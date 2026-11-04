"use client";
import { useState } from "react";
import type { Service } from "../core/service";
type Data = Awaited<ReturnType<Service["dashboard"]>>;
export default function ImportToolbar({
  data,
  items,
  onDone,
  api,
  initialProject = "",
}: {
  initialProject?: string;
  data: Data;
  items: string[];
  onDone: () => Promise<void>;
  api: (path: string, body?: unknown) => Promise<any>;
}) {
  const [project, setProject] = useState(initialProject),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const repositories = new Set(
    items
      .map((id) =>
        data.items
          .find((row) => row.data.id === id)
          ?.data.repository.toLowerCase(),
      )
      .filter((repo): repo is string => !!repo),
  );
  const choices = data.projects.filter((row) =>
    [...repositories].every((repo) =>
      row.data.repositories.some((value) => value.toLowerCase() === repo),
    ),
  );
  const validProject = choices.some((row) => row.data.id === project);
  const linkedTasks = new Set(
    data.tasks
      .filter((row) => row.data.project === project)
      .map((row) => row.data.id),
  );
  const linkedItems = new Set(
    data.links
      .filter(
        (row) =>
          row.data.status === "approved" && linkedTasks.has(row.data.task),
      )
      .map((row) => row.data.item),
  );
  const pendingItems = items.filter((id) => !linkedItems.has(id));
  return (
    <div
      className="import-toolbar"
      role="region"
      aria-label="선택한 GitHub 항목 가져오기"
    >
      <strong>{items.length}개 선택</strong>
      <label>
        추가할 프로젝트
        <select
          aria-label="가져올 프로젝트"
          value={validProject ? project : ""}
          onChange={(e) => {
            setProject(e.target.value);
          }}
        >
          <option value="">프로젝트 선택</option>
          {choices.map((p) => (
            <option key={p.data.id} value={p.data.id}>
              {p.data.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button"
        disabled={busy || !validProject || !pendingItems.length}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const result = await api("items/import", {
              project,
              items: pendingItems,
            });
            setMessage(
              `${result.created}개 추가, ${result.skipped + items.length - pendingItems.length}개 이미 연결됨`,
            );
            await onDone();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "추가 중…"
          : validProject && !pendingItems.length
            ? "이미 모두 연결됨"
            : "선택 항목 프로젝트에 추가"}
      </button>
      <small>
        {choices.length
          ? "선택한 항목의 저장소를 모두 포함하는 프로젝트에 추가할 수 있습니다. GitHub 원본은 변경하지 않습니다."
          : "선택한 저장소를 모두 포함하는 프로젝트가 없습니다. 저장소별로 나누어 선택하거나 프로젝트의 연결 저장소를 수정하세요."}
      </small>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
