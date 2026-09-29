import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const read = (...parts: string[]) => readFileSync(path.join(projectRoot, ...parts), 'utf8');

// The DSH 0.2.0 line is the current compatibility target. The declared dev range starts at
// `0.2.0-alpha.0`, but the only identity actually published on that line is the resolved
// `0.2.0-rc.1` release; npm has shipped no `0.2.0` alpha/beta or stable package yet, so
// `0.2.0-rc.1` stays the development / bundled-Docker pin and the range's alpha/beta
// acceptance is a declared-range fact, not a machine-verified runtime. No matching
// dsh-passwords release has been published either. Bump these constants together with
// package.json, the lockfile, the installers, Docker defaults, and the public baseline docs.
const DSH_PIN = '0.2.0-rc.1';
// The declared dev range spans the whole reviewed 0.2.0 patch, from its first prerelease up
// to (but excluding) the 0.2.1 line. `>=0.2.0-alpha.0 <0.2.1-0` keeps exactly the intended
// set: `0.2.0-alpha.0` and later alpha/beta/rc prereleases plus the stable `0.2.0` release,
// and nothing from the 0.2.1 line onward -- so it rejects both the retired `0.1.7` head and
// every `0.2.1` identity. `^0.2.0-rc.1` is worse than it looks: a caret range on a 0.x
// prerelease expands to `>=0.2.0-rc.1 <0.3.0-0`, which drops the earlier `0.2.0-alpha.*` /
// `0.2.0-beta.*` identities and accepts every later 0.2.x patch (0.2.1, 0.2.2, ...) with
// its prereleases. `^0.2.0` (the previous spec) is not an option either: node-semver only
// admits a prerelease candidate when a comparator shares its `[major, minor, patch]` tuple
// with a prerelease, so `^0.2.0` excludes `0.2.0-alpha.0` and `0.2.0-rc.1` alike.
const DSH_DEV_RANGE = '>=0.2.0-alpha.0 <0.2.1-0';
// Pinned target shipped and validated by the last dsh-passwords release (v2.7.5). It
// survives only as history (CHANGELOG release notes, release/verification prose) and
// must never reappear as a current source pin.
const RELEASED_PIN = '0.1.7-rc.2';
// Exact-match detector for the released pin: the `(?!\d)` guard keeps a future
// alpha.20 / alpha.21 from being misread as alpha.2, and `-{1,2}` also matches the
// shields.io badge double-hyphen spelling.
const RELEASED_PIN_RE = new RegExp(`0\\.1\\.7-{1,2}rc\\.2(?!\\d)`);

type LockEntry = { version?: string; resolved?: string; [key: string]: unknown };
type Lockfile = { lockfileVersion: number; packages: Record<string, LockEntry> };
type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string[] };

const lockPackageName = (key: string) => key.split('node_modules/').pop() ?? '';
const isDshPackage = (name: string) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-');

/** SemVer 2.0.0 identity; build metadata is dropped because it never changes precedence. */
function parseSemver(version: string): ParsedVersion {
  const withoutBuild = version.split('+', 1)[0];
  const dash = withoutBuild.indexOf('-');
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const prerelease = dash === -1 ? '' : withoutBuild.slice(dash + 1);
  const [major, minor, patch] = core.split('.').map(Number);
  return { major, minor, patch, prerelease: prerelease === '' ? [] : prerelease.split('.') };
}

function comparePrereleaseIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** SemVer 2.0.0 precedence; a release outranks any of its prereleases. */
function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const aId = left.prerelease[i];
    const bId = right.prerelease[i];
    if (aId === undefined) return -1; // fewer identifiers ranks lower
    if (bId === undefined) return 1;
    const order = comparePrereleaseIdentifiers(aId, bId);
    if (order !== 0) return order;
  }
  return 0;
}

/**
 * The declared DSH dev range is exactly two comparators, `>=<lower> <upper>`, and both
 * bounds carry a prerelease, so a plain interval check reproduces node-semver's result
 * for every version this suite cares about -- no separate prerelease-admission rule is
 * needed.
 */
function satisfiesPinnedRange(version: string, range: string): boolean {
  const match = /^>=(\S+)\s+<(\S+)$/.exec(range.trim());
  if (match === null) throw new Error(`unexpected DSH dev range shape: ${range}`);
  return compareSemver(version, match[1]) >= 0 && compareSemver(version, match[2]) < 0;
}

test('the released-pin detector matches the previous pin exactly and never a longer number', () => {
  assert.match(`@deepseek-ai/dsh@${RELEASED_PIN}`, RELEASED_PIN_RE);
  assert.match(`"${RELEASED_PIN}"`, RELEASED_PIN_RE);
  assert.match(`^${RELEASED_PIN}`, RELEASED_PIN_RE);
  assert.doesNotMatch('0.1.7-alpha.20', RELEASED_PIN_RE);
  assert.doesNotMatch('0.1.7-alpha.21', RELEASED_PIN_RE);
  assert.doesNotMatch('0.1.7-alpha.200', RELEASED_PIN_RE);
  assert.doesNotMatch(DSH_PIN, RELEASED_PIN_RE, 'the current pin must not be mistaken for the released pin');
  assert.match('DSH-0.1.7--rc.2', RELEASED_PIN_RE, 'the shields.io double-hyphen spelling must also be detected');
});

test('the declared dev range accepts alpha.0/alpha.1/beta/rc/stable on the 0.2.0 patch and rejects 0.1.7 and the 0.2.1 line', () => {
  // Accepted: every reviewed prerelease stage of the 0.2.0 patch (alpha, beta, rc --
  // including the resolved rc pin) and the stable 0.2.0 release itself. Cross-checked
  // against node_modules/semver@7.8.5, which agrees on every identity below.
  for (const version of ['0.2.0-alpha.0', '0.2.0-alpha.1', '0.2.0-alpha.20', '0.2.0-beta.1', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.10', '0.2.0', '0.2.0+build.7']) {
    assert.ok(satisfiesPinnedRange(version, DSH_DEV_RANGE), `${version} must satisfy ${DSH_DEV_RANGE}`);
  }
  // Rejected: prereleases below alpha.0, the retired 0.1.7 head (stable and prerelease),
  // every 0.2.1-line identity (including its own prereleases), later 0.2.x patches, and
  // the next minor.
  for (const version of ['0.2.0-alpha', '0.1.7', '0.1.7-rc.2', '0.2.1', '0.2.1-rc.1', '0.2.2', '0.3.0']) {
    assert.ok(!satisfiesPinnedRange(version, DSH_DEV_RANGE), `${version} must not satisfy ${DSH_DEV_RANGE}`);
  }
  // The resolved pin must always sit inside the range that declares it.
  assert.ok(satisfiesPinnedRange(DSH_PIN, DSH_DEV_RANGE), `${DSH_PIN} must satisfy ${DSH_DEV_RANGE}`);
});

test('package.json declares every @deepseek-ai/dsh* dev dependency with the pinned dev range', () => {
  const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
  const dshPackages = Object.entries(pkg.devDependencies).filter(([name]) => isDshPackage(name));
  assert.ok(dshPackages.length >= 9, `expected the @deepseek-ai/dsh* dev dependency set, found ${dshPackages.length}`);
  for (const [name, spec] of dshPackages) {
    assert.equal(spec, DSH_DEV_RANGE, `${name} must be exactly ${DSH_DEV_RANGE}`);
  }
});

test('npm-shrinkwrap.json root mirrors the package.json dependency graph', () => {
  const pkg = JSON.parse(read('package.json')) as {
    version: string;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    engines: Record<string, string>;
    overrides?: Record<string, unknown>;
  };
  const lock = JSON.parse(read('npm-shrinkwrap.json')) as Lockfile;
  const root = lock.packages[''];
  assert.ok(root !== undefined, 'npm v3 lockfiles must carry the root "" package entry');
  assert.equal(root.version, pkg.version, 'lock root version must match package.json');
  assert.deepEqual(root.dependencies, pkg.dependencies, 'lock root dependencies must match package.json');
  assert.deepEqual(root.devDependencies, pkg.devDependencies, 'lock root devDependencies must match package.json');
  assert.deepEqual(root.engines, pkg.engines, 'lock root engines must match package.json');

  // npm does not persist `overrides` in the lock root, so consistency is enforced
  // where it matters: every locked copy of an overridden package must satisfy the
  // range. A stale lockfile after an override bump fails here.
  const satisfiesOverride = (version: string, range: string): boolean => {
    const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
    if (caret === null) return version === range.trim();
    const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
    const [wantMajor, wantMinor, wantPatch] = caret.slice(1).map(Number);
    return major === wantMajor && (minor > wantMinor || (minor === wantMinor && patch >= wantPatch));
  };
  for (const [name, range] of Object.entries(pkg.overrides ?? {})) {
    if (typeof range !== 'string') continue; // 条件/嵌套覆盖当前未使用；出现时应显式扩展本测试
    const locked = Object.entries(lock.packages).filter(([key]) => lockPackageName(key) === name);
    assert.ok(locked.length > 0, `override target ${name} must exist in the lock`);
    for (const [key, entry] of locked) {
      assert.ok(
        typeof entry.version === 'string' && satisfiesOverride(entry.version, range),
        `${key}@${String(entry.version)} must satisfy override ${range}`,
      );
    }
  }
});

test('npm-shrinkwrap.json locks the whole @deepseek-ai/dsh* tree to the resolved pinned target on the official registry', () => {
  const raw = read('npm-shrinkwrap.json');
  const lock = JSON.parse(raw) as Lockfile;
  assert.equal(lock.lockfileVersion, 3);

  const entries = Object.entries(lock.packages);
  const dshEntries = entries.filter(([key]) => isDshPackage(lockPackageName(key)));
  // The rc.1 closure currently carries 278 @deepseek-ai/dsh* packages; the >= 250
  // assertion fails a lockfile that was truncated or regenerated without the full DSH
  // closure.
  assert.ok(dshEntries.length >= 250, `expected a populated @deepseek-ai/dsh* lock tree, found ${dshEntries.length}`);
  for (const [key, entry] of dshEntries) {
    assert.equal(entry.version, DSH_PIN, `${key} must lock ${DSH_PIN}`);
  }

  for (const [key, entry] of entries) {
    if (entry.resolved === undefined) continue;
    assert.ok(
      entry.resolved.startsWith('https://registry.npmjs.org/'),
      `${key} must resolve from the official registry, got ${entry.resolved}`,
    );
  }

  // Catches both resolved versions and leftover specifier ranges. CHANGELOG.md is
  // intentionally not scanned here: as a published record it keeps the released-pin
  // history, which this lock-tree check must not misread as current source residue.
  assert.doesNotMatch(raw, RELEASED_PIN_RE, 'no previous 0.1.7-rc.2 entry or specifier may remain in the locked tree');
});

test('installers and bundled Docker default to the current pinned target', () => {
  for (const file of ['install.sh', 'install.bat', 'scripts/install.mjs']) {
    const source = read(file);
    assert.match(source, /@deepseek-ai\/dsh@0\.2\.0-rc\.1/, `${file} must install @deepseek-ai/dsh@${DSH_PIN}`);
    assert.doesNotMatch(source, /@deepseek-ai\/dsh@0\.1\.7-alpha\.2(?!\d)/, `${file} must not prescribe the released alpha.2 install command`);
  }
  assert.match(read('docker', 'Dockerfile.bundled'), /ARG DSH_VERSION=0\.2\.0-rc\.1/);
  assert.match(read('docker', 'docker-compose.yml'), /DSH_VERSION:-0\.2\.0-rc\.1/);
  assert.match(read('docker', '.env.example'), /#DSH_VERSION=0\.2\.0-rc\.1/);
});

test('dsh-passwords bundle pins the official workspace picker to browse on every host platform', () => {
  const patch = read('cordis.yml');
  assert.match(patch, /- id: directory-picker\s+name: '@deepseek-ai\/dsh-host-directory-picker-browse'/);
  assert.match(patch, /- id: directory-picker-client\s+name: '@deepseek-ai\/dsh-client-ui-directory-picker-browse'/);
  assert.doesNotMatch(patch, /dsh-host-directory-picker-auto|dsh-host-directory-picker-native|dsh-client-ui-directory-picker-native/);
});

test('the deprecated third-party plugin compat switch is gone from the bundled Docker env template', () => {
  // `src/plugin-compat.ts` was removed; the `MCP_GATEWAY_PLUGIN_COMPAT` switch has no
  // implementation left, so the Docker template must not advertise it.
  assert.doesNotMatch(read('docker', '.env.example'), /MCP_GATEWAY_PLUGIN_COMPAT/);
});

test('public baseline docs name the current pinned target and declared alpha.0 range for release 2.7.6', () => {
  const docs = ['README.md', 'README_en.md', 'CONTRIBUTING.md', 'docs/compatibility-matrix.md'];
  for (const file of docs) {
    const source = read(...file.split('/'));
    assert.match(source, /0\.2\.0-rc\.1/, `${file} must name the current pinned target`);
  }

  // The released pin may survive as history (release notes, test-server verification),
  // but no doc may keep presenting alpha.2 as the current development / Docker pin.
  // These are the exact "current pin" phrasings the rc.2 migration replaced.
  const staleCurrentPinPhrases: Array<[string, RegExp]> = [
    ['README.md', /开发与 Docker 默认运行时锁定 `0\.1\.7-alpha\.2`/],
    ['README.md', /开发与 bundled Docker 运行时锁定 `0\.1\.7-alpha\.2`/],
    ['README.md', /当前锁定 alpha\.2/],
    ['README_en.md', /development and bundled Docker are pinned to `0\.1\.7-alpha\.2`/],
    ['README_en.md', /development and bundled Docker are pinned to alpha\.2/],
    ['CONTRIBUTING.md', /the development and bundled Docker pin for the DSH `0\.1\.7` line/],
    ['CONTRIBUTING.md', /locked against alpha\.2/],
    ['docs/compatibility-matrix.md', /currently pinned to `0\.1\.7-alpha\.2`/],
    ['docs/compatibility-matrix.md', /pin the official runtime to alpha\.2/],
  ];
  for (const [file, pattern] of staleCurrentPinPhrases) {
    assert.doesNotMatch(read(...file.split('/')), pattern, `${file} must not keep the released pin as the current pin`);
  }

  const zhReadme = read('README.md');
  assert.match(zhReadme, /兼容门禁继续接受稳定版及 alpha\/beta\/rc 预发布版本/);
  assert.match(zhReadme, /开发与 bundled Docker 默认运行时锁定 `0\.2\.0-rc\.1`/);
  assert.match(zhReadme, /npm 上 `0\.2\.0` 线当前唯一已发布的身份/, 'README.md must attribute rc.1 to the only published 0.2.0 identity');
  assert.match(zhReadme, /开发依赖声明范围 `>=0\.2\.0-alpha\.0 <0\.2\.1-0`/, 'README.md must name the declared dev range');
  assert.match(zhReadme, /拒绝 `0\.1\.7` 与 `0\.2\.1` 线/, 'the declared range must name both rejected boundaries');
  assert.match(zhReadme, /alpha 兼容仅由 SemVer 范围与版本身份门禁保证，未在实机运行、也未通过完整网关验收/, 'README.md must not claim a verified alpha runtime');
  assert.match(zhReadme, /badge\/DSH-0\.2\.0--rc\.1/, 'the DSH badge must advertise the current pinned target');
  assert.match(zhReadme, /当前发布版本 2\.7\.6/, 'README.md must present 2.7.6 as the current release');

  const enReadme = read('README_en.md');
  assert.match(enReadme, /The DSH compatibility gate accepts the stable 0\.1\.7 line and SemVer alpha\/beta\/rc prereleases/);
  assert.match(enReadme, /Development and bundled Docker default to the resolved runtime DSH `0\.2\.0-rc\.1`/);
  assert.match(enReadme, /the only identity published on the npm `0\.2\.0` line so far/, 'the bundled image must attribute rc.1 to the only published 0.2.0 identity');
  assert.match(enReadme, /declared dev range is `>=0\.2\.0-alpha\.0 <0\.2\.1-0`/, 'README_en.md must name the declared dev range');
  assert.match(enReadme, /rejects `0\.1\.7` and the `0\.2\.1` line/, 'the declared range must name both rejected boundaries');
  assert.match(enReadme, /no alpha build has been run or passed full gateway acceptance/, 'README_en.md must not claim a verified alpha runtime');
  assert.match(enReadme, /badge\/DSH-0\.2\.0--rc\.1/, 'the DSH badge must advertise the current pinned target');
  assert.match(enReadme, /Current release: 2\.7\.6/i, 'README_en.md must present 2.7.6 as the current release');

  const contributing = read('CONTRIBUTING.md');
  assert.match(contributing, /the current working-tree development and bundled Docker pin for the DSH `0\.2\.0` line/, 'CONTRIBUTING.md must attribute the working-tree pin to the 0.2.0 line');
  assert.match(contributing, /the only `0\.2\.0`-line identity published on npm so far/, 'CONTRIBUTING.md must state that rc.1 is the only published 0.2.0 identity');
  assert.match(contributing, /devDependencies declare `>=0\.2\.0-alpha\.0 <0\.2\.1-0`/, 'CONTRIBUTING.md must name the declared dev range');
  assert.match(contributing, /The declared range accepts `0\.2\.0-alpha\.0` and later alpha\/beta\/rc prereleases plus stable `0\.2\.0` and rejects `0\.1\.7` and the `0\.2\.1` line/);
  assert.match(contributing, /never a run or a full gateway acceptance/, 'CONTRIBUTING.md must not claim a verified alpha runtime');
  assert.match(contributing, /dsh-passwords 2\.7\.6 is the current release/, 'CONTRIBUTING.md must identify the current release');
  assert.match(contributing, /stable `0\.1\.7` and SemVer prereleases/);
  assert.match(contributing, /The latest release \(v2\.7\.5\) validated the rc\.2 runtime/, 'CONTRIBUTING.md must keep the released-pin verification as history');

  // Compatibility matrix accuracy guards the released 2.7.6 baseline and the 0.2.x identity boundary.
  const matrix = read('docs', 'compatibility-matrix.md');
  assert.match(matrix, /dsh-passwords \| 2\.7\.6 \|/, 'matrix must identify the 2.7.6 release');
  assert.match(matrix, /649\/649/, 'matrix must record the final 2.7.6 local suite');
  assert.match(matrix, /currently pinned to `0\.2\.0-rc\.1`/, 'matrix must name the current pinned rc.1 target');
  assert.match(matrix, /the current dependency pin for the `0\.2\.0` line/, 'matrix must attribute the current pin to the 0.2.0 line');
  assert.match(matrix, /Development dependencies declare `>=0\.2\.0-alpha\.0 <0\.2\.1-0`/, 'matrix must document the declared dev range');
  assert.match(matrix, /declared SemVer bound rather than a run/, 'matrix must state that the alpha range is not a machine-verified run');
  assert.match(matrix, /`0\.1\.7` stable and alpha\/beta\/rc prereleases pass the identity gate/);
  assert.match(matrix, /The `0\.2\.0` alpha\/beta identities are accepted by range and identity checks only/, 'matrix must not claim a verified 0.2.0 alpha/beta runtime');
  assert.match(matrix, /rejecting `0\.1\.8` and `0\.2\.1`/, 'the lifecycle contract must name the rejected 0.2.1 boundary');
  assert.match(matrix, /128 PASS, 0 FAIL, and 9 classified INCONCLUSIVE/);

  // CHANGELOG.md is a published historical record: the 2.7.4 section keeps its
  // original alpha.2 pin and must not be rewritten to rc.2. The released-pin detector
  // above is scoped to the lock tree and current-pin prose, so this history is never
  // misjudged as current source residue.
  const changelog = read('CHANGELOG.md');
  assert.match(changelog, /## 2\.7\.6 - 2026-09-29/, 'CHANGELOG.md must carry the released 2.7.6 section');
  const released276Match = /## 2\.7\.6[^\r\n]*\r?\n([\s\S]*?)(?:\r?\n## |$)/.exec(changelog);
  assert.ok(released276Match !== null, 'CHANGELOG.md must carry the 2.7.6 section body');
  assert.match(released276Match[1], /兼容 DSH `0\.2\.0-rc\.1`|Compatible with DSH `0\.2\.0-rc\.1`/, 'the 2.7.6 section must describe the rc.1 compatibility');
  assert.match(released276Match[1], /修复 Issue #33|Fixed Issue #33/);
  assert.match(released276Match[1], /普通插件|ordinary plugins/i);
  assert.match(released276Match[1], /649\/649/);

  const released274Match = /## 2\.7\.4[^\r\n]*\r?\n([\s\S]*?)(?:\r?\n## |$)/.exec(changelog);
  assert.ok(released274Match !== null, 'CHANGELOG.md must carry the 2.7.4 release section');
  assert.match(released274Match[1], /DSH `0\.1\.7-alpha\.2`/, 'CHANGELOG.md 2.7.4 must keep its released alpha.2 pin');
  assert.match(released274Match[1], /测试服务器 2\.7\.4 \/ DSH 0\.1\.7-alpha\.2 health\/ready 与 patch status 正常/);
  assert.match(released274Match[1], /MEDIA_QUOTA/);
  assert.match(released274Match[1], /Destructive purge was not run/);
  assert.doesNotMatch(released274Match[1], /审查模型|Review model:/);
  assert.doesNotMatch(released274Match[1], /0\.1\.6-alpha\.2(?!\d)/, 'the 2.7.4 section must not prescribe the previous DSH line');

  const released273Match = /## 2\.7\.3[^\r\n]*\r?\n([\s\S]*?)(?:\r?\n## |$)/.exec(changelog);
  assert.ok(released273Match !== null, 'CHANGELOG.md must keep the released 2.7.3 section');
  assert.match(released273Match[1], /0\.1\.6-alpha\.2/, 'the released 2.7.3 section must keep its historical alpha.2 pin');
});

// The working-tree version is the only release identity that lives in package.json, so the
// Public docs must quote the package version instead of a stale literal. Derived from
// package.json rather than hardcoded so the check keeps working across future releases.
test('public docs quote the package.json release version instead of a stale literal', () => {
  const pkg = JSON.parse(read('package.json')) as { version?: unknown };
  assert.equal(typeof pkg.version, 'string', 'package.json must declare a string version');
  const version = pkg.version as string;
  const token = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expectDocs: Array<[string, RegExp]> = [
    ['README.md', new RegExp(`当前发布版本 ${token}`)],
    ['README_en.md', new RegExp(`Current release: ${token}`, 'i')],
    ['CONTRIBUTING.md', new RegExp(`dsh-passwords ${token} is the current release`)],
    ['docs/compatibility-matrix.md', new RegExp(`dsh-passwords \\| ${token} \\|`)],
  ];
  for (const [file, pattern] of expectDocs) {
    assert.match(read(...file.split('/')), pattern, `${file} must quote the current package.json version ${version}`);
  }
});
