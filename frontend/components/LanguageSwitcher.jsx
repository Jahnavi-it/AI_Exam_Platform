"use client";

import { useLanguage } from "../context/LanguageContext";

export default function LanguageSwitcher() {
  const { lang, setLang, languages, loaded } = useLanguage();

  if (!loaded) return null;

  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      aria-label="Select language"
      style={{ padding: "4px 8px" }}
    >
      {languages.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
