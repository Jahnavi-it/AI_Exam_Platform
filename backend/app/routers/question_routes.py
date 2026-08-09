import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db
from ..auth_utils import require_role, get_current_user
from ..models import RoleEnum, User, SUPPORTED_LANGUAGES
from ..translate_utils import translate_question

router = APIRouter(prefix="/api/questions", tags=["Question Bank (Examiner)"])


def _options_to_json(options):
    if not options:
        return None
    return json.dumps(options)


def _available_languages(q: models.QuestionBank) -> List[str]:
    langs = ["en"] + [t.language_code for t in q.translations]
    return langs


def _question_to_full_dict(q: models.QuestionBank) -> dict:
    """Examiner/Admin view — includes correct_answer + model_answer, options as a list."""
    return {
        "question_id": q.question_id,
        "question_text": q.question_text,
        "question_type": q.question_type,
        "marks": q.marks,
        "subject": q.subject,
        "difficulty_level": q.difficulty_level,
        "options": json.loads(q.options) if q.options else None,
        "correct_answer": q.correct_answer,
        "model_answer": q.model_answer,
        "created_at": q.created_at,
        "available_languages": _available_languages(q),
    }


def _question_to_safe_dict(q: models.QuestionBank) -> dict:
    """Any-role view — never includes correct_answer or model_answer."""
    return {
        "question_id": q.question_id,
        "question_text": q.question_text,
        "question_type": q.question_type,
        "marks": q.marks,
        "subject": q.subject,
        "difficulty_level": q.difficulty_level,
        "options": json.loads(q.options) if q.options else None,
        "created_at": q.created_at,
        "available_languages": _available_languages(q),
    }


def _apply_translation(q: models.QuestionBank, lang: Optional[str], base: dict) -> dict:
    """Overlay question_text/options with the requested language's
    translation if it exists. Falls back to English (the base dict)
    silently if lang is None, 'en', unsupported, or not translated yet."""
    if not lang or lang == "en":
        return base

    if lang not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=422, detail=f"lang must be one of {SUPPORTED_LANGUAGES}")

    match = next((t for t in q.translations if t.language_code == lang), None)
    if not match:
        return base  # fallback to English silently

    base = dict(base)
    base["question_text"] = match.question_text
    base["options"] = json.loads(match.options) if match.options else None
    return base


@router.post("", response_model=schemas.QuestionBankOutFull, status_code=status.HTTP_201_CREATED)
def create_question(
    payload: schemas.QuestionBankCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    # mcq / multi_select questions need options + a correct_answer so the
    # exam-taking engine can auto-grade them.
    if payload.question_type in (models.QuestionTypeEnum.mcq, models.QuestionTypeEnum.multi_select):
        if not payload.options or len(payload.options) < 2:
            raise HTTPException(status_code=422, detail="mcq/multi_select questions need at least 2 options")
        if not payload.correct_answer:
            raise HTTPException(status_code=422, detail="mcq/multi_select questions need a correct_answer")

    # Milestone 3: short/long answer questions need a model_answer so the
    # LLM grading module has something to score against.
    if payload.question_type in (models.QuestionTypeEnum.short_answer, models.QuestionTypeEnum.long_answer):
        if not payload.model_answer:
            raise HTTPException(status_code=422, detail="short_answer/long_answer questions need a model_answer for AI grading")

    # image_upload questions must have max marks defined (marks is a
    # required field on the schema already, so this just makes the rule
    # explicit and rejects 0).
    if payload.question_type == models.QuestionTypeEnum.image_upload and payload.marks <= 0:
        raise HTTPException(status_code=422, detail="image_upload questions must have max marks defined")

    question = models.QuestionBank(
        question_text=payload.question_text,
        question_type=payload.question_type,
        marks=payload.marks,
        subject=payload.subject,
        difficulty_level=payload.difficulty_level,
        options=_options_to_json(payload.options),
        correct_answer=payload.correct_answer,
        model_answer=payload.model_answer,
        created_by=current_user.user_id,
    )
    db.add(question)
    db.commit()
    db.refresh(question)

    if payload.auto_translate:
        translations = translate_question(payload.question_text, payload.options)
        for lang_code, data in translations.items():
            db.add(models.QuestionTranslation(
                question_id=question.question_id,
                language_code=lang_code,
                question_text=data["question_text"],
                options=_options_to_json(data["options"]),
            ))
        db.commit()
        db.refresh(question)

    return _question_to_full_dict(question)


@router.get("", response_model=List[schemas.QuestionBankOut])
def list_questions(
    subject: Optional[str] = None,
    difficulty_level: Optional[models.DifficultyEnum] = None,
    lang: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),  # any logged-in role can view
):
    query = db.query(models.QuestionBank)
    if subject:
        query = query.filter(models.QuestionBank.subject == subject)
    if difficulty_level:
        query = query.filter(models.QuestionBank.difficulty_level == difficulty_level)
    questions = query.order_by(models.QuestionBank.created_at.desc()).all()
    return [_apply_translation(q, lang, _question_to_safe_dict(q)) for q in questions]


@router.get("/mine-detailed", response_model=List[schemas.QuestionBankOutFull])
def list_questions_detailed(
    subject: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    """Examiner/Admin-only: includes correct_answer/model_answer, used when
    picking questions to attach to an exam."""
    query = db.query(models.QuestionBank)
    if subject:
        query = query.filter(models.QuestionBank.subject == subject)
    questions = query.order_by(models.QuestionBank.created_at.desc()).all()
    return [_question_to_full_dict(q) for q in questions]


@router.get("/{question_id}", response_model=schemas.QuestionBankOut)
def get_question(
    question_id: str,
    lang: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    return _apply_translation(question, lang, _question_to_safe_dict(question))


@router.post("/{question_id}/translations", response_model=schemas.QuestionTranslationOut, status_code=status.HTTP_201_CREATED)
def add_or_update_translation(
    question_id: str,
    payload: schemas.QuestionTranslationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    """Manual override — lets an examiner fix a machine translation by hand."""
    question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    existing = db.query(models.QuestionTranslation).filter(
        models.QuestionTranslation.question_id == question_id,
        models.QuestionTranslation.language_code == payload.language_code,
    ).first()

    if existing:
        existing.question_text = payload.question_text
        existing.options = _options_to_json(payload.options)
        db.commit()
        db.refresh(existing)
        return existing

    translation = models.QuestionTranslation(
        question_id=question_id,
        language_code=payload.language_code,
        question_text=payload.question_text,
        options=_options_to_json(payload.options),
    )
    db.add(translation)
    db.commit()
    db.refresh(translation)
    return translation


@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(
    question_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    question = db.query(models.QuestionBank).filter(models.QuestionBank.question_id == question_id).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(question)
    db.commit()
    return None
