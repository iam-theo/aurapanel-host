import { Router } from 'express';
import { run, isSafeName } from '../lib/exec.js';
import { schemas, validateBody } from '../lib/validate.js';
import { requireRole } from '../lib/auth.js';

const router = Router();
const CRON_USER = 'digital-auracle';
const TMP_CRON = '/tmp/serverpanel-cron.txt';

function getCrontab() {
  try {
    const out = run(`crontab -u ${CRON_USER} -l 2>/dev/null`, {});
    return out.trim();
  } catch {
    return '';
  }
}

function parseCrontab(cronString) {
  const lines = cronString.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  return lines.map((line, i) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) {
      return { id: String(i + 1), raw: line.trim(), valid: false };
    }
    const [min, hour, dom, month, dow, ...cmd] = parts;
    return {
      id: String(i + 1),
      minute: min,
      hour,
      dayOfMonth: dom,
      month,
      dayOfWeek: dow,
      command: cmd.join(' '),
      raw: line.trim(),
      valid: true,
    };
  });
}

router.get('/', (req, res) => {
  try {
    const cron = getCrontab();
    res.json({ jobs: parseCrontab(cron), user: CRON_USER });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a cron job
router.post('/', requireRole('admin', 'operator'), validateBody(schemas.createCron), (req, res) => {
  const { schedule, minute, hour, dayOfMonth, month, dayOfWeek, command, label } = req.validated;

  try {
    let newLine;
    if (schedule) {
      newLine = `${schedule} ${command}`;
    } else {
      const m = minute ?? '*';
      const h = hour ?? '*';
      const d = dayOfMonth ?? '*';
      const mo = month ?? '*';
      const dow = dayOfWeek ?? '*';
      newLine = `${m} ${h} ${d} ${mo} ${dow} ${command}`;
    }

    // Add label comment
    const comment = label ? `# ${label}` : '';

    const current = getCrontab();
    const updated = current ? current + '\n' + (comment ? comment + '\n' : '') + newLine.trim() : newLine.trim();

    // Write to temp and install
    run(`printf '%s\\n' ${JSON.stringify(updated)} > ${TMP_CRON} && crontab -u ${CRON_USER} ${TMP_CRON} && rm -f ${TMP_CRON} 2>&1`, {});
    req.audit?.('cron.create', `cron/${newLine.trim().slice(0, 60)}`, { schedule: schedule || `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}` });
    res.json({ success: true, line: newLine.trim() });
  } catch (err) {
    req.audit?.('cron.create', 'cron', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Delete a cron job by index (1-based)
router.delete('/:id', requireRole('admin', 'operator'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return res.status(400).json({ error: 'Invalid job id' });
  try {
    const cron = getCrontab();
    const lines = cron.split('\n');
    const nonComment = lines.filter(l => l.trim() && !l.trim().startsWith('#'));
    if (id > nonComment.length) return res.status(404).json({ error: 'Job not found' });

    // Find the line index in the original (accounting for comment lines)
    let targetLine = null;
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() && !l.trim().startsWith('#')) {
        count++;
        if (count === id) {
          targetLine = i;
          break;
        }
      }
    }
    if (targetLine === null) return res.status(404).json({ error: 'Job not found' });

    // Also remove a comment directly above
    let deleteStart = targetLine;
    if (deleteStart > 0 && lines[deleteStart - 1].trim().startsWith('#')) {
      deleteStart = deleteStart - 1;
    }
    lines.splice(deleteStart, targetLine - deleteStart + 1);

    const updated = lines.join('\n').replace(/^\n+|\n+$/g, '');
    run(`printf '%s\\n' ${JSON.stringify(updated)} > ${TMP_CRON} && crontab -u ${CRON_USER} ${TMP_CRON} && rm -f ${TMP_CRON} 2>&1`, {});
    req.audit?.('cron.delete', `cron/${id}`, {});
    res.json({ success: true, id });
  } catch (err) {
    req.audit?.('cron.delete', `cron/${id}`, { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Test run a cron job
router.post('/:id/run', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const jobs = parseCrontab(getCrontab());
    const job = jobs.find(j => j.id === String(id));
    if (!job || !job.valid) return res.status(404).json({ error: 'Job not found' });
    const out = run(`bash -lc ${JSON.stringify(job.command)} 2>&1; echo "EXIT:$?"`, { timeout: 30000 });
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
