export type DiffLine = {
  kind: "hunk" | "added" | "deleted" | "context" | "meta";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export const MAX_DIFF_LINES = 10_000;

export function parseUnifiedDiff(patch: string, limit = MAX_DIFF_LINES) {
  const source = patch.split(/\r?\n/, limit + 2);
  if (source.length <= limit + 1 && source.at(-1) === "") source.pop();
  const truncated = source.length > limit;
  if (truncated) source.length = limit;
  const lines: DiffLine[] = [];
  let oldLine: number | null = null,
    newLine: number | null = null;
  let inHunk = false;
  for (const text of source) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (text.startsWith("@@")) {
      oldLine = hunk ? Number(hunk[1]) : null;
      newLine = hunk ? Number(hunk[2]) : null;
      inHunk = true;
      lines.push({ kind: "hunk", oldLine: null, newLine: null, text });
      continue;
    }
    if (
      text.startsWith("\\") ||
      (!inHunk &&
        /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |similarity index |rename (from|to) )/.test(
          text,
        ))
    ) {
      lines.push({ kind: "meta", oldLine: null, newLine: null, text });
    } else if (text.startsWith("+")) {
      lines.push({
        kind: "added",
        oldLine: null,
        newLine,
        text: text.slice(1),
      });
      if (newLine !== null) newLine++;
    } else if (text.startsWith("-")) {
      lines.push({
        kind: "deleted",
        oldLine,
        newLine: null,
        text: text.slice(1),
      });
      if (oldLine !== null) oldLine++;
    } else if (text.startsWith(" ")) {
      lines.push({ kind: "context", oldLine, newLine, text: text.slice(1) });
      if (oldLine !== null) oldLine++;
      if (newLine !== null) newLine++;
    } else {
      lines.push({ kind: "meta", oldLine: null, newLine: null, text });
    }
  }
  return { lines, truncated };
}
