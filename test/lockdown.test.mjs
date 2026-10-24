import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LOCKDOWN_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lockdown-test-'));
const { decide, parse, approve } = await import('../src/lib.mjs');
const cfg = { production: ['prod'], sandboxes: ['dev'], defaultIsProduction: true };
const denied = (c) => decide(c, cfg).allow === false;

test('reads and check-only runs are allowed on production', () => {
  for (const c of ['sf data query -q "select Id from X" -o prod', 'sf org list', 'sf project deploy start --dry-run -o prod',
    'sf project deploy validate -o prod', 'sf project retrieve start -o prod', 'ls -la'])
    assert.equal(denied(c), false, c);
});

test('writes to production are denied', () => {
  for (const c of ['sf project deploy start -o prod', 'sf data update record -o prod', 'sf apex run -o prod',
    'sf project delete source -o prod', 'sfdx force:source:deploy -u prod', 'npx sf data upsert bulk -o prod'])
    assert.equal(denied(c), true, c);
});

test('sandbox writes are allowed', () => assert.equal(denied('sf project deploy start -o dev'), false));

test('unknown alias and missing org are treated as production', () => {
  assert.equal(denied('sf project deploy start -o mystery'), true);
  assert.equal(denied('sf project deploy start'), true);
});

test('bypass attempts: chaining, pipes, subshell order, flag forms', () => {
  assert.equal(denied('echo hi && sf project deploy start -o prod'), true);
  assert.equal(denied('true; sf apex run -o prod'), true);
  assert.equal(denied('cat x | sf data import tree -o prod'), true);
  assert.equal(denied('sf project deploy start --target-org=prod'), true);
  assert.equal(denied('sf   project   deploy   start   -o   PROD'), true);
});

test('destructive flag in a deploy is a write even if it looks like a validation word', () => {
  assert.equal(parse('sf project deploy start --post-destructive-changes d.xml -o prod').kind, 'destructive');
});

test('approval covers one execution of the exact command', () => {
  const cmd = 'sf project deploy start -o prod --metadata ApexClass:A';
  const r = decide(cmd, cfg);
  assert.equal(r.allow, false);
  assert.ok(approve(r.id));
  assert.equal(decide(cmd, cfg).allow, true);
  assert.equal(decide(cmd, cfg).allow, false);
});

test('approval of one command does not cover another', () => {
  const r = decide('sf project deploy start -o prod --metadata ApexClass:B', cfg);
  approve(r.id);
  assert.equal(denied('sf project deploy start -o prod --metadata ApexClass:C'), true);
});

test('expired approval is refused', () => {
  const cmd = 'sf apex run -f x.apex -o prod';
  const r = decide(cmd, cfg);
  approve(r.id, -1);
  assert.equal(denied(cmd), true);
});
