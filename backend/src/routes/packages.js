import { Router } from 'express';
import { run } from '../lib/exec.js';
import { requireRole } from '../lib/auth.js';

const router = Router();

// Curated marketplace — ~80 packages across 7 categories
const MARKETPLACE = [
  // Web Servers
  { id: 'nginx', name: 'Nginx', category: 'web', desc: 'High-performance web server & reverse proxy', install: 'sudo apt update && sudo apt install -y nginx', check: 'nginx -v', icon: 'Globe' },
  { id: 'apache2', name: 'Apache2', category: 'web', desc: 'Apache HTTP Server', install: 'sudo apt install -y apache2', check: 'apache2 -v', icon: 'Globe' },
  { id: 'caddy', name: 'Caddy', category: 'web', desc: 'Automatic HTTPS web server', install: 'sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-keyring.gpg && echo "deb [signed-by=/usr/share/keyrings/caddy-stable-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" | sudo tee /etc/apt/sources.list.d/caddy-stable.list && sudo apt update && sudo apt install -y caddy', check: 'caddy version', icon: 'Globe' },
  { id: 'traefik', name: 'Traefik', category: 'web', desc: 'Cloud-native application proxy', install: 'curl -fsSL https://raw.githubusercontent.com/traefik/traefik/master/install.sh | sh && sudo mv traefik /usr/local/bin/', check: 'traefik version', icon: 'Globe' },
  // Databases
  { id: 'postgresql-17', name: 'PostgreSQL 17', category: 'database', desc: 'Advanced open-source relational database', install: 'sudo apt install -y postgresql-17', check: 'psql --version', icon: 'Database' },
  { id: 'postgresql-14', name: 'PostgreSQL 14', category: 'database', desc: 'PostgreSQL 14 (LTS)', install: 'sudo apt install -y postgresql-14', check: 'psql --version', icon: 'Database' },
  { id: 'mysql-server', name: 'MySQL', category: 'database', desc: 'World\'s most popular open-source database', install: 'sudo apt install -y mysql-server', check: 'mysql --version', icon: 'Database' },
  { id: 'mariadb-server', name: 'MariaDB', category: 'database', desc: 'MySQL fork with enhanced features', install: 'sudo apt install -y mariadb-server', check: 'mariadb --version', icon: 'Database' },
  { id: 'redis-server', name: 'Redis', category: 'database', desc: 'In-memory data structure store', install: 'sudo apt install -y redis-server', check: 'redis-server --version', icon: 'Database' },
  { id: 'mongodb', name: 'MongoDB', category: 'database', desc: 'Document-oriented NoSQL database', install: 'curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor && echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list && sudo apt update && sudo apt install -y mongodb-org', check: 'mongod --version', icon: 'Database' },
  { id: 'memcached', name: 'Memcached', category: 'database', desc: 'High-performance distributed memory cache', install: 'sudo apt install -y memcached', check: 'memcached -h', icon: 'Database' },
  { id: 'sqlite3', name: 'SQLite', category: 'database', desc: 'Self-contained SQL database engine', install: 'sudo apt install -y sqlite3', check: 'sqlite3 --version', icon: 'Database' },
  { id: 'cockroachdb', name: 'CockroachDB', category: 'database', desc: 'Distributed SQL database', install: 'curl https://binaries.cockroachdb.com/cockroach-v23.1.0.linux-amd64.tgz | tar -xz && sudo cp -i cockroach-v23.1.0.linux-amd64/cockroach /usr/local/bin/', check: 'cockroach version', icon: 'Database' },
  { id: 'clickhouse-server', name: 'ClickHouse', category: 'database', desc: 'Column-oriented DBMS for analytics', install: 'sudo apt install -y apt-transport-https ca-certificates dirmngr && sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 8919BBE9 && echo "deb https://packages.clickhouse.com/deb stable main" | sudo tee /etc/apt/sources.list.d/clickhouse.list && sudo apt update && sudo apt install -y clickhouse-server', check: 'clickhouse-server --version', icon: 'Database' },
  { id: 'rabbitmq-server', name: 'RabbitMQ', category: 'database', desc: 'Message broker', install: 'sudo apt install -y rabbitmq-server', check: 'rabbitmqctl version', icon: 'Database' },
  // Runtimes
  { id: 'nodejs-20', name: 'Node.js 20', category: 'runtime', desc: 'JavaScript runtime (LTS)', install: 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs', check: 'node --version', icon: 'Boxes' },
  { id: 'nodejs-22', name: 'Node.js 22', category: 'runtime', desc: 'JavaScript runtime (Current)', install: 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs', check: 'node --version', icon: 'Boxes' },
  { id: 'python3', name: 'Python 3', category: 'runtime', desc: 'Python programming language', install: 'sudo apt install -y python3 python3-pip python3-venv', check: 'python3 --version', icon: 'Boxes' },
  { id: 'php8.3', name: 'PHP 8.3', category: 'runtime', desc: 'PHP with FPM', install: 'sudo apt install -y php8.3 php8.3-fpm php8.3-cli php8.3-mysql php8.3-curl php8.3-mbstring', check: 'php --version', icon: 'Boxes' },
  { id: 'php8.4', name: 'PHP 8.4', category: 'runtime', desc: 'Latest PHP', install: 'sudo apt install -y php8.4 php8.4-fpm', check: 'php8.4 --version', icon: 'Boxes' },
  { id: 'golang', name: 'Go', category: 'runtime', desc: 'Go programming language', install: 'sudo apt install -y golang-go', check: 'go version', icon: 'Boxes' },
  { id: 'rust', name: 'Rust', category: 'runtime', desc: 'Rust toolchain via rustup', install: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y', check: 'rustc --version', icon: 'Boxes' },
  { id: 'openjdk-21', name: 'OpenJDK 21', category: 'runtime', desc: 'Java Development Kit', install: 'sudo apt install -y openjdk-21-jdk', check: 'java -version', icon: 'Boxes' },
  { id: 'openjdk-17', name: 'OpenJDK 17', category: 'runtime', desc: 'Java LTS', install: 'sudo apt install -y openjdk-17-jdk', check: 'java -version', icon: 'Boxes' },
  { id: 'ruby', name: 'Ruby', category: 'runtime', desc: 'Ruby programming language', install: 'sudo apt install -y ruby-full', check: 'ruby --version', icon: 'Boxes' },
  { id: 'dotnet', name: '.NET 8', category: 'runtime', desc: 'Microsoft .NET SDK', install: 'wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb && sudo dpkg -i packages-microsoft-prod.deb && sudo apt update && sudo apt install -y dotnet-sdk-8.0', check: 'dotnet --version', icon: 'Boxes' },
  // DevOps / Containers
  { id: 'docker', name: 'Docker', category: 'devops', desc: 'Container runtime', install: 'curl -fsSL https://get.docker.com | sh', check: 'docker --version', icon: 'Boxes' },
  { id: 'docker-compose', name: 'Docker Compose', category: 'devops', desc: 'Multi-container orchestration', install: 'sudo apt install -y docker-compose-plugin', check: 'docker compose version', icon: 'Boxes' },
  { id: 'podman', name: 'Podman', category: 'devops', desc: 'Daemonless container engine', install: 'sudo apt install -y podman', check: 'podman --version', icon: 'Boxes' },
  { id: 'kubernetes', name: 'Kubernetes (kubectl)', category: 'devops', desc: 'Container orchestration CLI', install: 'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl', check: 'kubectl version --client', icon: 'Boxes' },
  { id: 'helm', name: 'Helm', category: 'devops', desc: 'Kubernetes package manager', install: 'curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash', check: 'helm version', icon: 'Boxes' },
  { id: 'terraform', name: 'Terraform', category: 'devops', desc: 'Infrastructure as Code', install: 'wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg && echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list && sudo apt update && sudo apt install -y terraform', check: 'terraform version', icon: 'Boxes' },
  { id: 'ansible', name: 'Ansible', category: 'devops', desc: 'Automation platform', install: 'sudo apt install -y ansible', check: 'ansible --version', icon: 'Boxes' },
  { id: 'git', name: 'Git', category: 'devops', desc: 'Distributed version control', install: 'sudo apt install -y git', check: 'git --version', icon: 'Boxes' },
  { id: 'jenkins', name: 'Jenkins', category: 'devops', desc: 'Automation server', install: 'curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null && echo deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/ | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null && sudo apt update && sudo apt install -y jenkins', check: 'jenkins --version', icon: 'Boxes' },
  // Monitoring
  { id: 'prometheus', name: 'Prometheus', category: 'monitoring', desc: 'Monitoring & alerting toolkit', install: 'sudo apt install -y prometheus', check: 'prometheus --version', icon: 'Activity' },
  { id: 'grafana', name: 'Grafana', category: 'monitoring', desc: 'Observability platform', install: 'sudo apt-get install -y apt-transport-https software-properties-common && sudo mkdir -p /etc/apt/keyrings/ && wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg > /dev/null && echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list && sudo apt update && sudo apt install -y grafana', check: 'grafana-server -v', icon: 'Activity' },
  { id: 'netdata', name: 'Netdata', category: 'monitoring', desc: 'Real-time performance monitoring', install: 'bash <(curl -Ss https://my-netdata.io/kickstart.sh) --dont-wait', check: 'netdata -v', icon: 'Activity' },
  { id: 'htop', name: 'htop', category: 'monitoring', desc: 'Interactive process viewer', install: 'sudo apt install -y htop', check: 'htop --version', icon: 'Activity' },
  { id: 'glances', name: 'Glances', category: 'monitoring', desc: 'Cross-platform system monitor', install: 'sudo apt install -y glances', check: 'glances --version', icon: 'Activity' },
  { id: 'nmon', name: 'nmon', category: 'monitoring', desc: 'System performance monitor', install: 'sudo apt install -y nmon', check: 'nmon -h', icon: 'Activity' },
  // Security
  { id: 'ufw', name: 'UFW', category: 'security', desc: 'Uncomplicated Firewall', install: 'sudo apt install -y ufw', check: 'ufw --version', icon: 'Server' },
  { id: 'fail2ban', name: 'Fail2Ban', category: 'security', desc: 'Brute-force protection', install: 'sudo apt install -y fail2ban', check: 'fail2ban-client --version', icon: 'Server' },
  { id: 'certbot', name: 'Certbot', category: 'security', desc: 'Let\'s Encrypt client', install: 'sudo apt install -y certbot python3-certbot-nginx', check: 'certbot --version', icon: 'Server' },
  { id: 'clamav', name: 'ClamAV', category: 'security', desc: 'Antivirus engine', install: 'sudo apt install -y clamav clamav-daemon', check: 'clamscan --version', icon: 'Server' },
  { id: 'rkhunter', name: 'RKHunter', category: 'security', desc: 'Rootkit hunter', install: 'sudo apt install -y rkhunter', check: 'rkhunter --version', icon: 'Server' },
  // Tools & Utilities
  { id: 'supervisor', name: 'Supervisor', category: 'tools', desc: 'Process control system', install: 'sudo apt install -y supervisor', check: 'supervisord --version', icon: 'Server' },
  { id: 'pm2', name: 'PM2', category: 'tools', desc: 'Node process manager', install: 'sudo npm install -g pm2', check: 'pm2 --version', icon: 'Server' },
  { id: 'yarn', name: 'Yarn', category: 'tools', desc: 'Package manager', install: 'sudo npm install -g yarn', check: 'yarn --version', icon: 'Server' },
  { id: 'pnpm', name: 'pnpm', category: 'tools', desc: 'Fast package manager', install: 'sudo npm install -g pnpm', check: 'pnpm --version', icon: 'Server' },
  { id: 'composer', name: 'Composer', category: 'tools', desc: 'PHP dependency manager', install: 'curl -sS https://getcomposer.org/installer | php && sudo mv composer.phar /usr/local/bin/composer', check: 'composer --version', icon: 'Server' },
  { id: 'pip', name: 'pip', category: 'tools', desc: 'Python package installer', install: 'sudo apt install -y python3-pip', check: 'pip3 --version', icon: 'Server' },
  { id: 'awscli', name: 'AWS CLI', category: 'tools', desc: 'Amazon Web Services CLI', install: 'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && unzip awscliv2.zip && sudo ./aws/install', check: 'aws --version', icon: 'Server' },
  { id: 'gcloud', name: 'Google Cloud SDK', category: 'tools', desc: 'GCP CLI', install: 'curl https://sdk.cloud.google.com | bash', check: 'gcloud --version', icon: 'Server' },
  { id: 'azure-cli', name: 'Azure CLI', category: 'tools', desc: 'Azure CLI', install: 'curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash', check: 'az --version', icon: 'Server' },
  { id: 'jq', name: 'jq', category: 'tools', desc: 'JSON processor', install: 'sudo apt install -y jq', check: 'jq --version', icon: 'Server' },
  { id: 'curl', name: 'curl', category: 'tools', desc: 'Transfer data with URLs', install: 'sudo apt install -y curl', check: 'curl --version', icon: 'Server' },
  { id: 'wget', name: 'wget', category: 'tools', desc: 'Network downloader', install: 'sudo apt install -y wget', check: 'wget --version', icon: 'Server' },
  { id: 'tmux', name: 'tmux', category: 'tools', desc: 'Terminal multiplexer', install: 'sudo apt install -y tmux', check: 'tmux -V', icon: 'Server' },
  { id: 'vim', name: 'Vim', category: 'tools', desc: 'Text editor', install: 'sudo apt install -y vim', check: 'vim --version', icon: 'Server' },
  { id: 'ffmpeg', name: 'FFmpeg', category: 'tools', desc: 'Multimedia framework', install: 'sudo apt install -y ffmpeg', check: 'ffmpeg -version', icon: 'Server' },
  { id: 'imagemagick', name: 'ImageMagick', category: 'tools', desc: 'Image manipulation', install: 'sudo apt install -y imagemagick', check: 'convert --version', icon: 'Server' },
  { id: 'ollama', name: 'Ollama', category: 'tools', desc: 'Run LLMs locally', install: 'curl -fsSL https://ollama.com/install.sh | sh', check: 'ollama --version', icon: 'Server' },
  // Networking
  { id: 'tailscale', name: 'Tailscale', category: 'network', desc: 'Zero-config VPN', install: 'curl -fsSL https://tailscale.com/install.sh | sh', check: 'tailscale version', icon: 'Server' },
  { id: 'cloudflared', name: 'Cloudflared', category: 'network', desc: 'Cloudflare Tunnel', install: 'curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb', check: 'cloudflared --version', icon: 'Server' },
  { id: 'wireguard', name: 'WireGuard', category: 'network', desc: 'Fast VPN', install: 'sudo apt install -y wireguard', check: 'wg --version', icon: 'Server' },
  { id: 'openvpn', name: 'OpenVPN', category: 'network', desc: 'VPN solution', install: 'sudo apt install -y openvpn', check: 'openvpn --version', icon: 'Server' },
  { id: 'haproxy', name: 'HAProxy', category: 'network', desc: 'Load balancer', install: 'sudo apt install -y haproxy', check: 'haproxy -v', icon: 'Server' },
  { id: 'varnish', name: 'Varnish', category: 'network', desc: 'HTTP accelerator', install: 'sudo apt install -y varnish', check: 'varnishd -V', icon: 'Server' },
];

const CATEGORIES = [
  { id: 'all', label: 'All Packages' },
  { id: 'web', label: 'Web Servers' },
  { id: 'database', label: 'Databases' },
  { id: 'runtime', label: 'Runtimes' },
  { id: 'devops', label: 'DevOps' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'security', label: 'Security' },
  { id: 'tools', label: 'Tools' },
  { id: 'network', label: 'Network' },
];

function isInstalled(pkg) {
  try {
    const out = run(`${pkg.check} 2>&1`, { timeout: 5000 });
    // if command succeeds or version string found, consider installed
    if (out.toLowerCase().includes('not found') || out.toLowerCase().includes('command not found')) return false;
    if (out.trim().length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

router.get('/marketplace', (req, res) => {
  const { q, category } = req.query;
  let list = MARKETPLACE;
  if (category && category !== 'all') list = list.filter(p => p.category === category);
  if (q) {
    const s = q.toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(s) || p.desc.toLowerCase().includes(s) || p.id.includes(s));
  }
  // attach installed status (sample first 20 to avoid slow; rest lazy)
  const withStatus = list.map(p => ({ ...p, installed: isInstalled(p) }));
  res.json({ categories: CATEGORIES, packages: withStatus, total: withStatus.length });
});

router.get('/installed', (req, res) => {
  const installed = MARKETPLACE.filter(isInstalled);
  // also query apt for additional installed packages (top 50)
  let aptExtras = [];
  try {
    const out = run('dpkg -l 2>&1 | awk \'/^ii/ {print $2" "$3}\' | head -50', { timeout: 5000 });
    aptExtras = out.trim().split('\n').filter(Boolean).map(line => {
      const [name, ver] = line.split(' ');
      return { id: name, name, category: 'system', desc: `Installed via apt — v${ver}`, install: `sudo apt install -y ${name}`, installed: true, version: ver, icon: 'Server' };
    });
  } catch {}
  res.json({ packages: [...installed, ...aptExtras], total: installed.length + aptExtras.length });
});

router.get('/status/:id', (req, res) => {
  const pkg = MARKETPLACE.find(p => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  const installed = isInstalled(pkg);
  let version = null;
  if (installed) {
    try { version = run(`${pkg.check} 2>&1 | head -1`, { timeout: 5000 }).trim().slice(0, 120); } catch {}
  }
  res.json({ id: pkg.id, installed, version });
});

// Install (streaming via SSE-ish polling; we run async and return job id)
const jobs = new Map(); // jobId -> { status, log, pkgId }

router.post('/install', requireRole('admin', 'operator'), (req, res) => {
  const { id } = req.body;
  const pkg = MARKETPLACE.find(p => p.id === id);
  if (!pkg) return res.status(404).json({ error: 'Package not found in marketplace' });
  if (isInstalled(pkg)) return res.status(409).json({ error: `${pkg.name} is already installed` });
  const jobId = `${id}-${Date.now()}`;
  jobs.set(jobId, { status: 'running', log: `Starting install of ${pkg.name}...\n$ ${pkg.install}\n`, pkgId: id });
  req.audit?.('packages.install', `packages/${id}`, { install: pkg.install });
  // Run async (don't block)
  setImmediate(async () => {
    try {
      const out = run(`${pkg.install} 2>&1`, { timeout: 300000 });
      const j = jobs.get(jobId);
      if (j) { j.log += out.slice(-8000); j.status = 'done'; }
    } catch (e) {
      const j = jobs.get(jobId);
      if (j) { j.log += `\nERROR: ${e.message.slice(0, 4000)}`; j.status = 'failed'; }
    }
  });
  res.json({ success: true, jobId, message: `Installing ${pkg.name}...` });
});

router.post('/remove', requireRole('admin'), (req, res) => {
  const { id } = req.body;
  const pkg = MARKETPLACE.find(p => p.id === id);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });
  // naive apt remove for apt-based packages
  const aptName = id.split('-')[0] === 'postgresql' ? 'postgresql' : id;
  try {
    const out = run(`sudo apt remove -y ${aptName} 2>&1; echo EXIT:$?`, { sudo: true, timeout: 120000 });
    req.audit?.('packages.remove', `packages/${id}`, {});
    res.json({ success: true, output: out.slice(-4000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/jobs/:jobId', (req, res) => {
  const j = jobs.get(req.params.jobId);
  if (!j) return res.status(404).json({ error: 'Job not found' });
  res.json(j);
});

router.get('/categories', (req, res) => res.json(CATEGORIES));

export default router;
