import { Store } from "../db/store";
import type { Project, Feature, Task, GitHubItem } from "./model";
export async function seedDemo(store: Store) {
  if (await store.get("project", "customer-platform")) return;
  const project: Project = {
    id: "customer-platform",
    name: "고객 플랫폼",
    goal: "가입부터 결제까지, 연결된 고객 경험 만들기",
    repositories: ["demo/backend", "demo/frontend", "demo/infrastructure"],
  };
  await store.save("project", project.id, project, "demo-seed");
  const features: Feature[] = [
    {
      id: "social-login",
      project: project.id,
      name: "소셜 로그인",
      goal: "가입 진입 장벽을 낮추는 통합 인증",
    },
    {
      id: "billing",
      project: project.id,
      name: "구독 결제",
      goal: "안정적인 결제와 구독 관리",
    },
    {
      id: "observability",
      project: project.id,
      name: "서비스 모니터링",
      goal: "오류를 빠르게 파악할 수 있는 관측 환경",
    },
  ];
  for (const f of features) await store.save("feature", f.id, f, "demo-seed");
  const tasks: Task[] = [
    {
      id: "TASK-101",
      project: project.id,
      feature: "social-login",
      title: "소셜 로그인 API 구현",
      assignee: "minji",
      status: "done",
      priority: "high",
      dueDate: null,
      blockedReason: "",
      description: "OAuth 콜백과 사용자 세션 처리",
      yaml: "",
    },
    {
      id: "TASK-102",
      project: project.id,
      feature: "social-login",
      title: "소셜 로그인 화면 연결",
      assignee: "junho",
      status: "in_review",
      priority: "high",
      dueDate: null,
      blockedReason: "API 응답 형식 리뷰가 필요합니다.",
      description: "로그인 버튼과 콜백 화면을 연결합니다.",
      yaml: "",
    },
    {
      id: "TASK-103",
      project: project.id,
      feature: "social-login",
      title: "인증 환경 설정",
      assignee: "",
      status: "ready",
      priority: "high",
      dueDate: null,
      blockedReason: "",
      description: "운영 환경 OAuth 설정",
      yaml: "",
    },
    {
      id: "TASK-201",
      project: project.id,
      feature: "billing",
      title: "결제 웹훅 중복 처리",
      assignee: "seoyeon",
      status: "in_progress",
      priority: "high",
      dueDate: null,
      blockedReason: "",
      description: "중복 이벤트에도 결제가 한 번만 반영되도록 합니다.",
      yaml: "",
    },
    {
      id: "TASK-202",
      project: project.id,
      feature: "billing",
      title: "구독 관리 페이지",
      assignee: "junho",
      status: "backlog",
      priority: "medium",
      dueDate: null,
      blockedReason: "결제 API 선행 작업 대기",
      description: "",
      yaml: "",
    },
    {
      id: "TASK-301",
      project: project.id,
      feature: "observability",
      title: "에러 추적 계측",
      assignee: "minji",
      status: "done",
      priority: "medium",
      dueDate: null,
      blockedReason: "",
      description: "",
      yaml: "",
    },
  ];
  for (const t of tasks) await store.save("task", t.id, t, "demo-seed");
  const items: GitHubItem[] = [
    {
      id: "demo/frontend#87",
      repository: "demo/frontend",
      number: 87,
      kind: "pr",
      title: "소셜 로그인 화면 연결",
      body: "로그인 흐름과 오류 화면을 구현합니다.",
      author: "junho",
      assignees: ["junho"],
      reviewers: ["minji"],
      state: "open",
      url: "https://github.com/demo/frontend/pull/87",
      updatedAt: new Date().toISOString(),
      commitAuthors: ["junho"],
      filesComplete: true,
      files: [
        {
          path: "src/auth/LoginButton.tsx",
          status: "modified",
          additions: 24,
          deletions: 6,
          patch:
            "@@ -1,3 +1,5 @@\n-export function Login() {}\n+export function Login() {\n+  return <button>소셜 로그인</button>;\n+}",
        },
        {
          path: "src/auth/callback.ts",
          status: "added",
          additions: 32,
          deletions: 0,
        },
      ],
    },
    {
      id: "demo/backend#142",
      repository: "demo/backend",
      number: 142,
      kind: "pr",
      title: "소셜 로그인 API 구현",
      body: "",
      author: "minji",
      assignees: ["minji"],
      reviewers: [],
      state: "merged",
      url: "https://github.com/demo/backend/pull/142",
      updatedAt: new Date().toISOString(),
      commitAuthors: ["minji"],
      filesComplete: true,
      files: [
        {
          path: "src/auth/oauth.ts",
          status: "modified",
          additions: 84,
          deletions: 12,
        },
      ],
    },
  ];
  for (const i of items) await store.save("github", i.id, i, "demo-seed");
  await store.save(
    "link",
    "TASK-102:demo/frontend#87",
    {
      id: "TASK-102:demo/frontend#87",
      task: "TASK-102",
      item: "demo/frontend#87",
      status: "approved",
      reason: "개발자가 연결한 구현 PR",
      method: "manual",
    },
    "demo-seed",
  );
}
