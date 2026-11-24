"use client";
import dynamic from "next/dynamic";
// The Markdown, GFM and sanitizer stack loads with the first rendered body, not with the dashboard.
const MarkdownBody = dynamic(() => import("./markdown-body"), {
  ssr: false,
  loading: () => <div className="markdown-body" aria-busy="true" />,
});
export default MarkdownBody;
