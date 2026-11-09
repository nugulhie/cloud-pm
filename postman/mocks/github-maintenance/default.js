// Contract-shaped GET fixtures; unknown operations fail instead of reaching GitHub.
const http = require("http");
const issue = (number) => ({
  number,
  title: `변경된 이슈 ${number}`,
  body: "변경된 본문",
  user: { login: "developer" },
  assignees: [],
  labels: [],
  state: number === 2 ? "closed" : "open",
  html_url: `https://github.com/org/repo/issues/${number}`,
  updated_at: "2026-11-08T00:00:00Z",
});
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost"),
      path = url.pathname;
    let status = 200,
      data;
    if (req.method !== "GET") {
      status = 501;
      data = { message: "Unsupported operation" };
    } else if (path === "/repos/org/repo/issues") data = [issue(1), issue(2)];
    else if (path === "/repos/org/repo")
      data = { id: 1, full_name: "org/repo" };
    else if (path === "/repos/org/repo/issues/1") data = issue(1);
    else if (
      path === "/repos/org/repo/issues/2" ||
      path.startsWith("/repos/org/removed")
    ) {
      status = 404;
      data = { message: "Not Found" };
    } else if (path.startsWith("/repos/org/limited")) {
      res.writeHead(403, {
        "Content-Type": "application/json",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600),
      });
      res.end(JSON.stringify({ message: "API rate limit exceeded" }));
      return;
    } else {
      status = 501;
      data = { message: "Endpoint not modeled" };
    }
    res.writeHead(status, {
      "Content-Type": "application/json",
      "x-ratelimit-remaining": "4900",
    });
    res.end(JSON.stringify(data));
  })
  .listen(Number(process.env.PORT || 4913), "0.0.0.0");
