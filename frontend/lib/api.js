// Central place that talks to the FastAPI backend.
// In production this comes from the NEXT_PUBLIC_API_URL env var (set it in
// Vercel's project settings, or in .env.local for local dev). Falls back to
// localhost so `npm run dev` keeps working out of the box.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.detail || "Something went wrong. Please try again.");
  }
  return data;
}

export const registerUser = ({ name, email, password, role }) =>
  request("/api/auth/register", { method: "POST", body: { name, email, password, role } });

export const loginUser = ({ email, password }) =>
  request("/api/auth/login", { method: "POST", body: { email, password } });

export const getMe = (token) => request("/api/me", { token });

export const getAdminDashboard = (token) => request("/api/admin/dashboard", { token });
export const getExaminerDashboard = (token) => request("/api/examiner/dashboard", { token });
export const getStudentDashboard = (token) => request("/api/student/dashboard", { token });

// ---------- Question Bank (Examiner) ----------
// payload: { question_text, question_type, marks, subject, difficulty_level, options?, correct_answer? }
export const createQuestion = (token, payload) =>
  request("/api/questions", { method: "POST", body: payload, token });

export const listQuestions = (token, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/questions${qs ? `?${qs}` : ""}`, { token });
};

// Examiner/Admin-only â€” includes correct_answer, used for the "attach
// questions to an exam" picker.
export const listQuestionsDetailed = (token, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/questions/mine-detailed${qs ? `?${qs}` : ""}`, { token });
};

export const deleteQuestion = (token, questionId) =>
  request(`/api/questions/${questionId}`, { method: "DELETE", token });

// ---------- Exam Configuration (Admin) ----------
export const createExam = (token, payload) =>
  request("/api/exams", { method: "POST", body: payload, token });

export const listExams = (token) => request("/api/exams", { token });

export const deleteExam = (token, examId) =>
  request(`/api/exams/${examId}`, { method: "DELETE", token });

// Milestone 2 â€” attach specific Question Bank questions to an exam
export const attachQuestionsToExam = (token, examId, questionIds) =>
  request(`/api/exams/${examId}/questions`, {
    method: "POST",
    body: { question_ids: questionIds },
    token,
  });

export const getAttachedQuestionIds = (token, examId) =>
  request(`/api/exams/${examId}/attached-question-ids`, { token });

// ---------- Exam Attempt (Student) â€” Milestone 2 ----------
export const startExam = (token, examId, lang) =>
  request(`/api/attempts/start/${examId}${lang ? `?lang=${lang}` : ""}`, { method: "POST", token });

export const getSessionStatus = (token, sessionId) =>
  request(`/api/attempts/${sessionId}`, { token });

export const submitAnswer = (token, sessionId, questionId, submittedAnswer) =>
  request(`/api/attempts/${sessionId}/answer`, {
    method: "POST",
    body: { question_id: questionId, submitted_answer: submittedAnswer },
    token,
  });

export const submitExam = (token, sessionId) =>
  request(`/api/attempts/${sessionId}/submit`, { method: "POST", token });

export const getResult = (token, sessionId, lang) =>
  request(`/api/attempts/${sessionId}/result${lang ? `?lang=${lang}` : ""}`, { token });

export const getMySessions = (token) => request("/api/attempts/mine/all", { token });

export const forgotPassword = (email) =>
  request("/api/auth/forgot-password", { method: "POST", body: { email } });

export const resetPassword = (token, newPassword) =>
  request("/api/auth/reset-password", { method: "POST", body: { token, new_password: newPassword } });

// ---------- Settings ----------
export const changePassword = (token, currentPassword, newPassword) =>
  request("/api/auth/change-password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
    token,
  });

// ---------- Admin Reports ----------
export const getStudentReports = (token) =>
  request("/api/admin/reports/students", { token });


// ---------- Examiner Review & Live Proctoring (Milestone 2) ----------
export const getLiveSessions = (token) => request("/api/review/live", { token });

export const getPendingReviews = (token) => request("/api/review/pending", { token });

export const getPendingReviewCount = (token) => request("/api/review/pending/count", { token });

export const approveReview = (token, sessionId) =>
  request(`/api/review/${sessionId}/approve`, { method: "POST", token });

export const rejectReview = (token, sessionId) =>
  request(`/api/review/${sessionId}/reject`, { method: "POST", token });

export const reportViolation = (token, sessionId, reason) =>
  request(`/api/attempts/${sessionId}/violation`, {
    method: "POST",
    body: { reason },
    token,
  });

// ---------- Image Upload Answers (Milestone 3) ----------
// For image_upload questions — call instead of submitAnswer for that question.
export const uploadImageAnswer = async (token, sessionId, questionId, file, sessionToken) => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/api/attempts/${sessionId}/answer/${questionId}/image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Session-Token": sessionToken || "",
    },
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || "Image upload failed. Please try again.");
  }
  return data;
};

// ---------- AI Proctoring (Milestone 3) ----------
// REST fallback heartbeat — prefer a WebSocket to /ws/proctor/{sessionId}?token=<session_token>
// for the live connection; this covers browsers/proxies that can't hold one open.
export const sendProctorHeartbeat = (token, sessionId, signals) =>
  request(`/api/sessions/${sessionId}/proctor/heartbeat`, {
    method: "POST",
    body: signals,
    token,
  });

export const getProctorEvents = (token, sessionId) =>
  request(`/api/sessions/${sessionId}/proctor/events`, { token });

export const getFlaggedSessions = (token, examId) =>
  request(`/api/exams/${examId}/proctor/flagged-sessions`, { token });

// ---------- Subjective Grading Queue (Milestone 3, Examiner) ----------
export const getGradingQueue = (token, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/grading/queue${qs ? `?${qs}` : ""}`, { token });
};

export const setGradingScore = (token, answerId, score, feedback) =>
  request(`/api/grading/answers/${answerId}/score`, {
    method: "POST",
    body: { score, feedback },
    token,
  });

export const triggerAiGrading = (token, sessionId) =>
  request(`/api/sessions/${sessionId}/ai-grade`, { method: "POST", token });

export const publishResult = (token, sessionId) =>
  request(`/api/results/${sessionId}/publish`, { method: "POST", token });
