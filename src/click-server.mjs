// Tiny local page with one Approve button per pending request. The human clicks; the agent cannot.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { approve, stateDir } from './lib.mjs';

const port = Number(process.env.LOCKDOWN_PORT || 8787);
const pendingFile = () => path.join(stateDir(), 'pending.json');
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/approve/')) {
    const ok = approve(req.url.split('/')[2]);
    res.writeHead(303, { Location: '/?done=' + (ok ? 1 : 0) });
    return res.end();
  }
  let pending = {};
  try { pending = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch {}
  const rows = Object.entries(pending).map(([id, p]) =>
    `<form method="post" action="/approve/${id}"><code>${esc(p.cmd)}</code> <button>Approve once</button></form>`).join('') ||
    '<p>Nothing waiting.</p>';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><meta charset=utf-8><title>Approvals</title><body style="font:16px system-ui;background:#111;color:#eee;padding:2em"><h1>Production writes waiting for you</h1>${rows}</body>`);
}).listen(port, '127.0.0.1', () => console.log(`Approval page: http://127.0.0.1:${port}`));
