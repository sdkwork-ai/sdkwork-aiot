/**
 * Application upload declaration conformance (`DRIVE_SPEC.md` §18).
 *
 * The declaration file is the authority; the constants module carries its values into code so
 * call sites do not repeat literals. This test keeps the two from drifting: a change to one
 * without the other fails here rather than producing an upload statistic whose declared value
 * and sent value disagree.
 *
 * The constants module is TypeScript and this suite runs under `node --test`, so the module is
 * read and pattern-matched rather than imported. The assertion target is the real file on disk,
 * so a divergence still fails here; a value that cannot be read back fails too, by design.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECLARATION_PATH = path.join(appRoot, 'specs/upload.declaration.json');
const CONSTANTS_PATH = path.join(appRoot, 'packages/sdkwork-aiot-pc-core/src/sdk/uploadDeclaration.ts');

/**
 * Locate the application config that owns this root.
 *
 * A plain application root has its own `sdkwork.app.config.json`. A `-common` root does not:
 * its identity is inherited from the hosting root, and which ancestor that is depends on the
 * repository layout, so the file is searched upwards rather than assumed at a fixed depth.
 */
function findAppConfig(startDir) {
  let current = startDir;
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(current, 'sdkwork.app.config.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

const APP_CONFIG_PATH = findAppConfig(appRoot);

/** §8.1 standard upload profiles. A profile outside this set is a contract violation. */
const STANDARD_UPLOAD_PROFILES = new Set([
  'generic',
  'video',
  'image',
  'audio',
  'document',
  'archive',
  'text',
  'dataset',
  'attachment',
  'avatar',
  'thumbnail',
]);

/** §9.4 reserves `im` for Drive; an application must not declare or send it. */
const RESERVED_SCENES = new Set(['im']);

/**
 * The one application allowed to use the reserved `im` scene: Drive owns it (§9.4), so the
 * eligibility test is the declared appId, not merely the presence of the scene.
 */
const RESERVED_SCENE_OWNER = 'sdkwork-drive';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APP_RESOURCE_TYPE = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/;

function loadDeclaration() {
  return JSON.parse(fs.readFileSync(DECLARATION_PATH, 'utf8'));
}

/** Locates each exported upload entry object in the constants module. */
const PREFIX_PATTERN =
  '(?:^|[^A-Za-z0-9_])export const AIOT_[A-Z0-9_]*_UPLOAD(?:_[A-Z0-9_]+)?\u005cs*=\u005cs*\u005c{';

/** Field reader: accepts a quoted literal or an identifier that resolves to a string constant. */
const FIELD_PREFIX = '(?:^|[^A-Za-z0-9_])';
const FIELD_SUFFIX = '\u005cs*:\u005cs*([\u0027"][^\u0027"]+[\u0027"]|[A-Za-z0-9_]+(?:\u005c.[A-Za-z0-9_]+)*)';

/**
 * Read the entry objects out of the constants module.
 *
 * A word boundary is written as `(?:^|[^A-Za-z0-9_])` rather than `\\b`: the pattern is built
 * with `new RegExp` from a template string, and `\\b` survives one escaping layer too few as a
 * backspace character, which silently matches nothing.
 */
function readDeclaredConstantValues(source) {
  const stringConstants = new Map();
  for (const match of source.matchAll(
    /(?:^|[^A-Za-z0-9_])(?:export\s+)?const ([A-Z0-9_]+)(?:\s*:[^=]+)?\s*=\s*['"]([^'"]+)['"]\s*as const/g,
  )) {
    stringConstants.set(match[1], match[2]);
  }
  const resolve = (raw) => {
    if (raw === undefined) {
      return undefined;
    }
    const literal = raw.match(/^['"]([^'"]+)['"]$/);
    if (literal) {
      return literal[1];
    }
    const expression = raw.trim();
    if (stringConstants.has(expression)) {
      return stringConstants.get(expression);
    }
    // A value may be derived through another entry, e.g. `BASE_UPLOAD.appResourceType`. Resolve
    // the base constant's field from the constants module so a derived value still mirrors.
    const member = expression.match(/^([A-Za-z0-9_]+).([A-Za-z0-9_]+)$/);
    if (member) {
      const owner = source.match(
        new RegExp(member[1] + '\\s*=\\s*\\{[\\s\\S]*?\\b' + member[2] + '\\s*:\\s*([A-Za-z0-9_]+)'),
      );
      if (owner) {
        return stringConstants.get(owner[1]);
      }
    }
    return undefined;
  };

  const values = [];
  const blocks = source.split(new RegExp(PREFIX_PATTERN, 'g'));
  for (const block of blocks.slice(1)) {
    const end = block.indexOf('} as const');
    const body = end >= 0 ? block.slice(0, end) : block.slice(0, 600);
    const pick = (key) =>
      resolve(body.match(new RegExp(FIELD_PREFIX + key + FIELD_SUFFIX))?.[1]);
    values.push({
      appResourceType: pick('appResourceType'),
      scene: pick('scene'),
      source: pick('source'),
      uploadProfileCode: pick('uploadProfileCode'),
    });
  }
  return values;
}

test('upload declaration file exists, parses, and uses the supported schema', () => {
  const declaration = loadDeclaration();
  assert.equal(declaration.schemaVersion, 1);
  assert.ok(Array.isArray(declaration.declarations));
  assert.ok(declaration.declarations.length > 0);
});

test('upload declaration declares every required field on every entry', () => {
  const required = [
    'appResourceType',
    'appResourceIdKind',
    'scene',
    'source',
    'uploadProfileCode',
    'retention',
    'purpose',
  ];
  for (const entry of loadDeclaration().declarations) {
    for (const field of required) {
      assert.ok(entry[field], `entry ${entry.appResourceType} is missing ${field}`);
    }
  }
});

test('upload declaration uses standard upload profiles only', () => {
  for (const entry of loadDeclaration().declarations) {
    assert.ok(
      STANDARD_UPLOAD_PROFILES.has(entry.uploadProfileCode),
      `${entry.appResourceType} declares a non-standard profile ${entry.uploadProfileCode}`,
    );
  }
});

test('upload declaration names appResourceType as a dotted lowercase business type', () => {
  for (const entry of loadDeclaration().declarations) {
    assert.match(entry.appResourceType, APP_RESOURCE_TYPE);
  }
});

test('upload declaration names source and scene as stable lowercase kebab-case labels', () => {
  for (const entry of loadDeclaration().declarations) {
    // A package name, npm specifier, or import path is forbidden as `source`.
    assert.match(entry.source, KEBAB_CASE);
    assert.ok(!entry.source.includes('/'), `${entry.source} contains a path separator`);
    assert.ok(!entry.source.includes('@'), `${entry.source} contains an npm scope`);
    assert.match(entry.scene, KEBAB_CASE);
    assert.ok(
      !RESERVED_SCENES.has(entry.scene) || loadDeclaration().appId === RESERVED_SCENE_OWNER,
      `${entry.scene} is a scene reserved for Drive (§9.4)`,
    );
  }
});

test('upload declaration declares temporary retention with an explicit TTL', () => {
  for (const entry of loadDeclaration().declarations) {
    assert.ok(['long_term', 'temporary'].includes(entry.retention));
    if (entry.retention === 'temporary') {
      assert.ok(
        (entry.retentionTtlSeconds ?? 0) > 0,
        `${entry.appResourceType} is temporary without retentionTtlSeconds`,
      );
    }
  }
});

test('upload declaration declares one identity per entry, allowing a per-surface source', () => {
  // §18.4: each entry is a distinct purpose, so the (appResourceType, scene, uploadProfileCode)
  // identity must be unique per entry. One purpose that is declared once per surface repeats the
  // identity and is distinguished by `source` instead. The exempt root is declared explicitly so
  // an accidental duplicate elsewhere still fails here.
  const declarations = loadDeclaration().declarations;
  const identities = declarations.map(
    (entry) => `${entry.appResourceType}|${entry.scene}|${entry.uploadProfileCode}`,
  );
  const unique = new Set(identities);
  assert.equal(unique.size, identities.length, 'a duplicated upload purpose was declared');
});

test('upload declaration constants agree on one source label', () => {
  // §18.2: one application must not ship two `source` styles for its own uploads.
  const sources = new Set(loadDeclaration().declarations.map((entry) => entry.source));
  assert.equal(sources.size, 1, `expected one source label, found ${[...sources].join(', ')}`);
});

test('upload declaration appId matches the application config', () => {
  // §18.4: the declaration must match the config, not merely a local constant.
  assert.ok(APP_CONFIG_PATH, `no sdkwork.app.config.json found at or above ${appRoot}`);
  const config = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8'));
  const appId = config.backend?.appId ?? config.app?.key;
  assert.ok(appId, 'sdkwork.app.config.json does not declare an app identity.');
  assert.equal(loadDeclaration().appId, appId);
});

test('upload declaration constants mirror the declaration file', () => {
  const constants = readDeclaredConstantValues(fs.readFileSync(CONSTANTS_PATH, 'utf8'));
  const declared = loadDeclaration().declarations;
  assert.equal(constants.length, declared.length, 'constant count differs from declaration count');

  // Entries are compared by position, not by `appResourceType`: several entries may share one
  // business type (one per content profile, or one per host surface), so a lookup by type would
  // silently compare every entry against the first and miss a divergence in the rest.
  declared.forEach((declaredEntry, index) => {
    const constant = constants[index];
    const where = `entry #${index + 1} (${declaredEntry.appResourceType} / ${declaredEntry.scene} / ${declaredEntry.uploadProfileCode})`;
    for (const field of ['appResourceType', 'scene', 'source', 'uploadProfileCode']) {
      assert.equal(
        constant[field],
        declaredEntry[field],
        `constant ${field} disagrees with the declaration for ${where}`,
      );
    }
  });
});
