# Simulation context — github-activity

Generated 2026-10-28. One local mock represents `api.github.com` using the official REST issue/review-request response fields. No provider-owned mock was imported: this repository has no owning Postman workspace binding; fixtures are synthetic and read only.

## Purpose

Run the real `collectRepository` and `GitHubClient` over HTTP/TLS to verify issue/PR labels, assignees, requested reviewers and teams. Unknown routes return 501.

## Execution

```sh
NODE_USE_ENV_PROXY=1 postman simulation run postman/simulations/github-activity.sim.yaml --proxy --proxy-port 4912 --no-history --lift 'node --use-env-proxy --import tsx tests/github-simulation.ts'
```

The proxy owns the child lifecycle and stops with it. `GitHub HTTP simulation: ... passed` confirms the client assertions; the final proxy counts must show zero passed-through requests. No real credentials are needed or used.

## Assumptions

- 2026-10-28: Node 24.21 supports `--use-env-proxy`; the successful run used that flag and the CLI-provided CA to intercept the unmodified HTTPS host.
- Synthetic replies cover two open items and one PR with no changed files. This does not establish live token permissions, closed-item pagination, or full organization sync behavior.
- Restart after editing handlers. The production app and its database are not members of this simulation.

## Observations

<!-- begin:observations -->

- 2026-10-28: github received all six real client requests; all returned 200, all field assertions passed, zero traffic passed through to real GitHub, no silent members.

<!-- end:observations -->

## Webhook incremental processing — 2026-11-03

Run `tests/github-webhook-simulation.ts` with the same simulation (proxy port 4915 is used in the recorded run). The signed receiver and persistent queue feed the actual worker processor. Issue payloads and unchanged-commit PR metadata need no external request. A new PR fetches files, commits and two CI endpoints only. `/pulls/99/files` injects a primary-limit 403 with reset headers; its job remains pending with zero consumed attempts while another issue still completes. The proxy report must show five mocked requests and zero passed through. These synthetic contracts do not establish production App permissions or GitHub delivery timing.
