"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotPassword } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1>Forgot password</h1>
        <p className="subtitle">
          Enter your account email and we'll send you a link to reset your
          password.
        </p>

        {error && <div className="error-text">{error}</div>}

        {sent ? (
          <div className="success-text">
            If that email is registered, a reset link has been sent. Please
            check your inbox (and spam folder).
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <div className="switch-link">
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
