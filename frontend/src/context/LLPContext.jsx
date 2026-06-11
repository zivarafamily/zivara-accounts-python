// context/LLPContext.jsx – Current entity (LLP) context
// Stores which LLP the user is currently working in.
// Persisted to localStorage so page refresh keeps the selection.

import { createContext, useContext, useState } from "react";

const LLPContext = createContext(null);
const STORAGE_KEY = "zivara_llp";
const DEFAULT_LLP = { llpId: null, llpName: "All Entities", shortCode: "ALL", global: true };

export function LLPProvider({ children }) {
  const [currentLLP, setCurrentLLP] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_LLP;
    } catch {
      return DEFAULT_LLP;
    }
  });

  const selectLLP = (llp) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(llp));
    setCurrentLLP(llp);
  };

  const clearLLP = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_LLP));
    setCurrentLLP(DEFAULT_LLP);
  };

  return (
    <LLPContext.Provider value={{ currentLLP, selectLLP, clearLLP }}>
      {children}
    </LLPContext.Provider>
  );
}

export function useLLP() {
  const ctx = useContext(LLPContext);
  if (!ctx) throw new Error("useLLP must be used within LLPProvider");
  return ctx;
}
