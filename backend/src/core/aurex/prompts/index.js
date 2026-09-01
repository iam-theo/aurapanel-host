import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the infrastructure contract from aurex upstream if available, fallback to embedded
let cached = null;
export function getInfrastructurePrompt() {
  if (cached) return cached;
  const candidates = [
    '/home/digital-auracle/aurex/prompts/capabilities/infrastructure.md',
    join(__dirname, '../../../../docs/aurex-infrastructure-contract.md'),
    join(__dirname, 'infrastructure.md'),
  ];
  for (const p of candidates) {
    try { if (existsSync(p)) { cached = readFileSync(p, 'utf8'); return cached; } } catch {}
  }
  // embedded fallback — condensed contract
  cached = `# Infrastructure Audit Report
Host: <hostname> Uptime: <uptime> Load: <load>/<CPU> RAM: <%> Disk: <%>
## System Status — Overall + table Resource|Status|Severity + 1-3 sentences
## PM2 Analysis — |App|Status|Memory|CPU|Restarts|Uptime|Notes| + PM2 Issues (observed/assessment/severity/recommendation)
## Docker Containers + Issues
## Systemd Running/Failed Services
## System Bottlenecks (CRITICAL/HIGH/MEDIUM/LOW/NORMAL)
## Memory Analysis if RAM>85% (distinguish RSS/cache/swap, top consumers)
## Log Analysis (INFO/WARNING/ERROR/CRITICAL/SECURITY/NOISE, Observed vs Inference vs Confirmed)
## Incidents if needed (ID/Severity/Component/Detection/Evidence/Analysis/Root Cause/Impact/Action/Verification)
## Follow-up Suggestions (prioritized actionable)
## Aurex Assessment (Overall, highest priority, next) + Next Actions numbered.
Never dump raw 80-line output; summarize. Evidence-based severity, duplicate suppression, prioritize security/data-loss/outage.`;
  return cached;
}

export const INFRASTRUCTURE_CONTRACT = getInfrastructurePrompt();

// Short instruction injected into tasks when serverMode=true (token-efficient)
export const INFRASTRUCTURE_INSTRUCTION = `[INFRASTRUCTURE REPORT CONTRACT: For any infrastructure audit, diagnostic, monitoring, deployment investigation or server-health analysis, you MUST follow observe→collect→interpret→classify→summarize→recommend→optionally execute→verify. Never dump raw 80-line command output; summarize. Use structure: # Infrastructure Audit Report (Host/Uptime/Load/RAM/Disk), ## System Status (Overall + table Resource|Status|Severity), ## PM2 Analysis (|App|Status|Memory|CPU|Restarts|Uptime|Notes| + PM2 Issues with observed/assessment/severity/recommendation), ## Docker Containers + Issues, ## Systemd Running/Failed Services, ## System Bottlenecks (CRITICAL/HIGH/MEDIUM/LOW/NORMAL), ## Memory Analysis if RAM>85%, ## Log Analysis (INFO/WARNING/ERROR/CRITICAL/SECURITY/NOISE, distinguish Observed vs Inference vs Confirmed), ## Incidents if needed (ID/Severity/Component/Detection/Evidence/Analysis/Root Cause/Impact/Recommended Action/Verification), ## Follow-up Suggestions (prioritized actionable), then ## Aurex Assessment (Overall condition, highest priority, next) + ## Next Actions (numbered). Classify severity evidence-based, suppress duplicates, prioritize security/data-loss/outage. UI-friendly markdown tables, bold findings, checkmarks. Never claim root cause without evidence; use Observed/Likely/Not yet confirmed.]`;
