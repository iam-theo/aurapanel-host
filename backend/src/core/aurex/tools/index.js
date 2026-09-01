/**
 * Panel tools manifest — single source of truth for Aurex core.
 * Imported by routes/aurex.js and by the engine for host execution.
 */
export const PANEL_TOOLS = [
  { id: 'system.overview', method: 'GET', path: '/api/system/overview', desc: 'CPU/mem/disk/os/network' },
  { id: 'system.processes', method: 'GET', path: '/api/system/processes', desc: 'Top 25 processes' },
  { id: 'system.cpu-history', method: 'GET', path: '/api/system/cpu-history', desc: 'Per-core CPU load' },
  { id: 'pm2.list', method: 'GET', path: '/api/pm2', desc: 'List PM2 apps + status/mem/cpu' },
  { id: 'pm2.deploy', method: 'POST', path: '/api/pm2', desc: 'Deploy new Node app (blank or git clone)' },
  { id: 'pm2.action', method: 'POST', path: '/api/pm2/:name/:op', desc: 'start/stop/restart/delete/deploy for app' },
  { id: 'pm2.logs', method: 'GET', path: '/api/pm2/:name/logs', desc: 'App logs tail' },
  { id: 'docker.containers', method: 'GET', path: '/api/docker/containers', desc: 'List containers' },
  { id: 'docker.create', method: 'POST', path: '/api/docker/containers', desc: 'Create container (image, ports, env)' },
  { id: 'docker.action', method: 'POST', path: '/api/docker/containers/:id/:action', desc: 'start/stop/restart/...' },
  { id: 'docker.logs', method: 'GET', path: '/api/docker/containers/:id/logs', desc: 'Container logs' },
  { id: 'docker.images', method: 'GET', path: '/api/docker/images', desc: 'List images' },
  { id: 'docker.stats', method: 'GET', path: '/api/docker/stats', desc: 'Live CPU/mem per container' },
  { id: 'databases.postgres', method: 'GET', path: '/api/databases/postgres', desc: 'PG clusters, dbs, users' },
  { id: 'databases.redis', method: 'GET', path: '/api/databases/redis', desc: 'Redis info' },
  { id: 'nginx.sites', method: 'GET', path: '/api/nginx/sites', desc: 'Nginx sites + enabled state' },
  { id: 'nginx.create', method: 'POST', path: '/api/nginx/sites', desc: 'Create nginx site' },
  { id: 'nginx.reload', method: 'POST', path: '/api/nginx/reload', desc: 'Reload nginx' },
  { id: 'files.browse', method: 'GET', path: '/api/files?path=...', desc: 'Browse filesystem' },
  { id: 'files.read', method: 'GET', path: '/api/files/read?path=...', desc: 'Read file (<5MB)' },
  { id: 'files.write', method: 'POST', path: '/api/files/write', desc: 'Write file' },
  { id: 'services.list', method: 'GET', path: '/api/services', desc: 'systemd services status' },
  { id: 'services.action', method: 'POST', path: '/api/services/:name/:op', desc: 'start/stop/restart/enable/disable' },
  { id: 'backups.list', method: 'GET', path: '/api/backups', desc: 'List backups' },
  { id: 'backups.create', method: 'POST', path: '/api/backups/directory', desc: 'Create dir/db backup' },
  { id: 'cron.list', method: 'GET', path: '/api/cron', desc: 'List crontab jobs' },
  { id: 'cron.create', method: 'POST', path: '/api/cron', desc: 'Create cron job' },
  { id: 'packages.marketplace', method: 'GET', path: '/api/packages/marketplace', desc: '80+ installable packages' },
  { id: 'packages.install', method: 'POST', path: '/api/packages/install', desc: 'Install marketplace package' },
  { id: 'logs.tail', method: 'GET', path: '/api/logs/file?path=...', desc: 'Tail any log file' },
  { id: 'logs.journal', method: 'GET', path: '/api/logs/journal?unit=...', desc: 'journalctl' },
  { id: 'logs.pm2', method: 'GET', path: '/api/logs/pm2/:name', desc: 'PM2 aggregated logs' },
  { id: 'logs.docker', method: 'GET', path: '/api/logs/docker/:id', desc: 'Docker container logs' },
  { id: 'logs.search', method: 'GET', path: '/api/logs/search?q=...', desc: 'Grep across /var/log' },
  { id: 'updates.check', method: 'GET', path: '/api/updates', desc: 'Pending apt updates' },
  { id: 'updates.upgrade', method: 'POST', path: '/api/updates/upgrade', desc: 'Run apt upgrade' },
  { id: 'health.detailed', method: 'GET', path: '/api/health/detailed', desc: 'pm2/docker/pg/nginx checks' },
  { id: 'metrics', method: 'GET', path: '/api/metrics', desc: 'Prometheus metrics' },
];

export function getCapabilities() {
  return {
    server: 'ServerPanel',
    layer: 'core/aurex',
    capabilities: ['monitor:apps', 'monitor:services', 'monitor:logs', 'monitor:updates', 'control:pm2', 'control:docker', 'control:nginx', 'control:services', 'control:files', 'control:cron', 'control:backups', 'control:packages'],
    tools: PANEL_TOOLS.length,
    endpoints: {
      serverContext: '/api/aurex/server-context',
      tools: '/api/aurex/tools',
      hostPaths: '/api/aurex/host-paths',
      logs: '/api/logs',
      updates: '/api/updates',
      system: '/api/system/overview',
      health: '/api/health/detailed',
    },
  };
}
