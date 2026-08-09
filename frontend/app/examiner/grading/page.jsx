"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../context/AuthContext";
import {
  listExams,
  getGradingQueue,
  setGradingScore,
  triggerAiGrading,
  publishResult,
  API_BASE_URL,
} from "../../../lib/api";

const STATUS_LABEL = {
  pending_ai: "Pending AI grading",
  ai_graded: "AI graded — needs review",
  examiner_reviewed: "Reviewed",
  not_applicable: "N/A",
};

const STATUS_COLOR = {
  pending_ai: "#9ca3af",
  ai_graded: "#d97706",
  examiner_reviewed: "#16a34a",
  not_applicable: "#9ca3af",
};

export default function GradingQueuePage() {
  const { user, loading } = useRequireRole("examiner");
  const { token } = useAuth();
  const router = useRouter();

  const [exams, setExams] = useState([]);
  const [examId, setExamId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loadingQueue, setLoadingQueue] = useState(false);

  // draft score/feedback per answer_id, keyed so multiple rows can be edited independently
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [aiGradingSessionId, setAiGradingSessionId] = useState(null);
  const [publishingSessionId, setPublishingSessionId] = useState(null);
  const [publishMessage, setPublishMessage] = useState("");

  const refreshQueue = async () => {
    if (!token) return;
    setLoadingQueue(true);
    setError("");
    try {
      const params = {};
      if (examId) params.exam_id = examId;
      if (statusFilter) params.status_filter = statusFilter;
      const data = await getGradingQueue(token, params);
      setItems(data);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of data) {
          if (!(item.answer_id in next)) {
            next[item.answer_id] = {
              score: item.examiner_score ?? item.ai_score ?? "",
              feedback: item.examiner_feedback ?? "",
            };
          }
        }
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingQueue(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    listExams(token).then(setExams).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    refreshQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, examId, statusFilter]);

  const handleDraftChange = (answerId, field, value) => {
    setDrafts((prev) => ({ ...prev, [answerId]: { ...prev[answerId], [field]: value } }));
  };

  const handleSaveScore = async (item) => {
    const draft = drafts[item.answer_id] || {};
    setSavingId(item.answer_id);
    setError("");
    try {
      const updated = await setGradingScore(
        token,
        item.answer_id,
        Number(draft.score),
        draft.feedback || ""
      );
      setItems((prev) => prev.map((it) => (it.answer_id === item.answer_id ? updated : it)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleAiGrade = async (sessionId) => {
    setAiGradingSessionId(sessionId);
    setError("");
    try {
      await triggerAiGrading(token, sessionId);
      await refreshQueue();
    } catch (err) {
      setError(err.message);
    } finally {
      setAiGradingSessionId(null);
    }
  };

  const handlePublish = async (sessionId) => {
    setPublishingSessionId(sessionId);
    setPublishMessage("");
    setError("");
    try {
      const result = await publishResult(token, sessionId);
      setPublishMessage(`Published — ${result.marks} / ${result.max_marks} for session ${sessionId}`);
      await refreshQueue();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishingSessionId(null);
    }
  };

  // Group by session so we can offer a per-session "publish" action once every
  // subjective answer in that session shows examiner_reviewed.
  const sessions = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.session_id)) {
        map.set(item.session_id, { session_id: item.session_id, student_name: item.student_name, items: [] });
      }
      map.get(item.session_id).items.push(item);
    }
    return Array.from(map.values());
  }, [items]);

  if (loading || !user) return null;

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">Examiner</span>
          <h1 style={{ margin: "8px 0 0" }}>Grading Queue</h1>
        </div>
        <button className="logout-btn" onClick={() => router.push("/examiner/dashboard")}>
          Back to Dashboard
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {publishMessage && (
        <div className="card" style={{ background: "#ecfdf5", color: "#047857", marginTop: "12px" }}>
          {publishMessage}
        </div>
      )}

      <div className="card section-gap">
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="form-group">
            <label>Exam</label>
            <select value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">All exams</option>
              {exams.map((ex) => (
                <option key={ex.exam_id} value={ex.exam_id}>{ex.title}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending_ai">Pending AI grading</option>
              <option value="ai_graded">AI graded — needs review</option>
              <option value="examiner_reviewed">Reviewed</option>
            </select>
          </div>
          <button className="btn-primary" style={{ width: "auto", padding: "10px 18px" }} onClick={refreshQueue} disabled={loadingQueue}>
            {loadingQueue ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {sessions.length === 0 && !loadingQueue && (
        <div className="card section-gap">
          <p style={{ color: "#9ca3af" }}>No subjective answers match this filter.</p>
        </div>
      )}

      {sessions.map((session) => {
        const allReviewed = session.items.every((it) => it.grading_status === "examiner_reviewed");
        return (
          <div className="card section-gap" key={session.session_id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                {session.student_name} <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: "13px" }}>({session.session_id})</span>
              </h2>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  style={{ width: "auto", padding: "8px 16px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontWeight: 600 }}
                  disabled={aiGradingSessionId === session.session_id}
                  onClick={() => handleAiGrade(session.session_id)}
                >
                  {aiGradingSessionId === session.session_id ? "Running AI grading..." : "Re-run AI grading"}
                </button>
                <button
                  className="btn-primary"
                  style={{ width: "auto", padding: "8px 16px", background: allReviewed ? "#16a34a" : "#9ca3af" }}
                  disabled={!allReviewed || publishingSessionId === session.session_id}
                  onClick={() => handlePublish(session.session_id)}
                  title={allReviewed ? "Publish this student's result" : "All subjective answers must be reviewed first"}
                >
                  {publishingSessionId === session.session_id ? "Publishing..." : "Publish Result"}
                </button>
              </div>
            </div>

            <table className="data-table" style={{ marginTop: "12px" }}>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Answer</th>
                  <th>AI Score</th>
                  <th>Status</th>
                  <th>Your Score</th>
                  <th>Feedback</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {session.items.map((item) => (
                  <tr key={item.answer_id}>
                    <td style={{ maxWidth: "220px" }}>
                      <div style={{ fontWeight: 600 }}>{item.question_text}</div>
                      <div style={{ fontSize: "12px", color: "#9ca3af" }}>{item.question_type} • max {item.marks}</div>
                    </td>
                    <td style={{ maxWidth: "260px" }}>
                      {item.image_path ? (
                        <>
                          <a href={`${API_BASE_URL}/${item.image_path}`} target="_blank" rel="noreferrer">
                            <img
                              src={`${API_BASE_URL}/${item.image_path}`}
                              alt="Student answer"
                              style={{ maxWidth: "140px", maxHeight: "140px", borderRadius: "6px", border: "1px solid #d1d5db" }}
                            />
                          </a>
                          {item.ocr_text && (
                            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px" }}>
                              OCR: {item.ocr_text}
                            </div>
                          )}
                        </>
                      ) : (
                        item.submitted_answer || <span style={{ color: "#9ca3af" }}>Not answered</span>
                      )}
                    </td>
                    <td>
                      {item.ai_score ?? "—"}
                      {item.ai_justification && (
                        <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "4px", maxWidth: "180px" }}>
                          {item.ai_justification}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ color: STATUS_COLOR[item.grading_status] || "#6b7280", fontWeight: 600 }}>
                        {STATUS_LABEL[item.grading_status] || item.grading_status}
                      </span>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max={item.marks}
                        step="0.5"
                        style={{ width: "70px" }}
                        value={drafts[item.answer_id]?.score ?? ""}
                        onChange={(e) => handleDraftChange(item.answer_id, "score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        style={{ width: "140px" }}
                        value={drafts[item.answer_id]?.feedback ?? ""}
                        onChange={(e) => handleDraftChange(item.answer_id, "feedback", e.target.value)}
                        placeholder="Optional feedback"
                      />
                    </td>
                    <td>
                      <button
                        className="btn-primary"
                        style={{ width: "auto", padding: "6px 14px" }}
                        disabled={savingId === item.answer_id || drafts[item.answer_id]?.score === ""}
                        onClick={() => handleSaveScore(item)}
                      >
                        {savingId === item.answer_id ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
