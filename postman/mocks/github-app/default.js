// Synthetic installation and issue state; no real GitHub credentials or writes.
const http = require("http");
let issued = 0,
  revoked = false;
const issues = [];
http
  .createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const respond = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (path === "/__mock/state")
      return respond(200, { issued, issueWrites: issues.length, revoked });
    if (path === "/__mock/revoke" && req.method === "POST") {
      revoked = true;
      return respond(200, { revoked });
    }
    if (revoked)
      return respond(403, {
        message: "Resource not accessible by integration",
      });
    if (
      [
        "/orgs/org/installation",
        "/app/installations/77",
        "/app/installations/77/access_tokens",
      ].includes(path)
    ) {
      const jwt = (req.headers.authorization || "").replace(/^Bearer /, "");
      try {
        const [header, payload, signature] = jwt.split(".");
        if (
          JSON.parse(Buffer.from(header, "base64url")).alg !== "RS256" ||
          JSON.parse(Buffer.from(payload, "base64url")).iss !== "1234" ||
          !signature
        )
          throw new Error();
      } catch {
        return respond(401, { message: "Invalid JWT" });
      }
      if (path.endsWith("/access_tokens") && req.method === "POST") {
        issued++;
        return respond(201, {
          token: `app-http-token-${issued}`,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          permissions: {
            issues: "write",
            contents: "read",
            pull_requests: "read",
          },
        });
      }
      if (req.method === "GET")
        return respond(200, {
          id: 77,
          app_id: 1234,
          account: { login: "org" },
          suspended_at: null,
        });
    }
    if (!/^Bearer app-http-token-\d+$/.test(req.headers.authorization || ""))
      return respond(401, { message: "Bad credentials" });
    if (path === "/repos/org/repo/assignees" && req.method === "GET")
      return respond(200, [
        { login: "developer", type: "User" },
        { login: "other-dev", type: "User" },
        { login: "ignored-user", type: "User" },
        { login: "helper[bot]", type: "Bot" },
      ]);
    if (path.startsWith("/repos/org/repo/assignees/") && req.method === "GET") {
      const login = path.split("/").at(-1);
      if (["developer", "other-dev", "ignored-user"].includes(login)) {
        res.writeHead(204);
        return res.end();
      }
      return respond(404, { message: "Not Found" });
    }
    if (path === "/installation/repositories" && req.method === "GET")
      return respond(200, {
        total_count: 1,
        repositories: [{ full_name: "org/repo" }],
      });
    if (path === "/repos/org/repo/issues" && req.method === "POST") {
      let data;
      try {
        data = req.body;
        if (typeof data === "string") data = JSON.parse(data);
        if (!data || typeof data !== "object") throw new Error();
      } catch {
        return respond(400, { message: "Invalid JSON" });
      }
      if (!data.title) return respond(422, { message: "Validation failed" });
      const number = 101 + issues.length,
        issue = {
          number,
          title: data.title,
          body: data.body || "",
          html_url: `https://github.com/org/repo/issues/${number}`,
          user: { login: "cloud-pm-agent[bot]" },
          updated_at: new Date().toISOString(),
          assignees: (data.assignees ?? [])
            .filter((login) => login !== "ignored-user")
            .map((login) => ({ login })),
        };
      issues.push(issue);
      return respond(201, issue);
    }
    if (path === "/repos/org/repo/issues" && req.method === "GET")
      return respond(200, issues);
    return respond(501, { message: "Unsupported contract path" });
  })
  .listen(process.env.PORT || 4912);
