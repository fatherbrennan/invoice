import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('invoice fonts retain the OFL assets, embedding permissions and bundled notice', () => {
  const fonts = {
    'IBMPlexSans-Regular.ttf':
      'b47ebd72b5ce53b60f909033ff84d6fc12358cc147e2981f8c321ad3f36246b6',
    'IBMPlexSans-SemiBold.ttf':
      'c51119b25f4a296da2b66edf3201b9aa1735091ed7efc1fca0313346f3851a4d',
  };
  for (const [name, hash] of Object.entries(fonts)) {
    const bytes = readFileSync(
      new URL(`../src-tauri/fonts/${name}`, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      hash,
      'Recheck licensing before replacing a font',
    );
    let permission;
    for (let i = 0; i < bytes.readUInt16BE(4); i++) {
      const offset = 12 + i * 16;
      if (bytes.toString('ascii', offset, offset + 4) === 'OS/2') {
        permission = bytes.readUInt16BE(bytes.readUInt32BE(offset + 8) + 8);
      }
    }
    assert.equal(permission, 0, `${name}: embedding must remain unrestricted`);
  }
});

test('IBM Plex Sans copyright and OFL notice accompany the application and installer', () => {
  const license = readFileSync(
    new URL('../src-tauri/fonts/IBMPlexSans-OFL.txt', import.meta.url),
    'utf8',
  );
  assert.match(license, /Copyright © 2017 IBM Corp/);
  assert.match(license, /Reserved Font Name "Plex"/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1.1/);
  assert.equal(
    readFileSync(
      new URL('../static/licenses/IBMPlexSans-OFL.txt', import.meta.url),
      'utf8',
    ),
    license,
  );
  const config = JSON.parse(
    readFileSync(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(
    config.bundle.resources['fonts/IBMPlexSans-OFL.txt'],
    'licenses/IBMPlexSans-OFL.txt',
  );
});
