"use client";

import { useEffect, useState } from "react";

/**
 * Shows a small "Install app" banner.
 * - Android / desktop Chrome & Edge: uses the native beforeinstallprompt event.
 * - iOS Safari: that event doesn't exist, so we show manual
 *   "Share -> Add to Home Screen" instructions instead.
 * - Hides itself permanently (per browser) once dismissed or installed.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const alreadyStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;

    const dismissed = localStorage.getItem("installPromptDismissed") === "1";

    if (alreadyStandalone || dismissed) return;

    const ua = window.navigator.userAgent;
    const iOSDevice = /iphone|ipad|ipod/i.test(ua);
    setIsIOS(iOSDevice);

    if (iOSDevice) {
      setVisible(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem("installPromptDismissed", "1");
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 1000,
        background: "#1f2937",
        color: "#fff",
        borderRadius: 12,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
        fontSize: 13,
      }}
    >
      <span style={{ flex: 1 }}>
        {isIOS
          ? "Install this app: tap Share, then \"Add to Home Screen\"."
          : "Install this app on your device for quick, offline-ready access."}
      </span>
      {!isIOS && (
        <button
          onClick={install}
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Install
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          color: "#9ca3af",
          border: "none",
          fontSize: 16,
          cursor: "pointer",
        }}
      >
        ×
      </button>
    </div>
  );
}
