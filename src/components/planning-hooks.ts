"use client";
import { useEffect, useRef, useState } from "react";
export type PlanningApi = (path: string, body?: unknown) => Promise<any>;
export function usePlanningData<T>(
  api: PlanningApi,
  path: string | null,
  body?: unknown,
) {
  const ref = useRef(api);
  ref.current = api;
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    serialized = body === undefined ? undefined : JSON.stringify(body);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    if (!path) return;
    setLoading(true);
    void ref
      .current(
        path,
        serialized === undefined ? undefined : JSON.parse(serialized),
      )
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, serialized, version]);
  return { data, loading, error, reload: () => setVersion((v) => v + 1) };
}
export function usePlanningAction(
  api: PlanningApi,
  refresh: () => Promise<void>,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(false),
    apiRef = useRef(api),
    refreshRef = useRef(refresh);
  apiRef.current = api;
  refreshRef.current = refresh;
  async function mutate(
    path: string,
    body: unknown,
    success = "저장했습니다.",
  ) {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRef.current(
        path,
        typeof body === "function" ? await body() : body,
      );
      setNotice(success);
      await refreshRef.current();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return {
    busy,
    error,
    notice,
    mutate,
    clear: () => {
      setError("");
      setNotice("");
    },
  };
}
