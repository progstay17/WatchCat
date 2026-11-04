#!/usr/bin/env node
'use strict';
// Tes asap tanpa dependensi: sintaks semua berkas, --version/--help, render semua tab dengan data contoh
// (--selftest) di beberapa ukuran terminal, dan memastikan tidak ada error plugin/tampilan.
// Jalankan: node tests/smoke.js
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..'), MAIN = path.join(ROOT, 'watchcat-tui.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'watchcat-test-'));
const env = Object.assign({}, process.env, { WATCHCAT_DATA: DATA });
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };
const run = (args, opt) => cp.spawnSync(process.execPath, [MAIN].concat(args), Object.assign({ env, encoding: 'utf8', timeout: 30000 }, opt));

console.log('Sintaks');
for (const f of [MAIN].concat(fs.readdirSync(path.join(ROOT, 'plugins')).filter((x) => x.endsWith('.js')).map((x) => path.join(ROOT, 'plugins', x)))) {
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  ok(r.status === 0, path.relative(ROOT, f) + (r.status ? ': ' + r.stderr.split('\n')[0] : ''));
}

console.log('CLI');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
let r = run(['--version']); ok(r.stdout.trim() === pkg.version, '--version = package.json (' + pkg.version + ')');
r = run(['--help']); ok(/WatchCat TUI/.test(r.stdout) && /--headless/.test(r.stdout), '--help');

console.log('Render semua tab (data contoh)');
const TABS = ['Dashboard', 'Proses', 'Startup', 'Memori', 'Bloatware', 'Jaringan', 'Disk', 'Layanan', 'Scan', 'Notif', 'Log'];
for (const size of ['110x32', '80x24', '160x45']) {
  r = run(['--selftest', size]);
  ok(r.status === 0, size + ': selesai tanpa crash');
  const out = r.stdout;
  ok(!/Error tampilan/.test(out), size + ': tidak ada "Error tampilan"');
  const frames = (out.match(/^=== /gm) || []).length;
  ok(frames === TABS.length, size + ': ' + frames + '/' + TABS.length + ' frame');
}

console.log('Overlay');
for (const o of ['menu', 'confirm', 'help', 'input', 'newtab']) {
  r = run(['--selftest', o]); ok(r.status === 0 && /=== procs \+ /.test(r.stdout) && !/Error tampilan/.test(r.stdout), 'overlay ' + o);
}

console.log('Plugin termuat');
const log = fs.existsSync(path.join(DATA, 'tui.log')) ? fs.readFileSync(path.join(DATA, 'tui.log'), 'utf8') : '';
ok(!/Plugin .* gagal dimuat/.test(log), 'tidak ada plugin yang gagal dimuat');
ok(!/hook \w+:/.test(log), 'tidak ada error hook');
r = run(['--selftest', '110x32']);
for (const t of ['Jaringan', 'Disk', 'Layanan', 'Scan', 'Notif']) ok(r.stdout.includes(' ' + t + ' '), 'tab ' + t + ' terdaftar');

console.log('Rahasia');
r = run(['--selftest', 'notif']);
ok(!/AAFakeTokenForSelftestOnly/.test(r.stdout + log), 'token contoh tidak bocor ke layar/log');
ok(!fs.existsSync(path.join(DATA, 'headless.pid')), 'tidak ada pid file tertinggal');

try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
console.log('\n' + pass + ' lulus, ' + fail + ' gagal');
process.exit(fail ? 1 : 0);
