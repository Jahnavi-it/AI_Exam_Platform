"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../context/AuthContext";
import { getStudentReports } from "../../../lib/api";

export default function AdminReportsPage() {
  const { user, loading } = useRequireRole("admin");
  const { token } = useAuth();
  const router = useRouter();

  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) return;
    const load = async () => {
      setFetching(true);
      setError("");
      try {
        const data = await getStudentReports(token);
        setRows(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setFetching(false);
      }
    };
    load();
  }, [token]);

  if (loading || !user) return null;

  const filteredRows = rows.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.email.toLowerCase().includes(search.toLowerCase())
  );

  const totalStudents = rows.length;
  const activeStudents = rows.filter((r) => r.exams_taken > 0).length;
  const overallAvg =
    activeStudents > 0
      ? Math.round(
          (rows.reduce((sum, r) => sum + r.average_score, 0) / activeStudents) * 10
        ) / 10
      : 0;
  const totalPassed = rows.reduce((sum, r) => sum + r.passed_count, 0);

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">Admin</span>
          <h1 style={{ margin: "8px 0 0" }}>Student Reports</h1>
        </div>
        <button className="logout-btn" onClick={() => router.push("/admin/dashboard")}>
          Back to Dashboard
        </button>
      </div>

      <div className="stats-grid section-gap">
        <div className="stat-card">
          <div className="stat-icon stat-icon-blue">👥</div>
          <div>
            <div className="stat-label">Total Students</div>
            <div className="stat-value">{totalStudents}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-green">🎓</div>
          <div>
            <div className="stat-label">Students Who Attempted</div>
            <div className="stat-value">{activeStudents}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-amber">📊</div>
          <div>
            <div className="stat-label">Overall Average</div>
            <div className="stat-value">{overallAvg}%</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-purple">✅</div>
          <div>
            <div className="stat-label">Total Passed Attempts</div>
            <div className="stat-value">{totalPassed}</div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <h2 className="section-title">All Students</h2>
        {error && <div className="error-text">{error}</div>}

        <div className="form-group" style={{ maxWidth: "320px", marginBottom: "14px" }}>
          <label>Search by name or email</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Jahnavi" />
        </div>

        {fetching && <p style={{ color: "#6b7280" }}>Loading...</p>}

        {!fetching && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Exams Taken</th>
                <th>Average Score</th>
                <th>Passed</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.student_id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.exams_taken}</td>
                  <td>{r.average_score}%</td>
                  <td style={{ color: "#059669", fontWeight: 600 }}>{r.passed_count}</td>
                  <td style={{ color: "#dc2626", fontWeight: 600 }}>{r.failed_count}</td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "#9ca3af" }}>No students found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
