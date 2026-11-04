// Read-only fixtures shaped from GitHub REST issue / pull request contracts.
// Unsupported routes deliberately return 501.
const http = require("http");
http
  .createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    let data;
    if (req.method !== "GET") {
      res.writeHead(501);
      return res.end();
    }
    if (path === "/repos/org/repo/pulls/99/files") {
      res.writeHead(403, {
        "Content-Type": "application/json",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      });
      return res.end(
        JSON.stringify({ message: "API rate limit exceeded for installation" }),
      );
    }
    if (path === "/repos/org/repo/issues")
      data = [
        {
          number: 1,
          title: "Example PR",
          body: "",
          user: { login: "author" },
          assignees: [{ login: "owner" }],
          labels: [{ name: "feature", color: "00aa88" }],
          state: "open",
          html_url: "https://github.com/org/repo/pull/1",
          updated_at: "2026-10-28T00:00:00Z",
          pull_request: {},
        },
        {
          number: 2,
          title: "Example issue",
          body: "",
          user: { login: "author" },
          assignees: [],
          labels: [],
          state: "open",
          html_url: "https://github.com/org/repo/issues/2",
          updated_at: "2026-10-28T00:00:00Z",
        },
      ];
    else if (path === "/repos/org/repo/pulls/1")
      data = {
        merged_at: null,
        requested_reviewers: [{ login: "reviewer" }],
        requested_teams: [{ slug: "frontend" }],
        changed_files: 0,
        head: { sha: "a".repeat(40) },
      };
    else if (path.endsWith("/status"))
      data = { state: "success", total_count: 1 };
    else if (path.endsWith("/check-runs"))
      data = { total_count: 0, check_runs: [] };
    else if (
      [
        "/repos/org/repo/pulls/1/files",
        "/repos/org/repo/pulls/1/commits",
      ].includes(path)
    )
      data = [];
    else {
      res.writeHead(501);
      return res.end(JSON.stringify({ error: "Unsupported contract path" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  })
  .listen(process.env.PORT || 4911);
