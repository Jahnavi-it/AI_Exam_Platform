"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerUser } from "../../lib/api";
import { useLanguage } from "../../context/LanguageContext";
import LanguageSwitcher from "../../components/LanguageSwitcher";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [role, setRole] = useState("student");
  const [name, setName] = useState("");
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
      await registerUser({ name, email, password, role });
      router.push("/login?registered=1");
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
        <h1>{t("create_account")}</h1>
        <p className="subtitle">{t("register_note")}</p>

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
            <label>{t("full_name")}</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("full_name")}
            />
          </div>

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
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("at_least_6")}
            />
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? t("creating_account") : `${t("register")} — ${ROLES.find((r) => r.value === role)?.label}`}
          </button>
        </form>

        <div className="switch-link">
          {t("already_have_account")} <Link href="/login">{t("sign_in")}</Link>
        </div>
      </div>
    </div>
  );
}
