import { Router } from 'express';
import { readFileSync, writeFileSync, unlinkSync, chmodSync, chownSync } from 'fs';
import os from 'os';
import { join } from 'path';
import { run, isSafeIdentifier } from '../lib/exec.js';
import { runAsync } from '../lib/execAsync.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';
import { dbGauge } from '../lib/metrics.js';

const router = Router();

// SQL is passed to clients via temp files (never the shell command line),
// so passwords and quoted identifiers can't break shell quoting — and never
// show up in `ps` output.
function sqlFile(sql) {
  const p = join(os.tmpdir(), `panel-sql-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sql`);
  writeFileSync(p, sql, { mode: 0o600 });
  return p;
}

function postgresIds() {
  try {
    const line = readFileSync('/etc/passwd', 'utf-8').split('\n').find(l => l.startsWith('postgres:'));
    if (!line) return null;
    const [, , uid, gid] = line.split(':');
    return { uid: parseInt(uid, 10), gid: parseInt(gid, 10) };
  } catch { return null; }
}

// PostgreSQL helpers — clusters discovered live via pg_lsclusters so the
// panel works regardless of which major versions are installed/online.
const PG_SERVERS_FALLBACK = [
  { label: 'PostgreSQL 14', port: 5432, cluster: '14/main' },
  { label: 'PostgreSQL 17', port: 5433, cluster: '17/main' },
];

function pgClusters() {
  try {
    const out = run('pg_lsclusters 2>&1', {});
    return out.trim().split('\n').slice(1).filter(Boolean).map(line => {
      const [ver, name, port, status, owner] = line.trim().split(/\s+/);
      if (!ver || !name || ver === 'Ver') return null;
      return { version: ver, cluster: `${ver}/${name}`, port: parseInt(port, 10) || 5432, status: status || 'unknown', owner: owner || '' };
    }).filter(Boolean);
  } catch { return []; }
}

function pgServers() {
  const live = pgClusters();
  if (live.length) {
    return live.map(c => ({
      label: `PostgreSQL ${c.version}`,
      port: c.port,
      cluster: c.cluster,
      status: c.status,
    }));
  }
  return PG_SERVERS_FALLBACK.map(s => ({ ...s, status: 'unknown' }));
}

function pgPort(cluster) {
  const hit = pgClusters().find(c => c.cluster === cluster);
  if (hit) return hit.port;
  return cluster === '17/main' ? 5433 : 5432;
}

function defaultCluster() {
  const live = pgClusters();
  const online = live.find(c => c.status === 'online');
  if (online) return online.cluster;
  if (live.length) return live[0].cluster;
  return '14/main';
}

function pgCmd(cluster, sql, extraFlags = '') {
  const port = pgPort(cluster);
  const f = sqlFile(sql);
  try {
    const ids = postgresIds();
    try { if (ids) chownSync(f, ids.uid, ids.gid); else chmodSync(f, 0o644); } catch {}
    return run(`su postgres -c "psql -p ${port} -v ON_ERROR_STOP=1 ${extraFlags} -f ${f} 2>&1"`, { sudo: true });
  } finally { try { unlinkSync(f); } catch {} }
}

function pgList(cluster) {
  try {
    const out = pgCmd(cluster, 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;', '-t -A');
    return out.trim().split('\n').filter(Boolean).filter(l => !l.includes('could not') && !l.includes('password'));
  } catch (e) { return []; }
}

function pgUsers(cluster) {
  try {
    const out = pgCmd(cluster, "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname != 'postgres' ORDER BY rolname;", '-t -A');
    return out.trim().split('\n').filter(Boolean).filter(l => !l.includes('could not') && !l.includes('password') && !l.includes('ERROR'));
  } catch (e) { return []; }
}

router.get('/postgres', async (req, res) => {
  try {
    // parallelize per-cluster queries via async
    const servers = await Promise.all(pgServers().map(async s => {
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
  const { name, cluster = defaultCluster() } = req.validated;
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
  const { cluster = defaultCluster() } = req.query;
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
  const { name, password, cluster = defaultCluster() } = req.validated;
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
  const { cluster = defaultCluster() } = req.query;
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
  const { database, user, privileges = 'ALL', cluster = defaultCluster() } = req.validated;
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

// ---------- MySQL / MariaDB (root via unix_socket, no password needed) ----------
function myQuery(sql) {
  const f = sqlFile(sql);
  try {
    return run(`mysql -u root -N -B < ${f} 2>&1`, {});
  } finally { try { unlinkSync(f); } catch {} }
}

function mysqlStatus() {
  const st = { running: false, version: null };
  try {
    const active = run('systemctl is-active mariadb mysql 2>&1 || true', {}).trim().split('\n');
    st.running = active.some(l => l.trim() === 'active');
  } catch {}
  try {
    const v = myQuery('SELECT VERSION();').trim().split('\n').filter(Boolean)[0];
    if (v && !/ERROR/i.test(v)) { st.version = v; st.running = true; }
  } catch {}
  return st;
}

router.get('/mysql', (req, res) => {
  const st = mysqlStatus();
  if (!st.running) return res.json({ running: false, version: st.version, databases: [], users: [] });
  try {
    const dbs = myQuery(`SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','sys') ORDER BY SCHEMA_NAME;`)
      .trim().split('\n').filter(Boolean).map(name => ({ name }));
    const sizes = myQuery(`SELECT table_schema, SUM(data_length + index_length) FROM information_schema.TABLES GROUP BY table_schema;`)
      .trim().split('\n').filter(Boolean);
    const sizeByDb = {};
    for (const line of sizes) {
      const [db, bytes] = line.split('\t');
      if (db) sizeByDb[db] = parseInt(bytes, 10) || 0;
    }
    const users = myQuery(`SELECT CONCAT(User, '@', Host) FROM mysql.user WHERE User != '' ORDER BY User, Host;`)
      .trim().split('\n').filter(Boolean).map(u => {
        const [user, host] = u.split('@');
        return { user, host: host || '' };
      });
    res.json({ running: true, version: st.version, databases: dbs.map(d => ({ ...d, size: sizeByDb[d.name] || 0 })), users });
  } catch (err) {
    res.json({ running: true, version: st.version, databases: [], users: [], error: String(err.message).slice(0, 300) });
  }
});

router.post('/mysql/databases', requireRole('admin', 'operator'), validateBody(schemas.createDatabase), (req, res) => {
  const { name } = req.validated;
  if (!isSafeIdentifier(name)) return res.status(400).json({ error: 'Invalid database name' });
  try {
    myQuery(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    req.audit?.('db.create', `mysql/${name}`, {});
    res.json({ success: true, name });
  } catch (err) {
    req.audit?.('db.create', `mysql/${name}`, { error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to create database: ${String(err.message).slice(0, 500)}` });
  }
});

router.delete('/mysql/databases/:name', requireRole('admin'), (req, res) => {
  const { name } = req.params;
  if (!isSafeIdentifier(name)) return res.status(400).json({ error: 'Invalid database name' });
  try {
    myQuery(`DROP DATABASE IF EXISTS \`${name}\`;`);
    req.audit?.('db.drop', `mysql/${name}`, {});
    res.json({ success: true, name });
  } catch (err) {
    req.audit?.('db.drop', `mysql/${name}`, { error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to drop database: ${String(err.message).slice(0, 500)}` });
  }
});

router.post('/mysql/users', requireRole('admin'), validateBody(schemas.createMysqlUser), (req, res) => {
  const { name, password, host = '%' } = req.validated;
  if (!isSafeIdentifier(name)) return res.status(400).json({ error: 'Invalid username' });
  if (!/^[a-zA-Z0-9_.%-]+$/.test(host)) return res.status(400).json({ error: 'Invalid host' });
  try {
    myQuery(`CREATE USER '${name}'@'${host}' IDENTIFIED BY ${JSON.stringify(password)};`);
    req.audit?.('db.create_user', `mysql/${name}@${host}`, {});
    res.json({ success: true, name, host });
  } catch (err) {
    req.audit?.('db.create_user', `mysql/${name}@${host}`, { error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to create user: ${String(err.message).slice(0, 500)}` });
  }
});

router.delete('/mysql/users/:name', requireRole('admin'), (req, res) => {
  const { name } = req.params;
  const host = String(req.query.host || '%');
  if (!isSafeIdentifier(name) || !/^[a-zA-Z0-9_.%-]+$/.test(host)) return res.status(400).json({ error: 'Invalid user' });
  try {
    myQuery(`DROP USER IF EXISTS '${name}'@'${host}';`);
    req.audit?.('db.drop_user', `mysql/${name}@${host}`, {});
    res.json({ success: true, name, host });
  } catch (err) {
    req.audit?.('db.drop_user', `mysql/${name}@${host}`, { error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to drop user: ${String(err.message).slice(0, 500)}` });
  }
});

// ---------- MongoDB (no-auth localhost; defensive when down) ----------
function mongoEval(js) {
  return run(`mongosh --quiet --eval ${JSON.stringify(js)} 2>&1`, { timeout: 15000 });
}

function mongoStatus() {
  const st = { running: false, version: null };
  try {
    const active = run('systemctl is-active mongod 2>&1 || true', {}).trim();
    st.running = active.split('\n').some(l => l.trim() === 'active');
  } catch {}
  try {
    const v = mongoEval('db.version()').trim().split('\n').filter(Boolean).pop();
    if (v && /^\d+\./.test(v)) { st.version = v; st.running = true; }
  } catch {}
  return st;
}

router.get('/mongo', (req, res) => {
  const st = mongoStatus();
  if (!st.running) return res.json({ running: false, version: st.version, databases: [] });
  try {
    const out = mongoEval('JSON.stringify(db.adminCommand("listDatabases").databases)');
    const line = out.trim().split('\n').filter(Boolean).pop();
    const list = JSON.parse(line);
    res.json({
      running: true,
      version: st.version,
      databases: (Array.isArray(list) ? list : []).map(d => ({ name: d.name, size: d.sizeOnDisk || 0 })),
    });
  } catch (err) {
    res.json({ running: true, version: st.version, databases: [], error: String(err.message).slice(0, 300) });
  }
});

router.post('/mongo/start', requireRole('admin', 'operator'), (req, res) => {
  try {
    const out = run('sudo systemctl start mongod 2>&1', {});
    req.audit?.('service.start', 'mongod', {});
    res.json({ success: true, output: out.trim().slice(0, 500) });
  } catch (err) {
    req.audit?.('service.start', 'mongod', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

router.delete('/mongo/databases/:name', requireRole('admin'), (req, res) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name || '') || ['admin', 'local', 'config'].includes(name)) {
    return res.status(400).json({ error: 'Invalid or protected database name' });
  }
  try {
    mongoEval(`db.getSiblingDB(${JSON.stringify(name)}).dropDatabase()`);
    req.audit?.('db.drop', `mongo/${name}`, {});
    res.json({ success: true, name });
  } catch (err) {
    req.audit?.('db.drop', `mongo/${name}`, { error: err.message }, 'failure');
    res.status(400).json({ error: `Failed to drop database: ${String(err.message).slice(0, 500)}` });
  }
});

export default router;
