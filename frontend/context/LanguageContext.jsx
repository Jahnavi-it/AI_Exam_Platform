"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { UI_STRINGS, SUPPORTED_LANGUAGES } from "../lib/translations";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState("en");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("ui_lang");
    if (stored && SUPPORTED_LANGUAGES.some((l) => l.code === stored)) {
      setLangState(stored);
    }
    setLoaded(true);
  }, []);

  const setLang = (code) => {
    localStorage.setItem("ui_lang", code);
    setLangState(code);
  };

  // t("key") looks up the current language's string, falling back to
  // English, then to the key itself so missing translations never crash.
  const t = (key) => {
    const dict = UI_STRINGS[lang] || UI_STRINGS.en;
    return dict[key] ?? UI_STRINGS.en[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, loaded, languages: SUPPORTED_LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
