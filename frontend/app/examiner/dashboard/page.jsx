"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import LanguageSwitcher from "../../../components/LanguageSwitcher";
import {
  getExaminerDashboard,
  createQuestion,
  listQuestions,
  deleteQuestion,
  getLiveSessions,
  getPendingReviews,
  approveReview,
  rejectReview,
} from "../../../lib/api";

const QUESTION_TYPES = ["mcq", "multi_select", "short_answer", "long_answer", "image_upload"];
const DIFFICULTIES = ["easy", "medium", "hard"];
const NEEDS_OPTIONS = ["mcq", "multi_select"];

export default function ExaminerDashboardPage() {
  const { user, loading } = useRequireRole("examiner");
  const { token, logout } = useAuth();
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    question_text: "",
    question_type: "mcq",
    marks: 1,
    subject: "",
    difficulty_level: "easy",
    options_text: "",
    correct_answer: "",
  });

  const [liveSessions, setLiveSessions] = useState([]);
  const [pendingReviews, setPendingReviews] = useState([]);
  const [reviewError, setReviewError] = useState("");
  const [reviewActionId, setReviewActionId] = useState(null);

  const needsOptions = NEEDS_OPTIONS.includes(form.question_type);

  const refreshQuestions = async () => {
    if (!token) return;
    try {
      const data = await listQuestions(token, { lang });
      setQuestions(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const refreshStats = async () => {
    if (!token) return;
    try {
      const data = await getExaminerDashboard(token);
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
    refreshQuestions();
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

  // Re-fetch questions in the new language whenever it changes
  useEffect(() => {
    if (!token) return;
    refreshQuestions();
  }, [lang]);

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

  const resetForm = () =>
    setForm({
      question_text: "",
      question_type: "mcq",
      marks: 1,
      subject: "",
      difficulty_level: "easy",
      options_text: "",
      correct_answer: "",
    });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        question_text: form.question_text,
        question_type: form.question_type,
        marks: Number(form.marks),
        subject: form.subject,
        difficulty_level: form.difficulty_level,
        options: needsOptions
          ? form.options_text.split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        correct_answer: needsOptions ? form.correct_answer.trim() : null,
      };
      await createQuestion(token, payload);
      resetForm();
      await refreshQuestions();
      await refreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (questionId) => {
    try {
      await deleteQuestion(token, questionId);
      await refreshQuestions();
      await refreshStats();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading || !user) return null;

  const easyCount = questions.filter((q) => q.difficulty_level === "easy").length;
  const mediumCount = questions.filter((q) => q.difficulty_level === "medium").length;
  const hardCount = questions.filter((q) => q.difficulty_level === "hard").length;
  const contribution =
    stats && stats.total_questions > 0
      ? Math.round((stats.my_questions / stats.total_questions) * 100)
      : 0;

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">{t("role_examiner")}</span>
          <h1 style={{ margin: "8px 0 0" }}>{t("welcome")}, {user.name}</h1>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <LanguageSwitcher />
          <button className="logout-btn" onClick={() => router.push("/examiner/grading")}>
            Grading Queue
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

      <div className="hero-banner">
        <p className="hero-eyebrow">{t("role_examiner")} Dashboard</p>
        <h1>{t("welcome")}, {user.name} 👋</h1>
        <p>Here&apos;s what&apos;s happening with your exams today.</p>
        <div className="hero-actions">
          <button
            className="btn-primary"
            onClick={() => document.getElementById("add-question")?.scrollIntoView({ behavior: "smooth" })}
          >
            + {t("add_question_btn")}
          </button>
          <button className="btn-secondary" onClick={() => router.push("/examiner/grading")}>
            Grading Queue
          </button>
        </div>
      </div>

      <div className="card">
        <p>{message}</p>
      </div>

      <div className="stats-grid section-gap">
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">📝</div>
          <div>
            <div className="stat-label">{t("my_questions")}</div>
            <div className="stat-value">{stats ? stats.my_questions : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-purple">📚</div>
          <div>
            <div className="stat-label">{t("total_bank_questions")}</div>
            <div className="stat-value">{stats ? stats.total_questions : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-amber">🕓</div>
          <div>
            <div className="stat-label">Pending Grading</div>
            <div className="stat-value">{pendingReviews.length}</div>
            <div className="stat-sub">Needs your review</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-green">📈</div>
          <div>
            <div className="stat-label">{t("my_contribution")}</div>
            <div className="stat-value">{stats ? `${contribution}%` : "—"}</div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <p className="quick-access-title">Quick Access</p>
        <div className="quick-access-grid">
          <a
            className="quick-access-card"
            onClick={() => document.getElementById("add-question")?.scrollIntoView({ behavior: "smooth" })}
          >
            <div className="stat-icon stat-icon-blue">❓</div>
            <div>
              <div className="quick-access-title-text">Question Bank</div>
              <div className="quick-access-desc">Add and manage questions</div>
            </div>
            <span className="quick-access-arrow">›</span>
          </a>
          <a
            className="quick-access-card"
            onClick={() => document.getElementById("live-now")?.scrollIntoView({ behavior: "smooth" })}
          >
            <div className="stat-icon stat-icon-red">📡</div>
            <div>
              <div className="quick-access-title-text">{t("live_now")}</div>
              <div className="quick-access-desc">Monitor students taking exams</div>
            </div>
            <span className="quick-access-arrow">›</span>
          </a>
          <a
            className="quick-access-card"
            onClick={() => document.getElementById("pending-review")?.scrollIntoView({ behavior: "smooth" })}
          >
            <div className="stat-icon stat-icon-amber">🕓</div>
            <div>
              <div className="quick-access-title-text">{t("pending_reviews_title")}</div>
              <div className="quick-access-desc">Approve or reject submissions</div>
            </div>
            <span className="quick-access-arrow">›</span>
          </a>
          <a className="quick-access-card" onClick={() => router.push("/examiner/grading")}>
            <div className="stat-icon stat-icon-purple">🗂️</div>
            <div>
              <div className="quick-access-title-text">Grading Queue</div>
              <div className="quick-access-desc">Review subjective answers</div>
            </div>
            <span className="quick-access-arrow">›</span>
          </a>
        </div>
      </div>

      <div className="overview-grid section-gap">
        <div className="card">
          <h2 className="section-title">Question Bank Overview</h2>
          {(() => {
            const bySubject = {};
            questions.forEach((q) => {
              bySubject[q.subject] = (bySubject[q.subject] || 0) + 1;
            });
            const subjectRows = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
            const maxCount = subjectRows.length ? subjectRows[0][1] : 1;
            const barColors = ["#7c3aed", "#0ea5e9", "#ec4899", "#f59e0b", "#10b981", "#6366f1"];
            const maxDiff = Math.max(easyCount, mediumCount, hardCount, 1);

            return (
              <>
                <div className="mini-stat-row">
                  <div className="mini-stat-box">
                    <div className="mini-stat-label">Easy</div>
                    <div className="mini-stat-value">{easyCount}</div>
                  </div>
                  <div className="mini-stat-box">
                    <div className="mini-stat-label">Medium</div>
                    <div className="mini-stat-value">{mediumCount}</div>
                  </div>
                  <div className="mini-stat-box">
                    <div className="mini-stat-label">Hard</div>
                    <div className="mini-stat-value">{hardCount}</div>
                  </div>
                </div>

                {subjectRows.length > 0 && (
                  <>
                    <div className="mini-stat-label" style={{ marginBottom: "10px" }}>Questions by subject</div>
                    {subjectRows.map(([subject, count], i) => (
                      <div className="bar-row" key={subject}>
                        <div className="bar-row-label">{subject}</div>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${(count / maxCount) * 100}%`,
                              background: barColors[i % barColors.length],
                            }}
                          />
                        </div>
                        <div className="bar-row-count">{count}</div>
                      </div>
                    ))}
                  </>
                )}
                {subjectRows.length === 0 && (
                  <p style={{ color: "#9ca3af", fontSize: "13px" }}>{t("no_questions_yet")}</p>
                )}
              </>
            );
          })()}
        </div>

        <div className="card">
          <div className="section-title-row">
            <h2 className="section-title">Needs Your Review</h2>
            <button className="link-btn" onClick={() => document.getElementById("pending-review")?.scrollIntoView({ behavior: "smooth" })}>
              View all
            </button>
          </div>
          {pendingReviews.slice(0, 6).map((s) => (
            <div className="submission-row" key={s.session_id}>
              <div>
                <div className="student-name">{s.student_name}</div>
              </div>
              <div>
                <div>{s.exam_title}</div>
              </div>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>
                {s.end_time ? new Date(s.end_time).toLocaleString() : "—"}
              </div>
              <span className="pill pill-amber">Pending</span>
            </div>
          ))}
          {pendingReviews.length === 0 && (
            <p style={{ color: "#9ca3af", fontSize: "13px" }}>{t("no_pending_reviews")}</p>
          )}
        </div>
      </div>

      <div className="card section-gap" id="live-now">
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

      <div className="card section-gap" id="pending-review">
        <h2 className="section-title">🕓 {t("pending_reviews_title")} ({pendingReviews.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("student_col")}</th>
              <th>{t("exam_col")}</th>
              <th>{t("time_remaining")}</th>
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

      <div className="card section-gap" id="add-question">
        <h2 className="section-title">{t("add_question_title")}</h2>

        {error && <div className="error-text">{error}</div>}

        <form onSubmit={handleSubmit} className="inline-form">
          <div className="form-group">
            <label>{t("question_text_label")}</label>
            <input
              required
              value={form.question_text}
              onChange={handleChange("question_text")}
              placeholder="e.g. What is 2 + 2?"
            />
          </div>

          <div className="form-group">
            <label>{t("subject")}</label>
            <input
              required
              value={form.subject}
              onChange={handleChange("subject")}
              placeholder="e.g. Mathematics"
            />
          </div>

          <div className="form-group">
            <label>{t("question_type_label")}</label>
            <select value={form.question_type} onChange={handleChange("question_type")}>
              {QUESTION_TYPES.map((t2) => (
                <option key={t2} value={t2}>{t2}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{t("difficulty")}</label>
            <select value={form.difficulty_level} onChange={handleChange("difficulty_level")}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{t("marks")}</label>
            <input
              type="number"
              min="1"
              step="0.5"
              required
              value={form.marks}
              onChange={handleChange("marks")}
            />
          </div>

          {needsOptions && (
            <>
              <div className="form-group" style={{ gridColumn: "span 2" }}>
                <label>{t("options_col")}</label>
                <input
                  required
                  value={form.options_text}
                  onChange={handleChange("options_text")}
                  placeholder="e.g. Delhi, Mumbai, Chennai, Kolkata"
                />
              </div>
              <div className="form-group">
                <label>{t("correct_answer_label")}</label>
                <input
                  required
                  value={form.correct_answer}
                  onChange={handleChange("correct_answer")}
                  placeholder="e.g. Delhi"
                />
              </div>
            </>
          )}

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? t("adding") : t("add_question_btn")}
          </button>
        </form>

        <table className="data-table">
          <thead>
            <tr>
              <th>{t("question_col")}</th>
              <th>{t("subject")}</th>
              <th>{t("type_col")}</th>
              <th>{t("difficulty")}</th>
              <th>{t("marks")}</th>
              <th>{t("options_col")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => (
              <tr key={q.question_id}>
                <td>{q.question_text}</td>
                <td>{q.subject}</td>
                <td>{q.question_type}</td>
                <td>{q.difficulty_level}</td>
                <td>{q.marks}</td>
                <td>{q.options ? q.options.join(", ") : "—"}</td>
                <td>
                  <button className="delete-btn" onClick={() => handleDelete(q.question_id)}>
                    {t("delete")}
                  </button>
                </td>
              </tr>
            ))}
            {questions.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "#9ca3af" }}>{t("no_questions_yet")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}