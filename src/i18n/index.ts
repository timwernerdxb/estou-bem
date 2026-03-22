import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import ptBR from "./locales/pt-BR.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import de from "./locales/de.json";

// ─── Types ────────────────────────────────────────────────────

export type SupportedLang = "pt-BR" | "en" | "es" | "de";

type TranslationKeys = keyof typeof ptBR;

type Translations = Record<SupportedLang, Record<string, string>>;

const translations: Translations = {
  "pt-BR": ptBR,
  en,
  es,
  de,
};

export const SUPPORTED_LANGUAGES: { code: SupportedLang; label: string }[] = [
  { code: "pt-BR", label: "Portugues (Brasil)" },
  { code: "en", label: "English" },
  { code: "es", label: "Espanol" },
  { code: "de", label: "Deutsch" },
];

const STORAGE_KEY = "estoubem_lang";
const DEFAULT_LANG: SupportedLang = "pt-BR";

// ─── Context ──────────────────────────────────────────────────

interface I18nContextValue {
  t: (key: string, replacements?: Record<string, string | number>) => string;
  lang: SupportedLang;
  setLang: (lang: SupportedLang) => void;
}

const I18nContext = createContext<I18nContextValue>({
  t: (key) => key,
  lang: DEFAULT_LANG,
  setLang: () => {},
});

// ─── Provider ─────────────────────────────────────────────────

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [lang, setLangState] = useState<SupportedLang>(DEFAULT_LANG);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored && translations[stored as SupportedLang]) {
        setLangState(stored as SupportedLang);
      }
    });
  }, []);

  const setLang = useCallback((newLang: SupportedLang) => {
    setLangState(newLang);
    AsyncStorage.setItem(STORAGE_KEY, newLang);
  }, []);

  const t = useCallback(
    (key: string, replacements?: Record<string, string | number>): string => {
      const str =
        translations[lang]?.[key] || translations[DEFAULT_LANG][key] || key;
      if (!replacements) return str;
      return str.replace(
        /\{(\w+)\}/g,
        (_, k) => String(replacements[k] ?? "")
      );
    },
    [lang]
  );

  const value = React.useMemo(() => ({ t, lang, setLang }), [t, lang, setLang]);

  return React.createElement(I18nContext.Provider, { value }, children);
}

// ─── Hook ─────────────────────────────────────────────────────

export function useI18n() {
  return useContext(I18nContext);
}
