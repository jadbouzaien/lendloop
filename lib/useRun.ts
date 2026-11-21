"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "./errors";

/** Wraps an async action with pending + error state for buttons and forms. */
export function useRun() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, setError };
}
