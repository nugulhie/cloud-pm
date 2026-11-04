"use client";
import { useMemo, useState } from "react";
import type { GitHubItem } from "../core/model";
import { MAX_DIFF_LINES, parseUnifiedDiff } from "../core/unified-diff";

type File = NonNullable<GitHubItem["files"]>[number];
const statuses: Record<string, string> = {
  added: "새 파일",
  removed: "파일 삭제",
  modified: "수정",
  renamed: "이름 변경",
  copied: "복사",
  changed: "변경",
  unchanged: "변경 없음",
};

export default function FileDiff({
  file,
  sourceUrl,
}: {
  file: File;
  sourceUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const diff = useMemo(
    () => (expanded && file.patch ? parseUnifiedDiff(file.patch) : null),
    [expanded, file.patch],
  );
  return (
    <details
      className="file file-diff"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <code className="file-diff-path" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ` : ""}
          {file.path}
        </code>
        <span className="file-diff-stats">
          <span className="file-diff-status">
            {statuses[file.status] ?? file.status}
          </span>
          <b className="added" aria-label={`추가 ${file.additions}줄`}>
            +{file.additions}
          </b>
          <b className="deleted" aria-label={`삭제 ${file.deletions}줄`}>
            −{file.deletions}
          </b>
        </span>
      </summary>
      {expanded &&
        (diff ? (
          <>
            <div
              className="diff-scroll"
              role="region"
              aria-label={`${file.path} 파일 변경 내용`}
              tabIndex={0}
            >
              <table className="diff-table" aria-label="통합 변경 비교">
                <thead>
                  <tr>
                    <th scope="col">이전</th>
                    <th scope="col">이후</th>
                    <th scope="col">변경 내용</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.lines.map((line, index) => (
                    <tr key={index} className={`diff-row diff-${line.kind}`}>
                      <td className="diff-line-number">{line.oldLine}</td>
                      <td className="diff-line-number">{line.newLine}</td>
                      <td className="diff-code">
                        <span
                          className="diff-prefix"
                          aria-label={
                            line.kind === "added"
                              ? "추가"
                              : line.kind === "deleted"
                                ? "삭제"
                                : undefined
                          }
                        >
                          {line.kind === "added"
                            ? "+"
                            : line.kind === "deleted"
                              ? "−"
                              : " "}
                        </span>
                        <code>{line.text || " "}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {diff.truncated && (
              <p className="diff-notice">
                변경 내용이 길어 처음 {MAX_DIFF_LINES.toLocaleString("ko-KR")}
                줄만 표시합니다.{" "}
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  GitHub에서 전체 변경 확인 ↗
                </a>
              </p>
            )}
          </>
        ) : (
          <p className="diff-notice">
            텍스트 변경 내용이 제공되지 않았습니다. 바이너리 파일이거나 변경
            내용이 생략되었을 수 있습니다.{" "}
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              GitHub 원본 확인 ↗
            </a>
          </p>
        ))}
    </details>
  );
}
