import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memory, disk } from '../../server/platform/win32.mjs';

test('Windows platform: memory() returns valid total, used and pressure without throwing', async () => {
  const mem = await memory();
  assert.ok(mem.total > 0, 'mem.total must be > 0');
  assert.ok(mem.used > 0, 'mem.used must be > 0');
  assert.ok(['normal', 'warn', 'critical'].includes(mem.pressure), 'valid pressure state');
});

test('Windows platform: disk() returns disk stats for C: and D: drives', async () => {
  const d = await disk();
  assert.ok(d.total > 0, 'd.total must be > 0');
  assert.ok(d.free >= 0, 'd.free must be >= 0');
  assert.ok(d.drives, 'd.drives should contain per-drive statistics');
  assert.ok(d.drives['C:'] || d.drives['D:'], 'at least C: or D: drive reported');
});
