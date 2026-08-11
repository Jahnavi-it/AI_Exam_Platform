"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useRequireRole } from "../../../../context/AuthContext";
import { useLanguage } from "../../../../context/LanguageContext";
import { startExam, submitAnswer, submitExam, getSessionStatus, reportViolation, uploadImageAnswer } from "../../../../lib/api";
import * as faceapi from "face-api.js";

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

// ---- Question Palette ----
// Priority for a question's color: marked-for-review > answered > visited-but-empty > not-visited
function paletteStatus(qid, { answers, visited, marked }) {
  const answered = hasValue(answers[qid]);
  if (marked.has(qid)) return answered ? "marked-answered" : "marked";
  if (answered) return "answered";
  if (visited.has(qid)) return "visited";
  return "not-visited";
}

const STATUS_STYLE = {
  "not-visited": { background: "#fff", color: "#374151", border: "1px solid #d1d5db" },
  visited: { background: "#e5e7eb", color: "#374151", border: "1px solid #9ca3af" },
  answered: { background: "#16a34a", color: "#fff", border: "1px solid #16a34a" },
  marked: { background: "#eab308", color: "#fff", border: "1px solid #eab308" },
  "marked-answered": { background: "#7c3aed", color: "#fff", border: "1px solid #7c3aed" },
};

export default function AttemptExamPage() {
  const { user, loading } = useRequireRole("student");
  const { token } = useAuth();
  const { lang, t } = useLanguage();
  const router = useRouter();
  const params = useParams();
  const examId = params.examId;

  const STATUS_LABEL = {
    "not-visited": t("not_visited_label"),
    visited: t("not_answered_status"),
    answered: t("answered_status"),
    marked: t("marked_status"),
    "marked-answered": t("answered_marked_status"),
  };

  const [state, setState] = useState(null); // full StartExamResponse
  const [answers, setAnswers] = useState({}); // question_id -> value
  const [savingId, setSavingId] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [visited, setVisited] = useState(new Set());
  const [marked, setMarked] = useState(new Set());

  // ---- Image-upload answers (Milestone 3) ----
  const [imageUploads, setImageUploads] = useState({}); // question_id -> { preview, uploading, error, path }

  // ---- Unified proctoring (tab-switch + camera) ----
  const MAX_VIOLATIONS = 5;
  const [violations, setViolations] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [violationMessage, setViolationMessage] = useState("");
  const [autoSubmitReason, setAutoSubmitReason] = useState("");

  // ---- Camera proctoring ----
  const videoRef = useRef(null);
  const consecutiveBadFramesRef = useRef(0);
  const [cameraStatus, setCameraStatus] = useState("initializing"); // initializing | ready | no-face | multiple-faces | denied

  const handleAnswerChange = (questionId, value) => {
    setAnswers((a) => ({ ...a, [questionId]: value }));
  };

  const saveAnswer = async (questionId, value) => {
    if (!state) return;
    setSavingId(questionId);
    try {
      await submitAnswer(token, state.session_id, questionId, value ?? "");
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleImageUpload = async (questionId, file) => {
    if (!state || !file) return;

    const preview = URL.createObjectURL(file);
    setImageUploads((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] || {}), preview, uploading: true, error: "" },
    }));

    try {
      const answer = await uploadImageAnswer(token, state.session_id, questionId, file, state.session_token);
      setImageUploads((prev) => ({
        ...prev,
        [questionId]: { preview, uploading: false, error: "", path: answer.image_path },
      }));
      // Mark the question as answered locally so the palette/progress reflect it
      // (image answers don't go through submitAnswer/answers[] like text answers do).
      setAnswers((a) => ({ ...a, [questionId]: `__image_uploaded__` }));
    } catch (err) {
      setImageUploads((prev) => ({
        ...prev,
        [questionId]: { ...(prev[questionId] || {}), uploading: false, error: err.message },
      }));
    }
  };

  const handleSubmit = async (isAutoSubmit = false) => {
    if (!state || submittedRef.current) return;
    if (!isAutoSubmit) {
      const unanswered = state.questions.filter((q) => !hasValue(answers[q.question_id])).length;
      const confirmMsg =
        unanswered > 0
          ? `${t("not_answered")}: ${unanswered}. ${t("are_you_sure")}`
          : t("are_you_sure");
      const ok = window.confirm(confirmMsg);
      if (!ok) return;
    }
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await submitExam(token, state.session_id);
      router.replace(`/exam/${examId}/result`);
    } catch (err) {
      setError(err.message);
      submittedRef.current = false;
      setSubmitting(false);
    }
  };

  // Called for any proctoring rule break (tab-switch, no face, multiple faces).
  // Shows a warning the first several times, then auto-submits the exam.
  const registerViolation = (message) => {
    if (submittedRef.current || !state) return;
    setViolationMessage(message);

    // Persist the violation to the backend so examiners can see it on the
    // live-review / flagged-sessions views, regardless of local outcome.
    reportViolation(token, state.session_id, message).catch(() => {
      /* best-effort — don't block the exam UI on a logging failure */
    });

    setViolations((prev) => {
      const next = prev + 1;
      if (next >= MAX_VIOLATIONS) {
        const reason = `Proctoring limit reached (${next} violations). The exam is being submitted automatically.`;
        setAutoSubmitReason(reason);
        window.alert(reason);
        handleSubmit(true);
      } else {
        setShowTabWarning(true);
      }
      return next;
    });
  };

  // ---- Screen-change / tab-switch detection ----
  useEffect(() => {
    if (!state) return;
    const handleVisibilityChange = () => {
      if (document.hidden) registerViolation("You switched away from the exam tab/window.");
    };
    const handleBlur = () => {
      registerViolation("You switched away from the exam tab/window.");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
    };
  }, [state]);

  // ---- Camera live proctoring (face presence / multiple faces) ----
  useEffect(() => {
    if (!state) return;
    let stream;
    let intervalId;
    let cancelled = false;

    async function setupCamera() {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraStatus("ready");

        intervalId = setInterval(async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState !== 4) return;
          try {
            const detections = await faceapi.detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions());
            if (cancelled) return;

            if (detections.length === 1) {
              setCameraStatus("ready");
              consecutiveBadFramesRef.current = 0;
              return;
            }

            setCameraStatus(detections.length === 0 ? "no-face" : "multiple-faces");
            consecutiveBadFramesRef.current += 1;

            // Require the problem to persist across 2 checks (~8s) before
            // counting it, so a brief head-turn doesn't trigger a warning.
            if (consecutiveBadFramesRef.current >= 2) {
              consecutiveBadFramesRef.current = 0;
              registerViolation(
                detections.length === 0
                  ? "No face was detected by the camera. Please stay visible in front of the camera."
                  : "Multiple faces were detected in the camera frame."
              );
            }
          } catch {
            /* ignore transient detection errors */
          }
        }, 4000);
      } catch (err) {
        setCameraStatus("denied");
      }
    }

    setupCamera();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [state]);

  // ---- Load / start the exam session ----
  useEffect(() => {
    if (!token || !examId) return;
    startExam(token, examId, lang)
      .then((data) => {
        if (data.status === "submitted" || data.status === "auto_submitted") {
          router.replace(`/exam/${examId}/result`);
          return;
        }
        setState(data);
        setTimeLeft(data.time_remaining_seconds);
        if (data.questions.length > 0) {
          setVisited(new Set([data.questions[0].question_id]));
        }
      })
      .catch((err) => setError(err.message));
  }, [token, examId, lang]);

  // ---- Countdown timer ----
  useEffect(() => {
    if (timeLeft === null) return;
    if (timeLeft <= 0) {
      handleSubmit(true);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft]);

  // ---- Re-sync the timer with the backend every 20s ----
  useEffect(() => {
    if (!state) return;
    const interval = setInterval(async () => {
      try {
        const status = await getSessionStatus(token, state.session_id);
        if (status.status !== "in_progress") {
          if (!submittedRef.current) {
            submittedRef.current = true;
            router.replace(`/exam/${examId}/result`);
          }
          return;
        }
        setTimeLeft(status.time_remaining_seconds);
      } catch {
        /* ignore transient errors */
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [state, token, examId, router]);

  if (loading || !user) return null;

  if (error && !state) {
    return (
      <div className="dashboard-wrapper">
        <div className="card error-text">{error}</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="dashboard-wrapper">
        <div className="card">{t("loading_exam")}</div>
      </div>
    );
  }

  const questions = state.questions;
  const total = questions.length;

  if (total === 0) {
    return (
      <div className="dashboard-wrapper">
        <div className="card">
          <p style={{ color: "#9ca3af" }}>{t("no_questions_added_yet")}</p>
        </div>
      </div>
    );
  }

  const q = questions[currentIndex];
  const timerLow = timeLeft !== null && timeLeft <= 60;

  const goTo = (idx) => {
    if (idx < 0 || idx >= total) return;
    setCurrentIndex(idx);
    setVisited((prev) => new Set(prev).add(questions[idx].question_id));
  };

  const handleSaveAndContinue = async () => {
    // image_upload answers are already persisted server-side by handleImageUpload
    // as soon as the file finishes uploading — saving text here would overwrite them.
    if (q.question_type !== "image_upload") {
      const value = answers[q.question_id];
      await saveAnswer(q.question_id, value);
    }
    // Explicitly saving/answering clears any earlier "mark for review" flag
    setMarked((prev) => {
      const next = new Set(prev);
      next.delete(q.question_id);
      return next;
    });
    goTo(currentIndex + 1);
  };

  const handleMarkForReviewAndNext = async () => {
    if (q.question_type !== "image_upload") {
      const value = answers[q.question_id];
      if (hasValue(value)) await saveAnswer(q.question_id, value);
    }
    setMarked((prev) => new Set(prev).add(q.question_id));
    goTo(currentIndex + 1);
  };

  const handleNext = () => {
    goTo(currentIndex + 1);
  };

  const handlePrevious = () => {
    goTo(currentIndex - 1);
  };

  const answeredCount = questions.filter((qq) => hasValue(answers[qq.question_id])).length;
  const markedCount = marked.size;

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">{t("role_student")}</span>
          <h1 style={{ margin: "8px 0 0" }}>{state.exam.title}</h1>
          <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "13px" }}>
            {state.exam.subject} • {total} {t("question")}(s) • {t("negative_marks_label")}: {state.exam.negative_marks}
          </p>
        </div>
        <div
          style={{
            padding: "10px 18px",
            borderRadius: "10px",
            background: timerLow ? "#fef2f2" : "#eff6ff",
            color: timerLow ? "#b91c1c" : "#1d4ed8",
            fontWeight: 700,
            fontSize: "20px",
            minWidth: "110px",
            textAlign: "center",
          }}
        >
          {timeLeft !== null ? formatTime(timeLeft) : "--:--"}
        </div>
      </div>

      {violations > 0 && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 16px",
            borderRadius: "8px",
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          ⚠ {t("proctoring_warnings_label")}: {violations} / {MAX_VIOLATIONS}
        </div>
      )}

      {/* ---- Camera preview (bottom-right) ---- */}
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          width: "150px",
          height: "112px",
          borderRadius: "10px",
          overflow: "hidden",
          border: `3px solid ${
            cameraStatus === "ready" ? "#16a34a" : cameraStatus === "initializing" ? "#9ca3af" : "#dc2626"
          }`,
          background: "#111827",
          zIndex: 40,
          boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
        }}
      >
        <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "2px 6px",
            fontSize: "10px",
            fontWeight: 700,
            textAlign: "center",
            color: "#fff",
            background: "rgba(0,0,0,0.55)",
          }}
        >
          {cameraStatus === "ready" && t("camera_ok")}
          {cameraStatus === "initializing" && t("starting_camera")}
          {cameraStatus === "no-face" && t("no_face_detected")}
          {cameraStatus === "multiple-faces" && t("multiple_faces_warn")}
          {cameraStatus === "denied" && t("camera_blocked")}
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: "20px", alignItems: "start" }}>
        {/* ---- Current question card ---- */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
            <strong>
              Q{currentIndex + 1} {t("q_of_label")} {total}. {q.question_text}
            </strong>
            <span style={{ color: "#6b7280", fontSize: "13px", whiteSpace: "nowrap", marginLeft: "12px" }}>
              {q.marks} {t("marks_unit")}{savingId === q.question_id ? ` • ${t("saving_suffix")}` : ""}
            </span>
          </div>

          {q.question_type === "mcq" && (
            <div>
              {q.options.map((opt) => (
                <label key={opt} style={{ display: "block", marginBottom: "8px", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={q.question_id}
                    checked={answers[q.question_id] === opt}
                    onChange={() => handleAnswerChange(q.question_id, opt)}
                    style={{ marginRight: "8px" }}
                  />
                  {opt}
                </label>
              ))}
            </div>
          )}

          {q.question_type === "multi_select" && (
            <div>
              {q.options.map((opt) => {
                const current = (answers[q.question_id] || "").split(",").map((s) => s.trim()).filter(Boolean);
                const checked = current.includes(opt);
                return (
                  <label key={opt} style={{ display: "block", marginBottom: "8px", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked ? current.filter((v) => v !== opt) : [...current, opt];
                        handleAnswerChange(q.question_id, next.join(", "));
                      }}
                      style={{ marginRight: "8px" }}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}

          {q.question_type === "short_answer" && (
            <input
              value={answers[q.question_id] || ""}
              onChange={(e) => handleAnswerChange(q.question_id, e.target.value)}
              placeholder={t("type_your_answer")}
            />
          )}

          {q.question_type === "long_answer" && (
            <textarea
              rows={6}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "14px" }}
              value={answers[q.question_id] || ""}
              onChange={(e) => handleAnswerChange(q.question_id, e.target.value)}
              placeholder={t("type_your_answer")}
            />
          )}

          {q.question_type === "image_upload" && (
            <div>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  if (file) handleImageUpload(q.question_id, file);
                }}
                style={{ marginBottom: "10px" }}
              />
              <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#6b7280" }}>
                {t("upload_image_hint")}
              </p>

              {imageUploads[q.question_id]?.preview && (
                <div style={{ marginTop: "8px" }}>
                  <img
                    src={imageUploads[q.question_id].preview}
                    alt="Answer preview"
                    style={{ maxWidth: "260px", maxHeight: "260px", borderRadius: "8px", border: "1px solid #d1d5db", display: "block" }}
                  />
                  {imageUploads[q.question_id].uploading && (
                    <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#6b7280" }}>{t("uploading_label")}</p>
                  )}
                  {!imageUploads[q.question_id].uploading && !imageUploads[q.question_id].error && (
                    <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#16a34a" }}>{t("uploaded_ok")}</p>
                  )}
                  {imageUploads[q.question_id].error && (
                    <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#dc2626" }}>
                      {imageUploads[q.question_id].error}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- Navigation buttons ---- */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "24px", paddingTop: "18px", borderTop: "1px solid #e5e7eb" }}>
            <button
              className="btn-primary"
              style={{ width: "auto", padding: "10px 20px", background: "#eab308" }}
              onClick={handleMarkForReviewAndNext}
            >
              {t("mark_for_review_next")}
            </button>
            <button
              className="btn-primary"
              style={{ width: "auto", padding: "10px 20px" }}
              onClick={handleSaveAndContinue}
            >
              {t("save_and_continue")}
            </button>
            <button
              style={{ width: "auto", padding: "10px 20px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontWeight: 600 }}
              onClick={handlePrevious}
              disabled={currentIndex === 0}
            >
              {t("previous")}
            </button>
            <button
              style={{ width: "auto", padding: "10px 20px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontWeight: 600 }}
              onClick={handleNext}
              disabled={currentIndex === total - 1}
            >
              {t("next")}
            </button>
            <button
              className="btn-primary"
              style={{ width: "auto", padding: "10px 20px", background: "#b91c1c", marginLeft: "auto" }}
              onClick={() => handleSubmit(false)}
              disabled={submitting}
            >
              {submitting ? t("submitting") : t("submit_exam")}
            </button>
          </div>
        </div>

        {/* ---- Palette sidebar ---- */}
        <div className="card">
          <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#6b7280" }}>
            {t("answered_label")}: <strong>{answeredCount}</strong> / {total} &nbsp;•&nbsp; {t("marked_label")}: <strong>{markedCount}</strong>
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "8px", marginBottom: "16px" }}>
            {questions.map((qq, idx) => {
              const status = paletteStatus(qq.question_id, { answers, visited, marked });
              const style = STATUS_STYLE[status];
              return (
                <button
                  key={qq.question_id}
                  title={STATUS_LABEL[status]}
                  onClick={() => goTo(idx)}
                  style={{
                    ...style,
                    height: "36px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: "13px",
                    outline: idx === currentIndex ? "2px solid #1d4ed8" : "none",
                    outlineOffset: "2px",
                  }}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: "12px", color: "#374151", display: "grid", gap: "6px" }}>
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ width: "14px", height: "14px", borderRadius: "4px", display: "inline-block", ...STATUS_STYLE[key] }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Tab-switch warning modal ---- */}
      {showTabWarning && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div className="card" style={{ maxWidth: "420px", textAlign: "center" }}>
            <h2 style={{ margin: "0 0 12px", color: "#b91c1c" }}>⚠ {t("proctoring_warning_title")}</h2>
            <p style={{ margin: "0 0 8px", color: "#374151" }}>{violationMessage} {t("recorded_suffix")}</p>
            <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: "13px" }}>
              {t("warning_of_label")} {violations} / {MAX_VIOLATIONS}
            </p>
            <button className="btn-primary" style={{ width: "auto", padding: "10px 28px" }} onClick={() => setShowTabWarning(false)}>
              {t("understand_continue")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
