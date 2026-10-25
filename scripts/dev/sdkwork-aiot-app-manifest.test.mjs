#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('agent.app.config.json satisfies release and deployment manifest rules', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/dev/validate-app-manifest.mjs')],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    `app manifest validation failed:\n${result.stdout}\n${result.stderr}`,
  );
});
