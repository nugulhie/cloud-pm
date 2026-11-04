import type { GitHubItem } from "../core/model";
export default function GitHubPeople({ item }: { item: GitHubItem }) {
  return (
    <span className="github-metadata">
      <span>담당자: {item.assignees.join(", ") || "미할당"}</span>
      {item.kind === "pr" && (
        <span>
          리뷰 요청:{" "}
          {[
            ...item.reviewers,
            ...(item.reviewerTeams ?? []).map((team) => `팀 ${team}`),
          ].join(", ") || "없음"}
        </span>
      )}
      <span className="github-labels" aria-label="GitHub 라벨">
        {item.labels === undefined
          ? "라벨: 동기화 필요"
          : item.labels.length
            ? item.labels.map((label) => (
                <span
                  className="github-label"
                  key={label.name}
                  style={{
                    borderLeftColor: /^[0-9a-f]{6}$/i.test(label.color)
                      ? `#${label.color}`
                      : undefined,
                  }}
                >
                  {label.name}
                </span>
              ))
            : "라벨: 없음"}
      </span>
    </span>
  );
}
