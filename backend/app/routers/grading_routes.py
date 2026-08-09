"""
MILESTONE 3 — Subjective grading pipeline.

Flow per the brief:
  1. After objective (mcq/multi_select) auto-evaluation on submit, every
     short_answer / long_answer / image_upload answer is passed through
     the LLM grading module (ai_grading.grade_subjective) -> AI score +
     justification + key points, status becomes 'ai_graded'.
  2. Examiners open the grading queue (question-grouped: all students'
     answers to the same question shown together for grading
     consistency), see the AI score pre-filled, and can accept or
     override it -> status becomes 'examiner_reviewed'.
  3. Once every subjective answer in a session is examiner_reviewed (or
     there were none to begin with), the examiner publishes the result;
     only then does the student's results dashboard show it.
"""
import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db
from ..auth_utils import require_role
from ..models import RoleEnum, User, QuestionTypeEnum, GradingStatusEnum, SessionStatusEnum
from .. import ai_grading

router = APIRouter(tags=["Subjective Grading (Milestone 3, Examiner)"])

SUBJECTIVE_TYPES = (QuestionTypeEnum.short_answer, QuestionTypeEnum.long_answer, QuestionTypeEnum.image_upload)


# ---------------------------------------------------------------------
# Internal — shared with attempt_routes.submit_exam (auto-trigger on submit)
# ---------------------------------------------------------------------
def run_ai_grading_for_session(db: Session, session: models.ExamSession) -> None:
    rows = (
        db.query(models.Answer, models.QuestionBank)
        .join(models.QuestionBank, models.Answer.question_id == models.QuestionBank.question_id)
        .filter(models.Answer.session_id == session.session_id)
        .all()
    )
    ai_total = 0.0
    for answer, question in rows:
        if question.question_type not in SUBJECTIVE_TYPES:
            continue
        if answer.grading_status not in (None, GradingStatusEnum.not_applicable, GradingStatusEnum.pending_ai):
            ai_total += answer.ai_score or 0.0
            continue  # already graded — don't clobber an examiner's work

        answer_text = answer.submitted_answer
        if question.question_type == QuestionTypeEnum.image_upload and answer.image_path:
            ocr_text = ai_grading.ocr_image(answer.image_path)
            answer.ocr_text = ocr_text
            answer_text = ocr_text  # grade on OCR'd text when available

        result = ai_grading.grade_subjective(question.question_text, question.model_answer, answer_text)
        answer.ai_score = round(result.score_fraction * question.marks, 2)
        answer.ai_justification = result.justification
        answer.ai_key_points_matched = json.dumps(result.key_points_matched)
        answer.ai_key_points_missed = json.dumps(result.key_points_missed)
        answer.grading_status = GradingStatusEnum.ai_graded
        ai_total += answer.ai_score
    db.commit()

    # Roll the AI first-pass total into the Result row so examiners have a
    # reference figure before they've reviewed anything.
    result_row = db.query(models.Result).filter(models.Result.session_id == session.session_id).first()
    if result_row:
        result_row.ai_score = round(ai_total, 2)
        db.commit()


def _recompute_result_marks(db: Session, session_id: str) -> models.Result:
    result_row = db.query(models.Result).filter(models.Result.session_id == session_id).first()
    if not result_row:
        result_row = models.Result(session_id=session_id)
        db.add(result_row)
        db.commit()
        db.refresh(result_row)

    answers = db.query(models.Answer).filter(models.Answer.session_id == session_id).all()
    subjective_total = 0.0
    for a in answers:
        question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == a.question_id).first()
        if not question or question.question_type not in SUBJECTIVE_TYPES:
            continue
        score = a.examiner_score if a.examiner_score is not None else (a.ai_score or 0.0)
        subjective_total += score

    result_row.subjective_marks = round(subjective_total, 2)
    result_row.marks = round((result_row.objective_marks or 0.0) + result_row.subjective_marks, 2)
    db.commit()
    db.refresh(result_row)
    return result_row


# ---------------------------------------------------------------------
# 1. MANUAL AI-GRADE TRIGGER (examiner/admin) — normally runs automatically
#    on submit, this is for re-running / demoing independently.
# ---------------------------------------------------------------------
@router.post("/api/sessions/{session_id}/ai-grade", status_code=status.HTTP_202_ACCEPTED)
def trigger_ai_grading(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    session = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    if session.status not in (SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted):
        raise HTTPException(status_code=400, detail="Session has not been submitted yet")
    run_ai_grading_for_session(db, session)
    _recompute_result_marks(db, session_id)
    return {"detail": "AI grading complete"}


# ---------------------------------------------------------------------
# 2. GRADING QUEUE — question-grouped, AI score pre-filled & editable
# ---------------------------------------------------------------------
@router.get("/api/grading/queue", response_model=List[schemas.GradingQueueItem])
def grading_queue(
    exam_id: Optional[str] = None,
    question_id: Optional[str] = None,
    status_filter: Optional[GradingStatusEnum] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    query = (
        db.query(models.Answer, models.QuestionBank, models.ExamSession, models.User)
        .join(models.QuestionBank, models.Answer.question_id == models.QuestionBank.question_id)
        .join(models.ExamSession, models.Answer.session_id == models.ExamSession.session_id)
        .join(models.User, models.ExamSession.student_id == models.User.user_id)
        .filter(models.QuestionBank.question_type.in_(SUBJECTIVE_TYPES))
    )
    if exam_id:
        query = query.filter(models.ExamSession.exam_id == exam_id)
    if question_id:
        query = query.filter(models.Answer.question_id == question_id)
    if status_filter:
        query = query.filter(models.Answer.grading_status == status_filter)

    rows = query.order_by(models.Answer.question_id.asc(), models.User.name.asc()).all()

    items = []
    for answer, question, session, student in rows:
        items.append(schemas.GradingQueueItem(
            answer_id=answer.answer_id,
            session_id=session.session_id,
            student_name=student.name,
            question_id=question.question_id,
            question_text=question.question_text,
            question_type=question.question_type,
            marks=question.marks,
            model_answer=question.model_answer,
            submitted_answer=answer.submitted_answer,
            image_path=answer.image_path,
            ocr_text=answer.ocr_text,
            grading_status=answer.grading_status or GradingStatusEnum.pending_ai,
            ai_score=answer.ai_score,
            ai_justification=answer.ai_justification,
            ai_key_points_matched=json.loads(answer.ai_key_points_matched) if answer.ai_key_points_matched else None,
            ai_key_points_missed=json.loads(answer.ai_key_points_missed) if answer.ai_key_points_missed else None,
            examiner_score=answer.examiner_score,
            examiner_feedback=answer.examiner_feedback,
        ))
    return items


# ---------------------------------------------------------------------
# 3. SCORE OVERRIDE — examiner accepts/edits the AI score
# ---------------------------------------------------------------------
@router.post("/api/grading/answers/{answer_id}/score", response_model=schemas.GradingQueueItem)
def set_examiner_score(
    answer_id: str,
    payload: schemas.ScoreOverrideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    answer = db.query(models.Answer).filter(models.Answer.answer_id == answer_id).first()
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")
    question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == answer.question_id).first()
    if not question or question.question_type not in SUBJECTIVE_TYPES:
        raise HTTPException(status_code=400, detail="This answer is not subjectively graded")
    if payload.score > question.marks:
        raise HTTPException(status_code=422, detail=f"score cannot exceed the question's max marks ({question.marks})")

    answer.examiner_score = payload.score
    answer.examiner_feedback = payload.feedback
    answer.grading_status = GradingStatusEnum.examiner_reviewed
    answer.graded_by = current_user.user_id
    answer.graded_at = datetime.utcnow()
    db.commit()
    db.refresh(answer)

    _recompute_result_marks(db, answer.session_id)

    session = db.query(models.ExamSession).filter(models.ExamSession.session_id == answer.session_id).first()
    student = db.query(models.User).filter(models.User.user_id == session.student_id).first()

    return schemas.GradingQueueItem(
        answer_id=answer.answer_id,
        session_id=answer.session_id,
        student_name=student.name if student else "",
        question_id=question.question_id,
        question_text=question.question_text,
        question_type=question.question_type,
        marks=question.marks,
        model_answer=question.model_answer,
        submitted_answer=answer.submitted_answer,
        image_path=answer.image_path,
        ocr_text=answer.ocr_text,
        grading_status=answer.grading_status,
        ai_score=answer.ai_score,
        ai_justification=answer.ai_justification,
        ai_key_points_matched=json.loads(answer.ai_key_points_matched) if answer.ai_key_points_matched else None,
        ai_key_points_missed=json.loads(answer.ai_key_points_missed) if answer.ai_key_points_missed else None,
        examiner_score=answer.examiner_score,
        examiner_feedback=answer.examiner_feedback,
    )


# ---------------------------------------------------------------------
# 4. PUBLISH RESULTS — locked until every subjective answer is reviewed
# ---------------------------------------------------------------------
@router.post("/api/results/{session_id}/publish", response_model=schemas.PublishResultOut)
def publish_result(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    session = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    if session.status not in (SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted):
        raise HTTPException(status_code=400, detail="Session has not been submitted yet")

    unreviewed = (
        db.query(models.Answer)
        .join(models.QuestionBank, models.Answer.question_id == models.QuestionBank.question_id)
        .filter(
            models.Answer.session_id == session_id,
            models.QuestionBank.question_type.in_(SUBJECTIVE_TYPES),
            models.Answer.grading_status != GradingStatusEnum.examiner_reviewed,
        )
        .count()
    )
    if unreviewed > 0:
        raise HTTPException(
            status_code=400,
            detail=f"{unreviewed} subjective answer(s) still need examiner review before publishing",
        )

    result_row = _recompute_result_marks(db, session_id)
    result_row.published = True
    result_row.published_at = datetime.utcnow()
    result_row.final_examiner_score = result_row.marks
    db.commit()
    db.refresh(result_row)

    max_marks = db.query(models.QuestionBank).join(
        models.ExamQuestion, models.ExamQuestion.question_id == models.QuestionBank.question_id
    ).filter(models.ExamQuestion.exam_id == session.exam_id).all()

    return schemas.PublishResultOut(
        session_id=session_id,
        published=True,
        marks=result_row.marks,
        max_marks=sum(q.marks for q in max_marks) if max_marks else result_row.marks,
    )
