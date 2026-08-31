import { Router } from 'express';
import { run } from '../lib/exec.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

// Reboot the server
router.post('/reboot', requireRole('admin'), (req, res) => {
  try {
    req.audit?.('system.reboot', 'system', {});
    run('sudo -n reboot 2>&1 || echo "NEEDSSUDO"', {});
    res.json({ success: true, message: 'Reboot initiated' });
  } catch (err) {
    req.audit?.('system.reboot', 'system', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Shutdown the server
router.post('/shutdown', requireRole('admin'), (req, res) => {
  try {
    req.audit?.('system.shutdown', 'system', {});
    run('sudo -n shutdown -h now 2>&1 || echo "NEEDSSUDO"', {});
    res.json({ success: true, message: 'Shutdown initiated' });
  } catch (err) {
    req.audit?.('system.shutdown', 'system', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Get system uptime details
router.get('/uptime', (req, res) => {
  try {
    const out = run('uptime -p 2>&1', {}).trim();
    const since = run('uptime -s 2>&1', {}).trim();
    res.json({ uptime: out, since });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get login history
router.get('/logins', (req, res) => {
  try {
    const out = run('last -n 20 2>&1', {});
    res.json({ logins: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update system timezone
router.post('/timezone', requireRole('admin'), (req, res) => {
  const { timezone } = req.body;
  if (!timezone) return res.status(400).json({ error: 'Timezone required' });
  try {
    const out = run(`sudo -n timedatectl set-timezone ${timezone} 2>&1 || echo "NEEDSSUDO"`, {});
    req.audit?.('system.timezone', 'system', { timezone });
    res.json({ success: true, output: out.trim() });
  } catch (err) {
    req.audit?.('system.timezone', 'system', { error: err.message }, 'failure');
    res.status(500).json({ error: err.message });
  }
});

// Get system security info
router.get('/security', (req, res) => {
  try {
    const ufw = run('ufw status 2>&1 || true', { sudo: true });
    const fail2ban = run('fail2ban-client status 2>&1 || true', {});
    res.json({
      firewall: ufw.trim(),
      fail2ban: fail2ban.trim(),
    });
  } catch (err) {
    res.status(500).json({
      firewall: 'Not available (sudo required)',
      fail2ban: 'Not available',
    });
  }
});

export default router;
