// One-command demo: node demo.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LOCKDOWN_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lockdown-demo-'));
process.env.LOCKDOWN_CONFIG = new URL('./lockdown.config.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const { decide, approve } = await import('./src/lib.mjs');

const show = (label, cmd) => {
  const r = decide(cmd);
  console.log(`${label}\n  $ ${cmd}\n  -> ${r.allow ? 'ALLOWED' : 'DENIED  (' + r.id + ')'}\n`);
  return r;
};

show('1. read from production', 'sf data query -q "SELECT Id FROM Account LIMIT 1" -o prod');
show('2. check-only validation', 'sf project deploy start --dry-run -o prod');
show('3. deploy to a sandbox', 'sf project deploy start -o dev');
const r = show('4. deploy to production', 'sf project deploy start -o prod');
show('5. same deploy chained after a harmless command', 'echo ok && sf project deploy start -o prod');
show('6. no org given (assume production)', 'sf data delete record -s Account -i 001000000000000');
console.log('-- a human clicks Approve on the page --\n');
approve(r.id);
show('7. the approved command, once', 'sf project deploy start -o prod');
show('8. the same command again', 'sf project deploy start -o prod');
