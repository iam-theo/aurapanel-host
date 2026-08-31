import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'panel_' });

export const httpDuration = new client.Histogram({
  name: 'panel_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const httpCounter = new client.Counter({
  name: 'panel_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const auditCounter = new client.Counter({
  name: 'panel_audit_events_total',
  help: 'Audit events',
  labelNames: ['action', 'status'],
});

export const backupGauge = new client.Gauge({
  name: 'panel_backups_total',
  help: 'Number of backup files',
});

export const dbGauge = new client.Gauge({
  name: 'panel_postgres_databases',
  help: 'Number of Postgres databases per cluster',
  labelNames: ['cluster'],
});

export const register = client.register;

export function metricsMiddleware(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    end(labels);
    httpCounter.inc(labels);
  });
  next();
}
