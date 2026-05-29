"use client";

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

type HomeResetContextValue = {
  registerReset: (reset: () => void) => void;
  resetHome: () => void;
};

const HomeResetContext = createContext<HomeResetContextValue | null>(null);

export function HomeResetProvider({ children }: { children: ReactNode }) {
  const resetRef = useRef<(() => void) | null>(null);

  const registerReset = useCallback((reset: () => void) => {
    resetRef.current = reset;
  }, []);

  const resetHome = useCallback(() => {
    resetRef.current?.();
  }, []);

  return (
    <HomeResetContext.Provider value={{ registerReset, resetHome }}>
      {children}
    </HomeResetContext.Provider>
  );
}

export function useHomeReset() {
  const context = useContext(HomeResetContext);
  if (!context) {
    throw new Error("useHomeReset must be used within HomeResetProvider");
  }
  return context;
}

export function useOptionalHomeReset() {
  return useContext(HomeResetContext);
}
