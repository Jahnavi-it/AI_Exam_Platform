from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, ConfigDict, field_validator
from .models import (
    RoleEnum, QuestionTypeEnum, DifficultyEnum, SessionStatusEnum, ReviewStatusEnum,
    ProctorEventTypeEnum, GradingStatusEnum, SUPPORTED_LANGUAGES,
)


# ---------- AUTH ----------
class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: RoleEnum


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: str
    name: str
    email: EmailStr
    role: RoleEnum
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ---------- QUESTION BANK (Examiner) ----------
class QuestionBankCreate(BaseModel):
    question_text: str
    question_type: QuestionTypeEnum
    marks: float
    subject: str
    difficulty_level: DifficultyEnum
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    # Milestone 3: reference answer for LLM grading of short/long answers;
    # also shown to examiners as the rubric when reviewing image uploads.
    model_answer: Optional[str] = None
    auto_translate: bool = True

    @field_validator("marks")
    @classmethod
    def marks_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("marks must be greater than 0")
        return v


class QuestionBankOut(BaseModel):
    """Safe to show to ANY role — never includes correct_answer."""
    model_config = ConfigDict(from_attributes=True)
    question_id: str
    question_text: str
    question_type: QuestionTypeEnum
    marks: float
    subject: str
    difficulty_level: DifficultyEnum
    options: Optional[List[str]] = None
    created_at: datetime
    available_languages: Optional[List[str]] = None


class QuestionBankOutFull(QuestionBankOut):
    """Examiner/Admin-only view — includes the correct answer."""
    correct_answer: Optional[str] = None
    model_answer: Optional[str] = None


class QuestionTranslationCreate(BaseModel):
    language_code: str
    question_text: str
    options: Optional[List[str]] = None

    @field_validator("language_code")
    @classmethod
    def language_must_be_supported(cls, v):
        if v not in SUPPORTED_LANGUAGES:
            raise ValueError(f"language_code must be one of {SUPPORTED_LANGUAGES}")
        return v


class QuestionTranslationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    translation_id: str
    question_id: str
    language_code: str
    question_text: str
    options: Optional[List[str]] = None


# ---------- EXAMS (Admin) ----------
class ExamCreate(BaseModel):
    title: str
    subject: str
    duration_minutes: int
    start_time: datetime
    end_time: datetime
    negative_marks: float = 0.0
    pass_marks: Optional[float] = None
    # Milestone 3: proctoring configuration
    proctoring_enabled: bool = True
    gaze_sensitivity: float = 0.5
    max_tab_switch_warnings: int = 3

    @field_validator("duration_minutes")
    @classmethod
    def duration_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError("duration_minutes must be greater than 0")
        return v

    @field_validator("end_time")
    @classmethod
    def end_after_start(cls, v, info):
        start = info.data.get("start_time")
        if start and v <= start:
            raise ValueError("end_time must be after start_time")
        return v


class ExamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    exam_id: str
    title: str
    subject: str
    duration_minutes: int
    start_time: datetime
    end_time: datetime
    negative_marks: float
    pass_marks: Optional[float] = None
    proctoring_enabled: bool
    gaze_sensitivity: float
    max_tab_switch_warnings: int
    created_at: datetime


# ---------- EXAM <-> QUESTION LINKING (Admin) ----------
class AttachQuestionsRequest(BaseModel):
    question_ids: List[str]


# ---------- EXAM-TAKING (Student) ----------
class StudentQuestionOut(BaseModel):
    """What a student sees while taking the exam — no correct_answer."""
    question_id: str
    question_text: str
    question_type: QuestionTypeEnum
    marks: float
    options: Optional[List[str]] = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    session_id: str
    exam_id: str
    student_id: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: SessionStatusEnum


class StartExamResponse(BaseModel):
    session_id: str
    session_token: str          # Milestone 3: pass this to the proctor WS + image upload calls
    exam: ExamOut
    status: SessionStatusEnum
    start_time: datetime
    duration_minutes: int
    time_remaining_seconds: int
    questions: List[StudentQuestionOut]


class SessionStatusResponse(BaseModel):
    session_id: str
    status: SessionStatusEnum
    time_remaining_seconds: int


class AnswerSubmitRequest(BaseModel):
    question_id: str
    submitted_answer: str


class AnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    answer_id: str
    question_id: str
    submitted_answer: Optional[str] = None
    word_count: Optional[int] = None
    image_path: Optional[str] = None
    submitted_at: datetime


class SubmitExamResponse(BaseModel):
    session_id: str
    status: SessionStatusEnum
    marks: float
    max_marks: float
    feedback: str
    pass_marks: Optional[float] = None
    passed: Optional[bool] = None


class AnswerReviewItem(BaseModel):
    question_id: str
    question_text: str
    question_type: QuestionTypeEnum
    marks: float
    submitted_answer: Optional[str] = None
    image_path: Optional[str] = None
    correct_answer: Optional[str] = None
    is_correct: Optional[bool] = None
    # Milestone 3: subjective grading, visible once published
    grading_status: Optional[GradingStatusEnum] = None
    score_awarded: Optional[float] = None
    examiner_feedback: Optional[str] = None


class ResultOut(BaseModel):
    session_id: str
    exam_title: str
    status: SessionStatusEnum
    marks: float
    max_marks: float
    published: bool = False
    feedback: Optional[str] = None
    pass_marks: Optional[float] = None
    passed: Optional[bool] = None
    answers: List[AnswerReviewItem]
    review_status: Optional[ReviewStatusEnum] = None


class MySessionOut(BaseModel):
    session_id: str
    exam_id: str
    status: SessionStatusEnum


class ViolationReportRequest(BaseModel):
    reason: Optional[str] = None


# ---------- EXAMINER REVIEW WORKFLOW (Milestone 2) ----------
class PendingReviewSessionOut(BaseModel):
    session_id: str
    student_id: str
    student_name: str
    exam_id: str
    exam_title: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    violation_count: int
    marks: float
    max_marks: float


class LiveSessionOut(BaseModel):
    session_id: str
    student_id: str
    student_name: str
    exam_id: str
    exam_title: str
    start_time: datetime
    violation_count: int


class ReviewActionResponse(BaseModel):
    session_id: str
    review_status: ReviewStatusEnum
    message: str


# ---------- AI PROCTORING (Milestone 3) ----------
class ProctorHeartbeatIn(BaseModel):
    """Sent by the browser every ~10s. Only derived signals — never raw
    webcam frames — cross the wire, per the client-side-only CV design."""
    face_present: bool = True
    multiple_faces: bool = False
    gaze_away: bool = False
    tab_switch_event: bool = False
    window_blur_event: bool = False


class ProctorHeartbeatOut(BaseModel):
    suspicion_score: float
    flagged: bool
    warning: Optional[str] = None
    tab_switch_count: int
    max_tab_switch_warnings: int


class ProctorEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    proctor_event_id: str
    event_type: ProctorEventTypeEnum
    suspicion_delta: float
    suspicion_score_after: float
    details: Optional[str] = None
    created_at: datetime


class SessionProctorReport(BaseModel):
    session_id: str
    student_name: str
    exam_title: str
    suspicion_score: float
    tab_switch_count: int
    events: List[ProctorEventOut]


# ---------- SUBJECTIVE GRADING (Milestone 3) ----------
class GradingQueueItem(BaseModel):
    answer_id: str
    session_id: str
    student_name: str
    question_id: str
    question_text: str
    question_type: QuestionTypeEnum
    marks: float
    model_answer: Optional[str] = None
    submitted_answer: Optional[str] = None
    image_path: Optional[str] = None
    ocr_text: Optional[str] = None
    grading_status: GradingStatusEnum
    ai_score: Optional[float] = None
    ai_justification: Optional[str] = None
    ai_key_points_matched: Optional[List[str]] = None
    ai_key_points_missed: Optional[List[str]] = None
    examiner_score: Optional[float] = None
    examiner_feedback: Optional[str] = None


class ScoreOverrideRequest(BaseModel):
    score: float
    feedback: Optional[str] = None

    @field_validator("score")
    @classmethod
    def score_non_negative(cls, v):
        if v < 0:
            raise ValueError("score cannot be negative")
        return v


class PublishResultOut(BaseModel):
    session_id: str
    published: bool
    marks: float
    max_marks: float
