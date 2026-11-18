import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export function validateTag(tag, versions) {
  if (
    typeof tag !== 'string' ||
    !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)
  ) {
    throw new Error(
      'Tag must be canonical vX.Y.Z without leading zeroes or suffixes.',
    );
  }
  if (
    versions.length !== 3 ||
    versions.some((version) => version !== tag.slice(1))
  ) {
    throw new Error(
      'Tag must match package.json, Cargo.toml and tauri.conf.json versions.',
    );
  }
  return tag.slice(1);
}

export function projectVersions(directory = root) {
  const cargo = readFileSync(join(directory, 'src-tauri/Cargo.toml'), 'utf8');
  const section = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  const cargoVersion = section?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  return [
    JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version,
    cargoVersion,
    JSON.parse(
      readFileSync(join(directory, 'src-tauri/tauri.conf.json'), 'utf8'),
    ).version,
  ];
}

export function expectedAssets(tag, platform = 'all') {
  const version = validateTag(tag, [tag.slice(1), tag.slice(1), tag.slice(1)]);
  const names = {
    'windows-x64': [`Invoice_${version}_windows-x64_setup.exe`],
    'macos-arm64': [
      `Invoice_${version}_macos-arm64.dmg`,
      `Invoice_${version}_macos-arm64.app.zip`,
    ],
    'macos-x64': [
      `Invoice_${version}_macos-x64.dmg`,
      `Invoice_${version}_macos-x64.app.zip`,
    ],
  };
  if (platform === 'all') return Object.values(names).flat().sort();
  if (!Object.hasOwn(names, platform))
    throw new Error('Unsupported release platform.');
  return names[platform].sort();
}

export function validateAssetNames(tag, names, platform = 'all') {
  const expected = expectedAssets(tag, platform);
  if (
    names.length !== expected.length ||
    [...names].sort().some((name, index) => name !== expected[index])
  ) {
    throw new Error(`Release assets must be exactly: ${expected.join(', ')}`);
  }
  return expected;
}

export function validateAssets(tag, directory, platform = 'all') {
  return validateAssetNames(tag, readdirSync(directory), platform).map(
    (name) => {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size === 0 ||
        stat.size > 1024 ** 3
      ) {
        throw new Error(
          `Asset must be a regular, nonempty file no larger than 1 GiB: ${name}`,
        );
      }
      return { name, size: stat.size };
    },
  );
}

export function validateRemoteAssets(tag, directory, remote) {
  const local = validateAssets(tag, directory);
  validateAssetNames(
    tag,
    remote.map((asset) => asset.name),
  );
  for (const asset of local) {
    const uploaded = remote.find((candidate) => candidate.name === asset.name);
    if (uploaded.state !== 'uploaded' || uploaded.size !== asset.size) {
      throw new Error(`Release asset upload is incomplete: ${asset.name}`);
    }
  }
}

export async function assertRemoteAbsent(
  tag,
  repository,
  token,
  request = fetch,
) {
  expectedAssets(tag);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !token)
    throw new Error('Repository and token are required.');
  const get = (suffix) =>
    request(`https://api.github.com/repos/${repository}/${suffix}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  const tagResponse = await get(`git/ref/tags/${tag}`);
  if (tagResponse.status === 200)
    throw new Error('Tag already exists; refusing to overwrite it.');
  if (tagResponse.status !== 404)
    throw new Error(
      `Cannot verify release absence: HTTP ${tagResponse.status}`,
    );
  // The release-by-tag REST endpoint omits drafts; listing includes drafts visible to this token.
  for (let page = 1; ; page++) {
    const response = await get(`releases?per_page=100&page=${page}`);
    if (response.status !== 200)
      throw new Error(`Cannot verify release absence: HTTP ${response.status}`);
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid release listing.');
    if (releases.some((release) => release.tag_name === tag))
      throw new Error('Release already exists; refusing to overwrite it.');
    if (releases.length < 100) return;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, tag, directory, platform] = process.argv.slice(2);
  validateTag(tag, projectVersions());
  if (command === 'validate') console.log(tag.slice(1));
  else if (command === 'assets')
    console.log(JSON.stringify(validateAssets(tag, directory, platform)));
  else if (command === 'remote-assets')
    validateRemoteAssets(
      tag,
      directory,
      JSON.parse(readFileSync(platform, 'utf8')).assets,
    );
  else if (command === 'absent')
    await assertRemoteAbsent(
      tag,
      process.env.GITHUB_REPOSITORY,
      process.env.GH_TOKEN,
    );
  else
    throw new Error(
      'Expected validate, assets, remote-assets or absent command.',
    );
}
