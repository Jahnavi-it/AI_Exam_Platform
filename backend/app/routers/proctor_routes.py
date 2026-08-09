"""
MILESTONE 3 — AI Proctoring Engine (server side).

The heavy lifting (MediaPipe Face Detection + FaceMesh, gaze estimation,
multi-face detection) runs client-side in the browser via TensorFlow.js —
no webcam frames are ever sent here, only derived boolean/count signals,
per the brief's privacy design. This module:

  1. Accepts a heartbeat every ~10s (WebSocket, with a REST fallback for
     browsers/proxies that can't hold a socket open) containing the
     current signal snapshot.
  2. Converts signals into suspicion-score deltas and persists a
     ProctorEvent row only for actual violations (not every heartbeat).
  3. Enforces "single active session per student-exam pair" by rejecting
     a second concurrent WebSocket for the same session_id.
  4. Exposes an examiner/admin-only endpoint to review a session's
     flagged events with timestamps — students never see this.
"""
import json
from datetime import datetime
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db, SessionLocal
from ..auth_utils import require_role
from ..models import RoleEnum, User, SessionStatusEnum, ProctorEventTypeEnum

router = APIRouter(tags=["AI Proctoring (Milestone 3)"])

# session_id -> connected WebSocket. In-memory registry used to enforce a
# single live proctoring connection per session (i.e. the exam can't be
# open/monitored from two browser tabs at once). A multi-process deployment
# would move this to Redis; noted in the README limitations.
_active_connections: Dict[str, WebSocket] = {}

SUSPICION_CAP = 100.0
FLAG_THRESHOLD = 60.0

# suspicion-score deltas per violation signal
_DELTA = {
    ProctorEventTypeEnum.face_absent: 8.0,
    ProctorEventTypeEnum.multiple_faces: 15.0,
    ProctorEventTypeEnum.gaze_away: 4.0,
    ProctorEventTypeEnum.tab_switch: 10.0,
    ProctorEventTypeEnum.window_blur: 6.0,
}


def _get_session_or_404(db: Session, session_id: str) -> models.ExamSession:
    session = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Exam session not found")
    return session


def _record_event(db: Session, session: models.ExamSession, event_type: ProctorEventTypeEnum, details: dict = None) -> models.ProctorEvent:
    delta = _DELTA.get(event_type, 0.0)
    new_score = min(SUSPICION_CAP, round((session.suspicion_score or 0.0) + delta, 2))
    crossed_threshold = new_score >= FLAG_THRESHOLD and (session.suspicion_score or 0.0) < FLAG_THRESHOLD

    session.suspicion_score = new_score
    event = models.ProctorEvent(
        session_id=session.session_id,
        event_type=event_type,
        suspicion_delta=delta,
        suspicion_score_after=new_score,
        details=json.dumps(details) if details else None,
    )
    db.add(event)

    if crossed_threshold:
        db.add(models.ProctorEvent(
            session_id=session.session_id,
            event_type=ProctorEventTypeEnum.session_flagged,
            suspicion_delta=0.0,
            suspicion_score_after=new_score,
            details=json.dumps({"reason": f"suspicion_score crossed {FLAG_THRESHOLD}"}),
        ))

    db.commit()
    db.refresh(session)
    return event


def _apply_heartbeat(db: Session, session: models.ExamSession, payload: schemas.ProctorHeartbeatIn) -> None:
    if not payload.face_present:
        _record_event(db, session, ProctorEventTypeEnum.face_absent)
    if payload.multiple_faces:
        _record_event(db, session, ProctorEventTypeEnum.multiple_faces)
    if payload.gaze_away:
        _record_event(db, session, ProctorEventTypeEnum.gaze_away)
    if payload.window_blur_event:
        _record_event(db, session, ProctorEventTypeEnum.window_blur)
    if payload.tab_switch_event:
        session.tab_switch_count = (session.tab_switch_count or 0) + 1
        db.commit()
        db.refresh(session)
        _record_event(db, session, ProctorEventTypeEnum.tab_switch, {"tab_switch_count": session.tab_switch_count})


def _heartbeat_response(session: models.ExamSession, exam: models.Exam) -> schemas.ProctorHeartbeatOut:
    over_tab_limit = (session.tab_switch_count or 0) > (exam.max_tab_switch_warnings or 3)
    flagged = (session.suspicion_score or 0.0) >= FLAG_THRESHOLD or over_tab_limit
    warning = None
    if over_tab_limit:
        warning = f"Tab-switch limit ({exam.max_tab_switch_warnings}) exceeded — session auto-flagged."
    elif flagged:
        warning = "Suspicious activity threshold reached — session flagged for examiner review."
    return schemas.ProctorHeartbeatOut(
        suspicion_score=session.suspicion_score or 0.0,
        flagged=flagged,
        warning=warning,
        tab_switch_count=session.tab_switch_count or 0,
        max_tab_switch_warnings=exam.max_tab_switch_warnings or 3,
    )


def _validate_session_token(session: models.ExamSession, token: str) -> bool:
    if not session.session_token:
        return False
    return token == session.session_token


# ---------------------------------------------------------------------
# 1. WEBSOCKET HEARTBEAT — primary channel, one message every ~10s
# ---------------------------------------------------------------------
@router.websocket("/ws/proctor/{session_id}")
async def proctor_heartbeat_ws(websocket: WebSocket, session_id: str, token: str):
    """`token` is the exam session_token returned by /api/exams/{id}/start
    (query param, since browser WebSocket clients can't set custom auth
    headers) — binds this socket to exactly one student's live session."""
    db = SessionLocal()
    try:
        session = db.query(models.ExamSession).filter(models.ExamSession.session_id == session_id).first()
        if not session or not _validate_session_token(session, token):
            await websocket.close(code=4401)
            return
        if session.status != SessionStatusEnum.in_progress:
            await websocket.close(code=4403)
            return
        if session_id in _active_connections:
            # Single active session per student-exam pair — reject the 2nd tab.
            await websocket.close(code=4409)
            return

        await websocket.accept()
        _active_connections[session_id] = websocket

        while True:
            raw = await websocket.receive_json()
            db.refresh(session)
            if session.status != SessionStatusEnum.in_progress:
                break
            payload = schemas.ProctorHeartbeatIn(**raw)
            _apply_heartbeat(db, session, payload)
            exam = db.query(models.Exam).filter(models.Exam.exam_id == session.exam_id).first()
            await websocket.send_json(_heartbeat_response(session, exam).model_dump())
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        _active_connections.pop(session_id, None)
        db.close()


# ---------------------------------------------------------------------
# 2. REST FALLBACK — for environments where the WS can't stay open
# ---------------------------------------------------------------------
@router.post("/api/sessions/{session_id}/proctor/heartbeat", response_model=schemas.ProctorHeartbeatOut)
def proctor_heartbeat_rest(
    session_id: str,
    payload: schemas.ProctorHeartbeatIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.student])),
):
    session = _get_session_or_404(db, session_id)
    if session.student_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="This exam session does not belong to you")
    if session.status != SessionStatusEnum.in_progress:
        raise HTTPException(status_code=400, detail="Session is not in progress")

    _apply_heartbeat(db, session, payload)
    exam = db.query(models.Exam).filter(models.Exam.exam_id == session.exam_id).first()
    return _heartbeat_response(session, exam)


# ---------------------------------------------------------------------
# 3. EXAMINER/ADMIN — proctoring review panel data
#    Students never see their own suspicion score or event log.
# ---------------------------------------------------------------------
@router.get("/api/sessions/{session_id}/proctor/events", response_model=schemas.SessionProctorReport)
def get_proctor_events(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    session = _get_session_or_404(db, session_id)
    student = db.query(models.User).filter(models.User.user_id == session.student_id).first()
    exam = db.query(models.Exam).filter(models.Exam.exam_id == session.exam_id).first()
    events = (
        db.query(models.ProctorEvent)
        .filter(models.ProctorEvent.session_id == session_id)
        .order_by(models.ProctorEvent.created_at.asc())
        .all()
    )
    return schemas.SessionProctorReport(
        session_id=session_id,
        student_name=student.name if student else "Unknown",
        exam_title=exam.title if exam else "Unknown",
        suspicion_score=session.suspicion_score or 0.0,
        tab_switch_count=session.tab_switch_count or 0,
        events=events,
    )


@router.get("/api/exams/{exam_id}/proctor/flagged-sessions", response_model=List[schemas.SessionProctorReport])
def list_flagged_sessions(
    exam_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role([RoleEnum.examiner, RoleEnum.admin])),
):
    """All sessions for an exam whose suspicion score crossed the flag
    threshold — the entry point for the examiner's proctoring review panel."""
    sessions = (
        db.query(models.ExamSession)
        .filter(models.ExamSession.exam_id == exam_id, models.ExamSession.suspicion_score >= FLAG_THRESHOLD)
        .all()
    )
    exam = db.query(models.Exam).filter(models.Exam.exam_id == exam_id).first()
    reports = []
    for session in sessions:
        student = db.query(models.User).filter(models.User.user_id == session.student_id).first()
        events = (
            db.query(models.ProctorEvent)
            .filter(models.ProctorEvent.session_id == session.session_id)
            .order_by(models.ProctorEvent.created_at.asc())
            .all()
        )
        reports.append(schemas.SessionProctorReport(
            session_id=session.session_id,
            student_name=student.name if student else "Unknown",
            exam_title=exam.title if exam else "Unknown",
            suspicion_score=session.suspicion_score or 0.0,
            tab_switch_count=session.tab_switch_count or 0,
            events=events,
        ))
    return reports
