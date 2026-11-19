"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Lang, type TFn } from "./core";

const LangContext = createContext<Lang>("id");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT(): TFn {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
