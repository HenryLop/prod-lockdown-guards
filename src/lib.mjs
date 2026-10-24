// Classify Salesforce CLI commands and decide whether they may touch a production org.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const stateDir = () => {
  const d = process.env.LOCKDOWN_STATE_DIR || path.join(os.homedir(), '.prod-lockdown');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// Verbs that only read. Anything not listed here is treated as a write.
const READ_ONLY = [
  /^org (list|display|open)\b/, /^data query\b/, /^project (retrieve|list)\b/,
  /^sobject (list|describe)\b/, /^apex (get|list)\b/, /^limits\b/, /^config (get|list)\b/,
  /^package (list|version list)\b/,
];
const WRITE_KINDS = [
  ['destructive', /^project delete|^data delete|^org delete|--post-destructive-changes|--pre-destructive-changes/],
  ['deploy', /^project deploy (start|quick|resume)\b/],
  ['data', /^data (create|update|upsert|import|bulk)\b/],
  ['apex', /^apex run\b/],
  ['permission', /^org assign|^org permset|permset assign/],
];

export function splitCommands(line) {
  return line.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
}

// -> { isSf, kind: 'read'|'deploy'|'data'|'apex'|'destructive'|'permission'|'write', org, checkOnly }
export function parse(cmd) {
  const m = cmd.match(/^(?:npx\s+)?(?:sf|sfdx)\s+(.*)$/);
  if (!m) return { isSf: false };
  const rest = m[1].replace(/\s+/g, ' ').trim();
  const org = (rest.match(/(?:--target-org|-o|--targetusername|-u)[ =]([^\s]+)/) || [])[1] || null;
  const checkOnly = /--dry-run\b|--check-only\b|\s-c(\s|$)/.test(rest) || /^project deploy validate\b/.test(rest);
  if (checkOnly) return { isSf: true, kind: 'read', org, checkOnly: true };
  for (const [kind, re] of WRITE_KINDS) if (re.test(rest)) return { isSf: true, kind, org, checkOnly };
  if (READ_ONLY.some((re) => re.test(rest))) return { isSf: true, kind: 'read', org, checkOnly };
  return { isSf: true, kind: 'write', org, checkOnly };
}

export function loadConfig() {
  const f = process.env.LOCKDOWN_CONFIG || path.join(process.cwd(), 'lockdown.config.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { production: [], defaultIsProduction: true }; }
}

export function isProduction(org, cfg) {
  if (!org) return cfg.defaultIsProduction !== false; // no explicit org: assume the worst
  const o = org.toLowerCase();
  if ((cfg.sandboxes || []).map((s) => s.toLowerCase()).includes(o)) return false;
  if ((cfg.production || []).map((s) => s.toLowerCase()).includes(o)) return true;
  return cfg.defaultIsProduction !== false; // unknown alias: treat as production
}

const fp = (cmd) => crypto.createHash('sha256').update(cmd.trim()).digest('hex').slice(0, 12);
const file = (n) => path.join(stateDir(), n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const writeJson = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 1));

export function requestApproval(cmd) {
  const id = fp(cmd);
  const pending = readJson('pending.json', {});
  pending[id] = { cmd, at: Date.now() };
  writeJson('pending.json', pending);
  return id;
}

// Called ONLY by the click server, after a human pressed the button.
export function approve(id, ttlMs = Number(process.env.LOCKDOWN_TTL_MS || 120000)) {
  const pending = readJson('pending.json', {});
  if (!pending[id]) return false;
  const ok = readJson('approved.json', {});
  ok[id] = { until: Date.now() + ttlMs, used: false };
  writeJson('approved.json', ok);
  delete pending[id];
  writeJson('pending.json', pending);
  return true;
}

function consume(cmd) {
  const id = fp(cmd);
  const ok = readJson('approved.json', {});
  const a = ok[id];
  if (!a || a.used || a.until < Date.now()) return false;
  a.used = true; // one click covers one execution of this exact command
  writeJson('approved.json', ok);
  return true;
}

// -> { allow: true } | { allow: false, reason, id? }
export function decide(commandLine, cfg = loadConfig()) {
  for (const cmd of splitCommands(commandLine)) {
    const p = parse(cmd);
    if (!p.isSf || p.kind === 'read') continue;
    if (!isProduction(p.org, cfg)) continue;
    if (consume(cmd)) continue;
    const id = requestApproval(cmd);
    return {
      allow: false, id,
      reason: `BLOCKED: "${p.kind}" against ${p.org || 'an unspecified org'} (treated as production). ` +
        `Reads and check-only validations are allowed. A human must click Approve for request ${id} ` +
        `(node src/click-server.mjs), then re-run this exact command once.`,
    };
  }
  return { allow: true };
}
