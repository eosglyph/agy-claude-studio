import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Both native E2Es give the installed watcher a private host configuration.
export async function verifyNativeToggle({ file, mock, waitFor, removeExpr, once }) {
  const change = enabled => fs.writeFileSync(file, JSON.stringify({ plugins: { 'agy-claude-studio': { enabled } } }));
  const start = mock.getCalls().length;
  change(false);
  await waitFor(() => mock.getCalls().slice(start).some(c => c.params?.expression === removeExpr));
  const calls = mock.getCalls().slice(start);
  const remove = calls.findIndex(c => c.params?.expression === removeExpr);
  const ids = calls.slice(0, remove).filter(c => c.method === 'Page.removeScriptToEvaluateOnNewDocument').map(c => c.params.identifier);
  assert.equal(new Set(ids).size, 2);
  const count = mock.getCalls().length;
  assert.deepEqual((await once()).pages, []);
  fs.writeFileSync(file, '{');
  await delay(650);
  assert.equal(mock.getCalls().length, count, 'no CDP injection while host config is incomplete');
  change(true);
  await waitFor(() => mock.getCalls().slice(count).filter(c => c.method === 'Runtime.evaluate').length >= 2);
  assert.equal(mock.getCalls().slice(count).filter(c => c.method === 'Page.addScriptToEvaluateOnNewDocument').length, 2);
}
