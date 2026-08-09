"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import { getStudentDashboard, listExams, getMySessions } from "../../../lib/api";
import LanguageSwitcher from "../../../components/LanguageSwitcher";

export default function StudentDashboardPage() {
  const { user, loading } = useRequireRole("student");
  const { token, logout } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
  const [exams, setExams] = useState([]);
  const [sessionsByExam, setSessionsByExam] = useState({});
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!token) return;
    try {
      const [examList, sessions] = await Promise.all([listExams(token), getMySessions(token)]);
      setExams(examList);
      const map = {};
      sessions.forEach((s) => {
        map[s.exam_id] = s;
      });
      setSessionsByExam(map);
    } catch (err) {
      setError(err.message);
    }
  };

  const refreshStats = async () => {
    if (!token) return;
    try {
      const data = await getStudentDashboard(token);
      setMessage(data.message);
      setStats(data);
    } catch (err) {
      setMessage("");
      setStats(null);
    }
  };

  useEffect(() => {
    if (!token) return;
    refreshStats();
    refresh();
  }, [token]);

  if (loading || !user) return null;

  const notStarted = exams.filter((ex) => {
    const session = sessionsByExam[ex.exam_id];
    return !session || session.status === "not_started";
  }).length;

  const actionFor = (exam) => {
    const session = sessionsByExam[exam.exam_id];

    if (!session || session.status === "not_started") {
      return (
        <button
          className="btn-primary"
          style={{ width: "auto", padding: "8px 16px" }}
          onClick={() => router.push(`/exam/${exam.exam_id}/attempt`)}
        >
          {t("start_exam")}
        </button>
      );
    }
    if (session.status === "in_progress") {
      return (
        <button
          className="btn-primary"
          style={{ width: "auto", padding: "8px 16px", background: "#d97706" }}
          onClick={() => router.push(`/exam/${exam.exam_id}/attempt`)}
        >
          {t("start_exam")}
        </button>
      );
    }
    return (
      <button
        className="logout-btn"
        onClick={() => router.push(`/exam/${exam.exam_id}/result`)}
      >
        {t("results")}
      </button>
    );
  };

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">Student</span>
          <h1 style={{ margin: "8px 0 0" }}>{t("welcome")}, {user.name}</h1>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <LanguageSwitcher />
          <button className="logout-btn" onClick={() => router.push("/student/progress")}>
            {t("results")}
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
          <div className="stat-icon stat-icon-blue">📝</div>
          <div>
            <div className="stat-label">{t("my_exams")}</div>
            <div className="stat-value">{stats ? stats.total_exams : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-green">✅</div>
          <div>
            <div className="stat-label">{t("results")}</div>
            <div className="stat-value">{stats ? stats.completed_exams : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-amber">⏳</div>
          <div>
            <div className="stat-label">{t("time_remaining")}</div>
            <div className="stat-value">{stats ? stats.in_progress_exams : "—"}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon-gray">🕓</div>
          <div>
            <div className="stat-label">{t("my_exams")}</div>
            <div className="stat-value">{notStarted}</div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <h2 className="section-title">{t("my_exams")}</h2>
        {error && <div className="error-text">{error}</div>}
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("exam_title")}</th>
              <th>{t("subject")}</th>
              <th>{t("duration")}</th>
              <th>{t("start_exam")}</th>
              <th>{t("time_remaining")}</th>
              <th>{t("results")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {exams.map((ex) => {
              const session = sessionsByExam[ex.exam_id];
              return (
                <tr key={ex.exam_id}>
                  <td>{ex.title}</td>
                  <td>{ex.subject}</td>
                  <td>{ex.duration_minutes} min</td>
                  <td>{new Date(ex.start_time).toLocaleString()}</td>
                  <td>{new Date(ex.end_time).toLocaleString()}</td>
                  <td style={{ textTransform: "capitalize" }}>
                    {session ? session.status.replace("_", " ") : "Not started"}
                  </td>
                  <td>{actionFor(ex)}</td>
                </tr>
              );
            })}
            {exams.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "#9ca3af" }}>No exams available yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
