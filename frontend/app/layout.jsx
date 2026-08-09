import "./globals.css";
import "./dashboard-extra.css";
import { AuthProvider } from "../context/AuthContext";
import { LanguageProvider } from "../context/LanguageContext";
import LanguageSwitcher from "../components/LanguageSwitcher";
import InstallPrompt from "../components/InstallPrompt";

export const metadata = {
  title: "AI-Proctored Exam Platform",
  description: "AI-proctored online examination platform for students and examiners.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ExamPlatform",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ExamPlatform" />
      </head>
      <body>
        <AuthProvider>
          <LanguageProvider>
            <div style={{ position: "fixed", top: 8, right: 8, zIndex: 1000 }}>
              <LanguageSwitcher />
            </div>
            {children}
            <InstallPrompt />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}