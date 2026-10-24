// Claude Code PreToolUse hook: node src/hook.mjs  (event JSON on stdin)
import { decide } from './lib.mjs';

let raw = '';
for await (const c of process.stdin) raw += c;
let ev = {};
try { ev = JSON.parse(raw); } catch { process.exit(0); }
if (!['Bash', 'PowerShell'].includes(ev.tool_name)) process.exit(0);
const r = decide(ev.tool_input?.command || '');
if (!r.allow) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason },
  }));
}
