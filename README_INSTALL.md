# ServerPanel — Installer (aaPanel-like)

One command installs the panel on **any Ubuntu/Debian/RHEL/Rocky/Alma** server, like aaPanel.

## 1-line install (remote)

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/server-panel/main/install.sh | sudo bash
# with custom repo/branch:
curl -fsSL https://.../install.sh | sudo REPO_URL=https://github.com/you/panel.git BRANCH=main bash
```

## Local install (this checkout)

```bash
cd /home/digital-auracle/server-panel
sudo bash install.sh
# custom dir/user/ports:
sudo PANEL_DIR=/opt/server-panel PANEL_USER=panel PANEL_WEB_PORT=5180 PANEL_PORT=3500 bash install.sh
```

What it does (idempotent):
1. Detects OS (`apt` vs `yum`), installs `curl git nginx nodejs(20) pm2`
2. Creates `panel` user + `sudoers.d/panel-panel` NOPASSWD for `systemctl/nginx/docker/pg`
3. Copies panel to `/opt/server-panel`, `chown panel:panel`
4. Generates `backend/.env` (600) with `JWT_SECRET`, `PANEL_ADMIN_USER/PASS` if not exists
5. `npm ci` backend + `npm ci && npm run build` frontend → `frontend/dist`
6. Writes `systemd` `panel-api.service` (`/etc/systemd/system/panel-api.service` → `systemctl enable --now panel-api`)
7. Writes nginx vhost `/etc/nginx/sites-available/panel` listening on `:5180` (SPA + `/api` proxy to `:3500`), `nginx -t && systemctl reload nginx`
8. Opens `ufw`/`firewalld` ports 3500/5180
9. Prints `http://<IP>:5180` + admin creds

## After install

- **Panel:** `http://<IP>:5180` (or `http://<IP>:8888` if you change `PANEL_WEB_PORT`)
- **API:** `http://<IP>:3500/api/health` (proxied as `/api/health` on 5180)
- **Logs:** `journalctl -u panel-api -f` , `cat /opt/server-panel/backend/logs/audit.log`
- **Users:** `panel` user home `/home/panel/{apps,backups,compose}` (or `$PANEL_HOME`)

## Env

`backend/.env` is the single source of truth — see `backend/.env.example`. Key knobs:

```
PORT=3500
PANEL_USER=panel
PANEL_HOME=/home/panel
PANEL_APPS_DIR=/home/panel/apps
PANEL_BACKUP_DIR=/home/panel/backups
PANEL_COMPOSE_DIR=/home/panel/compose
JWT_SECRET=<32-byte hex>
PANEL_ADMIN_USER=admin
PANEL_ADMIN_PASS=<your-pass>
BACKUP_RETENTION_DAYS=14
AUTH_DISABLED=false
```

All hardcoded `/home/digital-auracle` paths are now read from `backend/src/lib/config.js:1` (`PANEL_USER`, `APPS_DIR`, etc.) with fallback to current user, so the panel auto-aligns to whatever host it is installed on.

## Update

```bash
sudo bash /opt/server-panel/update.sh
# or from checkout:
sudo bash ./update.sh
# custom repo:
sudo REPO_URL=https://github.com/you/panel.git BRANCH=main bash /opt/server-panel/update.sh
```

## Uninstall (keeps user data)

```bash
sudo bash /opt/server-panel/uninstall.sh
# then optionally: sudo rm -rf /opt/server-panel && sudo userdel -r panel
```

## Docker alternative

```bash
docker build -t server-panel .
docker run -d -p 5180:5180 -p 3500:3500 -v panel-data:/opt/server-panel/backend/data server-panel
```

## Troubleshooting

- `nginx -t` fails → check `/etc/nginx/sites-available/panel` and `journalctl -u nginx`
- `panel-api` not starting → `cat /opt/server-panel/backend/.env` (600, must have `JWT_SECRET`), `journalctl -u panel-api -n 100`
- firewall → `sudo ufw allow 5180,3500/tcp` or `sudo firewall-cmd --add-port=5180/tcp --permanent && firewall-cmd --reload`
- TLS → `sudo certbot --nginx -d panel.example.com` (panel vhost is plain HTTP on 5180 by default)
