import { useCallback, useEffect, useRef, useState } from "react";

/** Tiny data-fetching hook: { data, error, loading, reload } */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (alive.current) setState({ data: null, error: e.message || String(e), loading: false });
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run };
}
