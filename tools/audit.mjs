#!/usr/bin/env node
// Static audit: needs only Node itself (no npm install). Checks that things are WIRED UP, not just that they compile.
// Run: node tools/audit.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => readFileSync(join(ROOT, p), 'utf8');
const rb = (p) => readFileSync(join(ROOT, p));
const problems = [];
let checks = 0;
const check = (ok, msg) => { checks++; if (!ok) problems.push(msg); };
const walk = (d, out = []) => {
  for (const f of readdirSync(join(ROOT, d))) {
    if (f === 'node_modules' || f === '.git' || f === 'dist' || f === 'release') continue;
    const p = join(d, f);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p.replace(/\\/g, '/'));
  }
  return out;
};
const files = walk('.').map((f) => f.replace(/^\.\//, ''));
const pkg = JSON.parse(r('package.json'));

// 1. Windows batch files must be CRLF (cmd.exe breaks on LF-only goto labels)
for (const f of files.filter((f) => f.endsWith('.bat'))) {
  const b = rb(f).toString('latin1');
  check(!/[^\r]\n/.test(b) && b.includes('\r\n'), `${f}: must use CRLF line endings`);
}
// .gitattributes must keep them CRLF on checkout
check(/\*\.bat\s+text\s+eol=crlf/.test(r('.gitattributes')), '.gitattributes: *.bat must be eol=crlf');

// 2. .command scripts: executable in git, LF endings, bash shebang
for (const f of files.filter((f) => f.endsWith('.command'))) {
  const b = r(f);
  check(b.startsWith('#!/bin/bash'), `${f}: must start with #!/bin/bash`);
  check(!b.includes('\r'), `${f}: must use LF line endings`);
  let mode = '';
  try { mode = execSync(`git ls-files -s -- "${f}"`, { cwd: ROOT }).toString().slice(0, 6); } catch { /* not a git checkout */ }
  if (mode) check(mode === '100755', `${f}: not executable in git (run: git update-index --chmod=+x "${f}")`);
  else check((statSync(join(ROOT, f)).mode & 0o111) !== 0, `${f}: not executable`);
}

// 3. Required build scripts exist (two per platform: app, then package-only)
for (const f of ['mac/Build Mac App.command', 'mac/Build Mac DMG.command', 'windows/Build Windows App.bat', 'windows/Build Windows Installer.bat', 'installer/permanotes.iss'])
  check(existsSync(join(ROOT, f)), `missing ${f}`);
for (const f of ['START HERE - Windows.txt', 'START HERE - Mac.txt', 'START HERE - iPhone.txt', 'SETUP SYNC.txt', 'docs/README.txt'])
  check(existsSync(join(ROOT, f)), `missing ${f}`);

// 4. Package-only scripts must NOT rebuild the app
check(!/electron-builder|npm (ci|run build)/.test(r('mac/Build Mac DMG.command')), 'Build Mac DMG.command must not rebuild the app');
check(!/electron-builder|npm (ci|run build)/.test(r('windows/Build Windows Installer.bat')), 'Build Windows Installer.bat must not rebuild the app');

// 5. README ships INSIDE the DMG and the installer
const iss = r('installer/permanotes.iss');
check(/\[Files\][\s\S]*Source:\s*"\.\.\\docs\\README\.txt"/.test(iss), 'installer: README.txt missing from [Files]');
check(/\[Icons\][\s\S]*README[\s\S]*Filename:\s*"\{app\}\\README\.txt"/.test(iss), 'installer: README Start-menu shortcut missing');
check(/cp "docs\/README\.txt" "\$STAGE\//.test(r('mac/Build Mac DMG.command')), 'DMG: README.txt not staged next to the app');
check(/ln -s \/Applications/.test(r('mac/Build Mac DMG.command')), 'DMG: Applications shortcut missing');

// 6. Installer paths line up with what electron-builder produces
check(iss.includes('release\\win-unpacked\\*') && r('windows/Build Windows Installer.bat').includes('release\\win-unpacked\\PermaNotes.exe'), 'installer/bat paths do not match electron-builder win-unpacked output');
check(r('mac/Build Mac App.command').includes('release/mac-universal/PermaNotes.app') && r('mac/Build Mac DMG.command').includes('release/mac-universal/PermaNotes.app'), 'mac scripts disagree on the .app path');
check(pkg.build?.productName === 'PermaNotes', 'package.json build.productName must be PermaNotes (exe/app names depend on it)');
check(existsSync(join(ROOT, 'build/icon.png')) && existsSync(join(ROOT, 'build/icon.ico')), 'build/icon.png and build/icon.ico are required');

// 7. .pn file association everywhere
check(pkg.build?.fileAssociations?.some((a) => a.ext === 'pn'), 'package.json: .pn fileAssociation missing (Mac)');
check(/Software\\Classes\\\.pn/.test(iss) && /"%1"/.test(iss), 'installer: .pn association missing (Windows)');
const main = r('electron/main.cjs');
check(/app\.on\('open-file'/.test(main), 'electron: macOS open-file handler missing');
check(/second-instance/.test(main) && /filesFromArgv\(process\.argv\)/.test(main), 'electron: Windows .pn argv handling missing');

// 8. IPC: every channel the preload calls has a handler, and every bridge method the app uses exists
const pre = r('electron/preload.cjs');
const invoked = [...pre.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
const handled = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
for (const c of invoked) check(handled.has(c), `IPC channel ${c} is invoked in preload but has no ipcMain.handle`);
check(/webContents\.send\('pn:open-file'/.test(main) && /ipcRenderer\.on\('pn:open-file'/.test(pre), 'IPC pn:open-file not wired both ways');
const bridgeMethods = new Set([...pre.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
const platform = r('src/lib/platform.ts');
const iface = platform.slice(platform.indexOf('interface DesktopBridge'), platform.indexOf('}', platform.indexOf('interface DesktopBridge')));
for (const m of iface.matchAll(/^\s+(\w+)\(/gm)) check(bridgeMethods.has(m[1]), `DesktopBridge.${m[1]} is declared but preload does not expose it`);

// 9. Every relative import in src resolves
for (const f of files.filter((f) => f.startsWith('src/') && /\.(ts|tsx)$/.test(f))) {
  for (const m of r(f).matchAll(/from\s+'(\.[^']+)'/g)) {
    const base = join(dirname(f), m[1]);
    const ok = ['', '.ts', '.tsx', '/index.ts', '/index.tsx', '.css'].some((ext) => existsSync(join(ROOT, base + ext)));
    check(ok, `${f}: import '${m[1]}' does not resolve`);
  }
}

// 10. Supabase: tables/bucket the code uses exist in schema.sql, with RLS, realtime and server timestamps
const sql = r('supabase/schema.sql');
const sync = r('src/lib/sync.ts');
const tables = new Set([...sync.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1]));
const tableConst = /TABLES = \[([^\]]+)\]/.exec(sync)?.[1].match(/'(\w+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];
for (const t of [...tables, ...tableConst]) {
  check(new RegExp(`create table if not exists public\\.${t}\\b`).test(sql), `schema.sql: table ${t} used by sync.ts is not created`);
  check(new RegExp(`alter table public\\.${t} enable row level security`).test(sql), `schema.sql: RLS not enabled on ${t}`);
  check(new RegExp(`supabase_realtime add table public\\.${t}`).test(sql), `schema.sql: ${t} not added to realtime`);
  check(new RegExp(`create trigger ${t}_touch`).test(sql), `schema.sql: ${t} has no server timestamp trigger`);
}
const bucket = /BUCKET = '(\w+)'/.exec(sync)?.[1];
check(!!bucket && sql.includes(`values ('${bucket}'`), `schema.sql: storage bucket '${bucket}' not created`);
// every column the client sends must exist
const types = r('src/lib/types.ts');
const localOnly = new Set(['dirty', 'synced_at', 'has_blob']);
for (const [iface2, table] of [['Folder', 'folders'], ['Note', 'notes'], ['AttachmentMeta', 'attachments']]) {
  const body = types.slice(types.indexOf(`interface ${iface2} `), types.indexOf('}', types.indexOf(`interface ${iface2} `)));
  const cols = [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).filter((c) => !localOnly.has(c));
  const tdef = sql.slice(sql.indexOf(`public.${table} (`), sql.indexOf(');', sql.indexOf(`public.${table} (`)));
  for (const c of cols) check(new RegExp(`\\n\\s+${c}\\s`).test(tdef), `schema.sql: ${table}.${c} is sent by the app but the column does not exist`);
}
check(/strip\(/.test(sync) && /dirty: _d, synced_at: _s, has_blob: _h/.test(sync), 'sync.ts must strip local-only fields before upload');

// 11. Editor understands every block the OneNote importer produces
const on = r('src/lib/onenote.ts');
const att = r('src/components/AttachmentNode.ts');
const ed = r('src/components/Editor.tsx');
if (on.includes('data-pn-att')) check(att.includes("tag: 'div[data-pn-att]'") && ed.includes('AttachmentNode'), 'importer emits data-pn-att blocks but the editor has no parser for them');
if (on.includes('data-type="taskList"')) check(/TaskList/.test(ed) && /TaskItem/.test(ed), 'importer emits task lists but the editor lacks TaskList/TaskItem');
if (on.includes('<table>')) check(/TableKit/.test(ed), 'importer emits tables but the editor lacks table support');
if (on.includes('<img')) check(/Image\.configure/.test(ed), 'importer emits images but the editor lacks Image');
check(r('src/lib/util.ts').includes('data-pn-att="'), 'attachmentIdsIn must find data-pn-att blocks (else .pn exports drop attachments)');

// 12. iPhone web app: manifest + service worker wired
check(r('index.html').includes('manifest.webmanifest') && existsSync(join(ROOT, 'public/manifest.webmanifest')), 'web app manifest not linked');
check(r('public/sw.js').includes('__PN_FILES__') && r('vite.config.ts').includes('__PN_FILES__'), 'service worker file list is not injected at build');
check(r('src/main.tsx').includes("serviceWorker.register"), 'service worker is never registered');

// 13. Exporter (OneNote) is shipped and writes what the importer reads
check(existsSync(join(ROOT, 'onenote-exporter/Export-OneNote.ps1')), 'onenote-exporter missing');
const ps = r('onenote-exporter/Export-OneNote.ps1');
check(ps.includes("'pages.json'") && r('src/lib/onenoteImport.ts').includes("'pages.json'"), 'exporter/importer disagree about pages.json');
check(ps.includes("SetAttribute('exportedFile'") && on.includes("getAttribute('exportedFile')"), 'exporter/importer disagree about exportedFile');
check(ps.includes('hierarchy.xml') && r('src/lib/onenoteImport.ts').includes('hierarchy.xml'), 'exporter/importer disagree about hierarchy.xml');

// 14. CI workflow references real scripts
const wf = r('.github/workflows/build.yml');
for (const m of wf.matchAll(/"((?:mac|windows)\/[^"]+\.(?:command|bat))"/g)) check(existsSync(join(ROOT, m[1])), `workflow references missing ${m[1]}`);

// Account-wide artifact quota blocked builds once: deliver via Releases/gh-pages, never Actions artifacts
check(!/upload-artifact|upload-pages-artifact/.test(wf), 'workflow must not use Actions artifacts (account storage quota) - upload to the release instead');
check(/gh release upload[^\n]*Windows-Setup\.exe/.test(wf) && /gh release upload[^\n]*Mac\.dmg/.test(wf), 'workflow must attach both installers to the release');

// 15. Electron origin
check(r('electron/main.cjs').includes("loadURL('app://permanotes/index.html')"), 'electron must load the app:// URL (IndexedDB needs a stable origin)');

const rel = relative(process.cwd(), ROOT) || '.';
if (problems.length) {
  console.error(`\nAUDIT FAILED — ${problems.length} problem(s) in ${checks} checks (${rel}):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`Audit passed: ${checks} checks.`);
