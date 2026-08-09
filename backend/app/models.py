import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Enum, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship

from .database import Base


def gen_uuid():
    return str(uuid.uuid4())


class RoleEnum(str, enum.Enum):
    admin = "admin"
    examiner = "examiner"
    student = "student"


class User(Base):
    __tablename__ = "users"

    user_id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)          # stored as bcrypt hash
    role = Column(Enum(RoleEnum), nullable=False)
    # Milestone 2: forgot/reset-password flow
    reset_token = Column(String, nullable=True)
    reset_token_expiry = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    exam_sessions = relationship("ExamSession", back_populates="student", foreign_keys="ExamSession.student_id")


class QuestionTypeEnum(str, enum.Enum):
    mcq = "mcq"
    multi_select = "multi_select"
    short_answer = "short_answer"
    long_answer = "long_answer"
    image_upload = "image_upload"


class DifficultyEnum(str, enum.Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


SUPPORTED_LANGUAGES = ["en", "hi", "te", "ta", "kn", "ml", "mr", "bn"]


class QuestionBank(Base):
    __tablename__ = "question_bank"

    question_id = Column(String, primary_key=True, default=gen_uuid)
    question_text = Column(Text, nullable=False)
    question_type = Column(Enum(QuestionTypeEnum), nullable=False)
    marks = Column(Float, nullable=False)
    subject = Column(String, nullable=False, index=True)
    difficulty_level = Column(Enum(DifficultyEnum), nullable=False)
    # options (JSON-encoded list) for mcq/multi_select, and the correct
    # answer used for auto-evaluation. Both optional because short/long/
    # image questions don't use them.
    options = Column(Text, nullable=True)
    correct_answer = Column(Text, nullable=True)
    # Milestone 3: reference answer used by the LLM grading module as the
    # rubric for short_answer / long_answer questions, and shown to
    # examiners reviewing image_upload (handwritten) answers.
    model_answer = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.user_id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    translations = relationship(
        "QuestionTranslation", back_populates="question", cascade="all, delete-orphan"
    )


class QuestionTranslation(Base):
    __tablename__ = "question_translations"

    translation_id = Column(String, primary_key=True, default=gen_uuid)
    question_id = Column(String, ForeignKey("question_bank.question_id"), nullable=False)
    language_code = Column(String, nullable=False)
    question_text = Column(Text, nullable=False)
    options = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    question = relationship("QuestionBank", back_populates="translations")

    __table_args__ = (
        UniqueConstraint("question_id", "language_code", name="uq_question_language"),
    )


class ExamQuestion(Base):
    __tablename__ = "exam_questions"

    exam_question_id = Column(String, primary_key=True, default=gen_uuid)
    exam_id = Column(String, ForeignKey("exams.exam_id"), nullable=False)
    question_id = Column(String, ForeignKey("question_bank.question_id"), nullable=False)


class Exam(Base):
    __tablename__ = "exams"

    exam_id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    negative_marks = Column(Float, default=0.0)
    pass_marks = Column(Float, nullable=True)
    # Milestone 3: proctoring configuration per exam.
    proctoring_enabled = Column(Boolean, default=True)
    gaze_sensitivity = Column(Float, default=0.5)          # 0 (lenient) - 1 (strict)
    max_tab_switch_warnings = Column(Integer, default=3)    # warnings before auto-flag
    created_by = Column(String, ForeignKey("users.user_id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SessionStatusEnum(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    submitted = "submitted"
    auto_submitted = "auto_submitted"


class ReviewStatusEnum(str, enum.Enum):
    pending_review = "pending_review"
    approved = "approved"
    rejected = "rejected"


class ExamSession(Base):
    __tablename__ = "exam_sessions"

    session_id = Column(String, primary_key=True, default=gen_uuid)
    student_id = Column(String, ForeignKey("users.user_id"), nullable=False)
    exam_id = Column(String, ForeignKey("exams.exam_id"), nullable=False)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    status = Column(Enum(SessionStatusEnum), default=SessionStatusEnum.not_started)

    # Milestone 2: examiner review workflow (manual approve/reject of a
    # submitted attempt, independent of the AI proctoring pipeline below).
    violation_count = Column(Integer, default=0)
    review_status = Column(Enum(ReviewStatusEnum), default=ReviewStatusEnum.pending_review, nullable=False)
    last_activity = Column(DateTime, default=datetime.utcnow)
    reviewed_by = Column(String, ForeignKey("users.user_id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    # Milestone 3: short-lived token (exam_id + student_id + session_id bound,
    # expires with the exam) required on proctoring/upload calls so a URL or
    # main JWT leak alone can't be used to puppet someone else's live session.
    session_token = Column(String, nullable=True)
    # Cumulative AI-proctoring suspicion score for this session, 0-100.
    suspicion_score = Column(Float, default=0.0)
    tab_switch_count = Column(Integer, default=0)

    student = relationship("User", back_populates="exam_sessions", foreign_keys=[student_id])
    proctor_events = relationship("ProctorEvent", back_populates="session")


class ProctorEventTypeEnum(str, enum.Enum):
    face_absent = "face_absent"
    face_present_again = "face_present_again"
    multiple_faces = "multiple_faces"
    gaze_away = "gaze_away"
    tab_switch = "tab_switch"
    window_blur = "window_blur"
    window_focus = "window_focus"
    session_flagged = "session_flagged"     # suspicion_score crossed threshold


class ProctorEvent(Base):
    __tablename__ = "proctor_events"

    proctor_event_id = Column(String, primary_key=True, default=gen_uuid)
    session_id = Column(String, ForeignKey("exam_sessions.session_id"), nullable=False)
    event_type = Column(Enum(ProctorEventTypeEnum), nullable=False)
    suspicion_delta = Column(Float, default=0.0)
    suspicion_score_after = Column(Float, default=0.0)
    details = Column(Text, nullable=True)   # short JSON blob, e.g. {"gaze_away_streak": 3}
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("ExamSession", back_populates="proctor_events")


class GradingStatusEnum(str, enum.Enum):
    not_applicable = "not_applicable"    # mcq / multi_select — auto-graded, no queue
    pending_ai = "pending_ai"            # subjective answer, AI grading not run yet
    ai_graded = "ai_graded"              # AI score/justification filled, awaiting examiner
    examiner_reviewed = "examiner_reviewed"  # examiner has set the final score


class Answer(Base):
    __tablename__ = "answers"

    answer_id = Column(String, primary_key=True, default=gen_uuid)
    session_id = Column(String, ForeignKey("exam_sessions.session_id"), nullable=False)
    question_id = Column(String, ForeignKey("question_bank.question_id"), nullable=False)
    submitted_answer = Column(Text, nullable=True)
    word_count = Column(Integer, nullable=True)       # short/long answer text
    image_path = Column(String, nullable=True)         # image_upload answers
    thumbnail_path = Column(String, nullable=True)
    ocr_text = Column(Text, nullable=True)              # best-effort OCR of image_path
    submitted_at = Column(DateTime, default=datetime.utcnow)

    # Milestone 3 — subjective grading pipeline
    grading_status = Column(Enum(GradingStatusEnum), default=GradingStatusEnum.not_applicable)
    ai_score = Column(Float, nullable=True)            # 0..question.marks
    ai_justification = Column(Text, nullable=True)
    ai_key_points_matched = Column(Text, nullable=True)   # JSON list[str]
    ai_key_points_missed = Column(Text, nullable=True)    # JSON list[str]
    examiner_score = Column(Float, nullable=True)      # 0..question.marks, overrides ai_score
    examiner_feedback = Column(Text, nullable=True)
    graded_by = Column(String, ForeignKey("users.user_id"), nullable=True)
    graded_at = Column(DateTime, nullable=True)


class Result(Base):
    __tablename__ = "results"

    result_id = Column(String, primary_key=True, default=gen_uuid)
    session_id = Column(String, ForeignKey("exam_sessions.session_id"), nullable=False)
    objective_marks = Column(Float, default=0.0)   # auto-graded mcq/multi_select total
    subjective_marks = Column(Float, default=0.0)  # sum of examiner-approved subjective scores
    marks = Column(Float, default=0.0)              # objective_marks + subjective_marks
    ai_score = Column(Float, nullable=True)          # sum of AI first-pass subjective scores
    final_examiner_score = Column(Float, nullable=True)
    feedback = Column(Text, nullable=True)
    # Milestone 3: students only see the result once an examiner publishes it
    # (objective-only exams can auto-publish since there's nothing to review).
    published = Column(Boolean, default=False)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
