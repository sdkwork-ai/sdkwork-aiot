#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const output = path.join(root, 'dist');

if (!fs.existsSync(path.join(source, 'app.json'))) {
  throw new Error('mini program source is missing src/app.json');
}

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, { recursive: true });

// Bundle the @sdkwork/sdk-common resolver into the runtime so the mini program
// can resolve the API base url without a node_modules tree at runtime.
await esbuild.build({
  entryPoints: [path.join(source, 'config', 'resolveAppSdkBaseUrl.mjs')],
  bundle: true,
  outfile: path.join(output, 'config', 'resolveAppSdkBaseUrl.js'),
  platform: 'neutral',
  format: 'cjs',
  target: 'es2019',
  logLevel: 'error',
});
// The bundled CJS output is what the SDK client requires; drop the ESM copy.
fs.rmSync(path.join(output, 'config', 'resolveAppSdkBaseUrl.mjs'), { force: true });

console.log(`[sdkwork-aiot-mini-program] built ${path.relative(root, output)}`);
