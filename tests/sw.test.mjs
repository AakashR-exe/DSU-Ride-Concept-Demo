import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = new URL('../dsu-ride-demo/', import.meta.url);
const sw = fs.readFileSync(new URL('sw.js', app), 'utf8');
const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every file in the service worker shell exists', () => {
  for (const file of shell.filter((f) => f !== './')) assert.ok(fs.existsSync(new URL(file, app)), file);
});

test('the service worker shell lists every script and stylesheet', () => {
  for (const dir of ['js', 'css']) {
    for (const name of fs.readdirSync(new URL(`${dir}/`, app))) assert.ok(shell.includes(`${dir}/${name}`), `${dir}/${name} missing from SHELL in sw.js`);
  }
});

test('index.html only references files that exist', () => {
  const index = fs.readFileSync(new URL('index.html', app), 'utf8');
  const refs = [...index.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const ref of refs) assert.ok(fs.existsSync(new URL(ref, app)), ref);
});
