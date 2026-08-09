"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../context/AuthContext";
import { getMySessions, getResult } from "../../../lib/api";

export default function StudentProgressPage() {
  const { user, loading } = useRequireRole("student");
  const { token } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      setFetching(true);
      setError("");
      try {
        const sessions = await getMySessions(token);
        const completed = sessions.filter(
          (s) => s.status === "submitted" || s.status === "auto_submitted"
        );

        const results = await Promise.all(
          completed.map(async (s) => {
            try {
              const r = await getResult(token, s.session_id);
              return { ...r, exam_id: s.exam_id, session_id: s.session_id };
            } catch {
              return null;
            }
          })
        );

        setRows(results.filter(Boolean));
      } catch (err) {
        setError(err.message);
      } finally {
        setFetching(false);
      }
    };

    load();
  }, [token]);

  if (loading || !user) return null;

  const totalAttempts = rows.length;
  const passedCount = rows.filter((r) => r.passed === true).length;
  const failedCount = rows.filter((r) => r.passed === false).length;
  const avgPercent =
    totalAttempts > 0
      ? Math.round(
          (rows.reduce((sum, r) => sum + (r.max_marks > 0 ? (r.marks / r.max_marks) * 100 : 0), 0) /
            totalAttempts) *
            10
        ) / 10
      : 0;

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">Student</span>
          <h1 style={{ margin: "8px 0 0" }}>My Progress</h1>
        </div>
        <button className="logout-btn" onClick={() => router.push("/student/dashboard")}>
          Back to Dashboard
        </button>
      </div>

      <div className="stats-grid section-gap">
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">📝</div>
          <div>
            <div className="stat-label">Exams Attempted</div>
            <div className="stat-value">{totalAttempts}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-green">✅</div>
          <div>
            <div className="stat-label">Passed</div>
            <div className="stat-value">{passedCount}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-red">❌</div>
          <div>
            <div className="stat-label">Failed</div>
            <div className="stat-value">{failedCount}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-amber">📊</div>
          <div>
            <div className="stat-label">Average Score</div>
            <div className="stat-value">{avgPercent}%</div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <h2 className="section-title">Exam History</h2>
        {error && <div className="error-text">{error}</div>}
        {fetching && <p style={{ color: "#6b7280" }}>Loading...</p>}

        {!fetching && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Exam</th>
                <th>Marks</th>
                <th>Percentage</th>
                <th>Result</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.max_marks > 0 ? Math.round((r.marks / r.max_marks) * 1000) / 10 : 0;
                return (
                  <tr key={r.session_id}>
                    <td>{r.exam_title}</td>
                    <td>{r.marks} / {r.max_marks}</td>
                    <td>{pct}%</td>
                    <td>
                      {r.passed === null || r.passed === undefined ? (
                        <span style={{ color: "#6b7280" }}>—</span>
                      ) : r.passed ? (
                        <span style={{ color: "#059669", fontWeight: 600 }}>Passed</span>
                      ) : (
                        <span style={{ color: "#dc2626", fontWeight: 600 }}>Failed</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="delete-btn"
                        style={{ color: "#2563eb" }}
                        onClick={() => router.push(`/exam/${r.exam_id}/result`)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: "#9ca3af" }}>No completed exams yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
