// Public GitHub contract, synthetic users/tokens only. Served locally by Postman.
const http = require("http"),
  crypto = require("crypto");
let authorization = null,
  tokenExchanges = 0,
  patches = 0,
  loseNext = false;
let issue = {
  number: 17,
  title: "Synthetic task",
  body: "Synthetic body",
  user: { login: "author" },
  assignees: [{ login: "developer" }],
  labels: [],
  state: "open",
  html_url: "https://github.com/org/repo/issues/17",
  updated_at: "2026-11-05T01:00:00Z",
};
const body = (req) =>
  typeof req.body === "string" ? JSON.parse(req.body) : req.body;
http
  .createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (path === "/__mock/state")
      return send(200, { tokenExchanges, patches, assignees: issue.assignees });
    if (path === "/__mock/authorize" && req.method === "POST") {
      authorization = { ...body(req), used: false };
      return send(200, { ready: true });
    }
    if (path === "/__mock/lose-next-patch" && req.method === "POST") {
      loseNext = true;
      return send(200, { ready: true });
    }
    if (path === "/login/oauth/access_token" && req.method === "POST") {
      const form = new URLSearchParams(req.body);
      tokenExchanges++;
      if (
        form.get("client_id") !== "synthetic-client" ||
        form.get("client_secret") !== "synthetic-secret"
      )
        return send(200, { error: "incorrect_client_credentials" });
      if (
        !authorization ||
        authorization.used ||
        authorization.code !== form.get("code") ||
        crypto
          .createHash("sha256")
          .update(form.get("code_verifier") || "")
          .digest("base64url") !== authorization.challenge
      )
        return send(200, { error: "bad_verification_code" });
      authorization.used = true;
      return send(200, {
        access_token: "synthetic-oauth-user-token",
        token_type: "bearer",
        expires_in: 28800,
      });
    }
    if (
      path === "/user" &&
      req.method === "GET" &&
      req.headers.authorization === "Bearer synthetic-oauth-user-token"
    )
      return send(200, {
        id: authorization?.id ?? 123,
        login: authorization?.login ?? "developer",
        name: "Synthetic Developer",
        type: "User",
      });
    if (
      path === "/user/memberships/orgs/org" &&
      req.method === "GET" &&
      req.headers.authorization === "Bearer synthetic-oauth-user-token"
    )
      return send(200, {
        state: authorization?.membership ?? "active",
        role: "member",
      });
    if (
      ![
        "Bearer synthetic-installation-token",
        "Bearer synthetic-oauth-user-token",
      ].includes(req.headers.authorization)
    )
      return send(401, { message: "Bad credentials" });
    if (path === "/repos/org/repo/assignees" && req.method === "GET")
      return send(200, [
        { login: "developer", type: "User" },
        { login: "next-dev", type: "User" },
        { login: "ignored-dev", type: "User" },
      ]);
    if (path.startsWith("/repos/org/repo/assignees/") && req.method === "GET") {
      if (
        ["developer", "next-dev", "ignored-dev"].includes(
          path.split("/").at(-1),
        )
      ) {
        res.writeHead(204);
        return res.end();
      }
      return send(404, { message: "Not Found" });
    }
    if (path === "/repos/org/repo/issues/17" && req.method === "GET")
      return send(200, issue);
    if (path === "/repos/org/repo/issues/17" && req.method === "PATCH") {
      const input = body(req);
      if (!Array.isArray(input?.assignees) || input.assignees.length > 10)
        return send(422, { message: "Validation failed" });
      patches++;
      issue = {
        ...issue,
        assignees: input.assignees
          .filter((login) => login !== "ignored-dev")
          .map((login) => ({ login })),
        updated_at: new Date(Date.parse(issue.updated_at) + 1000).toISOString(),
      };
      if (loseNext) {
        loseNext = false;
        return res.destroy();
      }
      return send(200, issue);
    }
    return send(501, { message: "Unsupported contract path" });
  })
  .listen(process.env.PORT || 4918);
