"""
MILESTONE 3 — image_upload answer submission (handwritten work / diagrams).

Students upload a photo; it's stored as a file with a server-generated
thumbnail. The answer is routed straight to examiner review with
best-effort OCR (see ai_grading.ocr_image) rather than auto-graded.
"""
import os
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Header
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db
from ..auth_utils import require_role
from ..models import RoleEnum, User, SessionStatusEnum, QuestionTypeEnum, GradingStatusEnum
from .attempt_routes import _auto_close_if_expired

router = APIRouter(prefix="/api/attempts", tags=["Image Answer Upload (Milestone 3, Student)"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10MB
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


def _ensure_upload_dirs(session_id: str):
    full_dir = os.path.join(UPLOAD_DIR, session_id)
    thumb_dir = os.path.join(full_dir, "thumbnails")
    os.makedirs(full_dir, exist_ok=True)
    os.makedirs(thumb_dir, exist_ok=True)
    return full_dir, thumb_dir


def _make_thumbnail(src_path: str, dest_path: str):
    try:
        from PIL import Image
        img = Image.open(src_path)
        img.thumbnail((320, 320))
        img.save(dest_path)
    except Exception:
        pass  # Pillow not installed / unreadable image — grading portal falls back to the full image


@router.post("/{session_id}/answer/{question_id}/image", response_model=schemas.AnswerOut)
async def upload_image_answer(
    session_id: str,
    question_id: str,
    file: UploadFile = File(...),
    x_session_token: str = Header(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    session = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    if session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="This exam session does not belong to you")
    if session.session_token and x_session_token != session.session_token:
        raise HTTPException(status_code=401, detail="Missing or invalid X-Session-Token header")

    exam = db.query(models.Exam).filter(models.Exam.exam_id == session.exam_id).first()
    if exam:
        _auto_close_if_expired(db, session, exam)
    if session.status != SessionStatusEnum.in_progress:
        raise HTTPException(status_code=400, detail=f"Cannot answer — exam session is '{session.status.value}'")

    question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    if question.question_type != QuestionTypeEnum.image_upload:
        raise HTTPException(status_code=400, detail="This question does not accept image answers")

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported image type: {file.content_type}")

    contents = await file.read()
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds the 10MB upload limit")

    full_dir, thumb_dir = _ensure_upload_dirs(session_id)
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    filename = f"{question_id}_{uuid.uuid4().hex}{ext}"
    full_path = os.path.join(full_dir, filename)
    thumb_path = os.path.join(thumb_dir, filename)

    with open(full_path, "wb") as f:
        f.write(contents)
    _make_thumbnail(full_path, thumb_path)

    answer = (
        db.query(models.Answer)
        .filter(models.Answer.session_id == session_id, models.Answer.question_id == question_id)
        .first()
    )
    if not answer:
        answer = models.Answer(session_id=session_id, question_id=question_id)
        db.add(answer)

    answer.image_path = full_path
    answer.thumbnail_path = thumb_path if os.path.exists(thumb_path) else None
    answer.submitted_answer = None
    answer.submitted_at = datetime.utcnow()
    answer.grading_status = GradingStatusEnum.pending_ai
    db.commit()
    db.refresh(answer)
    return answer
