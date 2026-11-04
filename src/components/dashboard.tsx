"use client";
import TaskGitHubConnections from "./task-github-connections";
import ProjectOverview from "./project-overview";
import TaskDetail from "./task-detail";
import NavigationIcon from "./navigation-icon";
import { taskGitHubConnections } from "../core/task-github";
import GitHubPeople from "./github-people";
import { createId } from "../core/browser-id";
import {
  activityFreshness,
  newestActivities,
} from "../core/activity-freshness";
import RequirementsPanel from "./requirements-panel";
import KnowledgePanel from "./knowledge-panel";
import TaskDependencies from "./task-dependencies";
import TaskDiscussion from "./task-discussion";
import NotificationInbox from "./notification-inbox";
import WorkspaceSwitcher from "./workspace-switcher";
import TaskBoard from "./task-board";
import TaskSubtasks from "./task-subtasks";
import { taskHierarchyIndex, taskDescendants } from "../core/task-hierarchy";
import ActivityDestinations, {
  activityDestinations,
} from "./activity-destinations";
import type { ChangeEvent } from "../core/history";
import ManagementPanel from "./management-panel";
import ProjectCalendar from "./project-calendar";
import ImportToolbar from "./import-toolbar";
import HistoryTimeline from "./history-timeline";
import AccountPanel from "./account-panel";
import MarkdownBody from "./markdown-body";
import ProjectForm from "./project-form";
import GitHubAssigneeSelect from "./github-assignee-select";
import FileDiff from "./file-diff";
import AsanaFileImport from "./asana-file-import";
import DeleteConfirmation from "./delete-confirmation";
import { deletionImpact } from "./deletion-impact";
import { useEffect, useState, useRef, useMemo, type FormEvent } from "react";
import type { SyncJob } from "../jobs/queue";
import type { Service } from "../core/service";
import type { Task, Project, Feature, Stored, GitHubItem } from "../core/model";
type Data = Awaited<ReturnType<Service["dashboard"]>>;
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const labels: Record<string, string> = {
  backlog: "대기",
  ready: "준비 완료",
  in_progress: "진행 중",
  in_review: "리뷰 중",
  done: "완료",
  canceled: "취소",
  open: "열림",
  closed: "닫힘",
  merged: "머지 완료",
};
const tabs = [
  "프로젝트 현황",
  "태스크 보드",
  "GitHub 활동",
  "변경 이력",
  "작업 큐",
  "항목 관리",
  "캘린더",
  "PRD 관리",
  "정책 저장소",
  "용어집",
];
export default function Dashboard() {
  const [managementKind, setManagementKind] = useState<
    "project" | "feature" | "task"
  >("project");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<{
    kind: "project" | "task";
    id: string;
    revision: number;
    name: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [activityLimit, setActivityLimit] = useState(40);
  const [overviewLimit, setOverviewLimit] = useState(6);
  const [attentionLimit, setAttentionLimit] = useState(5);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [taskViewing, setTaskViewing] = useState(false);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [hideClosed, setHideClosed] = useState(true);
  const [activityKind, setActivityKind] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [boardDragging, setBoardDragging] = useState(false);
  const migratedWorkspaces = useRef(new Set<string>());
  const workspaceRef = useRef<string | null>(null);
  const accountGeneration = useRef(0);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState(tabs[0]),
    [token, setToken] = useState(""),
    [ready, setReady] = useState(false);
  const [project, setProject] = useState(""),
    [author, setAuthor] = useState(""),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [repo, setRepo] = useState("");
  const [requestedRequirement, setRequestedRequirement] = useState<{
    workspace: string;
    id: string;
  } | null>(null);
  const [analysis, setAnalysis] = useState<Awaited<
    ReturnType<Service["analyzeProject"]>
  > | null>(null);
  const [analysisProject, setAnalysisProject] = useState("");
  const [modal, setModal] = useState<"project" | "feature" | "task" | null>(
      null,
    ),
    [editing, setEditing] = useState<Stored<Task> | null>(null),
    [selected, setSelected] = useState<GitHubItem | null>(null),
    [history, setHistory] = useState<ChangeEvent[]>([]);
  const [formProject, setFormProject] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [formFeature, setFormFeature] = useState("");
  const selectedFormFeature =
    formFeature ||
    data?.features.find((f) => f.data.project === formProject)?.data.id ||
    "";
  const [newTaskId, setNewTaskId] = useState("");
  const [taskDirty, setTaskDirty] = useState(false);
  const [taskNavigationNotice, setTaskNavigationNotice] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(min-width: 721px)");
    const closeWide = () => {
      if (media.matches) setNavigationOpen(false);
    };
    media.addEventListener("change", closeWide);
    return () => media.removeEventListener("change", closeWide);
  }, []);
  useEffect(() => {
    if (!navigationOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = document.getElementById("workspace-navigation");
    sidebar?.querySelector<HTMLElement>(".nav.active")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest("dialog[open]"))
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setNavigationOpen(false);
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          sidebar?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href]",
          ) ?? [],
        ).filter(
          (element) =>
            element.getClientRects().length &&
            getComputedStyle(element).visibility !== "hidden",
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    sidebar?.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = overflow;
      sidebar?.removeEventListener("keydown", handleKey);
      previous?.focus({ preventScroll: true });
    };
  }, [navigationOpen]);
  useEffect(() => {
    setTaskDirty(false);
    setTaskNavigationNotice("");
  }, [modal, editing?.data.id, newTaskId]);
  const hierarchyIndex = useMemo(
    () => taskHierarchyIndex(data?.tasks ?? []),
    [data?.tasks],
  );
  const excludedParents = useMemo(
    () =>
      editing
        ? taskDescendants(hierarchyIndex, editing.data.id)
        : new Set<string>(),
    [hierarchyIndex, editing?.data.id],
  );
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [bodyMode, setBodyMode] = useState<"preview" | "source">("preview");
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  async function api(path: string, body?: unknown, signal?: AbortSignal) {
    const generation = accountGeneration.current;
    const response = await fetch(`/api/${path}`, {
      cache: "no-store",
      signal,
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${sessionStorage.getItem("pm-token") ?? ""}`,
        "Content-Type": "application/json",
        ...(workspaceRef.current
          ? { "X-Workspace-Id": workspaceRef.current }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (
        path === "dashboard" &&
        [401, 403].includes(response.status) &&
        generation === accountGeneration.current
      )
        setData(null);
      throw new ApiError(result.error ?? "요청 실패", response.status);
    }
    if (generation !== accountGeneration.current)
      throw new Error(
        "워크스페이스가 변경되어 이전 요청의 결과를 취소했습니다.",
      );
    return result;
  }
  async function load() {
    const generation = accountGeneration.current;
    setBusy(true);
    try {
      let next = await api("dashboard");
      const workspace = next.viewer.workspaceId ?? "main";
      if (
        next.viewer.role === "write" &&
        !migratedWorkspaces.current.has(workspace)
      ) {
        migratedWorkspaces.current.add(workspace);
        try {
          const migration = await api("work-items/migrate", {});
          if (migration.created) next = await api("dashboard");
        } catch (error) {
          migratedWorkspaces.current.delete(workspace);
          throw error;
        }
      }
      if (generation !== accountGeneration.current) return;
      workspaceRef.current = next.viewer.workspaceId ?? "main";
      setData(next);
      setProject((current) =>
        current &&
        !next.projects.some((row: Stored<Project>) => row.data.id === current)
          ? ""
          : current,
      );
      if (tab === tabs[4]) {
        const nextJobs = await api("jobs");
        if (generation === accountGeneration.current) setJobs(nextJobs);
      }
      setError("");
    } catch (e) {
      if (generation === accountGeneration.current)
        setError((e as Error).message);
    } finally {
      if (generation === accountGeneration.current) setBusy(false);
    }
  }
  useEffect(() => {
    setActivityLimit(40);
  }, [project, author, status, search, repo, activityKind, hideClosed]);
  useEffect(() => {
    setOverviewLimit(6);
    setAttentionLimit(5);
  }, [project, author, status, search]);
  function resetFilters() {
    setAuthor("");
    setStatus("");
    setSearch("");
    setRepo("");
    setActivityKind("");
    setHideClosed(true);
    setCheckedItems([]);
  }
  useEffect(() => {
    if (!modal && !selected && !profileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".overlay > .modal");
    const visibleControls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    const timer = requestAnimationFrame(() => {
      const title = dialog?.querySelector<HTMLInputElement>(
        'input[name="title"]:not(:disabled), input[name="name"]:not(:disabled)',
      );
      (title ?? visibleControls()[0])?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        dialog?.getAttribute("aria-busy") !== "true"
      ) {
        event.preventDefault();
        setModal(null);
        setSelected(null);
        setProfileOpen(false);
        setEditing(null);
      }
      if (event.key === "Tab") {
        const controls = visibleControls(),
          first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog?.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(timer);
      dialog?.removeEventListener("keydown", handleKey);
      previous?.focus({ preventScroll: true });
    };
  }, [
    modal,
    selected?.id,
    profileOpen,
    editing?.data.id,
    newTaskId,
    taskViewing,
  ]);
  useEffect(() => {
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (invite) {
      setInviteToken(invite);
      setProfileOpen(true);
      window.history.replaceState(
        null,
        "",
        location.pathname + location.search,
      );
    }
    setToken(sessionStorage.getItem("pm-token") ?? "");
    setReady(true);
    void load();
  }, []);
  useEffect(() => {
    if (!ready || modal || selected || profileOpen || boardDragging || deleting)
      return;
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const generation = accountGeneration.current;
        const next = await api("dashboard");
        if (active && generation === accountGeneration.current) setData(next);
        if (tab === tabs[4]) {
          const nextJobs = await api("jobs");
          if (active) setJobs(nextJobs);
        }
      } catch {
        /* 인증 오류는 수동 새로고침에서 표시한다. */
      }
    };
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, modal, selected, tab, profileOpen, boardDragging, deleting]);
  async function act(fn: () => Promise<unknown>) {
    const generation = accountGeneration.current;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (generation === accountGeneration.current) await load();
    } catch (e) {
      if (generation === accountGeneration.current)
        setError((e as Error).message);
    } finally {
      if (generation === accountGeneration.current) setBusy(false);
    }
  }
  const canWrite = data?.viewer.role === "write";
  const projects = data?.projects ?? [],
    features = (data?.features ?? []).filter(
      (f) => !project || f.data.project === project,
    );
  const selectedProject = projects.find((row) => row.data.id === project);
  function requestProjectDeletion(row: Stored<Project>) {
    if (!canWrite || busy || deleting) return;
    setDeleteError("");
    setDeleting({
      kind: "project",
      id: row.data.id,
      revision: row.revision,
      name: row.data.name,
    });
  }
  const tasks = (data?.tasks ?? []).filter(
    (t) =>
      (!project || t.data.project === project) &&
      (!author || t.data.assignee === author) &&
      (!status || t.data.status === status) &&
      (!search ||
        `${t.data.title} ${t.data.id}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const taskIds = new Set(tasks.map((task) => task.data.id));
  const attention = (data?.attention ?? []).filter((a) => taskIds.has(a.task));
  const destinations: ReturnType<typeof activityDestinations> = data
    ? activityDestinations(data)
    : new Map();
  const done = tasks.filter((t) => t.data.status === "done").length;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const val = (key: string) => String(f.get(key) ?? "");
    await act(async () => {
      if (modal === "project")
        await api("projects", {
          data: {
            id: val("id"),
            name: val("name"),
            goal: val("goal"),
            repositories: val("repositories")
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean),
          },
        });
      if (modal === "feature")
        await api("features", {
          data: {
            id: val("id"),
            project: val("project"),
            name: val("name"),
            goal: val("goal"),
          },
        });
      if (modal === "task")
        await api("tasks", {
          revision: editing?.revision,
          data: {
            id: val("id"),
            project: val("project"),
            feature: editing?.data.feature,
            title: val("title"),
            type: val("type"),
            parentId: val("parentId") || null,
            dependsOn: f.getAll("dependsOn").map(String),
            description: val("description"),
            assignee: val("assignee"),
            status: val("status"),
            priority: val("priority"),
            dueDate: val("dueDate") || null,
            blockedReason: val("blockedReason"),
            yaml: val("yaml"),
          },
        });
      setNotice(editing ? "작업을 수정했습니다." : "새 작업을 추가했습니다.");
      setModal(null);
      setEditing(null);
    });
  }
  function openActivity(item: GitHubItem) {
    setBodyMode("preview");
    setSelected(item);
    setDetailError("");
    setDetailLoading(true);
    setDetailRefreshVersion((version) => version + 1);
  }
  useEffect(() => {
    const id = selected?.id;
    if (!id) return;
    let active = true;
    let pending = false;
    const generation = accountGeneration.current;
    const controller = new AbortController();
    const refresh = async (initial = false) => {
      if (pending || (!initial && document.hidden)) return;
      pending = true;
      if (initial) setDetailLoading(true);
      try {
        const detail = (await api(
          `github/item?id=${encodeURIComponent(id)}`,
          undefined,
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        )) as GitHubItem;
        if (!active || generation !== accountGeneration.current) return;
        if (detail.id !== id)
          throw new Error("GitHub 항목 응답이 일치하지 않습니다.");
        setSelected((previous) => (previous?.id === id ? detail : previous));
        setData((previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.map((row) =>
                  row.data.id === id
                    ? { ...row, data: { ...detail, files: undefined } }
                    : row,
                ),
              }
            : previous,
        );
        setDetailError("");
      } catch (error) {
        if (!active || generation !== accountGeneration.current) return;
        if (
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          setSelected(null);
          setError(error.message);
          void load();
        } else
          setDetailError(
            error instanceof Error
              ? error.message
              : "최신 내용을 불러오지 못했습니다.",
          );
      } finally {
        pending = false;
        if (active) setDetailLoading(false);
      }
    };
    void refresh(true);
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [selected?.id, detailRefreshVersion]);
  function openTask(t: Stored<Task>, edit = false) {
    if (modal === "task" && taskDirty) {
      setTaskNavigationNotice(
        "작성 중인 변경사항이 있습니다. 먼저 저장한 뒤 다른 태스크를 열거나 추가해 주세요.",
      );
      return;
    }
    setTaskViewing(!edit);
    setFormProject(t.data.project);
    setFormFeature(t.data.feature);
    setNewParentId("");
    setEditing(t);
    setModal("task");
  }
  function addSubtask(parent: Stored<Task>) {
    if (modal === "task" && taskDirty) {
      setTaskNavigationNotice(
        "작성 중인 변경사항이 있습니다. 먼저 저장한 뒤 다른 태스크를 열거나 추가해 주세요.",
      );
      return;
    }
    setError("");
    setTaskViewing(false);
    setNewParentId(parent.data.id);
    setFormProject(parent.data.project);
    setFormFeature(parent.data.feature);
    setEditing(null);
    setNewTaskId(`task-${createId()}`);
    setModal("task");
  }
  async function moveTask(task: Stored<Task>, status: Task["status"]) {
    if (task.data.status === status) return;
    setNotice("");
    await act(async () => {
      const saved = await api("tasks", {
        data: { ...task.data, status },
        revision: task.revision,
      });
      setEditing((current) =>
        current?.data.id === task.data.id ? saved : current,
      );
      setNotice(`${task.data.title}: ${labels[status]} 상태로 변경했습니다.`);
    });
  }
  const freshness = activityFreshness(data?.items ?? []);
  const visibleItems = newestActivities(
    (data?.items ?? []).filter(
      ({ data: i }) =>
        (!activityKind || i.kind === activityKind) &&
        (!repo || i.repository.toLowerCase() === repo.toLowerCase()) &&
        (!author ||
          [
            i.author,
            ...i.assignees,
            ...i.reviewers,
            ...(i.commitAuthors ?? []),
          ].includes(author)) &&
        (!status || i.state === status) &&
        (!hideClosed || !["closed", "merged"].includes(i.state)) &&
        (!search ||
          `${i.title} ${i.id} ${(i.labels ?? []).map((label) => label.name).join(" ")} ${i.reviewers.join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!project ||
          projects
            .find((p) => p.data.id === project)
            ?.data.repositories.some(
              (repository) =>
                repository.toLowerCase() === i.repository.toLowerCase(),
            )),
    ),
  );
  const latest = data?.syncs.at(-1);
  const taskConnections = useMemo(
    () => taskGitHubConnections(data?.links ?? [], data?.items ?? []),
    [data?.links, data?.items],
  );
  const taskAdvancedFields =
    modal === "task" ? (
      <>
        {editing && (
          <TaskGitHubConnections
            items={taskConnections.get(editing.data.id) ?? []}
          />
        )}
        <fieldset className="task-fields" disabled={!canWrite || busy}>
          <details className="task-advanced">
            <summary>추가 설정 · 의존관계, 완료 조건</summary>
            {editing && (
              <p className="muted">
                작업 식별자: <code>{editing.data.id}</code>
              </p>
            )}
            <TaskDependencies
              key={`${editing?.data.id ?? newTaskId}-${formProject}`}
              task={{
                id: editing?.data.id ?? newTaskId,
                project: formProject,
                status: editing?.data.status ?? "backlog",
              }}
              tasks={data?.tasks ?? []}
              initial={
                editing?.data.project === formProject
                  ? (editing.data.dependsOn ?? [])
                  : []
              }
              writable={data?.viewer.role === "write"}
            />
            <label>
              차단 사유
              <textarea
                name="blockedReason"
                defaultValue={editing?.data.blockedReason}
              />
            </label>
            <label>
              완료 조건 YAML 초안
              <textarea
                className="yaml"
                name="yaml"
                rows={8}
                defaultValue={editing?.data.yaml}
                placeholder="version: 1"
              />
            </label>
            <small>
              저장한 초안은 자동 활성화되지 않습니다. 저장소 기본 브랜치의
              YAML로 자동 완료를 평가합니다. 상태에서 직접 완료·재개방할 수도
              있습니다. PR 조건이 계속 충족되면 다음 동기화에서 다시 완료될 수
              있습니다.
            </small>
          </details>
          {editing && (
            <details className="links task-advanced">
              <summary>GitHub 연결 관리 · PR과 이슈</summary>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  void act(() =>
                    api("links/suggest", { task: editing.data.id }),
                  )
                }
              >
                키워드로 연결 후보 찾기
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api("links/ai-suggest", {
                      task: editing.data.id,
                    }),
                  )
                }
              >
                ✧ AI 연결 제안
              </button>
              <small>
                AI 제안에는 제공자 설정이 필요합니다. 승인한 연결만 확정됩니다.
              </small>
              <select
                aria-label="직접 연결할 GitHub 항목"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value)
                    void act(() =>
                      api("links/manual", {
                        task: editing.data.id,
                        item: e.target.value,
                      }),
                    );
                }}
              >
                <option value="">GitHub 항목 직접 연결…</option>
                {data?.items
                  .filter((i) =>
                    projects
                      .find((p) => p.data.id === editing.data.project)
                      ?.data.repositories.includes(i.data.repository),
                  )
                  .map((i) => (
                    <option key={i.data.id} value={i.data.id}>
                      {i.data.title} ({i.data.id})
                    </option>
                  ))}
              </select>
              {data?.links
                .filter((l) => l.data.task === editing.data.id)
                .map((l) => (
                  <div className="link-row" key={l.data.id}>
                    <strong>{l.data.item}</strong>
                    <small>
                      {l.data.reason} ·{" "}
                      {
                        {
                          approved: "연결됨",
                          suggested: "연결 후보",
                          rejected: "연결 해제",
                        }[l.data.status]
                      }
                    </small>
                    {l.data.status !== "rejected" && (
                      <div>
                        {(["approved", "rejected"] as const).map((s) => (
                          <button
                            type="button"
                            key={s}
                            className="text-button"
                            onClick={() =>
                              void act(() =>
                                api("links/decide", {
                                  id: l.data.id,
                                  status: s,
                                  revision: l.revision,
                                }),
                              )
                            }
                          >
                            {s === "approved"
                              ? "승인"
                              : l.data.status === "approved"
                                ? "연결 해제"
                                : "거절"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </details>
          )}
        </fieldset>
      </>
    ) : null;
  const syncMessages = [
    ...(latest?.data.errors ?? []),
    ...(latest?.data.warnings ?? []),
  ];
  return (
    <div className="shell">
      <aside
        id="workspace-navigation"
        className={`sidebar${navigationOpen ? " sidebar-open" : ""}`}
      >
        <button
          className="navigation-close icon-button"
          aria-label="메뉴 닫기"
          onClick={() => setNavigationOpen(false)}
        >
          ×
        </button>
        <a className="brand" href="/">
          <span className="brand-icon">C</span>
          <span>
            cloud<span className="brand-light">pm</span>
            <small>TEAM WORKSPACE</small>
          </span>
        </a>
        <WorkspaceSwitcher
          enabled={!!data?.viewer.userId && !busy}
          currentId={data?.viewer.workspaceId ?? "main"}
          onChanged={async (id) => {
            accountGeneration.current++;
            workspaceRef.current = id;
            setData(null);
            setProject("");
            setAuthor("");
            setStatus("");
            setSearch("");
            setRepo("");
            setCheckedItems([]);
            setHistory([]);
            setJobs([]);
            setAnalysis(null);
            setEditing(null);
            setDeleting(null);
            setDeleteError("");
            setSelected(null);
            setModal(null);
            setTab(tabs[0]);
            await load();
            setNavigationOpen(false);
          }}
        />
        <nav aria-label="워크스페이스 메뉴">
          {[
            { title: "업무", indices: [0, 1, 6] },
            { title: "문서", indices: [7, 8, 9] },
            { title: "활동", indices: [2, 3] },
            { title: "관리", indices: [5, 4] },
          ].map((group) => (
            <div className="navigation-group" key={group.title}>
              <div className="nav-label">{group.title}</div>
              {group.indices.map((i) => (
                <button
                  key={tabs[i]}
                  aria-label={tabs[i]}
                  aria-current={tab === tabs[i] ? "page" : undefined}
                  className={tab === tabs[i] ? "nav active" : "nav"}
                  onClick={() => {
                    setTab(tabs[i]!);
                    setNavigationOpen(false);
                    resetFilters();
                    setNotice("");
                    if (i === 4)
                      void act(async () => setJobs(await api("jobs")));
                    if (i === 3)
                      void act(async () => setHistory(await api("history")));
                  }}
                >
                  <NavigationIcon index={i} />
                  <span className="nav-text">{tabs[i]}</span>
                  {i === 1 && <em>{data?.tasks.length ?? 0}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>↗</span>
          <strong>같은 맥락, 어디서나</strong>
          <p>
            MCP로 Claude와 연결해
            <br />
            프로젝트를 대화로 관리하세요.
          </p>
          <code>/api/mcp</code>
        </div>
        <button
          className="sidebar-bottom profile-trigger"
          aria-label="개인 프로필 및 토큰 설정"
          onClick={() => {
            setNavigationOpen(false);
            setProfileOpen(true);
          }}
        >
          <span className="avatar">PM</span>
          <span>
            {data?.viewer.login ?? "로그인이 필요합니다"}
            <small>
              {data?.viewer.userId ? "개인 프로필" : "워크스페이스 연결"}
            </small>
          </span>
        </button>
      </aside>
      {navigationOpen && (
        <button
          className="navigation-backdrop"
          tabIndex={-1}
          aria-label="메뉴 배경 닫기"
          onClick={() => setNavigationOpen(false)}
        />
      )}
      <main inert={navigationOpen || undefined}>
        <header>
          <button
            className="navigation-trigger icon-button"
            aria-label="메뉴 열기"
            aria-expanded={navigationOpen}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationOpen(true)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            워크스페이스 <span>/</span> {tab}
          </div>
          <div className="header-actions">
            {data && (data.viewer.userId || data.mode === "demo") && (
              <NotificationInbox
                key={`${data.viewer.workspaceId}-${data.viewer.userId ?? "demo"}`}
                api={api}
                onOpen={(id) => {
                  const task = data.tasks.find((t) => t.data.id === id);
                  if (task) openTask(task);
                }}
              />
            )}
            <span className="live-dot" />
            프로젝트 관제실
            <button
              className="icon-button"
              onClick={() => void load()}
              aria-label="새로고침"
            >
              ↻
            </button>
          </div>
        </header>
        <section className={`content${tab === tabs[1] ? " task-page" : ""}`}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">PROJECT INTELLIGENCE</div>
              <h1>{tab}</h1>
              <p>
                {tab === tabs[2]
                  ? "PR·이슈를 확인하고 필요한 항목을 프로젝트 작업으로 연결하세요."
                  : tab === tabs[7]
                    ? "요구사항을 작성하거나 CSV로 가져온 뒤 개발 작업으로 전환하세요."
                    : tab === tabs[1]
                      ? "담당자와 기한을 확인하고, 하위 작업을 펼쳐 진행 상황을 살펴보세요."
                      : "진행 상황을 이해하고, 다음 행동을 결정하세요."}
              </p>
            </div>
            <div className="actions">
              {tab === tabs[0] && (
                <button
                  className="button secondary"
                  disabled={!canWrite}
                  onClick={() => setModal("project")}
                >
                  ＋ 프로젝트 만들기
                </button>
              )}
              {tab === tabs[0] && (
                <details className="overview-tools">
                  <summary>더 보기</summary>
                  <div className="overview-tools-panel">
                    {" "}
                    {tab === tabs[0] && (
                      <AsanaFileImport
                        canWrite={canWrite}
                        api={api}
                        onRefresh={load}
                        onImported={(id) => setProject(id)}
                      />
                    )}
                    {tab === tabs[0] && canWrite && selectedProject && (
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() => requestProjectDeletion(selectedProject)}
                      >
                        프로젝트 삭제
                      </button>
                    )}
                    {[tabs[0], tabs[2]].includes(tab) && (
                      <button
                        className="button secondary"
                        disabled={
                          busy ||
                          !canWrite ||
                          data?.syncInProgress ||
                          (!!project &&
                            !projects.find((row) => row.data.id === project)
                              ?.data.repositories.length)
                        }
                        title={
                          project &&
                          !projects.find((row) => row.data.id === project)?.data
                            .repositories.length
                            ? "프로젝트에 GitHub 저장소를 연결한 뒤 동기화하세요."
                            : undefined
                        }
                        onClick={() =>
                          void act(async () => {
                            const result = await api(
                              "sync",
                              project ? { project } : {},
                            );
                            if (result.errors?.length)
                              setError(result.errors.join("\n"));
                          })
                        }
                      >
                        ↻ GitHub 수동 동기화
                      </button>
                    )}
                  </div>
                </details>
              )}
              {tab === tabs[2] && (
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    !canWrite ||
                    data?.syncInProgress ||
                    (!!project &&
                      !projects.find((row) => row.data.id === project)?.data
                        .repositories.length)
                  }
                  title={
                    project &&
                    !projects.find((row) => row.data.id === project)?.data
                      .repositories.length
                      ? "프로젝트에 GitHub 저장소를 연결한 뒤 동기화하세요."
                      : undefined
                  }
                  onClick={() =>
                    void act(async () => {
                      const result = await api(
                        "sync",
                        project ? { project } : {},
                      );
                      if (result.errors?.length)
                        setError(result.errors.join("\n"));
                    })
                  }
                >
                  ↻ GitHub 수동 동기화
                </button>
              )}
              {[tabs[0], tabs[1]].includes(tab) && (
                <button
                  className="button"
                  disabled={!canWrite || !projects.length || busy}
                  title={
                    !projects.length
                      ? "프로젝트를 먼저 만들어 주세요."
                      : undefined
                  }
                  onClick={() => {
                    setEditing(null);
                    setFormFeature("");
                    setNewParentId("");
                    setFormProject(project || projects[0]?.data.id || "");
                    setNewTaskId(`task-${createId()}`);
                    setModal("task");
                  }}
                >
                  ＋ 태스크 추가
                </button>
              )}
            </div>
          </div>
          {data?.mode === "demo" && (
            <div className="demo-banner">
              데모 워크스페이스 · 아래 작업자·PR·완료 상태는 예시 데이터입니다.
            </div>
          )}
          {ready && !data?.viewer.userId && (
            <details className="connection">
              <summary>워크스페이스 연결 설정</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sessionStorage.setItem("pm-token", token);
                  void load();
                }}
              >
                <label>
                  접근 토큰
                  <input
                    aria-label="접근 토큰"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button className="button">연결</button>
                <span>토큰은 현재 브라우저 세션에만 보관됩니다.</span>
              </form>
            </details>
          )}
          {notice && (
            <div className="success-note action-notice" role="status">
              {notice}
              <button
                className="text-button"
                aria-label="알림 닫기"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {error && !modal && (
            <div role="alert" className="alert">
              {error}
              <button aria-label="오류 닫기" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {data?.syncInProgress && (
            <div className="demo-banner" role="status">
              GitHub 동기화 중입니다. 현재 {data.items.length}개의 PR·이슈를
              저장했습니다. 화면은 자동 갱신됩니다.
            </div>
          )}
          {syncMessages.length ? (
            <details className="alert">
              <summary>
                최근 동기화에서 {syncMessages.length}개 항목을 확인하지
                못했습니다.
              </summary>
              <ul>
                {syncMessages.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {!data ? (
            <div className="empty">
              {busy
                ? "워크스페이스를 불러오는 중입니다…"
                : "사용자 계정으로 로그인해 워크스페이스를 확인하세요."}
            </div>
          ) : (
            <>
              {![tabs[1], tabs[3], tabs[4], "정책 저장소", "용어집"].includes(
                tab,
              ) && (
                <div className="filters">
                  <select
                    aria-label="프로젝트 필터"
                    value={project}
                    onChange={(e) => {
                      setProject(e.target.value);
                      setRepo("");
                      setCheckedItems([]);
                    }}
                  >
                    <option value="">모든 프로젝트</option>
                    {projects.map((p) => (
                      <option key={p.data.id} value={p.data.id}>
                        {p.data.name}
                      </option>
                    ))}
                  </select>
                  {[tabs[0], tabs[1], tabs[2]].includes(tab) && (
                    <>
                      <span className="filter-divider" />
                      <select
                        aria-label="작업자 필터"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                      >
                        <option value="">모든 담당자</option>
                        {[
                          ...new Set(
                            [
                              ...data.tasks.map((t) => t.data.assignee),
                              ...data.items.flatMap((i) => [
                                i.data.author,
                                ...i.data.assignees,
                                ...i.data.reviewers,
                                ...(i.data.commitAuthors ?? []),
                              ]),
                            ].filter(Boolean),
                          ),
                        ].map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                      <select
                        aria-label="상태 필터"
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          if (
                            tab === tabs[2] &&
                            ["closed", "merged"].includes(e.target.value)
                          )
                            setHideClosed(false);
                        }}
                      >
                        <option value="">모든 상태</option>
                        {Object.entries(labels)
                          .filter(([key]) =>
                            tab === tabs[2]
                              ? ["open", "closed", "merged"].includes(key)
                              : !["open", "closed", "merged"].includes(key),
                          )
                          .map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                      </select>
                      <input
                        className="search"
                        placeholder={
                          tab === tabs[2]
                            ? "제목·번호·라벨 검색…"
                            : "작업 검색…"
                        }
                        aria-label={
                          tab === tabs[2] ? "GitHub 활동 검색" : "태스크 검색"
                        }
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </>
                  )}
                  {(author ||
                    status ||
                    search ||
                    repo ||
                    activityKind ||
                    !hideClosed) && (
                    <button
                      className="text-button filter-reset"
                      onClick={resetFilters}
                    >
                      검색·필터 초기화
                    </button>
                  )}
                </div>
              )}
              {tab === "PRD 관리" && (
                <RequirementsPanel
                  key={data.viewer.workspaceId}
                  rows={data.requirements}
                  publications={data.requirementIssues}
                  projects={data.projects}
                  features={data.features}
                  tasks={data.tasks}
                  project={project}
                  canWrite={canWrite}
                  api={api}
                  onRefresh={load}
                  onOpenTask={openTask}
                  knowledge={data.knowledge}
                  requestedId={
                    requestedRequirement?.workspace === data.viewer.workspaceId
                      ? requestedRequirement.id
                      : undefined
                  }
                  onRequestedOpen={() => setRequestedRequirement(null)}
                  onManageProject={(id) => {
                    setProject(id);
                    setManagementKind("project");
                    setTab(tabs[5]);
                  }}
                />
              )}
              {["정책 저장소", "용어집"].includes(tab ?? "") && (
                <KnowledgePanel
                  key={`${data.viewer.workspaceId}-${tab}`}
                  kind={tab === "정책 저장소" ? "policy" : "glossary"}
                  rows={data.knowledge}
                  canWrite={canWrite}
                  api={api}
                  onRefresh={load}
                  onOpenRelated={(kind, id) => {
                    if (kind === "tasks") {
                      const task = data.tasks.find((r) => r.data.id === id);
                      if (task) openTask(task);
                    } else {
                      setProject("");
                      resetFilters();
                      setRequestedRequirement({
                        workspace: data.viewer.workspaceId,
                        id,
                      });
                      setTab("PRD 관리");
                    }
                  }}
                />
              )}
              {tab === tabs[0] && (
                <>
                  <ProjectOverview
                    projects={projects}
                    tasks={tasks}
                    relatedTasks={data.tasks}
                    selected={project}
                    scoped={!!(author || status || search)}
                    writable={!!canWrite}
                    busy={busy}
                    onSelect={(id) => {
                      setProject(id);
                      resetFilters();
                    }}
                    onManage={() => {
                      setManagementKind("project");
                      setTab(tabs[5]);
                    }}
                    onDelete={requestProjectDeletion}
                  />
                  <div className="stats">
                    <Stat
                      title="전체 태스크"
                      value={tasks.length}
                      note="기능과 태스크를 하나의 작업으로 관리"
                      icon="▦"
                    />
                    <Stat
                      title="진행 중"
                      value={
                        tasks.filter((t) =>
                          ["in_progress", "in_review"].includes(t.data.status),
                        ).length
                      }
                      note="구현 및 리뷰 단계"
                      icon="↗"
                    />
                    <Stat
                      title="완료한 태스크"
                      value={done}
                      note="등록된 태스크 기준"
                      icon="✓"
                    />
                    <Stat
                      title="확인 필요"
                      value={attention.length}
                      note="담당자 · 차단 요인 · 기한"
                      icon="!"
                      warm
                    />
                  </div>
                  <div className="section-title">
                    <span className="muted">원본 상태 기반 브리핑</span>
                    <button
                      className="text-button"
                      disabled={busy || !project || !canWrite}
                      onClick={() =>
                        void act(async () => {
                          const generation = accountGeneration.current;
                          const result = await api("analysis", { project });
                          if (generation === accountGeneration.current) {
                            setAnalysisProject(project);
                            setAnalysis(result);
                          }
                        })
                      }
                    >
                      ✧ 선택 프로젝트 AI 분석
                    </button>
                  </div>
                  <div className="briefing">
                    <div className="briefing-icon">✧</div>
                    <div>
                      <div className="section-eyebrow">
                        워크스페이스 브리핑{" "}
                        <span className="tag">규칙 기반</span>
                      </div>
                      <p>
                        {project || author || status || search
                          ? `선택 범위 태스크 ${tasks.length}개 중 ${done}개 완료, 확인 필요 ${attention.length}개입니다.`
                          : data.briefing.text}
                      </p>
                      <small>
                        원본 상태를 집계한 요약입니다. 기능의 출시·배포 완료를
                        의미하지 않습니다.
                      </small>
                    </div>
                  </div>
                  {analysis && analysisProject === project && (
                    <article className="analysis-panel">
                      <h2>
                        AI 기술 브리핑 <span className="tag">검토 필요</span>
                      </h2>
                      <p>{analysis.summary}</p>
                      {(["facts", "interpretations"] as const).map((key) => (
                        <section key={key}>
                          <h3>
                            {key === "facts" ? "관측 사실" : "기술적 해석"}
                          </h3>
                          {analysis[key].map((s, i) => (
                            <p key={i}>
                              {s.text}
                              <small>근거: {s.sources.join(" · ")}</small>
                            </p>
                          ))}
                        </section>
                      ))}
                      <h3>확인이 필요한 정보</h3>
                      {analysis.unknowns.map((u, i) => (
                        <p key={i}>{u}</p>
                      ))}
                      <small>
                        {new Date(analysis.generatedAt).toLocaleString("ko-KR")}{" "}
                        ·{" "}
                        {analysis.truncated
                          ? "일부 데이터 생략"
                          : "제공 범위 분석"}
                      </small>
                    </article>
                  )}
                  <div className="section-title">
                    <h2>
                      지금 확인이 필요해요 <span>{attention.length}</span>
                    </h2>
                    <span className="muted">다음 행동이 필요한 작업</span>
                  </div>
                  <div className="attention-list">
                    {attention.length ? (
                      attention.slice(0, attentionLimit).map((a) => (
                        <button
                          key={a.task}
                          className="attention-row"
                          onClick={() =>
                            openTask(tasks.find((t) => t.data.id === a.task)!)
                          }
                        >
                          <span className="warning-dot">!</span>
                          <div>
                            <strong>{a.title}</strong>
                            <small>{a.reasons.join(" · ")}</small>
                          </div>
                          <code>{a.task}</code>
                          <span className="arrow">↗</span>
                        </button>
                      ))
                    ) : (
                      <div className="empty small">
                        확인이 필요한 작업이 없습니다.
                      </div>
                    )}
                  </div>
                  {attention.length > attentionLimit && (
                    <button
                      className="button secondary"
                      onClick={() => setAttentionLimit(attentionLimit + 5)}
                    >
                      확인 필요 태스크 보드에서 전체 보기 (
                      {Math.min(attentionLimit, attention.length)} /{" "}
                      {attention.length})
                    </button>
                  )}
                  <div className="section-title">
                    <h2>태스크 진행 현황</h2>
                    <div className="section-actions">
                      <button
                        className="text-button"
                        disabled={!canWrite}
                        onClick={() => {
                          setManagementKind("task");
                          setTab(tabs[5]);
                        }}
                      >
                        수정·삭제 관리
                      </button>
                      <button
                        className="text-button"
                        disabled={!canWrite || !projects.length}
                        onClick={() => {
                          setEditing(null);
                          setNewParentId("");
                          setFormFeature("");
                          setFormProject(project || projects[0]?.data.id || "");
                          setNewTaskId(`task-${createId()}`);
                          setModal("task");
                        }}
                      >
                        ＋ 태스크 추가
                      </button>
                    </div>
                  </div>
                  <div className="feature-grid">
                    {tasks.slice(0, overviewLimit).map((task) => (
                      <article className="feature-card" key={task.data.id}>
                        <div className="feature-top">
                          <span className="feature-icon">◇</span>
                          <span className={`badge ${task.data.status}`}>
                            {labels[task.data.status]}
                          </span>
                        </div>
                        <h3>
                          <button
                            className="text-button"
                            onClick={() => openTask(task)}
                          >
                            {task.data.title}
                          </button>
                        </h3>
                        <p>{task.data.description.slice(0, 180)}</p>
                        <small>
                          {
                            projects.find(
                              (p) => p.data.id === task.data.project,
                            )?.data.name
                          }{" "}
                          · {task.data.assignee || "미할당"}
                        </small>
                      </article>
                    ))}
                    {!tasks.length && (
                      <div className="empty">
                        프로젝트를 선택하고 태스크를 추가하세요.
                      </div>
                    )}
                  </div>
                  {tasks.length > overviewLimit && (
                    <button
                      className="button secondary"
                      onClick={() => setTab(tabs[1])}
                    >
                      태스크 보드에서 전체 보기 (
                      {Math.min(overviewLimit, tasks.length)} / {tasks.length})
                    </button>
                  )}
                </>
              )}
              {tab === tabs[1] && (
                <>
                  <TaskBoard
                    githubConnections={taskConnections}
                    key={data.viewer.workspaceId}
                    tasks={tasks}
                    relatedTasks={data.tasks}
                    projects={projects}
                    showProject={!project}
                    externalFilterCount={Number(!!author) + Number(!!status)}
                    searchActive={!!search}
                    onResetFilters={resetFilters}
                    filterBar={
                      <>
                        <select
                          aria-label="프로젝트 필터"
                          value={project}
                          onChange={(event) => {
                            setProject(event.target.value);
                            setAuthor("");
                            setStatus("");
                            setSearch("");
                          }}
                        >
                          <option value="">모든 프로젝트</option>
                          {projects.map((row) => (
                            <option key={row.data.id} value={row.data.id}>
                              {row.data.name}
                            </option>
                          ))}
                        </select>
                        <input
                          className="task-search"
                          aria-label="태스크 검색"
                          placeholder="태스크 제목 검색…"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </>
                    }
                    extraFilters={
                      <>
                        <label>
                          담당자
                          <select
                            aria-label="작업자 필터"
                            value={author}
                            onChange={(event) => setAuthor(event.target.value)}
                          >
                            <option value="">모든 담당자</option>
                            {[
                              ...new Set(
                                data.tasks
                                  .filter(
                                    (row) =>
                                      !project || row.data.project === project,
                                  )
                                  .map((row) => row.data.assignee)
                                  .filter(Boolean),
                              ),
                            ]
                              .sort()
                              .map((name) => (
                                <option key={name}>{name}</option>
                              ))}
                          </select>
                        </label>
                        <label>
                          상태
                          <select
                            aria-label="상태 필터"
                            value={status}
                            onChange={(event) => setStatus(event.target.value)}
                          >
                            <option value="">모든 상태</option>
                            {Object.entries(labels)
                              .slice(0, 6)
                              .map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                          </select>
                        </label>
                      </>
                    }
                    busy={busy}
                    writable={data.viewer.role === "write"}
                    onOpen={openTask}
                    onDragging={setBoardDragging}
                    onMove={moveTask}
                    onAddSubtask={addSubtask}
                  />
                </>
              )}
              {tab === tabs[2] && (
                <>
                  <div className="section-title">
                    <h2>
                      PR과 이슈{" "}
                      <span>
                        {project
                          ? (projects.find((p) => p.data.id === project)?.data
                              .repositories.length ?? 0)
                          : data.repositories.length}
                        개 저장소 연결 · {visibleItems.length}개 항목
                      </span>
                    </h2>
                    <span className="muted">GitHub 원본 변경 시각 최신순</span>
                    <select
                      aria-label="활동 유형"
                      value={activityKind}
                      onChange={(e) => {
                        setActivityKind(e.target.value);
                        setCheckedItems([]);
                      }}
                    >
                      <option value="">전체 PR·이슈</option>
                      <option value="pr">PR만 보기</option>
                      <option value="issue">이슈만 보기</option>
                    </select>
                    <select
                      aria-label="저장소 필터"
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                    >
                      <option value="">
                        {project ? "프로젝트의 모든 저장소" : "모든 저장소"}
                      </option>
                      {[
                        ...new Set([
                          ...data.repositories.map((r) =>
                            r.data.name.toLowerCase(),
                          ),
                          ...data.items.map((i) => i.data.repository),
                        ]),
                      ]
                        .filter(
                          (r) =>
                            !project ||
                            projects
                              .find((p) => p.data.id === project)
                              ?.data.repositories.some(
                                (repository) =>
                                  repository.toLowerCase() === r.toLowerCase(),
                              ),
                        )
                        .map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                    </select>
                  </div>
                  <details className="collection-details">
                    <summary>
                      데이터 수집 정보 ·{" "}
                      {freshness.collectedAt
                        ? new Date(freshness.collectedAt).toLocaleString(
                            "ko-KR",
                          )
                        : "수집 기록 없음"}
                    </summary>
                    {data.collection.since && (
                      <div className="demo-banner">
                        수집 범위: 열린 작업 전체 +{" "}
                        {new Date(data.collection.since).toLocaleDateString(
                          "ko-KR",
                        )}{" "}
                        부터 현재까지 변경된 PR·이슈. 시작 기준일 이전에 종료된
                        전체 이력은 포함하지 않습니다.
                      </div>
                    )}
                    <div aria-label="GitHub 데이터 최신성">
                      <div>
                        마지막 데이터 수집:{" "}
                        {freshness.collectedAt
                          ? new Date(freshness.collectedAt).toLocaleString(
                              "ko-KR",
                            )
                          : "수집 기록 없음"}
                      </div>
                      <div>
                        GitHub 원본의 최근 변경:{" "}
                        {freshness.sourceUpdatedAt
                          ? new Date(freshness.sourceUpdatedAt).toLocaleString(
                              "ko-KR",
                            )
                          : "활동 없음"}
                      </div>
                      <small>
                        화면은 15초마다 갱신됩니다. 최초 수집 이후에는 웹훅으로
                        변경된 항목을 반영합니다. 누락된 변경은 수동 동기화로
                        복구할 수 있습니다.
                      </small>
                    </div>
                  </details>
                  <label className="activity-hide-closed compact-checkbox">
                    <input
                      type="checkbox"
                      checked={hideClosed}
                      onChange={(event) => {
                        setHideClosed(event.target.checked);
                        if (
                          event.target.checked &&
                          ["closed", "merged"].includes(status)
                        )
                          setStatus("");
                      }}
                    />
                    닫힌 PR·이슈 숨기기 (머지 완료 포함)
                  </label>
                  {canWrite && (
                    <div className="bulk-toolbar">
                      <button
                        onClick={() =>
                          setCheckedItems(
                            visibleItems.slice(0, 100).map((i) => i.data.id),
                          )
                        }
                      >
                        검색 결과 전체 선택 (최대 100개)
                      </button>
                      <button onClick={() => setCheckedItems([])}>
                        선택 해제
                      </button>
                    </div>
                  )}
                  {canWrite &&
                    checkedItems.some((id) =>
                      visibleItems.some((row) => row.data.id === id),
                    ) && (
                      <ImportToolbar
                        key={project}
                        initialProject={project}
                        data={data}
                        items={checkedItems.filter((id) =>
                          visibleItems.some((i) => i.data.id === id),
                        )}
                        api={api}
                        onDone={load}
                      />
                    )}
                  {canWrite && !checkedItems.length && (
                    <p className="selection-hint">
                      체크박스로 여러 항목을 선택하거나, 항목 옆의 ‘프로젝트에
                      추가’를 누르세요.
                    </p>
                  )}
                  {!visibleItems.length && (
                    <div className="empty empty-state">
                      <strong>조건에 맞는 PR·이슈가 없습니다.</strong>
                      <p>
                        프로젝트에 연결된 저장소와 검색 조건을 확인하세요. 닫힌
                        항목은 기본으로 숨겨집니다.
                      </p>
                      <button onClick={resetFilters}>검색·필터 초기화</button>
                    </div>
                  )}
                  <div className="activity-list">
                    {visibleItems.slice(0, activityLimit).map(({ data: i }) => (
                      <div key={i.id} className="selectable-activity">
                        <input
                          aria-label={`선택: ${i.title}`}
                          type="checkbox"
                          disabled={!canWrite}
                          checked={checkedItems.includes(i.id)}
                          onChange={(e) =>
                            setCheckedItems(
                              e.target.checked
                                ? [...checkedItems, i.id]
                                : checkedItems.filter((id) => id !== i.id),
                            )
                          }
                        />
                        <button
                          className="activity-row"
                          onClick={() => {
                            void openActivity(i);
                          }}
                        >
                          <span className={`activity-icon ${i.state}`}>
                            {i.kind === "pr" ? "⑂" : "◉"}
                          </span>
                          <div>
                            <strong>{i.title}</strong>
                            <small>
                              {i.repository} #{i.number} · 작성자 {i.author} ·
                              {i.kind === "pr" ? "PR" : "이슈"}
                            </small>
                            <GitHubPeople item={i} />
                            <ActivityDestinations
                              destinations={destinations.get(i.id) ?? []}
                            />
                            <small>
                              GitHub 변경{" "}
                              <time dateTime={i.updatedAt}>
                                {new Date(i.updatedAt).toLocaleString("ko-KR")}
                              </time>
                            </small>
                          </div>
                          <span className={`badge ${i.state}`}>
                            {labels[i.state] ?? i.state}
                          </span>
                          <span>→</span>
                        </button>
                        {canWrite && (
                          <button
                            className="text-button"
                            disabled={
                              busy ||
                              (!!project &&
                                (destinations.get(i.id) ?? []).some(
                                  (destination) =>
                                    destination.projectId === project,
                                ))
                            }
                            onClick={() => {
                              if (project)
                                void act(async () => {
                                  const result = await api("items/import", {
                                    project,
                                    items: [i.id],
                                  });
                                  setNotice(
                                    result.created
                                      ? `‘${projects.find((row) => row.data.id === project)?.data.name}’ 프로젝트에 작업을 추가했습니다.`
                                      : "이미 이 프로젝트에 연결된 항목입니다.",
                                  );
                                });
                              else {
                                setCheckedItems([i.id]);
                                requestAnimationFrame(() => {
                                  const picker =
                                    document.querySelector<HTMLSelectElement>(
                                      '[aria-label="가져올 프로젝트"]',
                                    );
                                  picker?.scrollIntoView({
                                    block: "center",
                                    behavior: "smooth",
                                  });
                                  picker?.focus({ preventScroll: true });
                                });
                              }
                            }}
                          >
                            {project &&
                            (destinations.get(i.id) ?? []).some(
                              (destination) =>
                                destination.projectId === project,
                            )
                              ? "현재 프로젝트에 연결됨"
                              : !project &&
                                  (destinations.get(i.id)?.length ?? 0) > 0
                                ? "다른 프로젝트에 추가"
                                : "프로젝트에 추가"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {visibleItems.length > activityLimit && (
                    <div className="activity-pagination">
                      <span>
                        {visibleItems.length}개 중 {activityLimit}개 표시
                      </span>
                      <button
                        onClick={() => setActivityLimit((value) => value + 40)}
                      >
                        다음 40개 더 보기
                      </button>
                    </div>
                  )}
                </>
              )}
              {tab === tabs[5] && (
                <ManagementPanel
                  key={`${data.viewer.workspaceId}-${managementKind}`}
                  projectFilter={project}
                  onEditTask={(task) => openTask(task, true)}
                  onAddProject={() => {
                    setError("");
                    setModal("project");
                  }}
                  onAddTask={() => {
                    setEditing(null);
                    setNewParentId("");
                    setFormProject(project || projects[0]?.data.id || "");
                    setNewTaskId(`task-${createId()}`);
                    setModal("task");
                  }}
                  initialKind={managementKind}
                  data={data}
                  api={api}
                  refresh={load}
                />
              )}
              {tab === tabs[6] && (
                <ProjectCalendar
                  projects={projects.filter(
                    (p) => !project || p.data.id === project,
                  )}
                  onManage={() => {
                    setManagementKind("project");
                    setTab(tabs[5]);
                  }}
                />
              )}
              {tab === tabs[3] && <HistoryTimeline events={history} />}
              {tab === tabs[4] && (
                <section>
                  <div className="section-title">
                    <h2>웹훅 동기화 작업</h2>
                    <span className="muted">최근 100개 · 15초마다 갱신</span>
                  </div>
                  <div className="activity-list">
                    {jobs.length ? (
                      jobs.map((j) => (
                        <article className="activity-row" key={j.id}>
                          <span className={`job-status ${j.status}`}>
                            {
                              {
                                pending: "대기",
                                running: "처리 중",
                                completed: "완료",
                                failed: "실패",
                              }[j.status]
                            }
                          </span>
                          <div>
                            <strong>{j.repository}</strong>
                            <small>
                              {j.event} · 시도 {j.attempts}/5 ·{" "}
                              {new Date(j.updated_at).toLocaleString("ko-KR")}
                            </small>
                            {j.last_error && (
                              <small className="job-error">
                                {j.last_error}
                              </small>
                            )}
                          </div>
                          {j.status === "failed" && (
                            <button
                              className="button secondary"
                              disabled={busy || !canWrite}
                              onClick={() =>
                                void act(() => api("jobs/retry", { id: j.id }))
                              }
                            >
                              재시도
                            </button>
                          )}
                        </article>
                      ))
                    ) : (
                      <div className="empty">
                        수신한 웹훅 작업이 없습니다. 웹훅 등록 후 작업자를
                        실행하세요.
                      </div>
                    )}
                  </div>
                </section>
              )}
              <footer>
                <span className="live-dot" />{" "}
                {data.syncInProgress
                  ? "GitHub 동기화 진행 중"
                  : freshness.collectedAt
                    ? `마지막 데이터 수집 ${new Date(freshness.collectedAt).toLocaleString("ko-KR")}`
                    : latest
                      ? `최근 동기화 기록 ${new Date(latest.updatedAt).toLocaleString("ko-KR")}`
                      : "실제 GitHub 동기화 기록 없음"}
                <span>태스크 완료 ≠ 배포 완료</span>
              </footer>
            </>
          )}
        </section>
      </main>
      {profileOpen && (
        <div className="overlay" onClick={() => setProfileOpen(false)}>
          <section
            className="modal profile-modal"
            role="dialog"
            aria-modal="true"
            aria-label="프로필 및 토큰 설정"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>프로필 및 토큰 설정</h2>
              <button
                className="icon-button"
                aria-label="닫기"
                onClick={() => setProfileOpen(false)}
              >
                ×
              </button>
            </div>
            <AccountPanel
              inDialog
              inviteToken={inviteToken}
              workspaceId={
                data?.viewer.workspaceId ?? workspaceRef.current ?? "main"
              }
              onChanged={(id) => {
                accountGeneration.current++;
                if (id !== undefined) workspaceRef.current = id;
                setDeleting(null);
                setDeleteError("");
                sessionStorage.removeItem("pm-token");
                setData(null);
                void load();
              }}
            />
          </section>
        </div>
      )}
      {modal && (
        <div
          className={`overlay${modal === "task" && editing ? " task-detail-overlay" : ""}`}
        >
          <section
            className={`modal task-editor-modal${modal === "task" && editing ? " task-detail-drawer" : ""}`}
            aria-busy={busy}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "task"
                ? "태스크 관리"
                : modal === "project"
                  ? "프로젝트 등록"
                  : "기능 등록"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>
                {modal === "task"
                  ? "태스크 관리"
                  : modal === "project"
                    ? "프로젝트 등록"
                    : "기능 등록"}
              </h2>
              <button
                className="icon-button"
                aria-label="닫기"
                disabled={busy}
                onClick={() => {
                  setModal(null);
                  setEditing(null);
                }}
              >
                ×
              </button>
            </div>
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            {modal === "project" ? (
              <ProjectForm
                prefixes={projects.flatMap((row) =>
                  row.data.featurePrefix ? [row.data.featurePrefix] : [],
                )}
                repositories={[
                  ...(data?.repositories.map((r) => r.data.name) ?? []),
                  ...projects.flatMap((p) => p.data.repositories),
                ]}
                busy={busy}
                onCancel={() => setModal(null)}
                onSubmit={async (input) => {
                  await act(async () => {
                    const created = await api("projects", { data: input });
                    setProject(created.data.id);
                    setNotice(
                      "프로젝트를 만들었습니다. PRD를 작성하거나 작업을 추가해 보세요.",
                    );
                    setTab(tabs[0]);
                    setModal(null);
                  });
                }}
              />
            ) : modal === "task" && editing && taskViewing ? (
              <>
                <TaskDetail
                  task={editing}
                  project={
                    projects.find((row) => row.data.id === editing.data.project)
                      ?.data
                  }
                  tasks={data?.tasks ?? []}
                  items={taskConnections.get(editing.data.id) ?? []}
                  writable={!!canWrite}
                  busy={busy}
                  onMove={moveTask}
                  onOpen={openTask}
                />
                <TaskSubtasks
                  notice={taskNavigationNotice}
                  key={`subtasks-${editing.data.id}`}
                  task={editing}
                  tasks={data?.tasks ?? []}
                  writable={!!canWrite}
                  busy={busy}
                  onOpen={openTask}
                  onAdd={addSubtask}
                  onMove={moveTask}
                />
              </>
            ) : (
              <form
                key={editing?.data.id ?? newTaskId}
                onSubmit={submit}
                onChange={(event) => {
                  if (!(event.target as HTMLElement).closest(".task-subtasks"))
                    setTaskDirty(true);
                }}
              >
                {!canWrite && (
                  <p className="section-description">
                    조회 전용 권한으로 태스크를 확인하고 있습니다.
                  </p>
                )}
                <fieldset className="task-fields" disabled={!canWrite || busy}>
                  <input
                    type="hidden"
                    name="id"
                    value={editing?.data.id ?? newTaskId}
                  />
                  <label>
                    제목{" "}
                    <input
                      name="title"
                      required
                      maxLength={300}
                      placeholder="예: 회원 초대 기능 추가"
                      defaultValue={editing?.data.title}
                    />
                  </label>
                  {
                    <label>
                      프로젝트
                      <select
                        name="project"
                        required
                        value={formProject}
                        onChange={(e) => {
                          setFormProject(e.target.value);
                          setFormFeature("");
                          setNewParentId("");
                        }}
                      >
                        {projects.map((p) => (
                          <option key={p.data.id} value={p.data.id}>
                            {p.data.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  }
                  {modal === "task" ? (
                    <>
                      <label>
                        작업 유형
                        <select
                          name="type"
                          aria-label="작업 유형"
                          defaultValue={editing?.data.type ?? "feature"}
                        >
                          <option value="feature">기능 개발</option>
                          <option value="bug">버그</option>
                          <option value="improvement">개선</option>
                          <option value="operations">운영</option>
                        </select>
                      </label>
                      <label>
                        설명
                        <textarea
                          name="description"
                          aria-label="설명"
                          defaultValue={editing?.data.description}
                        />
                      </label>
                      <div className="form-grid">
                        <GitHubAssigneeSelect
                          key={`assignee-${editing?.data.id ?? newTaskId}-${formProject}`}
                          api={api}
                          project={formProject}
                          defaultValue={
                            editing?.data.project === formProject
                              ? editing.data.assignee
                              : ""
                          }
                        />
                        <label>
                          기한
                          <input
                            name="dueDate"
                            type="date"
                            defaultValue={editing?.data.dueDate ?? ""}
                          />
                        </label>
                        <label>
                          상태
                          <select
                            name="status"
                            aria-label="상태"
                            defaultValue={editing?.data.status ?? "backlog"}
                          >
                            {Object.entries(labels)
                              .slice(0, 6)
                              .map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          우선순위
                          <select
                            name="priority"
                            defaultValue={editing?.data.priority ?? "medium"}
                          >
                            {["low", "medium", "high"].map((p) => (
                              <option key={p} value={p}>
                                {
                                  { low: "낮음", medium: "보통", high: "높음" }[
                                    p
                                  ]
                                }
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label>
                        상위 태스크
                        <select
                          name="parentId"
                          aria-label="상위 태스크"
                          key={`parent-${formProject}-${selectedFormFeature}`}
                          defaultValue={editing?.data.parentId ?? newParentId}
                        >
                          <option value="">없음 (최상위 태스크)</option>
                          {data?.tasks
                            .filter(
                              (task) =>
                                task.data.project === formProject &&
                                (!editing ||
                                  task.data.feature === editing.data.feature) &&
                                task.data.id !== editing?.data.id &&
                                !excludedParents.has(task.data.id),
                            )
                            .map((task) => (
                              <option key={task.data.id} value={task.data.id}>
                                {task.data.title} ({task.data.id})
                              </option>
                            ))}
                        </select>
                        <small>
                          상위 작업을 선택하면 하위 태스크가 됩니다. 각 작업의
                          완료 상태는 따로 관리합니다.
                        </small>
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        이름
                        <input name="name" required />
                      </label>
                      <label>
                        목표
                        <textarea name="goal" />
                      </label>
                    </>
                  )}
                </fieldset>
                {modal === "task" && editing && data && (
                  <TaskSubtasks
                    notice={taskNavigationNotice}
                    key={`subtasks-${editing.data.id}`}
                    task={editing}
                    tasks={data.tasks}
                    writable={!!canWrite}
                    busy={busy}
                    onOpen={openTask}
                    onAdd={addSubtask}
                    onMove={moveTask}
                  />
                )}
                {taskAdvancedFields}
                <div className="form-actions">
                  {editing && canWrite && (
                    <button
                      type="button"
                      className="button danger task-delete-action"
                      disabled={busy}
                      onClick={() => {
                        setDeleteError("");
                        setDeleting({
                          kind: "task",
                          id: editing.data.id,
                          revision: editing.revision,
                          name: editing.data.title,
                        });
                      }}
                    >
                      작업 삭제
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setModal(null);
                      setEditing(null);
                    }}
                  >
                    취소
                  </button>
                  <button className="button" disabled={busy || !canWrite}>
                    {busy ? "저장 중…" : "저장"}
                  </button>
                </div>
              </form>
            )}
            {modal === "task" && editing && (
              <TaskDiscussion
                key={`${data?.viewer.workspaceId}-${editing.data.id}`}
                task={editing.data.id}
                repository={
                  projects.find((p) => p.data.id === editing.data.project)?.data
                    .repositories[0] ?? ""
                }
                writable={data?.viewer.role === "write"}
                api={api}
              />
            )}
            {modal === "task" && editing && taskViewing && (
              <div className="task-read-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    setModal(null);
                    setEditing(null);
                  }}
                >
                  상세 닫기
                </button>
                {canWrite && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setTaskViewing(false);
                      setTaskDirty(false);
                    }}
                  >
                    태스크 수정
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      {deleting && data && (
        <DeleteConfirmation
          names={[deleting.name]}
          impact={deletionImpact(data, deleting.kind, [deleting.id])}
          busy={busy}
          error={deleteError}
          onCancel={() => {
            if (!busy) setDeleting(null);
          }}
          onConfirm={async () => {
            setBusy(true);
            setDeleteError("");
            try {
              await api("manage/delete", {
                kind: deleting.kind,
                entries: [{ id: deleting.id, revision: deleting.revision }],
              });
              setDeleting(null);
              setModal(null);
              setEditing(null);
              setNotice(
                deleting.kind === "project"
                  ? "프로젝트와 연결된 작업을 삭제했습니다."
                  : "작업을 삭제했습니다.",
              );
              await load();
            } catch (error) {
              setDeleteError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <section
            className="modal wide activity-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="PR 및 파일 변경"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>{selected.title}</h2>
              <button
                className="icon-button"
                aria-label="닫기"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>
            <p>
              {selected.repository} #{selected.number} · 작성자{" "}
              {selected.author} · {labels[selected.state] ?? selected.state}
            </p>
            <p>
              CI: {selected.ci?.state ?? "미확인"} · 마지막 활동:{" "}
              {new Date(selected.updatedAt).toLocaleString("ko-KR")}
            </p>
            <GitHubPeople item={selected} />
            <p>
              커밋 작성자:{" "}
              {selected.commitAuthors?.join(", ") || "확인 정보 없음"}
            </p>
            <div className="activity-detail-actions">
              <button
                type="button"
                className="button secondary"
                disabled={detailLoading}
                onClick={() =>
                  setDetailRefreshVersion((version) => version + 1)
                }
              >
                최신 내용 새로고침
              </button>
              <small className="muted">
                열려 있는 동안 15초마다 수신된 변경을 확인합니다.
              </small>
            </div>
            <a
              className="text-button"
              href={selected.url}
              target="_blank"
              rel="noreferrer"
            >
              GitHub 원본 열기 ↗
            </a>
            <div className="body-tabs" role="tablist" aria-label="본문 표시">
              <button
                role="tab"
                aria-selected={bodyMode === "preview"}
                onClick={() => setBodyMode("preview")}
              >
                미리보기
              </button>
              <button
                role="tab"
                aria-selected={bodyMode === "source"}
                onClick={() => setBodyMode("source")}
              >
                Markdown 원문
              </button>
            </div>
            <section aria-label="PR·이슈 본문">
              {bodyMode === "preview" ? (
                <MarkdownBody
                  body={selected.body}
                  repository={selected.repository}
                />
              ) : (
                <pre className="markdown-source">
                  {selected.body || "작성된 본문이 없습니다."}
                </pre>
              )}
            </section>
            {detailLoading && (
              <p role="status">최신 본문과 변경 정보를 불러오는 중입니다…</p>
            )}
            {detailError && (
              <div role="alert">
                최신 내용을 불러오지 못했습니다. {detailError}
                <button
                  onClick={() =>
                    setDetailRefreshVersion((version) => version + 1)
                  }
                >
                  다시 시도
                </button>
              </div>
            )}
            {selected.filesComplete === false && (
              <div className="alert">
                일부 파일이 생략되었습니다. 원본 PR에서 전체 변경을 확인하세요.
              </div>
            )}
            {!!selected.files?.length && (
              <div className="diff-section-heading">
                <h3>파일 변경 · {selected.files.length}개</h3>
                <span>
                  <b className="added">+ 추가</b>
                  <b className="deleted">− 삭제</b>
                </span>
              </div>
            )}
            {selected.files?.map((file) => (
              <FileDiff key={file.path} file={file} sourceUrl={selected.url} />
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  note,
  icon,
  warm = false,
}: {
  title: string;
  value: number;
  note: string;
  icon: string;
  warm?: boolean;
}) {
  return (
    <article className={`stat ${warm ? "warm" : ""}`}>
      <div>
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>
        {value}
        <small>개</small>
      </strong>
      <p>{note}</p>
    </article>
  );
}
