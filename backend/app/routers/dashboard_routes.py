from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth_utils import require_role, get_current_user
from ..database import get_db
from ..models import RoleEnum, User, Exam, QuestionBank, ExamSession, ExamQuestion, Result, SessionStatusEnum

router = APIRouter(prefix="/api", tags=["Dashboards"])


# Only admins can hit this
@router.get("/admin/dashboard")
def admin_dashboard(
    current_user: User = Depends(require_role([RoleEnum.admin])),
    db: Session = Depends(get_db),
):
    total_students = db.query(User).filter(User.role == RoleEnum.student).count()
    total_examiners = db.query(User).filter(User.role == RoleEnum.examiner).count()
    total_admins = db.query(User).filter(User.role == RoleEnum.admin).count()
    total_users = total_students + total_examiners + total_admins

    total_exams = db.query(Exam).count()
    total_questions = db.query(QuestionBank).count()

    live_sessions_now = (
        db.query(ExamSession)
        .filter(ExamSession.status == SessionStatusEnum.in_progress)
        .count()
    )

    results = db.query(Result).all()
    percentages = []
    for r in results:
        session = db.query(ExamSession).filter(ExamSession.session_id == r.session_id).first()
        if not session:
            continue
        max_marks = (
            db.query(QuestionBank.marks)
            .join(ExamQuestion, ExamQuestion.question_id == QuestionBank.question_id)
            .filter(ExamQuestion.exam_id == session.exam_id)
            .all()
        )
        total_max = sum(m[0] for m in max_marks) if max_marks else 0
        if total_max > 0:
            percentages.append((r.marks / total_max) * 100)

    average_score = round(sum(percentages) / len(percentages), 1) if percentages else 0.0

    return {
        "message": f"Welcome Admin {current_user.name}",
        "role": current_user.role,
        "platform_users": total_users,
        "total_students": total_students,
        "total_examiners": total_examiners,
        "total_admins": total_admins,
        "total_exams": total_exams,
        "total_questions": total_questions,
        "live_sessions_now": live_sessions_now,
        "average_score": average_score,
    }


# Only examiners can hit this
@router.get("/examiner/dashboard")
def examiner_dashboard(
    current_user: User = Depends(require_role([RoleEnum.examiner])),
    db: Session = Depends(get_db),
):
    my_questions = db.query(QuestionBank).filter(QuestionBank.created_by == current_user.user_id).count()
    total_questions = db.query(QuestionBank).count()

    return {
        "message": f"Welcome Examiner {current_user.name}",
        "role": current_user.role,
        "my_questions": my_questions,
        "total_questions": total_questions,
    }


# Only students can hit this
@router.get("/student/dashboard")
def student_dashboard(
    current_user: User = Depends(require_role([RoleEnum.student])),
    db: Session = Depends(get_db),
):
    my_sessions = db.query(ExamSession).filter(ExamSession.student_id == current_user.user_id).all()
    completed = len([s for s in my_sessions if s.status in [SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted]])
    in_progress = len([s for s in my_sessions if s.status == SessionStatusEnum.in_progress])
    total_exams = db.query(Exam).count()

    return {
        "message": f"Welcome Student {current_user.name}",
        "role": current_user.role,
        "total_exams": total_exams,
        "completed_exams": completed,
        "in_progress_exams": in_progress,
    }


# Any logged-in user (any role) can hit this
@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "user_id": current_user.user_id,
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role,
    }


# Admin: per-student performance report
@router.get("/admin/reports/students")
def student_reports(
    current_user: User = Depends(require_role([RoleEnum.admin])),
    db: Session = Depends(get_db),
):
    students = db.query(User).filter(User.role == RoleEnum.student).all()
    report = []

    for student in students:
        sessions = (
            db.query(ExamSession)
            .filter(ExamSession.student_id == student.user_id)
            .all()
        )
        completed_sessions = [
            s for s in sessions
            if s.status in [SessionStatusEnum.submitted, SessionStatusEnum.auto_submitted]
        ]

        percentages = []
        passed_count = 0
        failed_count = 0

        for session in completed_sessions:
            result = (
                db.query(Result)
                .filter(Result.session_id == session.session_id)
                .order_by(Result.created_at.desc())
                .first()
            )
            if not result:
                continue

            exam = db.query(Exam).filter(Exam.exam_id == session.exam_id).first()
            max_marks_rows = (
                db.query(QuestionBank.marks)
                .join(ExamQuestion, ExamQuestion.question_id == QuestionBank.question_id)
                .filter(ExamQuestion.exam_id == session.exam_id)
                .all()
            )
            max_marks = sum(m[0] for m in max_marks_rows) if max_marks_rows else 0

            if max_marks > 0:
                percentages.append((result.marks / max_marks) * 100)

            if exam and exam.pass_marks is not None:
                if result.marks >= exam.pass_marks:
                    passed_count += 1
                else:
                    failed_count += 1

        average_score = round(sum(percentages) / len(percentages), 1) if percentages else 0.0

        report.append({
            "student_id": student.user_id,
            "name": student.name,
            "email": student.email,
            "exams_taken": len(completed_sessions),
            "average_score": average_score,
            "passed_count": passed_count,
            "failed_count": failed_count,
        })

    return report
