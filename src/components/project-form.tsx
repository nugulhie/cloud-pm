"use client";
import { createId } from "../core/browser-id";
import { useDraftRestore } from "./draft-boundary";
import { useState, type FormEvent } from "react";
import type { Project } from "../core/model";
import ProjectPrefixField from "./project-prefix-field";
export default function ProjectForm({
  repositories,
  busy,
  onSubmit,
  onCancel,
  prefixes = [],
}: {
  repositories: string[];
  busy: boolean;
  onSubmit: (project: Project) => Promise<void>;
  onCancel: () => void;
  prefixes?: string[];
}) {
  const [name, setName] = useState(""),
    [identifier, setIdentifier] = useState(
      () => `project-${createId().slice(0, 8)}`,
    ),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const choices = [...new Set(repositories.map((r) => r.toLowerCase()))].sort();
  useDraftRestore("project-form", (values) => {
    setName(values.name?.[0] ?? "");
    if (values.id?.[0]) setIdentifier(values.id[0]);
    setSelected(
      (values.draftRepositories ?? []).filter((r) => choices.includes(r)),
    );
  });
  const visible = choices.filter((r) => r.includes(query.toLowerCase()));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!selected.length) {
      setError("프로젝트에 연결할 저장소를 하나 이상 선택하세요.");
      return;
    }
    await onSubmit({
      id: identifier.trim(),
      name: name.trim(),
      featurePrefix: String(
        new FormData(event.currentTarget).get("featurePrefix"),
      ),
      goal: String(new FormData(event.currentTarget).get("goal") ?? "").trim(),
      repositories: selected,
      startDate:
        String(new FormData(event.currentTarget).get("startDate") ?? "") ||
        null,
      endDate:
        String(new FormData(event.currentTarget).get("endDate") ?? "") || null,
    });
  }
  return (
    <form onSubmit={submit} className="project-form">
      <p className="form-intro">
        프로젝트 이름과 연결할 저장소를 선택하세요. 목표와 일정은 나중에 수정할
        수 있습니다.
      </p>
      <label>
        프로젝트 이름
        <input
          name="name"
          required
          maxLength={200}
          autoFocus
          placeholder="예: 고객 플랫폼 개편"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        프로젝트 목표
        <textarea
          name="goal"
          maxLength={4000}
          placeholder="이 프로젝트에서 달성할 목표를 적어주세요."
        />
      </label>
      <ProjectPrefixField
        projectName={name}
        seed={identifier}
        used={prefixes}
      />
      <div className="form-grid">
        <label>
          시작일
          <input type="date" name="startDate" />
        </label>
        <label>
          종료일
          <input type="date" name="endDate" />
        </label>
      </div>
      <fieldset className="repository-picker">
        <legend>
          연결할 저장소 <span>{selected.length}개 선택</span>
        </legend>
        <input
          aria-label="저장소 검색"
          placeholder="저장소 이름으로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="picker-actions">
          <button
            type="button"
            onClick={() => setSelected([...new Set([...selected, ...visible])])}
          >
            검색 결과 전체 선택
          </button>
          <button type="button" onClick={() => setSelected([])}>
            선택 해제
          </button>
        </div>
        <div className="repository-options">
          {visible.map((r) => (
            <label key={r}>
              <input
                name="draftRepositories"
                value={r}
                type="checkbox"
                checked={selected.includes(r)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSelected((current) =>
                    checked ? [...current, r] : current.filter((v) => v !== r),
                  );
                }}
              />
              <span>{r}</span>
            </label>
          ))}
          {!visible.length && (
            <div className="empty small">
              {choices.length
                ? "검색 결과가 없습니다."
                : "GitHub를 동기화하면 접근 가능한 저장소가 표시됩니다."}
            </div>
          )}
        </div>
      </fieldset>
      <details>
        <summary>프로젝트 식별자 설정</summary>
        <label>
          식별자
          <input
            name="id"
            required
            maxLength={100}
            pattern="([A-Za-z0-9_]|-)+"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </label>
        <small>태스크와 YAML에서 이 식별자를 참조합니다.</small>
      </details>
      {error && (
        <div role="alert" className="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          data-draft-close
          onClick={onCancel}
        >
          취소
        </button>
        <button className="button" disabled={busy || !name.trim()}>
          {busy ? "생성 중…" : "프로젝트 생성"}
        </button>
      </div>
    </form>
  );
}
