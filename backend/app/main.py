import logging
import os
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import engine, Base, SessionLocal
from .routers import (
    auth_routes, dashboard_routes, question_routes, exam_routes,
    attempt_routes, review_routes, proctor_routes, grading_routes, upload_routes,
)
from . import models

logger = logging.getLogger("uvicorn.error")

# Creates all tables in the database if they don't already exist (includes
# the language/translation + password-reset + review-workflow additions,
# and the proctoring/subjective-grading/image-upload additions)
Base.metadata.create_all(bind=engine)

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(
    title="AI-Proctored Online Examination Platform - API",
    version="0.3.0 (Milestone 3)",
)

# Allow the Next.js frontend to call this API. Localhost stays enabled for
# local dev; add your deployed frontend URL(s) via the ALLOWED_ORIGINS env
# var (comma-separated), e.g. ALLOWED_ORIGINS=https://exam-platform.vercel.app
_default_origins = ["http://localhost:3000", "http://localhost:3001"]
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serves uploaded image answers / thumbnails for the examiner grading portal.
# NOTE: in production this should sit behind auth (e.g. a signed-URL proxy
# route) rather than a public static mount — flagged in README limitations.
app.mount(f"/{UPLOAD_DIR}", StaticFiles(directory=UPLOAD_DIR), name="uploads")

app.include_router(auth_routes.router)
app.include_router(dashboard_routes.router)
app.include_router(question_routes.router)
app.include_router(exam_routes.router)
app.include_router(attempt_routes.router)
app.include_router(upload_routes.router)
app.include_router(review_routes.router)
app.include_router(proctor_routes.router)
app.include_router(grading_routes.router)


# ---------------------------------------------------------------------
# Milestone 3 — APScheduler background job: server-side auto-submit.
# The client timer is never trusted; this job is the source of truth even
# if a student closes the tab or loses connectivity right at the deadline.
# ---------------------------------------------------------------------
def _auto_submit_expired_sessions():
    db = SessionLocal()
    try:
        in_progress = (
            db.query(models.ExamSession)
            .filter(models.ExamSession.status == models.SessionStatusEnum.in_progress)
            .all()
        )
        for session in in_progress:
            exam = db.query(models.Exam).filter(models.Exam.exam_id == session.exam_id).first()
            if not exam or not session.start_time:
                continue
            deadline = session.start_time + timedelta(minutes=exam.duration_minutes)
            if datetime.utcnow() >= deadline:
                # Reuse the exact same grading path the student-facing
                # submit endpoint uses, so behaviour is identical either way.
                from .routers.attempt_routes import _grade_session
                session.status = models.SessionStatusEnum.auto_submitted
                session.end_time = datetime.utcnow()
                session.review_status = models.ReviewStatusEnum.pending_review
                db.commit()
                db.refresh(session)
                _grade_session(db, session, exam)
                logger.info(f"Auto-submitted expired session {session.session_id}")
    except Exception:
        logger.exception("Auto-submit background job failed")
    finally:
        db.close()


scheduler = BackgroundScheduler()
scheduler.add_job(_auto_submit_expired_sessions, "interval", seconds=30, id="auto_submit_expired_sessions")


@app.on_event("startup")
def _start_scheduler():
    if not scheduler.running:
        scheduler.start()


@app.on_event("shutdown")
def _stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)


@app.get("/")
def root():
    return {"status": "ok", "message": "Exam Platform API is running"}
