import type { GitHubItem } from "../core/model";
const states: Record<string, string> = {
  open: "열림",
  closed: "닫힘",
  merged: "머지 완료",
};
export function TaskGitHubBadges({ items = [] }: { items?: GitHubItem[] }) {
  if (!items.length) return null;
  return (
    <span
      className="task-github-badges"
      role="group"
      aria-label={`GitHub 연결 ${items.length}개`}
    >
      {items.slice(0, 2).map((item) => (
        <span
          key={item.id}
          className={`task-github-badge ${item.kind}`}
          title={`${item.repository} · ${item.title} · ${states[item.state] ?? item.state}`}
        >
          {item.kind === "pr" ? "PR" : "이슈"} #{item.number}
        </span>
      ))}
      {items.length > 2 && (
        <span className="task-github-more">+{items.length - 2}</span>
      )}
    </span>
  );
}
export default function TaskGitHubConnections({
  items,
}: {
  items: GitHubItem[];
}) {
  return (
    <section
      className="task-github-connections"
      aria-label="태스크 GitHub 연결"
    >
      <div className="section-title">
        <h3>연결된 GitHub 항목</h3>
        <span className="badge">{items.length}개</span>
      </div>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span className={`task-github-badge ${item.kind}`}>
                {item.kind === "pr" ? "PR" : "이슈"} #{item.number}
              </span>
              <a href={item.url} target="_blank" rel="noreferrer">
                <strong>{item.title}</strong>
                <small>{item.repository} · GitHub에서 열기 ↗</small>
              </a>
              <span className={`github-link-state ${item.state}`}>
                {states[item.state] ?? item.state}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="section-description">
          아직 연결된 PR·이슈가 없습니다. 태스크 수정의 GitHub 연결 관리에서
          기존 항목을 연결할 수 있습니다.
        </p>
      )}
    </section>
  );
}
