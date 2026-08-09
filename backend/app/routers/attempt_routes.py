"""
Exam-taking engine (Student).

Flow:
  1. Student calls POST /api/attempts/start/{exam_id}
     -> creates (or resumes) an ExamSession, returns questions + timer info
        + a session_token (Milestone 3: used to authorize the proctoring
        WebSocket and image-upload calls for this session).
  2. Student calls POST /api/attempts/{session_id}/answer for each
     text-based question, or POST /api/attempts/{session_id}/answer/
     {question_id}/image for image_upload questions (see upload_routes.py).
  3. Student calls POST /api/attempts/{session_id}/submit (or the frontend
     timer hits 0 and auto-calls it; a background job in main.py also
     auto-submits server-side so a closed tab can't dodge the deadline).
     -> mcq/multi_select auto-graded (with negative marking); short/long/
        image answers are queued and handed off to the AI grading module
        (grading_routes). Objective-only exams publish immediately —
        exams with subjective questions wait for examiner review/publish.
  4. Student calls GET /api/attempts/{session_id}/result to see the score
     (blocked with 409 until published, if there's anything subjective).
"""
import json
import secrets
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..auth_utils import require_role, get_current_user
from ..models import RoleEnum, User, SessionStatusEnum, ReviewStatusEnum, QuestionTypeEnum, GradingStatusEnum
from . import grading_routes

router = APIRouter(prefix="/api/attempts", tags=["Exam Attempts (Student)"])

# Milestone 3: word-count ceilings enforced server-side on text answers so
# a student can't paste in an essay for a "short answer" question.
WORD_LIMITS = {
    QuestionTypeEnum.short_answer: 100,
    QuestionTypeEnum.long_answer: 500,
}

SUBJECTIVE_TYPES = (QuestionTypeEnum.short_answer, QuestionTypeEnum.long_answer, QuestionTypeEnum.image_upload)


# ---------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------
def _questions_for_exam(db: Session, exam: models.Exam) -> List[models.QuestionBank]:
    """Explicitly attached questions win; otherwise fall back to a
    subject match so the demo/basic flow works without an extra step."""
    links = db.query(models.ExamQuestion).filter(models.ExamQuestion.exam_id == exam.exam_id).all()
    if links:
        ids = [l.question_id for l in links]
        return db.query(models.QuestionBank).filter(models.QuestionBank.question_id.in_(ids)).all()
    return db.query(models.QuestionBank).filter(models.QuestionBank.subject == exam.subject).all()


def _grade_answer(question: models.QuestionBank, submitted_answer: Optional[str], negative_marks: float) -> float:
    """Returns marks earned (possibly negative) for ONE auto-gradable question."""
    if submitted_answer is None or submitted_answer.strip() == "":
        return 0.0  # unanswered -> no marks, no penalty

    if question.question_type == QuestionTypeEnum.mcq:
        correct = (question.correct_answer or "").strip().lower()
        given = submitted_answer.strip().lower()
        return question.marks if given == correct else -abs(negative_marks)

    if question.question_type == QuestionTypeEnum.multi_select:
        correct_set = {v.strip().lower() for v in (question.correct_answer or "").split(",") if v.strip()}
        given_set = {v.strip().lower() for v in submitted_answer.split(",") if v.strip()}
        return question.marks if given_set == correct_set else -abs(negative_marks)

    # short_answer / long_answer / image_upload -> not auto-graded here;
    # handled by the AI/examiner grading pipeline below.
    return 0.0


def _time_remaining_seconds(exam_session: models.ExamSession, exam: models.Exam) -> int:
    if not exam_session.start_time:
        return exam.duration_minutes * 60
    deadline = exam_session.start_time + timedelta(minutes=exam.duration_minutes)
    remaining = (deadline - datetime.utcnow()).total_seconds()
    return max(0, int(remaining))


def _build_start_response(db: Session, exam: models.Exam, exam_session: models.ExamSession) -> schemas.StartExamResponse:
    questions = _questions_for_exam(db, exam)
    q_out = [
        schemas.StudentQuestionOut(
            question_id=q.question_id,
            question_text=q.question_text,
            question_type=q.question_type,
            marks=q.marks,
            options=json.loads(q.options) if q.options else None,
        )
        for q in questions
    ]

    return schemas.StartExamResponse(
        session_id=exam_session.session_id,
        session_token=exam_session.session_token,
        exam=schemas.ExamOut.model_validate(exam),
        status=exam_session.status,
        start_time=exam_session.start_time,
        duration_minutes=exam.duration_minutes,
        time_remaining_seconds=_time_remaining_seconds(exam_session, exam),
        questions=q_out,
    )


def _grade_session(db: Session, exam_session: models.ExamSession, exam: models.Exam) -> models.Result:
    """Grades every mcq/multi_select answer (with negative marking), creates/
    updates the Result row, then hands short/long/image answers off to the
    AI grading module and queues them for examiner review. Publishes
    immediately if there's nothing subjective to review."""
    questions = {q.question_id: q for q in _questions_for_exam(db, exam)}
    answers = db.query(models.Answer).filter(models.Answer.session_id == exam_session.session_id).all()

    objective_total = 0.0
    for ans in answers:
        question = questions.get(ans.question_id)
        if not question:
            continue
        if question.question_type in (QuestionTypeEnum.mcq, QuestionTypeEnum.multi_select):
            objective_total += _grade_answer(question, ans.submitted_answer, exam.negative_marks)
        elif question.question_type in SUBJECTIVE_TYPES and ans.grading_status in (None, GradingStatusEnum.not_applicable):
            ans.grading_status = GradingStatusEnum.pending_ai

    has_subjective = any(q.question_type in SUBJECTIVE_TYPES for q in questions.values())
    feedback = (
        "MCQ/multi-select auto-graded. Subjective answers are being AI-scored "
        "and queued for examiner review — your result publishes once that's done."
        if has_subjective
        else "All questions auto-graded (MCQ / multi-select)."
    )

    result = db.query(models.Result).filter(models.Result.session_id == exam_session.session_id).first()
    if not result:
        result = models.Result(session_id=exam_session.session_id)
        db.add(result)
    result.objective_marks = round(objective_total, 2)
    result.marks = result.objective_marks  # subjective_marks folded in once graded
    result.feedback = feedback
    db.commit()
    db.refresh(result)

    if has_subjective:
        grading_routes.run_ai_grading_for_session(db, exam_session)
        result = grading_routes._recompute_result_marks(db, exam_session.session_id)
    else:
        # Nothing for an examiner to review — publish immediately.
        result.published = True
        result.published_at = datetime.utcnow()
        db.commit()
        db.refresh(result)

    return result


def _auto_close_if_expired(db: Session, exam_session: models.ExamSession, exam: models.Exam):
    """Call this before returning any session info — if time is up but the
    session is still 'in_progress', silently auto-submit it. Also called by
    the APScheduler background job in main.py so timeouts fire even if no
    one is actively polling this session."""
    if exam_session.status == SessionStatusEnum.in_progress and _time_remaining_seconds(exam_session, exam) <= 0:
        exam_session.status = SessionStatusEnum.auto_submitted
        exam_session.end_time = datetime.utcnow()
        exam_session.review_status = ReviewStatusEnum.pending_review
        db.commit()
        db.refresh(exam_session)
        _grade_session(db, exam_session, exam)


# ---------------------------------------------------------------------
# 1. START / RESUME EXAM
# ---------------------------------------------------------------------
@router.post("/start/{exam_id}", response_model=schemas.StartExamResponse, status_code=status.HTTP_201_CREATED)
def start_attempt(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    existing = (
        db.query(models.ExamSession)
        .filter(
            models.ExamSession.exam_id == exam_id,
            models.ExamSession.student_id == current_user.user_id,
        )
        .first()
    )

    if existing:
        _auto_close_if_expired(db, existing, exam)
        if existing.status in (SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted):
            raise HTTPException(status_code=400, detail="You have already submitted this exam")
        existing.last_activity = datetime.utcnow()
        if not existing.session_token:
            # Milestone 3: short-lived token binding this session_id to this
            # student, used to authorize the proctoring WebSocket and image
            # uploads — separate from the main login JWT so a leaked exam
            # URL can't be replayed to puppet the live session.
            existing.session_token = secrets.token_urlsafe(32)
        db.commit()
        db.refresh(existing)
        return _build_start_response(db, exam, existing)

    new_session = models.ExamSession(
        student_id=current_user.user_id,
        exam_id=exam_id,
        start_time=datetime.utcnow(),
        status=SessionStatusEnum.in_progress,
        violation_count=0,
        review_status=ReviewStatusEnum.pending_review,
        last_activity=datetime.utcnow(),
        session_token=secrets.token_urlsafe(32),
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return _build_start_response(db, exam, new_session)


# ---------------------------------------------------------------------
# 2. SUBMIT / UPDATE ONE TEXT ANSWER (auto-save as the student progresses)
# ---------------------------------------------------------------------
@router.post("/{session_id}/answer", response_model=schemas.AnswerOut, status_code=status.HTTP_200_OK)
def submit_answer(
    session_id: str,
    payload: schemas.AnswerSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    exam_session = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.session_id == session_id)
        .first()
    )
    if not exam_session:
        raise HTTPException(status_code=404, detail="Session not found")
    if exam_session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_session.exam_id).first()
    if exam:
        _auto_close_if_expired(db, exam_session, exam)

    if exam_session.status != SessionStatusEnum.in_progress:
        raise HTTPException(status_code=400, detail=f"Cannot answer — exam session is '{exam_session.status.value}'")

    question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == payload.question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.question_type == QuestionTypeEnum.image_upload:
        raise HTTPException(
            status_code=400,
            detail="image_upload answers go through POST /api/attempts/{session_id}/answer/{question_id}/image",
        )

    word_count = None
    limit = WORD_LIMITS.get(question.question_type)
    if limit is not None:
        word_count = len((payload.submitted_answer or "").split())
        if word_count > limit:
            raise HTTPException(
                status_code=422,
                detail=f"{question.question_type.value} answers are limited to {limit} words (got {word_count})",
            )

    existing_answer = (
        db.query(models.Answer)
        .filter(
            models.Answer.session_id == session_id,
            models.Answer.question_id == payload.question_id,
        )
        .first()
    )
    if existing_answer:
        existing_answer.submitted_answer = payload.submitted_answer
        existing_answer.word_count = word_count
        existing_answer.submitted_at = datetime.utcnow()
        answer = existing_answer
    else:
        answer = models.Answer(
            session_id=session_id,
            question_id=payload.question_id,
            submitted_answer=payload.submitted_answer,
            word_count=word_count,
        )
        db.add(answer)

    exam_session.last_activity = datetime.utcnow()
    db.commit()
    db.refresh(answer)
    return answer


# ---------------------------------------------------------------------
# 3. MANUAL VIOLATION REPORT (lightweight counter — independent of the
#    full AI proctoring heartbeat/suspicion-score system in proctor_routes.py)
# ---------------------------------------------------------------------
@router.post("/{session_id}/violation", status_code=status.HTTP_200_OK)
def report_violation(
    session_id: str,
    payload: schemas.ViolationReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    exam_session = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.session_id == session_id)
        .first()
    )
    if not exam_session:
        raise HTTPException(status_code=404, detail="Session not found")
    if exam_session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    exam_session.violation_count = (exam_session.violation_count or 0) + 1
    exam_session.last_activity = datetime.utcnow()
    db.commit()
    return {"session_id": session_id, "violation_count": exam_session.violation_count}


# ---------------------------------------------------------------------
# 4. SUBMIT EXAM (manual submit, or called by the frontend on timeout)
# ---------------------------------------------------------------------
@router.post("/{session_id}/submit", response_model=schemas.SubmitExamResponse)
def finalize_attempt(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    exam_session = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.session_id == session_id)
        .first()
    )
    if not exam_session:
        raise HTTPException(status_code=404, detail="Session not found")
    if exam_session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_session.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    if exam_session.status in (SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted):
        result = db.query(models.Result).filter(models.Result.session_id == session_id).first()
        max_marks = sum(q.marks for q in _questions_for_exam(db, exam))
        passed = result.marks >= exam.pass_marks if (result and exam.pass_marks is not None) else None
        return schemas.SubmitExamResponse(
            session_id=exam_session.session_id,
            status=exam_session.status,
            marks=result.marks if result else 0.0,
            max_marks=max_marks,
            feedback=result.feedback if result else "",
            pass_marks=exam.pass_marks,
            passed=passed,
        )

    exam_session.status = SessionStatusEnum.submitted
    exam_session.end_time = datetime.utcnow()
    exam_session.review_status = ReviewStatusEnum.pending_review
    db.commit()
    db.refresh(exam_session)

    result = _grade_session(db, exam_session, exam)
    max_marks = sum(q.marks for q in _questions_for_exam(db, exam))
    passed = result.marks >= exam.pass_marks if exam.pass_marks is not None else None

    return schemas.SubmitExamResponse(
        session_id=exam_session.session_id,
        status=exam_session.status,
        marks=result.marks,
        max_marks=max_marks,
        feedback=result.feedback,
        pass_marks=exam.pass_marks,
        passed=passed,
    )


# ---------------------------------------------------------------------
# 5. SESSION INFO (frontend polls this to decide Start / Resume / View Result)
# ---------------------------------------------------------------------
@router.get("/{session_id}", response_model=schemas.SessionOut)
def get_attempt(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam_session = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.session_id == session_id)
        .first()
    )
    if not exam_session:
        raise HTTPException(status_code=404, detail="Session not found")
    if current_user.role == RoleEnum.student and exam_session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_session.exam_id).first()
    if exam:
        _auto_close_if_expired(db, exam_session, exam)
    return exam_session


@router.get("/mine/all", response_model=List[schemas.SessionOut])
def list_my_attempts(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    sessions = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.student_id == current_user.user_id)
        .order_by(models.ExamSession.start_time.desc())
        .all()
    )
    for s in sessions:
        exam = db.query(models.Exam).filter(models.Exam.exam_id == s.exam_id).first()
        if exam:
            _auto_close_if_expired(db, s, exam)
    return sessions


# ---------------------------------------------------------------------
# 6. RESULT (detailed, question-by-question review)
# ---------------------------------------------------------------------
@router.get("/{session_id}/result", response_model=schemas.ResultOut)
def get_result(
    session_id: str,
    lang: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam_session = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.session_id == session_id)
        .first()
    )
    if not exam_session:
        raise HTTPException(status_code=404, detail="Session not found")
    if current_user.role == RoleEnum.student and exam_session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_session.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    _auto_close_if_expired(db, exam_session, exam)

    if exam_session.status not in (SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted):
        raise HTTPException(status_code=400, detail="Exam not submitted yet")

    result = (
        db.query(models.Result)
        .filter(models.Result.session_id == session_id)
        .order_by(models.Result.created_at.desc())
        .first()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    # Milestone 3+: students only see the result once grading is published.
    # Pass/Fail verdict itself depends on review_status (handled below) —
    # pending_review just shows "Awaiting Review" on the frontend, it
    # doesn't block the result from loading.
    if current_user.role == RoleEnum.student and not result.published:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your result is still being graded and hasn't been published yet",
        )

    questions = {q.question_id: q for q in _questions_for_exam(db, exam)}
    max_marks = sum(q.marks for q in questions.values())
    answers = db.query(models.Answer).filter(models.Answer.session_id == session_id).all()
    answers_by_qid = {a.question_id: a for a in answers}
    review_items = []
    for qid, q in questions.items():
        ans = answers_by_qid.get(qid)
        submitted_answer = ans.submitted_answer if ans else None
        is_correct = None
        grading_status = None
        score_awarded = None
        examiner_feedback = None
        correct_answer_out = None
        if q.question_type in (QuestionTypeEnum.mcq, QuestionTypeEnum.multi_select):
            correct_answer_out = q.correct_answer
            if submitted_answer is not None and q.correct_answer:
                is_correct = _grade_answer(q, submitted_answer, 0) > 0
        elif q.question_type in SUBJECTIVE_TYPES and ans:
            grading_status = ans.grading_status
            score_awarded = ans.examiner_score if ans.examiner_score is not None else ans.ai_score
            examiner_feedback = ans.examiner_feedback
        review_items.append(
            schemas.AnswerReviewItem(
                question_id=q.question_id,
                question_text=q.question_text,
                question_type=q.question_type,
                marks=q.marks,
                submitted_answer=submitted_answer,
                image_path=ans.image_path if ans else None,
                correct_answer=correct_answer_out,
                is_correct=is_correct,
                grading_status=grading_status,
                score_awarded=score_awarded,
                examiner_feedback=examiner_feedback,
            )
        )

    # Reject always wins over the marks-based calculation.
    if exam_session.review_status == ReviewStatusEnum.rejected:
        passed = False
    elif exam.pass_marks is not None:
        passed = result.marks >= exam.pass_marks
    elif exam_session.review_status == ReviewStatusEnum.approved:
        passed = True
    else:
        passed = None

    if exam_session.review_status == ReviewStatusEnum.rejected:
        feedback = "Your attempt was reviewed and rejected by the examiner. Result: Failed."
    else:
        feedback = result.feedback
        if not feedback:
            feedback = f"You scored {result.marks} out of {max_marks}."
        if passed is True and "passed" not in feedback.lower():
            feedback += " You passed."
        elif passed is False and "fail" not in feedback.lower():
            feedback += " You did not pass."

    return schemas.ResultOut(
        session_id=session_id,
        exam_title=exam.title,
        status=exam_session.status,
        marks=result.marks,
        max_marks=max_marks,
        published=result.published,
        feedback=feedback,
        pass_marks=exam.pass_marks,
        passed=passed,
        answers=review_items,
        review_status=exam_session.review_status,
    )
