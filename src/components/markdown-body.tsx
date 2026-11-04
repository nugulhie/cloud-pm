import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

export function markdownUrl(url: string, repository: string, image = false) {
  const safe = defaultUrlTransform(url);
  if (!safe) return "";
  if (safe.startsWith("#")) return safe;
  try {
    const base = image
      ? `https://github.com/${repository}/raw/HEAD/`
      : `https://github.com/${repository}/blob/HEAD/`;
    const resolved = new URL(
      safe,
      safe.startsWith("/") ? "https://github.com" : base,
    );
    return ["https:", "http:", ...(image ? [] : ["mailto:"])].includes(
      resolved.protocol,
    )
      ? resolved.href
      : "";
  } catch {
    return "";
  }
}
export default function MarkdownBody({
  body,
  repository,
}: {
  body: string;
  repository: string;
}) {
  if (!body.trim())
    return <div className="empty small">작성된 본문이 없습니다.</div>;
  return (
    <article className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        urlTransform={(url, key) => markdownUrl(url, repository, key === "src")}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target={props.href?.startsWith("#") ? undefined : "_blank"}
              rel="noopener noreferrer"
            />
          ),
          img: ({ node, ...props }) => (
            <img
              {...props}
              alt={props.alt ?? ""}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ),
          table: ({ node, ...props }) => (
            <div className="markdown-table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {body}
      </Markdown>
    </article>
  );
}
