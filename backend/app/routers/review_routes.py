from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..auth_utils import require_role
from ..models import RoleEnum, User, SessionStatusEnum, ReviewStatusEnum
from ..schemas import PendingReviewSessionOut, LiveSessionOut, ReviewActionResponse
from . import grading_routes

router = APIRouter(prefix="/api/review", tags=["Examiner Review"])

def _max_marks(db: Session, exam_id: str) -> float:
    qids = [
        eq.question_id
        for eq in db.query(models.ExamQuestion).filter(models.ExamQuestion.exam_id == exam_id).all()
    ]
    qs = db.query(models.QuestionBank).filter(models.QuestionBank.question_id.in_(qids)).all()
    return sum(q.marks for q in qs)

@router.get("/live", response_model=List[LiveSessionOut])
def list_live_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    sessions = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.status == SessionStatusEnum.in_progress)
        .all()
    )
    out = []
    for s in sessions:
        student = db.query(models.User).filter(models.User.user_id == s.student_id).first()
        exam = db.query(models.Exam).filter(models.Exam.exam_id == s.exam_id).first()
        if not student or not exam:
            continue
        out.append(
            LiveSessionOut(
                session_id=s.session_id,
                student_id=s.student_id,
                student_name=student.name,
                exam_id=s.exam_id,
                exam_title=exam.title,
                start_time=s.start_time,
                violation_count=s.violation_count or 0,
            )
        )
    return out

@router.get("/pending", response_model=List[PendingReviewSessionOut])
def list_pending_reviews(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    sessions = (
        db.query(models.ExamSession)
        .filter(
            models.ExamSession.status.in_(
                [SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted]
            ),
            models.ExamSession.review_status == ReviewStatusEnum.pending_review,
        )
        .all()
    )
    out = []
    for s in sessions:
        student = db.query(models.User).filter(models.User.user_id == s.student_id).first()
        exam = db.query(models.Exam).filter(models.Exam.exam_id == s.exam_id).first()
        result = (
            db.query(models.Result)
            .filter(models.Result.session_id == s.session_id)
            .order_by(models.Result.created_at.desc())
            .first()
        )
        if not student or not exam:
            continue
        out.append(
            PendingReviewSessionOut(
                session_id=s.session_id,
                student_id=s.student_id,
                student_name=student.name,
                exam_id=s.exam_id,
                exam_title=exam.title,
                start_time=s.start_time,
                end_time=s.end_time,
                violation_count=s.violation_count or 0,
                marks=result.marks if result else 0.0,
                max_marks=_max_marks(db, s.exam_id),
            )
        )
    return out

@router.get("/pending/count")
def pending_review_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    count = (
        db.query(models.ExamSession)
        .filter(
            models.ExamSession.status.in_(
                [SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted]
            ),
            models.ExamSession.review_status == ReviewStatusEnum.pending_review,
        )
        .count()
    )
    return {"pending_count": count}

@router.post("/{session_id}/approve", response_model=ReviewActionResponse)
def approve_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    s = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    s.review_status = ReviewStatusEnum.approved
    s.reviewed_by = current_user.user_id
    s.reviewed_at = datetime.utcnow()
    db.commit()

    # Approving finalizes the attempt for the student -- publish the
    # result too, so it shows up immediately without a separate step.
    result_row = grading_routes._recompute_result_marks(db, session_id)
    result_row.published = True
    result_row.published_at = datetime.utcnow()
    result_row.final_examiner_score = result_row.marks
    db.commit()

    return ReviewActionResponse(session_id=session_id, review_status=s.review_status, message="Approved")

@router.post("/{session_id}/reject", response_model=ReviewActionResponse)
def reject_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    s = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    s.review_status = ReviewStatusEnum.rejected
    s.reviewed_by = current_user.user_id
    s.reviewed_at = datetime.utcnow()
    db.commit()

    # Reject is also a final decision -- publish so the student sees the
    # Failed verdict right away instead of waiting on a separate publish.
    result_row = grading_routes._recompute_result_marks(db, session_id)
    result_row.published = True
    result_row.published_at = datetime.utcnow()
    result_row.final_examiner_score = result_row.marks
    db.commit()

    return ReviewActionResponse(session_id=session_id, review_status=s.review_status, message="Rejected")