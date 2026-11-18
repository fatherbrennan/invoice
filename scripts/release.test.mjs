import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertRemoteAbsent,
  expectedAssets,
  projectVersions,
  validateAssetNames,
  validateAssets,
  validateRemoteAssets,
  validateTag,
} from './release.mjs';

const tag = 'v0.1.0';
const versions = ['0.1.0', '0.1.0', '0.1.0'];
const names = [
  'Invoice_0.1.0_windows-x64_setup.exe',
  'Invoice_0.1.0_macos-arm64.dmg',
  'Invoice_0.1.0_macos-arm64.app.zip',
  'Invoice_0.1.0_macos-x64.dmg',
  'Invoice_0.1.0_macos-x64.app.zip',
].sort();

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'invoice-release-'));
  t.after(() => {
    assert(directory.startsWith(join(tmpdir(), 'invoice-release-')));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function assets(t) {
  const directory = temporary(t);
  for (const name of names)
    writeFileSync(join(directory, name), 'synthetic installer');
  return directory;
}

test('only canonical release tags matching all three versions are accepted', () => {
  assert.equal(validateTag(tag, versions), '0.1.0');
  assert.equal(
    validateTag('v12.34.56', ['12.34.56', '12.34.56', '12.34.56']),
    '12.34.56',
  );
  for (const bad of [
    '',
    '0.1.0',
    'v00.1.0',
    'v0.01.0',
    'v0.1.00',
    'v0.1',
    'v0.1.0-beta',
    'v0.1.0+build',
    'v0.1.0\n',
    '../v0.1.0',
    'v0.1.0;exit',
    undefined,
  ]) {
    assert.throws(() => validateTag(bad, versions), /canonical/);
  }
  for (let index = 0; index < 3; index++) {
    const mismatched = [...versions];
    mismatched[index] = '0.2.0';
    assert.throws(() => validateTag(tag, mismatched), /must match/);
  }
  assert.throws(() => validateTag(tag, ['0.1.0']), /must match/);
});

test('versions come from the package rather than dependency sections', (t) => {
  const directory = temporary(t);
  mkdirSync(join(directory, 'src-tauri'));
  writeFileSync(join(directory, 'package.json'), '{"version":"1.2.3"}');
  writeFileSync(
    join(directory, 'src-tauri/tauri.conf.json'),
    '{"version":"1.2.3"}',
  );
  writeFileSync(
    join(directory, 'src-tauri/Cargo.toml'),
    '[package]\nname = "invoice"\nversion = "1.2.3"\n\n[dependencies.example]\nversion = "9.9.9"\n',
  );
  assert.deepEqual(projectVersions(directory), ['1.2.3', '1.2.3', '1.2.3']);
  writeFileSync(
    join(directory, 'src-tauri/Cargo.toml'),
    '[dependencies.example]\nversion = "1.2.3"\n',
  );
  assert.throws(
    () => validateTag('v1.2.3', projectVersions(directory)),
    /must match/,
  );
});

test('asset allowlist is complete and architecture-specific', () => {
  assert.deepEqual(expectedAssets(tag), names);
  assert.deepEqual(expectedAssets(tag, 'windows-x64'), [
    'Invoice_0.1.0_windows-x64_setup.exe',
  ]);
  assert.equal(expectedAssets(tag, 'macos-arm64').length, 2);
  assert.equal(expectedAssets(tag, 'macos-x64').length, 2);
  assert.throws(() => expectedAssets(tag, 'linux'), /Unsupported/);
  assert.deepEqual(validateAssetNames(tag, [...names].reverse()), names);
  for (const wrong of [
    names.slice(1),
    [...names, names[0]],
    [...names, 'private.json'],
    names.map((name) => `../${name}`),
    names.map((name) => `C:\\private\\${name}`),
    names.map((name) => name.replace('0.1.0', '0.2.0')),
  ]) {
    assert.throws(() => validateAssetNames(tag, wrong), /exactly/);
  }
});

test('assets must be only nonempty regular files in the release directory', (t) => {
  const directory = assets(t);
  assert.deepEqual(
    validateAssets(tag, directory).map((asset) => asset.name),
    names,
  );
  writeFileSync(join(directory, names[0]), '');
  assert.throws(() => validateAssets(tag, directory), /nonempty/);
  rmSync(join(directory, names[0]));
  mkdirSync(join(directory, names[0]));
  assert.throws(() => validateAssets(tag, directory), /regular/);
  rmSync(join(directory, names[0]), { recursive: true });
  const outside = temporary(t);
  symlinkSync(
    outside,
    join(directory, names[0]),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => validateAssets(tag, directory), /regular/);
});

test('extra private files and missing installers prevent release staging', (t) => {
  const directory = assets(t);
  writeFileSync(join(directory, 'private.sqlite'), 'private');
  assert.throws(() => validateAssets(tag, directory), /exactly/);
  rmSync(join(directory, 'private.sqlite'));
  rmSync(join(directory, names[0]));
  assert.throws(() => validateAssets(tag, directory), /exactly/);
});

test('remote asset names, upload states and sizes must match all local files', (t) => {
  const directory = assets(t);
  const remote = names.map((name) => ({ name, state: 'uploaded', size: 19 }));
  validateRemoteAssets(tag, directory, remote);
  assert.throws(
    () => validateRemoteAssets(tag, directory, remote.slice(1)),
    /exactly/,
  );
  assert.throws(
    () =>
      validateRemoteAssets(
        tag,
        directory,
        remote.map((asset, index) =>
          index ? asset : { ...asset, state: 'starter' },
        ),
      ),
    /incomplete/,
  );
  assert.throws(
    () =>
      validateRemoteAssets(
        tag,
        directory,
        remote.map((asset, index) => (index ? asset : { ...asset, size: 20 })),
      ),
    /incomplete/,
  );
});

test('only missing tags and successful release listings establish remote absence', async () => {
  const calls = [];
  await assertRemoteAbsent(
    tag,
    'example/invoice',
    'synthetic-token',
    async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      return {
        status: url.includes('/git/') ? 404 : 200,
        json: async () => [],
      };
    },
  );
  assert.deepEqual(calls, [
    'https://api.github.com/repos/example/invoice/git/ref/tags/v0.1.0',
    'https://api.github.com/repos/example/invoice/releases?per_page=100&page=1',
  ]);
  for (const status of [200, 401, 403, 429, 500]) {
    await assert.rejects(
      assertRemoteAbsent(tag, 'example/invoice', 'token', async () => ({
        status,
      })),
      status === 200 ? /already exists/ : /Cannot verify/,
    );
  }
  let requests = 0;
  await assert.rejects(
    assertRemoteAbsent(tag, 'example/invoice', 'token', async () => ({
      status: ++requests === 1 ? 404 : 200,
      json: async () => [{ tag_name: tag, draft: true }],
    })),
    /already exists/,
  );
  await assert.rejects(
    assertRemoteAbsent(tag, '../other/repository', 'token'),
    /Repository/,
  );
  await assert.rejects(assertRemoteAbsent(tag, 'example/invoice', ''), /token/);
});

test('draft release checks include later pages and reject unreadable listings', async () => {
  const calls = [];
  await assert.rejects(
    assertRemoteAbsent(tag, 'example/invoice', 'token', async (url) => {
      calls.push(url);
      return {
        status: url.includes('/git/') ? 404 : 200,
        json: async () =>
          url.endsWith('page=1')
            ? Array.from({ length: 100 }, (_, index) => ({
                tag_name: `v1.0.${index}`,
              }))
            : [{ tag_name: tag, draft: true }],
      };
    }),
    /already exists/,
  );
  assert(calls.at(-1).endsWith('page=2'));
  for (const response of [
    { status: 403 },
    { status: 500 },
    { status: 200, json: async () => ({}) },
  ]) {
    await assert.rejects(
      assertRemoteAbsent(tag, 'example/invoice', 'token', async (url) =>
        url.includes('/git/') ? { status: 404 } : response,
      ),
      /Cannot verify|Invalid release listing/,
    );
  }
});

test('CLI validates actual project versions and rejects invalid input without network access', () => {
  const script = fileURLToPath(new URL('./release.mjs', import.meta.url));
  const version = projectVersions()[0];
  assert.equal(
    execFileSync(process.execPath, [script, 'validate', `v${version}`], {
      encoding: 'utf8',
    }).trim(),
    version,
  );
  const result = spawnSync(
    process.execPath,
    [script, 'absent', 'v0.1.0;exit'],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /canonical/);
});
