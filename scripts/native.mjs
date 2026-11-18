import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
const local = resolve(root, '.tools/msvc');
if (process.platform === 'win32' && existsSync(local)) {
  const vcRoot = join(local, 'VC/Tools/MSVC');
  const sdkRoot = join(local, 'Windows Kits/10');
  const vcVersions = readdirSync(vcRoot);
  const sdkVersions = readdirSync(join(sdkRoot, 'Include'));
  if (vcVersions.length !== 1 || sdkVersions.length !== 1) {
    throw new Error('Expected exactly one local MSVC and Windows SDK version.');
  }
  const vc = join(vcRoot, vcVersions[0]);
  const sdk = sdkVersions[0];
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const originalPath = pathKey ? env[pathKey] : '';
  if (pathKey) delete env[pathKey];
  env.PATH = [
    join(vc, 'bin/Hostx64/x64'),
    join(sdkRoot, 'bin', sdk, 'x64'),
    originalPath,
  ].join(delimiter);
  env.INCLUDE = [
    join(vc, 'include'),
    ...['ucrt', 'shared', 'um', 'winrt'].map((p) =>
      join(sdkRoot, 'Include', sdk, p),
    ),
  ].join(delimiter);
  env.LIB = [
    join(vc, 'lib/x64'),
    ...['ucrt', 'um'].map((p) => join(sdkRoot, 'Lib', sdk, p, 'x64')),
  ].join(delimiter);
  env.VCToolsInstallDir = `${vc}\\`;
  env.VCToolsVersion = vcVersions[0];
  env.WindowsSdkDir = `${sdkRoot}\\`;
  env.WindowsSDKVersion = `${sdk}\\`;
  env.VSCMD_ARG_HOST_ARCH = 'x64';
  env.VSCMD_ARG_TGT_ARCH = 'x64';
}
const [command, ...args] = process.argv.slice(2);
if (!['cargo', 'bun'].includes(command))
  throw new Error('Expected cargo or bun command.');
const result = spawnSync(command, args, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
