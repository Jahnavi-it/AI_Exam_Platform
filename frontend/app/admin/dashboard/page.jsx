"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import {
  getAdminDashboard,
  createExam,
  listExams,
  deleteExam,
  listQuestionsDetailed,
  getAttachedQuestionIds,
  attachQuestionsToExam,
  getLiveSessions,
  getPendingReviews,
  approveReview,
  rejectReview,
} from "../../../lib/api";

const emptyForm = {
  title: "",
  subject: "",
  duration_minutes: 60,
  start_time: "",
  end_time: "",
  negative_marks: 0,
};

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminDashboardPage() {
  const { user, loading } = useRequireRole("admin");
  const { token, logout } = useAuth();
  const { lang, t } = useLanguage();
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
  const [exams, setExams] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [managingExam, setManagingExam] = useState(null);
  const [bankQuestions, setBankQuestions] = useState([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
  const [attachSaving, setAttachSaving] = useState(false);
  const [attachMessage, setAttachMessage] = useState("");

  // ---- Live Proctoring & Review (Milestone 2) ----
  const [liveSessions, setLiveSessions] = useState([]);
  const [pendingReviews, setPendingReviews] = useState([]);
  const [reviewError, setReviewError] = useState("");
  const [reviewActionId, setReviewActionId] = useState(null);

  const refreshExams = async () => {
    if (!token) return;
    try {
      const data = await listExams(token);
      setExams(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const refreshStats = async () => {
    if (!token) return;
    try {
      const data = await getAdminDashboard(token);
      setMessage(data.message);
      setStats(data);
    } catch (err) {
      setMessage("");
      setStats(null);
    }
  };

  const refreshLive = async () => {
    if (!token) return;
    try {
      const data = await getLiveSessions(token);
      setLiveSessions(data);
    } catch (err) {
      setReviewError(err.message);
    }
  };

  const refreshPending = async () => {
    if (!token) return;
    try {
      const data = await getPendingReviews(token);
      setPendingReviews(data);
    } catch (err) {
      setReviewError(err.message);
    }
  };

  useEffect(() => {
    if (!token) return;
    refreshStats();
    refreshExams();
    refreshLive();
    refreshPending();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      refreshLive();
      refreshPending();
    }, 15000);
    return () => clearInterval(interval);
  }, [token]);

  const handleApprove = async (sessionId) => {
    setReviewActionId(sessionId);
    setReviewError("");
    try {
      await approveReview(token, sessionId);
      await refreshPending();
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setReviewActionId(null);
    }
  };

  const handleReject = async (sessionId) => {
    setReviewActionId(sessionId);
    setReviewError("");
    try {
      await rejectReview(token, sessionId);
      await refreshPending();
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setReviewActionId(null);
    }
  };

  const handleChange = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await createExam(token, {
        ...form,
        duration_minutes: Number(form.duration_minutes),
        negative_marks: Number(form.negative_marks),
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
      });
      setForm(emptyForm);
      await refreshExams();
      await refreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (examId) => {
    try {
      await deleteExam(token, examId);
      await refreshExams();
      await refreshStats();
    } catch (err) {
      setError(err.message);
    }
  };

  const openManageQuestions = async (exam) => {
    setManagingExam(exam);
    setAttachMessage("");
    try {
      const [all, attached] = await Promise.all([
        listQuestionsDetailed(token, { subject: exam.subject, lang }),
        getAttachedQuestionIds(token, exam.exam_id),
      ]);
      setBankQuestions(all);
      setSelectedQuestionIds(attached);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleQuestion = (qid) => {
    setSelectedQuestionIds((ids) =>
      ids.includes(qid) ? ids.filter((x) => x !== qid) : [...ids, qid]
    );
  };

  const saveAttachedQuestions = async () => {
    setAttachSaving(true);
    setAttachMessage("");
    try {
      await attachQuestionsToExam(token, managingExam.exam_id, selectedQuestionIds);
      const totalMarks = bankQuestions
        .filter((q) => selectedQuestionIds.includes(q.question_id))
        .reduce((sum, q) => sum + q.marks, 0);
      setAttachMessage(
        `${t("saved_prefix")} ${selectedQuestionIds.length} ${t("questions_attached_suffix")} (${totalMarks} ${t("total_marks_suffix")}).`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setAttachSaving(false);
    }
  };

  if (loading || !user) return null;

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">{t("role_admin")}</span>
          <h1 style={{ margin: "8px 0 0" }}>{t("welcome")}, {user.name}</h1>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="logout-btn" onClick={() => router.push("/admin/reports")}>
            {t("reports_btn")}
          </button>
          <button className="logout-btn" onClick={() => router.push("/settings")}>
            {t("settings")}
          </button>
          <button
            className="logout-btn"
            onClick={() => {
              logout();
              router.push("/login");
            }}
          >
            {t("logout")}
          </button>
        </div>
      </div>

      <div className="card">
        <p>{message}</p>
      </div>

      <div className="stats-grid section-gap">
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">👥</div>
          <div>
            <div className="stat-label">{t("platform_users")}</div>
            <div className="stat-value">{stats ? stats.platform_users : "—"}</div>
            <div className="stat-sub">
              {stats
                ? `${stats.total_students} ${t("students_word")} · ${stats.total_examiners} ${t("examiners_word")} · ${stats.total_admins} ${t("admins_word")}`
                : ""}
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-purple">📝</div>
          <div>
            <div className="stat-label">{t("total_exams")}</div>
            <div className="stat-value">{stats ? stats.total_exams : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-gray">📚</div>
          <div>
            <div className="stat-label">{t("total_questions_stat")}</div>
            <div className="stat-value">{stats ? stats.total_questions : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-red">🔴</div>
          <div>
            <div className="stat-label">{t("live_sessions_now")}</div>
            <div className="stat-value">{liveSessions.length}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-green">📊</div>
          <div>
            <div className="stat-label">{t("average_score")}</div>
            <div className="stat-value">{stats ? `${stats.average_score}%` : "—"}</div>
          </div>
        </div>
      </div>

      {/* ---- Live Now (Milestone 2) ---- */}
      <div className="card section-gap">
        <h2 className="section-title">🔴 {t("live_now")} ({liveSessions.length})</h2>
        {reviewError && <div className="error-text">{reviewError}</div>}
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("student_col")}</th>
              <th>{t("exam_col")}</th>
              <th>{t("started_col")}</th>
              <th>{t("violations_col")}</th>
            </tr>
          </thead>
          <tbody>
            {liveSessions.map((s) => (
              <tr key={s.session_id}>
                <td>{s.student_name}</td>
                <td>{s.exam_title}</td>
                <td>{new Date(s.start_time).toLocaleTimeString()}</td>
                <td>
                  <span style={{ color: s.violation_count > 0 ? "#dc2626" : "#6b7280", fontWeight: 700 }}>
                    {s.violation_count}
                  </span>
                </td>
              </tr>
            ))}
            {liveSessions.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: "#9ca3af" }}>{t("no_students_taking_exam")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---- Pending Review (Milestone 2) ---- */}
      <div className="card section-gap">
        <h2 className="section-title">🕓 {t("pending_reviews_title")} ({pendingReviews.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("student_col")}</th>
              <th>{t("exam_col")}</th>
              <th>{t("submitted_col")}</th>
              <th>{t("violations_col")}</th>
              <th>{t("score_col")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pendingReviews.map((s) => (
              <tr key={s.session_id}>
                <td>{s.student_name}</td>
                <td>{s.exam_title}</td>
                <td>{s.end_time ? new Date(s.end_time).toLocaleString() : "—"}</td>
                <td>
                  <span style={{ color: s.violation_count > 0 ? "#dc2626" : "#6b7280", fontWeight: 700 }}>
                    {s.violation_count}
                  </span>
                </td>
                <td>{s.marks} / {s.max_marks}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="delete-btn"
                    style={{ color: "#16a34a", marginRight: "12px" }}
                    disabled={reviewActionId === s.session_id}
                    onClick={() => handleApprove(s.session_id)}
                  >
                    {t("approve")}
                  </button>
                  <button
                    className="delete-btn"
                    disabled={reviewActionId === s.session_id}
                    onClick={() => handleReject(s.session_id)}
                  >
                    {t("reject")}
                  </button>
                </td>
              </tr>
            ))}
            {pendingReviews.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "#9ca3af" }}>{t("no_pending_reviews")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card section-gap">
        <h2 className="section-title">{t("configure_exam_title")}</h2>

        {error && <div className="error-text">{error}</div>}

        <form onSubmit={handleSubmit} className="inline-form">
          <div className="form-group">
            <label>{t("title_label")}</label>
            <input required value={form.title} onChange={handleChange("title")} placeholder={t("title_placeholder")} />
          </div>

          <div className="form-group">
            <label>{t("subject_label")}</label>
            <input required value={form.subject} onChange={handleChange("subject")} placeholder={t("subject_placeholder")} />
          </div>

          <div className="form-group">
            <label>{t("duration_minutes_label")}</label>
            <input type="number" min="1" required value={form.duration_minutes} onChange={handleChange("duration_minutes")} />
          </div>

          <div className="form-group">
            <label>{t("start_time_label")}</label>
            <input type="datetime-local" required value={form.start_time} onChange={handleChange("start_time")} />
          </div>

          <div className="form-group">
            <label>{t("end_time_label")}</label>
            <input type="datetime-local" required value={form.end_time} onChange={handleChange("end_time")} />
          </div>

          <div className="form-group">
            <label>{t("negative_marks_label")}</label>
            <input type="number" min="0" step="0.25" value={form.negative_marks} onChange={handleChange("negative_marks")} />
          </div>

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? t("creating") : t("create_exam_btn")}
          </button>
        </form>

        <table className="data-table">
          <thead>
            <tr>
              <th>{t("title_label")}</th>
              <th>{t("subject_label")}</th>
              <th>{t("duration_col")}</th>
              <th>{t("start_col")}</th>
              <th>{t("end_col")}</th>
              <th>{t("neg_marks_col")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {exams.map((ex) => (
              <tr key={ex.exam_id}>
                <td>{ex.title}</td>
                <td>{ex.subject}</td>
                <td>{ex.duration_minutes} min</td>
                <td>{toLocalInputValue(ex.start_time).replace("T", " ")}</td>
                <td>{toLocalInputValue(ex.end_time).replace("T", " ")}</td>
                <td>{ex.negative_marks}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="delete-btn"
                    style={{ color: "#2563eb", marginRight: "12px" }}
                    onClick={() => openManageQuestions(ex)}
                  >
                    {t("manage_questions")}
                  </button>
                  <button className="delete-btn" onClick={() => handleDelete(ex.exam_id)}>
                    {t("delete")}
                  </button>
                </td>
              </tr>
            ))}
            {exams.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "#9ca3af" }}>{t("no_exams_configured")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {managingExam && (
        <div className="card section-gap">
          <h2 className="section-title">
            {t("questions_for_label")} &ldquo;{managingExam.title}&rdquo; ({t("subject_paren_label")}: {managingExam.subject})
          </h2>
          <p style={{ color: "#6b7280", fontSize: "13px", marginTop: "-8px" }}>
            {t("manage_questions_desc")}
          </p>

          {attachMessage && (
            <div className="card" style={{ background: "#ecfdf5", color: "#047857", padding: "10px 14px", marginBottom: "14px" }}>
              {attachMessage}
            </div>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>{t("question_col")}</th>
                <th>{t("type_col")}</th>
                <th>{t("difficulty")}</th>
                <th>{t("marks")}</th>
              </tr>
            </thead>
            <tbody>
              {bankQuestions.map((q) => (
                <tr key={q.question_id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedQuestionIds.includes(q.question_id)}
                      onChange={() => toggleQuestion(q.question_id)}
                    />
                  </td>
                  <td>{q.question_text}</td>
                  <td>{q.question_type}</td>
                  <td>{q.difficulty_level}</td>
                  <td>{q.marks}</td>
                </tr>
              ))}
              {bankQuestions.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#9ca3af" }}>
                    {t("no_questions_for_subject_prefix")} &ldquo;{managingExam.subject}&rdquo; {t("no_questions_for_subject_suffix")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
            <button className="btn-primary" style={{ width: "auto", padding: "10px 20px" }} onClick={saveAttachedQuestions} disabled={attachSaving}>
              {attachSaving ? t("adding") : t("save_attached_questions_btn")}
            </button>
            <button
              className="logout-btn"
              onClick={() => setManagingExam(null)}
            >
              {t("close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}