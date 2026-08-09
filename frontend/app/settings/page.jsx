"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useRequireAuth } from "../../context/AuthContext";
import { changePassword } from "../../lib/api";

const roleDashboardPath = {
  admin: "/admin/dashboard",
  examiner: "/examiner/dashboard",
  student: "/student/dashboard",
};

export default function SettingsPage() {
  const { user, loading } = useRequireAuth();
  const { token, logout } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading || !user) return null;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New password and confirm password do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(token, currentPassword, newPassword);
      setSuccess("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const backPath = roleDashboardPath[user.role] || "/login";

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-header">
        <div>
          <span className="badge">{user.role}</span>
          <h1 style={{ margin: "8px 0 0" }}>Settings</h1>
        </div>
        <button className="logout-btn" onClick={() => router.push(backPath)}>
          Back to Dashboard
        </button>
      </div>

      <div className="card">
        <h2 className="section-title">Profile</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>Name</div>
            <div style={{ fontSize: "16px", color: "#1f2530" }}>{user.name}</div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>Email</div>
            <div style={{ fontSize: "16px", color: "#1f2530" }}>{user.email}</div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>Role</div>
            <div style={{ fontSize: "16px", color: "#1f2530", textTransform: "capitalize" }}>{user.role}</div>
          </div>
        </div>
      </div>

      <div className="card section-gap">
        <h2 className="section-title">Change Password</h2>

        {error && <div className="error-text">{error}</div>}
        {success && (
          <div className="card" style={{ background: "#ecfdf5", color: "#047857", padding: "10px 14px", marginBottom: "14px" }}>
            {success}
          </div>
        )}

        <form onSubmit={handleChangePassword} className="inline-form">
          <div className="form-group">
            <label>Current Password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>New Password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Confirm New Password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>

      <div className="card section-gap">
        <h2 className="section-title">Account</h2>
        <p style={{ color: "#6b7280", fontSize: "14px" }}>
          Logging out will end your current session on this device.
        </p>
        <button className="delete-btn" style={{ marginTop: "10px" }} onClick={handleLogout}>
          Log Out
        </button>
      </div>
    </div>
  );
}
