import { z } from 'zod';

export const schemas = {
  // nginx
  createSite: z.object({
    name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid site name'),
    serverName: z.string().min(1).max(253),
    root: z.string().max(512).optional(),
    php: z.boolean().optional(),
    hsts: z.boolean().optional(),
    proxy_pass: z.string().max(512).optional(),
  }),
  siteAction: z.enum(['enable', 'disable']),

  // postgres
  createDatabase: z.object({
    name: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/, 'Invalid database name'),
    cluster: z.enum(['14/main', '17/main']).optional(),
  }),
  dropDatabase: z.object({
    cluster: z.enum(['14/main', '17/main']).optional(),
  }),
  createUser: z.object({
    name: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/, 'Invalid username'),
    password: z.string().min(8).max(128),
    cluster: z.enum(['14/main', '17/main']).optional(),
  }),
  grant: z.object({
    database: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/),
    user: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/),
    privileges: z.string().max(64).optional(),
    cluster: z.enum(['14/main', '17/main']).optional(),
  }),

  // pm2
  deployApp: z.object({
    name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    port: z.number().int().min(1024).max(65535).optional(),
    instances: z.number().int().min(1).max(16).optional(),
    repo: z.string().url().optional().or(z.literal('')),
    branch: z.string().max(128).optional(),
  }),

  // docker
  createContainer: z.object({
    image: z.string().min(1).max(256),
    name: z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(),
    ports: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    network: z.string().max(64).optional(),
    restart: z.enum(['no', 'always', 'unless-stopped', 'on-failure']).optional(),
  }),
  composeDeploy: z.object({
    name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
    compose: z.string().min(10).max(100000),
  }),

  // backups
  createDbBackup: z.object({
    database: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_.-]+$/),
    cluster: z.enum(['pg14', 'pg17', '14/main', '17/main']).optional(),
    label: z.string().max(64).optional(),
  }),
  restoreDbBackup: z.object({
    filename: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.-]+$/),
    database: z.string().min(1).max(63).regex(/^[a-zA-Z0-9_]+$/),
    cluster: z.enum(['pg14', 'pg17', '14/main', '17/main']).optional(),
  }),

  // cron
  createCron: z.object({
    schedule: z.string().min(9).max(64),
    command: z.string().min(1).max(1024),
    label: z.string().max(128).optional(),
  }),

  // ssh
  addSshKey: z.object({
    pubkey: z.string().min(20).max(8192),
  }),

  // files
  writeFile: z.object({
    path: z.string().min(1).max(1024),
    content: z.string().max(5 * 1024 * 1024),
  }),

  // services
  serviceAction: z.enum(['start', 'stop', 'restart', 'enable', 'disable', 'reload']),

  // auth
  login: z.object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(128),
  }),
  createPanelUser: z.object({
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
    password: z.string().min(8).max(128),
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
  }),
};

function formatZodError(err) {
  const issues = err.issues || err.errors || [];
  return issues.map(e => `${(e.path || []).join('.')}: ${e.message}`).join('; ');
}

export function validate(schema) {
  return (req, res, next) => {
    const data = { ...req.body, ...req.params, ...req.query };
    const toValidate = req.method === 'GET' ? { ...req.query, ...req.params } : { ...req.body, ...req.params };
    const result = schema.safeParse(req.body && Object.keys(req.body).length ? req.body : toValidate);
    if (!result.success) {
      return res.status(400).json({ error: formatZodError(result.error) });
    }
    req.validated = result.data;
    next();
  };
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: formatZodError(result.error) });
    }
    req.validated = result.data;
    next();
  };
}
