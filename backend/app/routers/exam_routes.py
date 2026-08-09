from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db
from ..auth_utils import require_role, get_current_user
from ..models import RoleEnum, User

router = APIRouter(prefix="/api/exams", tags=["Exam Configuration (Admin)"])


@router.post("", response_model=schemas.ExamOut, status_code=status.HTTP_201_CREATED)
def create_exam(
    payload: schemas.ExamCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.admin])),
):
    exam = models.Exam(
        title=payload.title,
        subject=payload.subject,
        duration_minutes=payload.duration_minutes,
        start_time=payload.start_time,
        end_time=payload.end_time,
        negative_marks=payload.negative_marks,
        pass_marks=payload.pass_marks,
        # Milestone 3: proctoring configuration
        proctoring_enabled=payload.proctoring_enabled,
        gaze_sensitivity=payload.gaze_sensitivity,
        max_tab_switch_warnings=payload.max_tab_switch_warnings,
        created_by=current_user.user_id,
    )
    db.add(exam)
    db.commit()
    db.refresh(exam)
    return exam


@router.get("", response_model=List[schemas.ExamOut])
def list_exams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(models.Exam).order_by(models.Exam.start_time.asc()).all()


@router.get("/{exam_id}", response_model=schemas.ExamOut)
def get_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    return exam


@router.delete("/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.admin])),
):
    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    db.delete(exam)
    db.commit()
    return None


# ---------------------------------------------------------------------
# Attach specific Question Bank questions to an exam. If an exam has no
# explicitly attached questions, the exam-taking engine (attempt_routes.py)
# falls back to matching by subject, so this step is optional but
# recommended for real usage.
# ---------------------------------------------------------------------
@router.post("/{exam_id}/questions", status_code=status.HTTP_201_CREATED)
def attach_questions_to_exam(
    exam_id: str,
    payload: schemas.AttachQuestionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.admin, RoleEnum.examiner])),
):
    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    # Remove any questions previously attached, then attach the new set
    # (keeps this endpoint idempotent / easy to re-run from the Admin UI).
    db.query(models.ExamQuestion).filter(models.ExamQuestion.exam_id == exam_id).delete()

    attached = []
    for qid in payload.question_ids:
        question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == qid).first()
        if not question:
            continue
        link = models.ExamQuestion(exam_id=exam_id, question_id=qid)
        db.add(link)
        attached.append(qid)

    db.commit()
    return {"exam_id": exam_id, "attached_question_ids": attached}


@router.get("/{exam_id}/attached-question-ids", response_model=List[str])
def get_attached_question_ids(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    links = db.query(models.ExamQuestion).filter(models.ExamQuestion.exam_id == exam_id).all()
    return [l.question_id for l in links]
