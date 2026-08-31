# ServerPanel

A full-stack web server control panel for this Linux server, replicating the **Hostinger** style and layout. Dark theme, resource monitoring, PM2/Docker/DB management — all backed by a live REST API that reads real system state.

## Stack

| Layer     | Tech                                                       |
|-----------|------------------------------------------------------------|
| Backend   | Node.js + Express (REST API, `systeminformation`, exec)    |
| Frontend  | React 18 + Vite + Tailwind CSS + Recharts + Lucide icons   |
| Run       | PM2-compatible, or manual via `start.sh`                   |

## Quick Start

```bash
./start.sh
```

- Frontend → **http://localhost:5180**
- Backend API → **http://localhost:3500/api**
- Health check → `curl http://localhost:3500/api/health`

## Layout

```
server-panel/
├── backend/            # Express REST API
│   └── src/
│       ├── index.js            # app entry, CORS, mounts routes
│       └── routes/
│           ├── system.js       # CPU/mem/disk/network/processes
│           ├── pm2.js          # PM2 app list + start/stop/restart/delete/logs
│           ├── docker.js       # containers/images/networks/volumes + control
│           ├── databases.js    # PostgreSQL/Redis/Memcached/RabbitMQ/Ollama
│           ├── nginx.js        # sites, configs, reload, status
│           ├── services.js     # systemd services control
│           └── files.js        # file browser / editor
└── frontend/           # React + Vite + Tailwind UI
    └── src/
        ├── components/  # Sidebar layout, shared UI
        ├── pages/       # Dashboard, Processes, Applications, Containers,
        │                # Databases, Domains, Files, Services, Settings
        └── lib/         # api client + utils
```

## Features

- **Overview** — live CPU/mem/disk gauges, CPU history chart, network throughput, uptime
- **Processes** — top 25 by CPU, searchable, with state badges
- **Applications** — full PM2 management: deploy new app (blank or git clone), start/stop/restart/delete, logs, metrics, cluster mode
- **Containers** — Docker containers/images/networks/volumes: create container (image, ports, env, network), deploy docker-compose.yml, start/stop/restart/remove, logs
- **Databases** — PostgreSQL (create/drop databases + users/roles + grant), Redis (info + flush), Memcached, RabbitMQ, Ollama
- **Domains** — create/delete/enable/disable nginx sites with auto-generated config (PHP/HSTS/proxy), config viewer, reload
- **Backups** — create database & directory backups, list, download, restore, delete
- **Cron Jobs** — create/delete/run crontab jobs for the current user with schedule presets
- **SSH Keys & Users** — add/remove authorized SSH keys, list system users
- **File Manager** — browse / read / write / create / delete across the FS
- **Services** — systemd start/stop/restart/enable/disable
- **Settings** — server, security, notifications, backups, network, profile

## Management & Privileges

The backend runs as `digital-auracle` (groups: `sudo`, `docker`, `www-data`, `ollama`). Verified **working now** (real create/remove against the live server):

- **PM2 deploy** — creates app dir + package.json + starter `index.js` (express), runs `npm install`, starts via cluster mode. Working (tested on port 9091).
- **Docker create/remove/compose** — works via the `docker` group (no sudo needed). Working.
- **Cron create/delete/run** — writes the user crontab. Working.
- **Backups (directory)** — `tar` into `/home/digital-auracle/backups`, list/download/delete. Working.
- **SSH keys** — add/remove in `~/.ssh/authorized_keys`. Working.
- **nginx sites** — needs root (writes to `/etc/nginx`). Code is wired and falls back to direct writes; whether it applies depends on sudo availability.

**Limitation — PostgreSQL database create/drop/backup needs superuser** (the system PG clusters on 5432/5433 use password auth and `sudo` requires a password on this box). The API returns a clear message when elevation is unavailable. To enable real DB management, either:
1. Grant passwordless sudo for the panel user, e.g. `/etc/sudoers.d/serverpanel`: `digital-auracle ALL=(ALL) NOPASSWD:ALL`
2. Or supply the `postgres` role password (then swap the `pgCmd` helper to use `PGPASSWORD` instead of `sudo -u postgres`).

## API Reference

| Method | Path                      | Description                      |
|--------|---------------------------|----------------------------------|
| GET    | `/api/system/overview`    | CPU, mem, disk, os, network      |
| GET    | `/api/system/processes`   | Top processes                    |
| POST   | `/api/pm2`                | Deploy a new app (blank or git)  |
| GET    | `/api/pm2`                | PM2 process list                 |
| POST   | `/api/pm2/:name/:op`      | start/stop/restart/delete/deploy |
| GET    | `/api/pm2/:name/logs`     | App logs                         |
| GET/POST| `/api/docker/containers` | List / create containers       |
| POST   | `/api/docker/containers/:id/:action` | start/stop/restart/... |
| DELETE | `/api/docker/containers/:id` | Remove container             |
| POST   | `/api/docker/compose/deploy` | Deploy docker-compose.yml   |
| GET/POST| `/api/databases/postgres/*` | List/Create/Drop databases, users, grants |
| POST   | `/api/databases/redis/flush` | Flush Redis                  |
| GET/POST| `/api/nginx/sites`      | List / create sites            |
| DELETE | `/api/nginx/sites/:name` | Delete site                    |
| POST   | `/api/nginx/sites/:name/:action` | enable/disable            |
| POST   | `/api/nginx/reload`      | Reload nginx                    |
| GET/POST| `/api/backups/*`       | List / create backups          |
| POST   | `/api/backups/restore/*` | Restore database/directory    |
| DELETE | `/api/backups/:name`     | Delete backup                   |
| GET/POST| `/api/cron`            | List / create cron jobs        |
| DELETE | `/api/cron/:id`         | Delete cron job                 |
| POST   | `/api/cron/:id/run`     | Run job now                      |
| GET/POST/DELETE | `/api/users/ssh-keys` | List/add/remove SSH keys     |
| GET    | `/api/users/users`       | List system users               |
| GET    | `/api/services`          | systemd services status         |
| POST   | `/api/services/:name/:op`| start/stop/restart/enable/disable |
