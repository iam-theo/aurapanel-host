# Aurex as Core Architecture Layer — Design

**Goal:** Move Aurex from an external container-proxied service (`http://localhost:4010` + Docker workspaces) into a **native core layer** of `server-panel` that runs directly on the host and owns infrastructure intelligence.

## Why

Currently `backend/src/routes/aurex.js:1` proxies to an external Aurex API. Workspaces are Docker volumes at `/workspace` ( `aurex/packages/docker/src/index.ts:67` ). Host paths like `/home`, `/var/log`, `/etc/nginx` are only injected as *text* `[HOST PATH: ...]` and not actually mounted, so the agent cannot truly `systemctl`, `journalctl`, `apt`, `nginx -t`, `pm2` on the host. Host mode (`AUREX_HOST_MODE=true` in `aurex/.env`) bypasses Docker (`aurex/packages/docker`: host exec via `spawn` + `SUDO_PASSWORD`, `aurex/apps/worker/src/opencodeServe.ts: host fetch` instead of `docker exec curl`) and maps `/workspace/*` → `HOST_ROOT/*` (`/` by default), but server-panel still treats Aurex as an external dependency.

Moving to a core layer makes Aurex **in-process**, **audited**, **RBAC-gated**, **observable** via the same `lib/audit`, `lib/metrics`, `lib/logger`, and `lib/exec` as the rest of the panel.

## Target Layering

```
server-panel/
├── frontend/                 # Presentation — ChatGPT-style chat (Aurex.jsx)
├── backend/src/
│   ├── routes/               # API — thin HTTP, validation, RBAC
│   │   └── aurex.js          # now facades core, not proxy
│   ├── core/
│   │   └── aurex/            # ← NEW CORE LAYER (Aurex Intelligence)
│   │       ├── engine.js     # run orchestration, opencode lifecycle, host vs container
│   │       ├── service.js    # domain: projects/runs/events, persistence, pubsub
│   │       ├── tools/        # host tools: system, pm2, docker, logs, updates, nginx, services
│   │       ├── prompts/      # infrastructure contract, host rules, server-context builder
│   │       └── index.js      # public facade
│   ├── lib/                  # Infrastructure — exec, config, secrets, metrics, logger
│   │   ├── exec.js / execAsync.js
│   │   ├── config.js
│   │   └── ...
│   └── middleware/           # Cross-cutting — auth, rateLimit, audit
└── aurex/ (upstream)         # optional heavy coding backend, kept for opencode heavy tasks
```

Layer rules (dependency direction):
`routes → core/aurex → lib` — `lib` never imports `core`. `core/aurex` may import `lib/exec`, `lib/config`, `lib/logger` but not routes.

## Execution Modes

| Mode | Workspace | Opencode | Use |
|------|-----------|----------|-----|
| `isolated` (default legacy) | Docker volume `aurex-vol-*:/workspace` | `docker exec opencode serve` | safe coding, untrusted code |
| `host` (new default for server-panel) | Host FS (`toHostPath: /workspace/* → /*`) | host `opencode serve --port 4096` | infrastructure audits, host services, logs, updates, nginx |

`HOST_MODE = AUREX_HOST_MODE=true || AUREX_EXEC_MODE=host` (`aurex/packages/docker/src/index.ts:9`, `aurex/apps/worker/src/config.ts:19`). Server-panel passes `serverMode=true` → task gets `[SERVER CONTEXT]` snapshot + `[HOST PATH: /home/...]` and effective `WORKDIR = hostPath` (`aurex/apps/worker/src/processRun.ts:545`).

## Data & PubSub

- Keep existing Postgres (`aurex` DB `5435` + `aurex-postgres`) + Redis (`6379`) for runs/events (BullMQ) to avoid migrating server-panel's file-based `data/panel-users.json`. Core layer reuses the same `Prisma` + `BullMQ` connections but is owned by server-panel's lifecycle.
- Alternatively, for true single-binary, core could use `data/aurex-runs.json` + in-memory pubsub — deferred to phase 2. Phase 1 keeps external DB/Redis but makes the *control plane* native.

## Security Integration

- All `core/aurex` entry points go through `requireAuth` + `requireRole` + `csrfMiddleware` (`backend/src/index.js:96`) and `req.audit()` (`lib/audit.js`), same as `pm2`, `docker`, `nginx`.
- Host destructive actions (`apt upgrade`, `systemctl restart`, `nginx -s reload`, `rm -rf`, `docker rm`) require explicit `question` tool (`agent-prompt.md:4`) and are gated as `Approval-required` per infrastructure contract (`prompts/capabilities/infrastructure.md:12`).

## Prompt Integration

- `aurex/prompts/capabilities/infrastructure.md` (20-section report contract) + `aurex/packages/shared/src/prompts/prompts.ts:92` keywords (`infrastructure`, `pm2`, `docker`, `systemd`, `nginx`, `health`, etc.) → auto-loaded when task contains infra terms. Server-panel's `backend/src/routes/aurex.js:373` also injects `[INFRASTRUCTURE REPORT CONTRACT]` for `serverMode`.

## Deployment (PM2)

`ecosystem.config.cjs`:
- `server-panel-api` (port 3500) — now also hosts `core/aurex` engine (no extra port)
- `aurex-worker` (host mode, `AUREX_HOST_MODE=true`) — can be merged into `server-panel-api` as a worker thread or kept as `aurex-worker` but managed by the same PM2 + `update-env`
- `aurex-api` (4010) becomes optional — only for heavy coding offload

Phase 1 keeps `aurex-api` + `aurex-worker` as PM2 alongside `server-panel-api` for compatibility, but `server-panel/backend/src/core/aurex` is the authoritative facade. Frontend continues to hit `/api/aurex/*` (now served natively under `/api/v1/aurex`).

## Phased Plan

**Phase 1 (this PR):** Scaffold `backend/src/core/aurex/` (engine/service/tools/prompts/index), refactor `backend/src/routes/aurex.js` to facade core for `server-context`/`tools`/`capabilities` and keep proxy fallback, wire `lib/exec` host handling, document architecture here. No DB migration.

**Phase 2:** Move `aurex/packages/docker` host exec and `aurex/packages/shared` prompts into `backend/src/core/aurex` as native libs, make BullMQ optional (in-memory queue for infra audits), unify `panel-users.json` ↔ `aurex User` auth.

**Phase 3:** Optional monorepo merge — `server-panel` + `aurex` in one `pnpm` workspace, single `docker-compose.yml` (postgres + redis), single `npm run dev`.

## Verification

- `curl /api/aurex/server-context` returns live host snapshot (pm2/docker/services/nginx/updates) without calling `localhost:4010`
- `curl /api/aurex/tools` lists 38 panel tools
- Frontend `Aurex.jsx` chat creates runs via `core/aurex` host exec and streams events, no `{"part":{"type":"step-finish"}}` leak, todos as text strike-through, questions sequential
- `pm2 logs aurex-worker --lines 20` shows `[docker] HOST MODE enabled` and `ss -tlnp | grep 8080` returns `filebrowser` in one call
