"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../../context/AuthContext";
import { useLanguage } from "../../../../context/LanguageContext";
import { getMySessions, getResult } from "../../../../lib/api";

export default function ExamResultPage() {
  const { user, loading } = useRequireRole("student");
  const { token } = useAuth();
  const { lang, t } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const examId = params.examId;

  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !examId) return;
    (async () => {
      try {
        const sessions = await getMySessions(token);
        const session = sessions.find((s) => s.exam_id === examId);
        if (!session) {
          setError("You haven't attempted this exam yet.");
          return;
        }
        if (session.status === "not_started" || session.status === "in_progress") {
          router.replace(`/exam/${examId}/attempt`);
          return;
        }
        const data = await getResult(token, session.session_id, lang);
        setResult(data);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [token, examId]);

  if (loading || !user) return null;

  const reviewStatus = result?.review_status;
  let verdict = null;
  if (reviewStatus === "approved") {
    verdict = { label: t("pass_label"), bg: "#ecfdf5", color: "#047857" };
  } else if (reviewStatus === "rejected") {
    verdict = { label: t("fail_label"), bg: "#fef2f2", color: "#b91c1c" };
  } else {
    verdict = { label: t("awaiting_review_label"), bg: "#fffbeb", color: "#b45309" };
  }

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">Student</span>
          <h1 style={{ margin: "8px 0 0" }}>{t("exam_result")}</h1>
        </div>
        <button className="logout-btn" onClick={() => router.push("/student/dashboard")}>
          {t("back_to_dashboard")}
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}

      {result && (
        <>
          <div className="card">
            <h2 className="section-title" style={{ marginBottom: "4px" }}>{result.exam_title}</h2>
            <p style={{ color: "#6b7280", fontSize: "13px", marginTop: 0 }}>
              {t("status")}: <span style={{ textTransform: "capitalize" }}>{result.status.replace("_", " ")}</span>
            </p>

            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "center", marginTop: "10px" }}>
              <div style={{ display: "inline-block", padding: "14px 26px", borderRadius: "12px", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: "24px" }}>
                {result.marks} / {result.max_marks}
              </div>
              <div style={{ display: "inline-block", padding: "14px 26px", borderRadius: "12px", background: verdict.bg, color: verdict.color, fontWeight: 700, fontSize: "20px" }}>
                {verdict.label}
              </div>
            </div>

            {result.feedback && (
              <p style={{ marginTop: "14px", color: "#374151", fontSize: "14px" }}>{result.feedback}</p>
            )}
          </div>

          <div className="card section-gap">
            <h2 className="section-title">{t("answer_review")}</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("question")}</th>
                  <th>{t("type_col")}</th>
                  <th>{t("your_answer")}</th>
                  <th>{t("correct_answer_label")}</th>
                  <th>{t("marks")}</th>
                  <th>{t("result_col")}</th>
                </tr>
              </thead>
              <tbody>
                {result.answers.map((a) => (
                  <tr key={a.question_id}>
                    <td>{a.question_text}</td>
                    <td>{a.question_type}</td>
                    <td>{a.submitted_answer || <span style={{ color: "#9ca3af" }}>{t("not_answered")}</span>}</td>
                    <td>{a.correct_answer ?? <span style={{ color: "#9ca3af" }}>—</span>}</td>
                    <td>{a.marks}</td>
                    <td>
                      {a.is_correct === true && <span style={{ color: "#047857", fontWeight: 600 }}>{t("correct_label")}</span>}
                      {a.is_correct === false && <span style={{ color: "#b91c1c", fontWeight: 600 }}>{t("incorrect_label")}</span>}
                      {a.is_correct === null && <span style={{ color: "#9ca3af" }}>{t("pending_review_label")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}