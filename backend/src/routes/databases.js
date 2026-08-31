import { Router } from 'express';
import { run, isSafeIdentifier } from '../lib/exec.js';
import { runAsync } from '../lib/execAsync.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';
import { dbGauge } from '../lib/metrics.js';

const router = Router();

// PostgreSQL helpers
const PG_SERVERS = [
  { label: 'PostgreSQL 14', port: 5432, cluster: '14/main' },
  { label: 'PostgreSQL 17', port: 5433, cluster: '17/main' },
];

function pgCmd(cluster, sql) {
  const port = cluster === '17/main' ? 5433 : 5432;
  return run(`su postgres -c ${JSON.stringify(`psql -p ${port} -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)} 2>&1`)}`, { sudo: true });
}

function pgList(cluster) {
  const port = cluster === '17/main' ? 5433 : 5432;
  try {
    const out = run(`su postgres -c ${JSON.stringify(`psql -p ${port} -t -A -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;" 2>&1`)}`, { sudo: true });
    return out.trim().split('\n').filter(Boolean).filter(l => !l.includes('could not') && !l.includes('password'));
  } catch (e) { return []; }
}

function pgUsers(cluster) {
  const port = cluster === '17/main' ? 5433 : 5432;
  try {
    const out = run(`su postgres -c ${JSON.stringify(`psql -p ${port} -t -A -c "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname != 'postgres' ORDER BY rolname;" 2>&1`)}`, { sudo: true });
    return out.trim().split('\n').filter(Boolean).filter(l => !l.includes('could not') && !l.includes('password') && !l.includes('ERROR'));
  } catch (e) { return []; }
}

router.get('/postgres', async (req, res) => {
  try {
    // parallelize per-cluster queries via async
    const servers = await Promise.all(PG_SERVERS.map(async s => {
      const [dbs, users] = await Promise.all([
        (async () => { try { return pgList(s.cluster); } catch { return []; } })(),
        (async () => { try { return pgUsers(s.cluster); } catch { return []; } })(),
      ]);
      dbGauge.set({ cluster: s.cluster }, dbs.length);
      return { ...s, databases: dbs, users };
    }));
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create database
router.post('/postgres/databases', requireRole('admin', 'operator'), validateBody(schemas.createDatabase), (req, res) => {
  const { name, cluster = '17/main' } = req.validated;
  try {
    const out = pgCmd(cluster, `CREATE DATABASE "${name}"`);
    req.audit?.('db.create', `postgres/${cluster}/${name}`, { cluster });
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    req.audit?.('db.create', `postgres/${cluster}/${name}`, { cluster, error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to create database: ${err.message}` });
  }
});

// Drop database
router.delete('/postgres/databases/:name', requireRole('admin'), (req, res) => {
  const { name } = req.params;
  const { cluster = '17/main' } = req.query;
  if (!isSafeIdentifier(name)) return res.status(400).json({ error: 'Invalid database name' });
  try {
    pgCmd(cluster, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid();`);
    const out = pgCmd(cluster, `DROP DATABASE IF EXISTS "${name}"`);
    req.audit?.('db.drop', `postgres/${cluster}/${name}`, { cluster });
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    req.audit?.('db.drop', `postgres/${cluster}/${name}`, { cluster, error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to drop database: ${err.message}` });
  }
});

// Create user / role
router.post('/postgres/users', requireRole('admin'), validateBody(schemas.createUser), (req, res) => {
  const { name, password, cluster = '17/main' } = req.validated;
  try {
    const out = pgCmd(cluster, `CREATE USER "${name}" WITH PASSWORD '${password.replace(/'/g, "''")}'`);
    req.audit?.('db.create_user', `postgres/${cluster}/${name}`, { cluster });
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    req.audit?.('db.create_user', `postgres/${cluster}/${name}`, { cluster, error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to create user: ${err.message}` });
  }
});

// Drop user
router.delete('/postgres/users/:name', requireRole('admin'), (req, res) => {
  const { name } = req.params;
  const { cluster = '17/main' } = req.query;
  if (!isSafeIdentifier(name)) return res.status(400).json({ error: 'Invalid username' });
  try {
    pgCmd(cluster, `REASSIGN OWNED BY "${name}" TO postgres;`);
    pgCmd(cluster, `DROP OWNED BY "${name}";`);
    const out = pgCmd(cluster, `DROP ROLE IF EXISTS "${name}"`);
    req.audit?.('db.drop_user', `postgres/${cluster}/${name}`, { cluster });
    res.json({ success: true, output: out.trim(), name });
  } catch (err) {
    req.audit?.('db.drop_user', `postgres/${cluster}/${name}`, { cluster, error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to drop user: ${err.message}` });
  }
});

// Grant privileges
router.post('/postgres/grant', requireRole('admin'), validateBody(schemas.grant), (req, res) => {
  const { database, user, privileges = 'ALL', cluster = '17/main' } = req.validated;
  try {
    const out = pgCmd(cluster, `GRANT ${privileges} ON DATABASE "${database}" TO "${user}"`);
    const schema = pgCmd(cluster, `GRANT ALL ON SCHEMA public TO "${user}"`);
    req.audit?.('db.grant', `postgres/${cluster}/${database}`, { user, privileges });
    res.json({ success: true, output: `${out.trim()}\n${schema.trim()}`, database, user });
  } catch (err) {
    req.audit?.('db.grant', `postgres/${cluster}/${database}`, { user, error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to grant: ${err.message}` });
  }
});

// Redis
router.get('/redis', (req, res) => {
  try {
    const info = run('redis-cli info server 2>&1', {});
    const clients = run('redis-cli info clients 2>&1', {});
    const memory = run('redis-cli info memory 2>&1', {});
    const stats = run('redis-cli info stats 2>&1', {});
    const getVal = (raw, key) => {
      const match = raw.split('\n').find(l => l.startsWith(`${key}:`));
      return match ? match.split(':')[1]?.trim() : null;
    };
    res.json({
      port: 6379,
      version: getVal(info, 'redis_version'),
      connectedClients: parseInt(getVal(clients, 'connected_clients') || '0'),
      usedMemory: parseInt(getVal(memory, 'used_memory') || '0'),
      totalCommands: parseInt(getVal(stats, 'total_commands_processed') || '0'),
      uptimeSeconds: parseInt(getVal(info, 'uptime_in_seconds') || '0'),
      keys: parseInt(getVal(stats, 'total_keys') || '0') || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Flush redis
router.post('/redis/flush', requireRole('admin', 'operator'), (req, res) => {
  try {
    const out = run('redis-cli flushall 2>&1', {});
    req.audit?.('db.redis_flush', 'redis', {});
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Memcached
router.get('/memcached', (req, res) => {
  try {
    const stats = run('echo "stats" | nc -q 1 localhost 11211 2>&1', {});
    if (!stats.includes('STAT')) return res.json({ port: 11211, pid: 0, currItems: 0, totalItems: 0, bytes: 0, currConnections: 0, running: false, error: 'Memcached not running' });
    const getStat = (key) => {
      const match = stats.split('\n').find(l => l.includes(`STAT ${key}`));
      return match ? match.split(/\s+/)[2] : null;
    };
    res.json({
      port: 11211,
      pid: parseInt(getStat('pid') || '0'),
      currItems: parseInt(getStat('curr_items') || '0'),
      totalItems: parseInt(getStat('total_items') || '0'),
      bytes: parseInt(getStat('bytes') || '0'),
      currConnections: parseInt(getStat('curr_connections') || '0'),
      running: true,
    });
  } catch (err) {
    res.json({ port: 11211, pid: 0, currItems: 0, totalItems: 0, bytes: 0, currConnections: 0, running: false, error: err.message });
  }
});

// RabbitMQ
router.get('/rabbitmq', (req, res) => {
  try {
    const output = run('rabbitmqctl status 2>&1', {});
    const running = output.includes('"running"') || output.includes('pid');
    if (!running) return res.json({ port: 5672, managementPort: 15672, running: false, queuesRaw: '', error: 'RabbitMQ not running' });
    const queues = run('rabbitmqctl list_queues name messages consumers 2>&1', {});
    res.json({ port: 5672, managementPort: 15672, running, queuesRaw: queues });
  } catch (err) {
    res.json({ port: 5672, managementPort: 15672, running: false, queuesRaw: '', error: err.message });
  }
});

// Ollama
router.get('/ollama', (req, res) => {
  try {
    const output = run('curl -s --max-time 3 http://localhost:11434/api/tags 2>&1', {});
    const data = JSON.parse(output);
    res.json({ port: 11434, models: data.models || [], running: true });
  } catch (err) {
    res.json({ port: 11434, models: [], running: false, error: 'Ollama not running or not installed' });
  }
});

export default router;
