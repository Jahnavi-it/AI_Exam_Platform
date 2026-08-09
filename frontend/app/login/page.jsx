"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginUser } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import LanguageSwitcher from "../../components/LanguageSwitcher";

const DASHBOARD_BY_ROLE = {
  admin: "/admin/dashboard",
  examiner: "/examiner/dashboard",
  student: "/student/dashboard",
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useLanguage();
  const [role, setRole] = useState("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const ROLES = [
    { value: "student", label: t("role_student") },
    { value: "examiner", label: t("role_examiner") },
    { value: "admin", label: t("role_admin") },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await loginUser({ email, password });

      if (data.user.role !== role) {
        setError(
          `Invalid credentials. This account is not registered as ${
            ROLES.find((r) => r.value === role)?.label
          }.`
        );
        setLoading(false);
        return;
      }

      login(data.access_token, data.user);
      router.push(DASHBOARD_BY_ROLE[data.user.role] || "/login");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <LanguageSwitcher />
        </div>
        <h1>{t("sign_in")}</h1>
        <p className="subtitle">{t("select_role_note")}</p>
        {error && <div className="error-text">{error}</div>}
        <div className="role-select">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              className={role === r.value ? "active" : ""}
              onClick={() => setRole(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t("email")}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="form-group">
            <label>{t("password")}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("password")}
            />
          </div>
          <div className="forgot-link">
            <Link href="/forgot-password">{t("forgot_password")}</Link>
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? t("signing_in") : t("sign_in")}
          </button>
        </form>
        <div className="switch-link">
          {t("dont_have_account")} <Link href="/register">{t("register")}</Link>
        </div>
      </div>
    </div>
  );
}
