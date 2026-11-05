"use client";
import { useEffect, useRef, useState } from "react";
import type { Stored } from "../core/model";
import type { Sprint } from "../core/planning-model";
export default function TaskSprintSelect({
  api,
  project,
  value,
}: {
  api: (path: string, body?: unknown) => Promise<any>;
  project: string;
  value?: string | null;
}) {
  const [sprints, setSprints] = useState<Stored<Sprint>[]>([]),
    [error, setError] = useState("");
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let active = true;
    void apiRef
      .current(`planning/sprints?project=${encodeURIComponent(project)}`)
      .then((r) => {
        if (active) setSprints(r);
      })
      .catch(() => {
        if (active) setError("스프린트를 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [project]);
  return (
    <label>
      스프린트
      <select name="sprintId" aria-label="스프린트" defaultValue={value ?? ""}>
        <option value="">백로그 · 미배정</option>
        {value && !sprints.some((s) => s.data.id === value) && (
          <option value={value}>기존 스프린트</option>
        )}
        {sprints
          .filter((s) => s.data.status !== "closed" || s.data.id === value)
          .map((s) => (
            <option key={s.data.id} value={s.data.id}>
              {s.data.name}
              {s.data.status === "closed"
                ? " · 종료"
                : s.data.status === "active"
                  ? " · 진행 중"
                  : ""}
            </option>
          ))}
      </select>
      {error && <small>{error} 기존 배정은 유지하세요.</small>}
    </label>
  );
}
