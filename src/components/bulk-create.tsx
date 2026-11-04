"use client";
import { createId } from "../core/browser-id";
import { useRef, useState } from "react";
import type { Service } from "../core/service";
type Data = Awaited<ReturnType<Service["dashboard"]>>;
export default function BulkCreate({
  kind,
  data,
  api,
  refresh,
  preferredProject = "",
}: {
  kind: "project" | "feature" | "task";
  data: Data;
  api: (path: string, body?: unknown) => Promise<unknown>;
  refresh: () => Promise<void>;
  preferredProject?: string;
}) {
  const [project, setProject] = useState(
      preferredProject || data.projects[0]?.data.id || "",
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const submitting = useRef(false);
  return (
    <details className="management-form">
      <summary>
        {kind === "project"
          ? "프로젝트"
          : kind === "feature"
            ? "기능"
            : "태스크"}{" "}
        일괄 추가
      </summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          const form = e.currentTarget,
            f = new FormData(form),
            names = String(f.get("names") ?? "")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
          setMessage("");
          if (!names.length || names.length > 100) {
            setMessage("이름을 1~100개 입력하세요.");
            return;
          }
          submitting.current = true;
          setBusy(true);
          let created = 0;
          try {
            for (const name of names) {
              const input =
                kind === "project"
                  ? {
                      id: `project-${createId()}`,
                      name,
                      goal: "",
                      repositories: [String(f.get("repository"))],
                    }
                  : kind === "feature"
                    ? {
                        id: `feature-${createId()}`,
                        name,
                        goal: "",
                        project,
                      }
                    : {
                        id: `task-${createId()}`,
                        title: name,
                        project,
                      };
              await api(
                kind === "project"
                  ? "projects"
                  : kind === "feature"
                    ? "features"
                    : "tasks",
                { data: input },
              );
              created++;
            }
            form.reset();
            setMessage(`${created}개 등록했습니다.`);
          } catch (error) {
            const remaining = form.elements.namedItem(
              "names",
            ) as HTMLTextAreaElement;
            remaining.value = names.slice(created).join("\n");
            setMessage(
              `${created}개 등록 후 중단: ${(error as Error).message}. 등록하지 못한 항목만 입력란에 남겼습니다. 다시 시도하세요.`,
            );
          } finally {
            try {
              await refresh();
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }
        }}
      >
        <fieldset disabled={busy} className="bulk-create-fields">
          {kind === "project" ? (
            <label>
              연결 저장소
              <select required name="repository">
                {[
                  ...new Set([
                    ...data.repositories.map((r) => r.data.name),
                    ...data.projects.flatMap((p) => p.data.repositories),
                  ]),
                ].map((repo) => (
                  <option key={repo}>{repo}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              프로젝트
              <select
                required
                aria-label="프로젝트"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                {data.projects.map((p) => (
                  <option key={p.data.id} value={p.data.id}>
                    {p.data.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            이름 (한 줄에 하나씩)
            <textarea
              required
              name="names"
              placeholder="첫 번째 항목\n두 번째 항목"
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "등록 중…" : "일괄 추가"}
          </button>
        </fieldset>
        {message && <p role="status">{message}</p>}
      </form>
    </details>
  );
}
