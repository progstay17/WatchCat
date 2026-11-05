#!/usr/bin/env node
'use strict';
// WatchCat TUI - monitor & penjaga Windows di terminal: menu, banyak tab, grafik langsung.
// Tanpa dependensi. Butuh Node 18+. Jalankan: node watchcat-tui.js   (--help untuk bantuan)
const os = require('os'), fs = require('fs'), path = require('path'), cp = require('child_process'), readline = require('readline');

const IS_WIN = process.platform === 'win32';
const VERSION = '1.1.0';
const DATA_DIR = process.env.WATCHCAT_DATA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.watchcat'), 'WatchCat');
const CFG_FILE = path.join(DATA_DIR, 'tui-config.json');
const BACKUP_FILE = path.join(DATA_DIR, 'startup-backup.jsonl');
const LOG_FILE = path.join(DATA_DIR, 'tui.log');

const DEFAULT_CFG = {
  protected: ['system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'explorer',
    'fontdrvhost', 'sihost', 'ctfmon', 'conhost', 'audiodg', 'taskmgr', 'runtimebroker', 'searchhost', 'startmenuexperiencehost',
    'shellexperiencehost', 'textinputhost', 'msmpeng', 'nissrv', 'securityhealthservice', 'memory compression', 'vmmem', 'vmmemwsl',
    'wslservice', 'wslhost', 'powershell', 'pwsh', 'cmd', 'windowsterminal', 'openconsole', 'code'],
  bloat: ['compattelrunner', 'onedrive', 'skype*', 'yourphone', 'phoneexperiencehost', 'gamebarpresencewriter', 'hxtsr', 'teams', 'ms-teams'],
  blockStartup: ['MicrosoftEdgeAutoLaunch*', 'OneDrive*', 'Docker Desktop', 'MSTeams*', 'Skype*', 'Spotify*'],
  leakIgnore: ['memory compression', 'vmmem', 'vmmemwsl', 'system', 'chrome', 'msedge', 'firefox', 'brave'],
};

// Hook sederhana untuk plugin: on('log'|'procs'|'tick'|'startup'|'leak'|'headless'|'quit', fn)
const HOOKS = {};
function emit(ev, arg) { for (const fn of HOOKS[ev] || []) { try { fn(arg); } catch (e) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' [WARN] hook ' + ev + ': ' + e.message + '\n'); } catch (x) { /* abaikan */ } } } }

// ------------------------------------------------------------------ util
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (s, w, a) => { s = String(s); if (s.length > w) s = w > 1 ? s.slice(0, w - 1) + '…' : s.slice(0, w); const sp = ' '.repeat(Math.max(0, w - s.length)); return a === 'r' ? sp + s : s + sp; };
const fmtMem = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : Math.round(b / 1048576) + ' MB');
const fmtUp = (s) => { s = Math.floor(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'h ' : '') + h + 'j ' + m + 'm'; };
const hhmmss = (d) => d.toTimeString().slice(0, 8);
const colorFor = (p) => (p >= 85 ? '31' : p >= 60 ? '33' : '32');
const globRe = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
const compile = (l) => (l || []).map(globRe);
const matchAny = (name, res) => res.some((r) => r.test(name));
const BLOCKS = ' ▁▂▃▄▅▆▇█';

function bar(frac, w) { const n = clamp(Math.round(frac * w), 0, w); return '█'.repeat(n) + '░'.repeat(w - n); }
function spark(vals, w) {
  if (!vals.length) return '';
  const v = vals.slice(-w); const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  return v.map((x) => BLOCKS[clamp(1 + Math.round((x - lo) / span * 7), 1, 8)]).join('');
}

// ------------------------------------------------------------------ config & state
let CFG = {}, USER_CFG = {};
function loadCfg() {
  let user = {};
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* abaikan */ }
  try {
    if (fs.existsSync(CFG_FILE)) user = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    else fs.writeFileSync(CFG_FILE, JSON.stringify(DEFAULT_CFG, null, 2));
  } catch (e) { logLine('WARN', 'Config tidak bisa dibaca: ' + e.message); }
  USER_CFG = user; applyCfg();
}
function applyCfg() {
  CFG = Object.assign({}, DEFAULT_CFG, USER_CFG);
  CFG.rProt = compile(CFG.protected); CFG.rBloat = compile(CFG.bloat); CFG.rBlock = compile(CFG.blockStartup); CFG.rLeak = compile(CFG.leakIgnore);
}

const S = {
  tabs: [], active: 0, overlay: null, paused: false, procInterval: 3000, autoKill: false,
  cpu: [], ram: [], cores: [], prevCpu: null,
  procs: [], groups: [], hist: new Map(), prevProc: new Map(), polling: false, procErr: '', lastPoll: 0,
  startup: [], backup: [], log: [], cooldown: new Map(), flagged: new Set(),
};

function logLine(level, msg) {
  const e = { t: new Date(), level, msg };
  S.log.push(e); if (S.log.length > 500) S.log.shift(); emit('log', e);
  try { fs.appendFileSync(LOG_FILE, e.t.toISOString() + ' [' + level + '] ' + msg + '\n'); } catch (x) { /* abaikan */ }
}
function cooldownOk(key, ms) { const n = Date.now(), p = S.cooldown.get(key); if (p && n - p < ms) return false; S.cooldown.set(key, n); return true; }

// ------------------------------------------------------------------ pengumpul data
function sampleCpu() {
  const cpus = os.cpus(); const cur = cpus.map((c) => { const t = c.times; return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }; });
  if (S.prevCpu && S.prevCpu.length === cur.length) {
    S.cores = cur.map((c, i) => { const dt = c.total - S.prevCpu[i].total, di = c.idle - S.prevCpu[i].idle; return dt > 0 ? clamp((1 - di / dt) * 100, 0, 100) : 0; });
    const avg = S.cores.reduce((a, b) => a + b, 0) / (S.cores.length || 1);
    S.cpu.push(avg);
  } else if (!S.cores.length) { S.cores = cur.map(() => 0); S.cpu.push(0); }
  S.prevCpu = cur;
  S.ram.push((1 - os.freemem() / os.totalmem()) * 100);
  if (S.cpu.length > 400) S.cpu.shift();
  if (S.ram.length > 400) S.ram.shift();
}

function parseProcs(out) {
  const list = [];
  if (IS_WIN) {
    for (const line of out.split(/\r?\n/)) {
      const p = line.trim().split('|'); if (p.length < 5) continue;
      const pid = +p[0]; if (!pid && pid !== 0) continue;
      list.push({ pid, name: p.slice(1, p.length - 3).join('|'), ws: +p[p.length - 3] || 0, priv: +p[p.length - 2] || 0, cpu: parseFloat(String(p[p.length - 1]).replace(',', '.')) || 0 });
    }
  } else {
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/); if (!m) continue;
      list.push({ pid: +m[1], name: m[2], ws: +m[3] * 1024, priv: +m[3] * 1024, cpu: +m[5] });
    }
  }
  return list;
}

function pollProcs() {
  if (S.polling) return; S.polling = true;
  const done = (err, out) => {
    S.polling = false;
    if (err && !out) S.procErr = String(err.message || err).split('\n')[0]; else { S.procErr = ''; applyProcs(parseProcs(out)); }
  };
  const opt = { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 25000 };
  if (IS_WIN) {
    const ps = "Get-Process | ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.Id,$_.ProcessName,$_.WorkingSet64,$_.PrivateMemorySize64,([double]$_.CPU).ToString('0.0',[Globalization.CultureInfo]::InvariantCulture) }";
    cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], opt, done);
  } else cp.execFile('ps', ['-eo', 'pid=,comm=,rss=,vsz=,times='], opt, done);
}

function applyProcs(list) {
  const now = Date.now(), cores = os.cpus().length || 1, prev = S.prevProc, next = new Map(), groups = new Map();
  for (const p of list) {
    const old = prev.get(p.pid); p.pct = 0;
    if (old && now > old.t) p.pct = clamp((p.cpu - old.cpu) / ((now - old.t) / 1000) / cores * 100, 0, 100);
    next.set(p.pid, { cpu: p.cpu, t: now });
    const k = p.name.toLowerCase(); let g = groups.get(k);
    if (!g) { g = { name: p.name, key: k, count: 0, ws: 0, priv: 0, pct: 0, pids: [] }; groups.set(k, g); }
    g.count++; g.ws += p.ws; g.priv += p.priv; g.pct += p.pct; g.pids.push(p.pid);
  }
  S.prevProc = next; S.procs = list; S.groups = [...groups.values()]; S.lastPoll = now;
  for (const g of S.groups) {
    let h = S.hist.get(g.key); if (!h) { h = { t: [], v: [] }; S.hist.set(g.key, h); }
    h.t.push(now); h.v.push(g.priv / 1048576); if (h.v.length > 180) { h.t.shift(); h.v.shift(); }
    const a = analyzeLeak(g.key);
    if (a.flag && !S.flagged.has(g.key)) { S.flagged.add(g.key); logLine('WARN', 'Kemungkinan memory leak: ' + g.name + ' +' + Math.round(a.growth) + ' MB (' + a.slope.toFixed(1) + ' MB/menit)'); emit('leak', { name: g.name, growth: a.growth, slope: a.slope, last: a.last }); }
    if (!a.flag) S.flagged.delete(g.key);
  }
  for (const k of [...S.hist.keys()]) if (!groups.has(k)) S.hist.delete(k);
  if (S.autoKill) for (const g of S.groups) if (isBloat(g.name) && cooldownOk('auto:' + g.key, 60000)) killGroup(g, true);
  emit('procs');
}

function analyzeLeak(key) {
  const h = S.hist.get(key); if (!h || h.v.length < 6) return { growth: 0, slope: 0, ratio: 0, flag: false, n: h ? h.v.length : 0, last: 0 };
  const v = h.v, last = v[v.length - 1], growth = last - v[0]; let up = 0;
  for (let i = 1; i < v.length; i++) if (v[i] >= v[i - 1] - 1) up++;
  const ratio = up / (v.length - 1), mins = Math.max((h.t[h.t.length - 1] - h.t[0]) / 60000, 0.01);
  return { growth, slope: growth / mins, ratio, n: v.length, last, flag: v.length >= 20 && last >= 300 && growth >= 80 && ratio >= 0.75 && !matchAny(key, CFG.rLeak) };
}

const isProtected = (name) => matchAny(name, CFG.rProt);
const isBloat = (name) => !isProtected(name) && matchAny(name, CFG.rBloat);

// ------------------------------------------------------------------ aksi
function killPid(pid, cb) {
  if (pid === process.pid) return cb(new Error('proses WatchCat sendiri'));
  if (IS_WIN) cp.execFile('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true }, (e, o, se) => cb(e ? new Error(String(se || o || e.message).trim().split(/\r?\n/)[0]) : null));
  else { try { process.kill(pid, 'SIGKILL'); cb(null); } catch (e) { cb(e); } }
}
function killGroup(g, auto) {
  if (isProtected(g.name)) { logLine('WARN', g.name + ' dilindungi, tidak dihentikan.'); return; }
  let ok = 0, fail = 0, last = '', left = g.pids.length;
  for (const pid of g.pids) killPid(pid, (e) => {
    if (e) { fail++; last = e.message; } else ok++;
    if (--left === 0) { logLine(fail && !ok ? 'WARN' : 'ACTION', (auto ? '[auto] ' : '') + g.name + ': ' + ok + ' dihentikan' + (fail ? ', ' + fail + ' gagal (' + last + ')' : '')); setTimeout(pollProcs, 400); }
  });
}

const RUN_KEYS = [{ scope: 'HKCU', key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' },
  { scope: 'HKLM', key: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' },
  { scope: 'HKLM32', key: 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run' }];

function regQuery(rk) {
  return new Promise((res) => cp.execFile('reg', ['query', rk.key], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
    const rows = []; if (!err) for (const line of String(out).split(/\r?\n/)) { const m = line.match(/^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/); if (m) rows.push({ scope: rk.scope, key: rk.key, name: m[1], value: m[3] }); }
    res(rows);
  }));
}
function readBackup() {
  const out = [];
  try { for (const l of fs.readFileSync(BACKUP_FILE, 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; try { const r = JSON.parse(l); r.key = String(r.key).replace(/^([A-Za-z0-9]+):\\?/, '$1\\'); out.push(r); } catch (e) { /* baris rusak */ } } } catch (e) { /* belum ada */ }
  return out;
}
async function refreshStartup() {
  let rows;
  if (IS_WIN) rows = (await Promise.all(RUN_KEYS.map(regQuery))).flat();
  else rows = S.demoStartup || (S.demoStartup = [{ scope: 'HKCU', key: 'HKCU\\...\\Run', name: 'MicrosoftEdgeAutoLaunch_DEMO', value: '"msedge.exe" --no-startup-window' }, { scope: 'HKCU', key: 'HKCU\\...\\Run', name: 'OneDrive', value: '"OneDrive.exe" /background' }, { scope: 'HKLM', key: 'HKLM\\...\\Run', name: 'SecurityHealth', value: 'SecurityHealthSystray.exe' }]);
  rows.forEach((r) => { r.bloat = matchAny(r.name, CFG.rBlock); });
  S.startup = rows;
  const active = new Set(rows.map((r) => r.key + '|' + r.name));
  const seen = new Set(); S.backup = readBackup().filter((r) => { const id = r.key + '|' + r.name; if (active.has(id) || seen.has(id)) return false; seen.add(id); return true; });
  emit('startup');
}
function removeStartup(e) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(BACKUP_FILE, JSON.stringify({ time: new Date().toISOString(), key: e.key, name: e.name, value: e.value }) + '\n'); } catch (x) { logLine('WARN', 'Cadangan gagal ditulis: ' + x.message); return; }
  if (!IS_WIN) { S.demoStartup = S.demoStartup.filter((r) => r !== e); logLine('ACTION', '[demo] autostart dihapus: ' + e.name); return refreshStartup(); }
  cp.execFile('reg', ['delete', e.key, '/v', e.name, '/f'], { windowsHide: true }, (err, o, se) => {
    logLine(err ? 'WARN' : 'ACTION', err ? 'Gagal hapus autostart ' + e.name + ': ' + String(se || o || err.message).trim().split(/\r?\n/)[0] : 'Autostart dihapus: ' + e.name + ' (cadangan tersimpan)');
    refreshStartup();
  });
}
function restoreStartup(r) {
  const finish = () => { try { const keep = readBackup().filter((x) => !(x.key === r.key && x.name === r.name)); fs.writeFileSync(BACKUP_FILE, keep.map((x) => JSON.stringify(x)).join('\n') + (keep.length ? '\n' : '')); } catch (x) { /* abaikan */ } refreshStartup(); };
  if (!IS_WIN) { S.demoStartup.push({ scope: 'HKCU', key: r.key, name: r.name, value: r.value }); logLine('ACTION', '[demo] dipulihkan: ' + r.name); return finish(); }
  cp.execFile('reg', ['add', r.key, '/v', r.name, '/t', 'REG_SZ', '/d', r.value, '/f'], { windowsHide: true }, (err, o, se) => {
    logLine(err ? 'WARN' : 'ACTION', err ? 'Gagal memulihkan ' + r.name + ': ' + String(se || o || err.message).trim().split(/\r?\n/)[0] : 'Autostart dipulihkan: ' + r.name);
    finish();
  });
}

// ------------------------------------------------------------------ layar (grid sel)
class Screen {
  constructor(w, h) { this.w = w; this.h = h; this.ch = []; this.st = []; for (let y = 0; y < h; y++) { this.ch.push(new Array(w).fill(' ')); this.st.push(new Array(w).fill('0')); } }
  put(x, y, text, style) { if (y < 0 || y >= this.h) return; let i = 0; for (const c of String(text)) { const xx = x + i++; if (xx < 0) continue; if (xx >= this.w) break; this.ch[y][xx] = c; this.st[y][xx] = style || '0'; } }
  fill(x, y, w, h, ch, style) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && xx < this.w && yy >= 0 && yy < this.h) { this.ch[yy][xx] = ch || ' '; this.st[yy][xx] = style || '0'; } } }
  box(x, y, w, h, style, title) {
    if (w < 2 || h < 2) return; this.fill(x, y, w, h, ' ', '0');
    this.put(x, y, '┌' + '─'.repeat(w - 2) + '┐', style); this.put(x, y + h - 1, '└' + '─'.repeat(w - 2) + '┘', style);
    for (let j = 1; j < h - 1; j++) { this.put(x, y + j, '│', style); this.put(x + w - 1, y + j, '│', style); }
    if (title) this.put(x + 2, y, ' ' + title + ' ', '1;36');
  }
  row(y) { let s = '', cur = ''; for (let x = 0; x < this.w; x++) { if (this.st[y][x] !== cur) { cur = this.st[y][x]; s += '\x1b[0;' + cur + 'm'; } s += this.ch[y][x]; } return s + '\x1b[0m'; }
  text() { return this.ch.map((r) => r.join('').replace(/\s+$/, '')).join('\n'); }
}

function drawChart(scr, x, y, w, h, vals, max, styleFn) {
  const n = Math.min(w, vals.length), total = h * 8;
  scr.put(x, y + h - 1, '·'.repeat(w - n), '2');
  for (let c = 0; c < n; c++) {
    const v = vals[vals.length - n + c], lvl = clamp(Math.round(v / max * total), 0, total), st = styleFn(v), cx = x + w - n + c;
    for (let r = 0; r < h; r++) { const f = clamp(lvl - r * 8, 0, 8); if (f > 0) scr.put(cx, y + h - 1 - r, BLOCKS[f], st); }
  }
}
function chartBox(scr, x, y, w, h, title, vals, opt) {
  scr.box(x, y, w, h, '36', title); if (h < 4 || w < 14) return;
  const lw = 7, cw = w - 2 - lw, ch = h - 2;
  scr.put(x + 1, y + 1, pad(opt.top, lw - 1, 'r'), '2'); scr.put(x + 1, y + h - 2, pad(opt.bottom, lw - 1, 'r'), '2');
  drawChart(scr, x + 1 + lw, y + 1, cw, ch, vals.map((v) => v - (opt.lo || 0)), opt.span, (v) => opt.style(v + (opt.lo || 0)));
}

function drawTable(scr, x, y, w, h, cols, rows, selKey, rowKey, tab, rowStyle) {
  const fixed = cols.reduce((a, c) => a + (c.flex ? 0 : c.w), 0) + cols.length - 1, flexW = Math.max(6, w - fixed), ws = cols.map((c) => (c.flex ? flexW : c.w));
  scr.fill(x, y, w, 1, ' ', '1;36;100'); let hx = x; cols.forEach((c, i) => { scr.put(hx, y, pad(c.t, ws[i], c.a), '1;36;100'); hx += ws[i] + 1; });
  const vis = Math.max(1, h - 1); tab.page = vis;
  let idx = rows.findIndex((r) => rowKey(r) === selKey); if (idx < 0) idx = 0;
  tab.scroll = clamp(tab.scroll || 0, 0, Math.max(0, rows.length - vis)); if (idx < tab.scroll) tab.scroll = idx; if (idx >= tab.scroll + vis) tab.scroll = idx - vis + 1;
  for (let i = 0; i < vis; i++) {
    const r = rows[tab.scroll + i]; if (!r) break; const sel = tab.scroll + i === idx, base = rowStyle ? rowStyle(r) : '0', st = sel ? '30;46' : base;
    scr.fill(x, y + 1 + i, w, 1, ' ', st); let cx = x;
    cols.forEach((c, j) => { scr.put(cx, y + 1 + i, pad(c.f(r, ws[j]), ws[j], c.a), !sel && c.style ? c.style(r) : st); cx += ws[j] + 1; });
  }
  if (rows.length > vis) scr.put(x + w - 12, y, pad((idx + 1) + '/' + rows.length, 11, 'r'), '1;36;100');
  return rows[idx];
}
function listKey(tab, rows, k, rowKey) {
  const n = rows.length; if (!n) return false; let i = rows.findIndex((r) => rowKey(r) === tab.selKey); if (i < 0) i = 0; let ni = i; const pg = tab.page || 10;
  switch (k.name) { case 'up': ni = i - 1; break; case 'down': ni = i + 1; break; case 'pageup': ni = i - pg; break; case 'pagedown': ni = i + pg; break; case 'home': ni = 0; break; case 'end': ni = n - 1; break; default: return false; }
  tab.selKey = rowKey(rows[clamp(ni, 0, n - 1)]); return true;
}

// Daftar alamat antarmuka jaringan dari API bawaan Node.js (tanpa akses admin).
function getNetworkRows() {
  const rows = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of (list || [])) rows.push({ name, address: n.address, family: n.family, internal: !!n.internal, mac: n.mac || '—', cidr: n.cidr || '—' });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.family.localeCompare(b.family));
}

// ------------------------------------------------------------------ tampilan (view)
const VIEWS = {};

VIEWS.dashboard = {
  title: 'Dashboard', hints: 'p jeda · +/- interval · r segarkan',
  render(scr, r) {
    const sysH = r.h >= 20 ? 10 : Math.max(0, r.h - 8), chH = r.h - sysH, lw = Math.floor(r.w / 2), cpu = S.cpu[S.cpu.length - 1] || 0, ram = S.ram[S.ram.length - 1] || 0;
    chartBox(scr, r.x, r.y, lw, chH, 'CPU  ' + cpu.toFixed(0) + '%', S.cpu, { top: '100%', bottom: '0', span: 100, style: (v) => colorFor(v) });
    chartBox(scr, r.x + lw, r.y, r.w - lw, chH, 'RAM terpakai  ' + ram.toFixed(0) + '%  (' + fmtMem(os.totalmem() - os.freemem()) + ' / ' + fmtMem(os.totalmem()) + ')', S.ram, { top: '100%', bottom: '0', span: 100, style: (v) => colorFor(v) });
    if (sysH < 5) return;
    const y = r.y + chH, bw = Math.floor(r.w / 2), iw = bw - 4;
    scr.box(r.x, y, bw, sysH, '36', 'Sistem'); let ly = y + 1; const L = (t, st) => { scr.put(r.x + 2, ly++, pad(t, iw), st || '0'); };
    L(os.hostname() + '  ·  ' + os.type() + ' ' + os.release()); L('Uptime  ' + fmtUp(os.uptime()));
    const bw2 = clamp(iw - 34, 4, 20), used = 1 - os.freemem() / os.totalmem(); L('RAM     ' + bar(used, bw2) + ' ' + pad((used * 100).toFixed(0) + '%', 4, 'r') + '  kosong ' + fmtMem(os.freemem()), colorFor(used * 100));
    try { const d = fs.statfsSync(IS_WIN ? 'C:\\' : '/'), tot = d.blocks * d.bsize, fr = d.bavail * d.bsize; L('Disk    ' + bar(1 - fr / tot, bw2) + ' ' + pad(((1 - fr / tot) * 100).toFixed(0) + '%', 4, 'r') + '  kosong ' + fmtMem(fr), colorFor((1 - fr / tot) * 100)); } catch (e) { L('Disk    (tidak terbaca)', '2'); }
    scr.put(r.x + 2, ly, pad('Core    ', 8), '0'); S.cores.slice(0, iw - 9).forEach((c, i) => scr.put(r.x + 10 + i, ly, BLOCKS[clamp(1 + Math.round(c / 100 * 7), 1, 8)], colorFor(c))); ly++;
    const netRows = getNetworkRows(), ipv4 = netRows.filter((n) => n.family === 'IPv4' && !n.internal);
    L('Jaringan ' + netRows.length + ' alamat · ' + (ipv4.length ? ipv4.slice(0, 2).map((n) => n.address).join(', ') : 'tidak terhubung'), ipv4.length ? '36' : '2');
    L('Proses  ' + S.procs.length + ' jalan · pantau tiap ' + S.procInterval / 1000 + 'dtk' + (S.paused ? ' · DIJEDA' : '') + (S.autoKill ? ' · auto-bloat ON' : ''), S.paused ? '33' : '0');
    const leaks = S.flagged.size; if (S.procErr) L('! ' + S.procErr, '31'); else if (os.freemem() / os.totalmem() < 0.1) L('! RAM hampir habis', '1;31'); else if (leaks) L('! ' + leaks + ' proses dicurigai memory leak (tab Memori)', '1;33'); else L('Semua normal', '32');
    const rw = r.w - bw, rows = [...S.groups].sort((a, b) => b.ws - a.ws).slice(0, sysH - 2), mx = rows.length ? rows[0].ws : 1, nw = 17;
    scr.box(r.x + bw, y, rw, sysH, '36', 'Pemakai resource terbesar');
    rows.forEach((g, i) => {
      const label = pad(g.name, nw) + pad(fmtMem(g.ws), 8, 'r') + pad(g.pct.toFixed(0) + '%', 5, 'r');
      scr.put(r.x + bw + 2, y + 1 + i, label + ' ' + bar(g.ws / mx, Math.max(2, rw - 4 - nw - 15)), i === 0 ? '33' : '0');
    });
  },
  key() { return false; },
};

VIEWS.procs = {
  title: 'Proses', hints: '↑↓ pilih · k hentikan · s urut · g grup/PID · / cari',
  init() { return { sort: 'mem', group: true, filter: '' }; },
  rows(tab) {
    let rows = tab.group ? S.groups.map((g) => ({ k: g.key, name: g.name, n: g.count, pct: g.pct, ws: g.ws, pids: g.pids }))
      : S.procs.map((p) => ({ k: String(p.pid), name: p.name, n: p.pid, pct: p.pct, ws: p.ws, pids: [p.pid] }));
    if (tab.filter) { const f = tab.filter.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(f)); }
    const s = { mem: (a, b) => b.ws - a.ws, cpu: (a, b) => b.pct - a.pct, name: (a, b) => a.name.localeCompare(b.name) }[tab.sort]; return rows.sort(s);
  },
  render(scr, r, tab) {
    const rows = this.rows(tab), mx = Math.max(1, ...rows.map((x) => x.ws)), detH = r.h >= 22 ? 9 : (r.h >= 16 ? 6 : 0);
    const age = S.lastPoll ? Math.max(0, Math.floor((Date.now() - S.lastPoll) / 1000)) : null;
    const summary = rows.length + ' entri' + (tab.group ? ' · dikelompokkan' : ' · per PID') + ' · urut ' + { mem: 'memori', cpu: 'CPU', name: 'nama' }[tab.sort]
      + (age === null ? ' · menunggu data' : ' · diperbarui ' + age + ' dtk lalu')
      + (tab.filter ? ' · filter: "' + tab.filter + '"' : '') + (S.procErr ? ' · ! ' + S.procErr : '');
    scr.put(r.x, r.y, pad(' ' + summary, r.w), S.procErr ? '33' : '2');
    const cols = [{ t: 'Nama', w: 26, f: (x) => (x.disp || x.name) + (isProtected(x.name) ? ' *' : '') }, { t: tab.group ? 'Jml' : 'PID', w: 6, a: 'r', f: (x) => x.n }, { t: 'CPU%', w: 6, a: 'r', f: (x) => x.pct.toFixed(1), style: (x) => colorFor(x.pct * 2) },
      { t: 'Memori', w: 10, a: 'r', f: (x) => fmtMem(x.ws) }, { t: '', flex: true, f: (x, w) => bar(x.ws / mx, w), style: () => '34' }];
    const sel = drawTable(scr, r.x, r.y + 1, r.w, r.h - 1 - detH, cols, rows, tab.selKey, (x) => x.k, tab, (x) => (isBloat(x.name) ? '33' : '0'));
    if (!rows.length) {
      const msg = tab.filter ? 'Tidak ada proses yang cocok. Tekan Esc untuk menghapus filter.' : (S.procErr ? 'Data proses belum tersedia. Tekan r untuk mencoba lagi.' : 'Menunggu daftar proses pertama…');
      scr.put(r.x + 2, r.y + 3, pad(msg, r.w - 4), '2');
    }
    if (sel && !tab.selKey) tab.selKey = sel.k;
    if (detH && sel) {
      const h = S.hist.get(sel.name.toLowerCase()), y = r.y + r.h - detH;
      scr.box(r.x, y, r.w, detH, '36', 'Ringkasan proses: ' + sel.name);
      const status = isProtected(sel.name) ? 'DILINDUNGI' : isBloat(sel.name) ? 'BLOATWARE' : 'NORMAL';
      scr.put(r.x + 2, y + 1, pad(sel.pids.length + ' proses · PID ' + sel.pids.slice(0, 6).join(', ') + (sel.pids.length > 6 ? ' …' : '') + ' · ' + status, r.w - 4), isProtected(sel.name) ? '32' : isBloat(sel.name) ? '33' : '2');
      scr.put(r.x + 2, y + 2, pad('CPU ' + sel.pct.toFixed(1) + '% · RAM ' + fmtMem(sel.ws) + ' · ' + (tab.group ? 'total grup' : 'proses terpilih'), r.w - 4), '1');
      if (h) { scr.put(r.x + 2, y + 3, 'Tren RAM ', '2'); scr.put(r.x + 11, y + 3, spark(h.v, r.w - 14), '36'); scr.put(r.x + 2, y + 4, pad('sekarang ' + Math.round(h.v[h.v.length - 1]) + ' MB · rentang ' + Math.round(Math.min(...h.v)) + '–' + Math.round(Math.max(...h.v)) + ' MB · ' + h.v.length + ' sampel', r.w - 4), '2'); }
      const ex = this.detail ? this.detail(sel, tab) : [];
      ex.slice(0, Math.max(0, detH - 6)).forEach((l, i) => scr.put(r.x + 2, y + 5 + i, pad(l, r.w - 4), '2'));
    }
  },
  key(k, tab) {
    const rows = this.rows(tab), cur = rows.find((x) => x.k === tab.selKey) || rows[0];
    if (listKey(tab, rows, k, (x) => x.k)) return true;
    if (k.name === 's') { tab.sort = { mem: 'cpu', cpu: 'name', name: 'mem' }[tab.sort]; return true; }
    if (k.name === 'g') { tab.group = !tab.group; tab.selKey = null; return true; }
    if (k.str === '/') { S.overlay = { type: 'input', title: 'Cari proses', value: tab.filter, done: (v) => { tab.filter = v.trim(); tab.selKey = null; } }; return true; }
    if (k.name === 'escape' && tab.filter) { tab.filter = ''; return true; }
    if (k.name === 'k' && cur) {
      if (isProtected(cur.name)) { logLine('WARN', cur.name + ' dilindungi, tidak bisa dihentikan.'); return true; }
      S.overlay = { type: 'confirm', text: ['Hentikan "' + cur.name + '"?', cur.pids.length + ' proses (' + fmtMem(cur.ws) + '). Data yang belum disimpan bisa hilang.'], yes: () => killGroup({ name: cur.name, pids: cur.pids }) }; return true;
    }
    return false;
  },
};

VIEWS.startup = {
  title: 'Startup', hints: '↑↓ pilih · d hapus dari autostart · Enter pulihkan · r segarkan',
  init() { return {}; },
  rows() { return [...S.startup.map((e) => ({ k: 'a|' + e.key + '|' + e.name, kind: 'aktif', e })), ...S.backup.map((e) => ({ k: 'b|' + e.key + '|' + e.name, kind: 'cadangan', e }))]; },
  render(scr, r, tab) {
    const rows = this.rows();
    scr.put(r.x, r.y, pad(' Aktif: ' + S.startup.length + ' · Dicadangkan (sudah dihapus, bisa dipulihkan): ' + S.backup.length + (IS_WIN ? '' : ' · [mode demo, bukan Windows]'), r.w), '2');
    const cols = [{ t: 'Status', w: 10, f: (x) => (x.kind === 'cadangan' ? 'dihapus' : x.e.bloat ? 'bloat' : 'aktif'), style: (x) => (x.kind === 'cadangan' ? '2' : x.e.bloat ? '33' : '32') },
      { t: 'Lokasi', w: 7, f: (x) => x.e.scope || (x.e.key.startsWith('HKLM') ? 'HKLM' : 'HKCU') }, { t: 'Nama', w: 34, f: (x) => x.e.name }, { t: 'Perintah', flex: true, f: (x) => x.e.value }];
    const sel = drawTable(scr, r.x, r.y + 1, r.w, r.h - 1, cols, rows, tab.selKey, (x) => x.k, tab, (x) => (x.kind === 'cadangan' ? '2' : '0'));
    if (sel && !tab.selKey) tab.selKey = sel.k;
    if (!rows.length) scr.put(r.x + 2, r.y + 3, 'Tidak ada entri autostart.', '2');
  },
  key(k, tab) {
    const rows = this.rows(), cur = rows.find((x) => x.k === tab.selKey) || rows[0];
    if (listKey(tab, rows, k, (x) => x.k)) return true;
    if (k.name === 'r') { refreshStartup(); return true; }
    if (!cur) return false;
    if (k.name === 'd' && cur.kind === 'aktif') { S.overlay = { type: 'confirm', text: ['Hapus "' + cur.e.name + '" dari autostart?', 'Aplikasinya tetap terpasang. Cadangan disimpan, bisa dipulihkan dari tab ini.'], yes: () => removeStartup(cur.e) }; return true; }
    if (k.name === 'return' && cur.kind === 'cadangan') { restoreStartup(cur.e); return true; }
    return false;
  },
};

VIEWS.memory = {
  title: 'Memori', hints: '↑↓ pilih · s urut · / cari · Esc hapus pencarian',
  init() { return { sort: 'grow', query: '' }; },
  rows(tab) {
    let rows = S.groups.filter((g) => !matchAny(g.key, CFG.rLeak) || S.hist.get(g.key)).map((g) => { const a = analyzeLeak(g.key); return { k: g.key, name: g.name, mb: g.priv / 1048576, a }; });
    if (tab.query) rows = rows.filter((x) => x.name.toLowerCase().includes(tab.query.toLowerCase()));
    return rows.sort(tab.sort === 'grow' ? (x, y) => (y.a.flag - x.a.flag) || (y.a.slope - x.a.slope) : (x, y) => y.mb - x.mb);
  },
  render(scr, r, tab) {
    const rows = this.rows(tab), chH = r.h >= 18 ? 9 : 0, flagged = rows.filter((x) => x.a.flag).length;
    const tracked = rows.reduce((n, x) => n + x.mb, 0);
    scr.put(r.x, r.y, pad(' ' + rows.length + ' proses · ' + Math.round(tracked) + ' MB terpantau · ' + flagged + ' dugaan leak · urut ' + (tab.sort === 'grow' ? 'tren naik' : 'ukuran') + (tab.query ? ' · cari: ' + tab.query : '') + ' · ⚠ bukan kepastian', r.w), flagged ? '33' : '2');
    const cols = [{ t: '', w: 2, f: (x) => (x.a.flag ? '⚠' : ' '), style: () => '1;31' }, { t: 'Nama', w: 26, f: (x) => x.name }, { t: 'Memori', w: 10, a: 'r', f: (x) => Math.round(x.mb) + ' MB' },
      { t: 'Naik', w: 10, a: 'r', f: (x) => (x.a.n < 6 ? '…' : (x.a.growth >= 0 ? '+' : '') + Math.round(x.a.growth) + ' MB'), style: (x) => (x.a.flag ? '31' : x.a.growth > 40 ? '33' : '0') },
      { t: 'MB/menit', w: 9, a: 'r', f: (x) => (x.a.n < 6 ? '…' : x.a.slope.toFixed(1)) }, { t: 'Tren', flex: true, f: (x, w) => { const h = S.hist.get(x.k); return h ? spark(h.v, w) : ''; }, style: () => '36' }];
    const sel = drawTable(scr, r.x, r.y + 1, r.w, r.h - 1 - chH, cols, rows, tab.selKey, (x) => x.k, tab, (x) => (x.a.flag ? '31' : '0'));
    if (sel && !tab.selKey) tab.selKey = sel.k;
    if (!rows.length) scr.put(r.x + 2, r.y + 3, tab.query ? 'Tidak ada proses cocok. Esc untuk hapus pencarian.' : 'Belum ada data proses. Tunggu satu siklus pemantauan.', '2');
    if (chH && sel) {
      const h = S.hist.get(sel.k), y = r.y + r.h - chH; if (!h || h.v.length < 2) { scr.box(r.x, y, r.w, chH, '36', 'Grafik: ' + sel.name); scr.put(r.x + 2, y + 2, 'Mengumpulkan data…', '2'); return; }
      const lo = Math.min(...h.v), hi = Math.max(...h.v), span = Math.max(hi - lo, 10), mins = (h.t[h.t.length - 1] - h.t[0]) / 60000;
      chartBox(scr, r.x, y, r.w, chH, 'Grafik: ' + sel.name + ' · ' + mins.toFixed(1) + ' menit terakhir', h.v, { top: Math.round(lo + span) + 'MB', bottom: Math.round(lo) + 'MB', lo, span, style: () => (sel.a.flag ? '31' : '36') });
    }
  },
  key(k, tab) { const rows = this.rows(tab); if (listKey(tab, rows, k, (x) => x.k)) return true; if (k.name === 's') { tab.sort = tab.sort === 'grow' ? 'size' : 'grow'; return true; } if (k.str === '/') { S.overlay = { type: 'input', title: 'Cari proses memori', value: tab.query, done: (v) => { tab.query = v.trim(); tab.selKey = null; } }; return true; } if (k.name === 'escape' && tab.query) { tab.query = ''; tab.selKey = null; return true; } return false; },
};

VIEWS.bloat = {
  title: 'Bloatware', hints: '↑↓ pilih · k hentikan · K hentikan semua · a auto-hentikan · r muat ulang config',
  init() { return {}; },
  rows() { return S.groups.filter((g) => isBloat(g.name)).map((g) => ({ k: g.key, name: g.name, n: g.count, ws: g.ws, pids: g.pids })); },
  render(scr, r, tab) {
    const rows = this.rows(), listH = Math.max(4, r.h - 9);
    scr.put(r.x, r.y, pad(' Bloatware yang sedang jalan: ' + rows.length + ' · auto-hentikan: ' + (S.autoKill ? 'ON (tiap proses baru dihentikan)' : 'OFF'), r.w), S.autoKill ? '1;33' : '2');
    const cols = [{ t: 'Nama', w: 28, f: (x) => x.name }, { t: 'Jml', w: 5, a: 'r', f: (x) => x.n }, { t: 'Memori', w: 10, a: 'r', f: (x) => fmtMem(x.ws) }, { t: 'PID', flex: true, f: (x) => x.pids.slice(0, 8).join(', ') }];
    const sel = drawTable(scr, r.x, r.y + 1, r.w, listH, cols, rows, tab.selKey, (x) => x.k, tab);
    if (sel && !tab.selKey) tab.selKey = sel.k; if (!rows.length) scr.put(r.x + 2, r.y + 3, 'Bersih: tidak ada proses bloatware yang jalan.', '32');
    const y = r.y + 1 + listH; if (r.y + r.h - y < 5) return;
    scr.box(r.x, y, r.w, r.y + r.h - y, '36', 'Daftar pola (dari config)');
    const lines = ['Proses : ' + CFG.bloat.join(', '), 'Startup: ' + CFG.blockStartup.join(', '), 'Dilindungi: ' + CFG.protected.length + ' pola (proses sistem, dll.)', 'Config : ' + CFG_FILE + '  (edit lalu tekan r)'];
    lines.forEach((l, i) => { if (y + 1 + i < r.y + r.h - 1) scr.put(r.x + 2, y + 1 + i, pad(l, r.w - 4), i === 3 ? '2' : '0'); });
  },
  key(k, tab) {
    const rows = this.rows(), cur = rows.find((x) => x.k === tab.selKey) || rows[0];
    if (listKey(tab, rows, k, (x) => x.k)) return true;
    if (k.name === 'r') { loadCfg(); refreshStartup(); logLine('INFO', 'Config dimuat ulang.'); return true; }
    if (k.name === 'a') { S.autoKill = !S.autoKill; logLine('INFO', 'Auto-hentikan bloatware ' + (S.autoKill ? 'ON' : 'OFF')); return true; }
    if (k.name === 'k' && !k.shift && cur) { S.overlay = { type: 'confirm', text: ['Hentikan "' + cur.name + '"?', cur.pids.length + ' proses (' + fmtMem(cur.ws) + ').'], yes: () => killGroup({ name: cur.name, pids: cur.pids }) }; return true; }
    if ((k.name === 'k' && k.shift) || k.str === 'K') { if (rows.length) S.overlay = { type: 'confirm', text: ['Hentikan SEMUA bloatware yang jalan?', rows.map((x) => x.name).join(', ')], yes: () => rows.forEach((x) => killGroup({ name: x.name, pids: x.pids })) }; return true; }
    return false;
  },
};

VIEWS.log = {
  title: 'Log', hints: '↑↓ gulir · f filter level · / cari · Esc reset · End terbaru',
  init() { return { off: 0, level: 'ALL', query: '' }; },
  rows(tab) { return S.log.filter((e) => (tab.level === 'ALL' || e.level === tab.level) && (!tab.query || (e.level + ' ' + e.msg).toLowerCase().includes(tab.query.toLowerCase()))); },
  render(scr, r, tab) {
    const rows = this.rows(tab), n = r.h - 1, total = rows.length; tab.off = clamp(tab.off, 0, Math.max(0, total - n)); const end = total - tab.off, start = Math.max(0, end - n);
    scr.put(r.x, r.y, pad(' ' + total + '/' + S.log.length + ' entri · level ' + tab.level + (tab.query ? ' · cari: ' + tab.query : '') + ' · ' + LOG_FILE, r.w), '2');
    rows.slice(start, end).forEach((e, i) => { const st = { ACTION: '32', WARN: '33', ALERT: '1;33', INFO: '0' }[e.level] || '0'; scr.put(r.x + 1, r.y + 1 + i, pad(hhmmss(e.t) + ' ' + pad(e.level, 7) + e.msg, r.w - 2), st); });
    if (!total) scr.put(r.x + 2, r.y + 2, S.log.length ? 'Tidak ada log yang cocok dengan filter.' : 'Belum ada aktivitas.', '2');
  },
  key(k, tab) {
    const pg = (tab.page = 10);
    if (k.name === 'f') { tab.level = ({ ALL: 'WARN', WARN: 'ACTION', ACTION: 'ALERT', ALERT: 'INFO', INFO: 'ALL' })[tab.level]; tab.off = 0; return true; }
    if (k.str === '/') { S.overlay = { type: 'input', title: 'Cari log', value: tab.query, done: (v) => { tab.query = v.trim(); tab.off = 0; } }; return true; }
    if (k.name === 'escape' && (tab.query || tab.level !== 'ALL')) { tab.query = ''; tab.level = 'ALL'; tab.off = 0; return true; }
    if (k.name === 'up') tab.off++; else if (k.name === 'down') tab.off--; else if (k.name === 'pageup') tab.off += pg; else if (k.name === 'pagedown') tab.off -= pg; else if (k.name === 'end') tab.off = 0; else if (k.name === 'home') tab.off = 1e9; else return false;
    return true;
  },
};
const VIEW_ORDER = ['dashboard', 'procs', 'startup', 'memory', 'bloat', 'log'];

function newTab(type) { const v = VIEWS[type]; const t = Object.assign({ type, sel: 0, scroll: 0 }, v.init ? v.init() : {}); S.tabs.push(t); S.active = S.tabs.length - 1; return t; }
function tabTitle(i) { const t = S.tabs[i], same = S.tabs.filter((x) => x.type === t.type); return VIEWS[t.type].title + (same.length > 1 ? ' #' + (same.indexOf(t) + 1) : ''); }
function closeTab(i) { if (S.tabs.length <= 1) return; S.tabs.splice(i, 1); S.active = clamp(S.active, 0, S.tabs.length - 1); }

// ------------------------------------------------------------------ overlay
function openMenu() {
  S.overlay = { type: 'menu', title: 'Menu', sel: 0, items: [
    { label: 'Tab baru…', hint: 'n', fn: openNewTabMenu }, { label: 'Tutup tab ini', hint: 'w', fn: () => closeTab(S.active) },
    { label: 'Segarkan sekarang', hint: 'r', fn: refreshAll }, { label: S.paused ? 'Lanjutkan pemantauan' : 'Jeda pemantauan', hint: 'p', fn: () => { S.paused = !S.paused; } },
    { label: 'Interval proses: ' + S.procInterval / 1000 + ' dtk (ganti)', hint: '+ / -', fn: () => cycleInterval(1) },
    { label: 'Auto-hentikan bloatware: ' + (S.autoKill ? 'ON' : 'OFF'), hint: '', fn: () => { S.autoKill = !S.autoKill; logLine('INFO', 'Auto-hentikan bloatware ' + (S.autoKill ? 'ON' : 'OFF')); } },
    { label: 'Bantuan', hint: 'F1 / ?', fn: openHelp }, { label: 'Keluar', hint: 'q', fn: quit }] };
}
function openNewTabMenu() { S.overlay = { type: 'menu', title: 'Tab baru (pilih fitur)', sel: 0, items: VIEW_ORDER.map((t) => ({ label: VIEWS[t].title, hint: '', fn: () => newTab(t) })) }; }
function openHelp() { S.overlay = { type: 'help' }; }
function cycleInterval(d) { const L = [2000, 3000, 5000, 10000]; S.procInterval = L[clamp(L.indexOf(S.procInterval) + d, 0, L.length - 1)] || 3000; if (d > 0 && S.procInterval === 10000 && L.indexOf(S.procInterval) === L.length - 1) { /* batas atas */ } }
function refreshAll() { pollProcs(); refreshStartup(); }

const HELP = ['WatchCat TUI v' + VERSION, '', 'Tab        ← →  /  Tab  /  1-9      pindah tab', 'Tab baru   n      pilih fitur; satu fitur boleh dibuka di banyak tab', 'Tutup tab  w', 'Menu       F10  atau  m', 'Segarkan   r        Jeda  p        Interval  + / -', 'Daftar     ↑ ↓  PgUp PgDn  Home End', 'Keluar     q  atau  Ctrl+C', '', 'Proses: k hentikan · s urut · g grup/PID · / cari', 'Startup: d hapus dari autostart · Enter pulihkan', 'Bloatware: k / K hentikan · a auto-hentikan', '', 'Proses sistem & yang ada di daftar dilindungi tidak bisa dihentikan.', 'Tekan tombol apa saja untuk menutup.'];

function drawOverlay(scr) {
  const o = S.overlay; if (!o) return;
  const W = scr.w, H = scr.h;
  if (o.type === 'menu') {
    const w = Math.min(W - 4, Math.max(34, ...o.items.map((i) => i.label.length + i.hint.length + 6))), h = o.items.length + 4, x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
    scr.box(x, y, w, h, '1;36', o.title); o.items.forEach((it, i) => { const st = i === o.sel ? '30;46' : '0'; scr.fill(x + 1, y + 2 + i, w - 2, 1, ' ', st); scr.put(x + 2, y + 2 + i, it.label, st); scr.put(x + w - 2 - it.hint.length, y + 2 + i, it.hint, i === o.sel ? '30;46' : '2'); });
  } else if (o.type === 'confirm') {
    const w = Math.min(W - 4, Math.max(40, ...o.text.map((t) => t.length + 4))), h = o.text.length + 5, x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
    scr.box(x, y, w, h, '1;33', 'Konfirmasi'); o.text.forEach((t, i) => scr.put(x + 2, y + 2 + i, pad(t, w - 4), i ? '2' : '1')); scr.put(x + 2, y + h - 2, '[Y/Enter] ya    [N/Esc] batal', '36');
  } else if (o.type === 'input') {
    const w = Math.min(W - 4, 64), x = Math.floor((W - w) / 2), y = Math.floor((H - 5) / 2), txt = (o.mask ? '•'.repeat(o.value.length) : o.value) + '_', iw = w - 4;
    scr.box(x, y, w, 5, '1;36', o.title); scr.put(x + 2, y + 2, pad(txt.length > iw ? '…' + txt.slice(-(iw - 1)) : txt, iw), '1'); scr.put(x + 2, y + 3, 'Enter = oke · Esc = batal', '2');
  } else if (o.type === 'help') {
    const L = o.lines || HELP, w = Math.min(W - 4, o.lines ? 100 : 70), h = Math.min(H - 2, L.length + 2), x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
    scr.box(x, y, w, h, '1;36', o.title || 'Bantuan'); L.slice(0, h - 2).forEach((l, i) => scr.put(x + 2, y + 1 + i, pad(l, w - 4), i === 0 ? '1;36' : '0'));
  }
}

// ------------------------------------------------------------------ render
let prevRows = [], forceFull = true;
function buildFrame(w, h) {
  const scr = new Screen(w, h);
  if (w < 70 || h < 18) { scr.put(1, 1, 'Terminal terlalu kecil (' + w + 'x' + h + '). Minimal 70x18. Perbesar jendela.', '33'); return scr; }

  // Header ringkas: identitas aplikasi + metrik yang tetap terbaca saat terminal dipersempit.
  const cpuNow = S.cpu.length ? S.cpu[S.cpu.length - 1] : 0;
  const ramNow = (1 - os.freemem() / os.totalmem()) * 100;
  const procCount = S.procs.length;
  scr.fill(0, 0, w, 1, ' ', '30;47');
  scr.put(1, 0, ' WatchCat ', '1;30;46');
  if (w >= 100) {
    scr.put(12, 0, 'CPU ' + cpuNow.toFixed(0) + '%', cpuNow >= 85 ? '1;31;47' : '30;47');
    scr.put(23, 0, 'RAM ' + ramNow.toFixed(0) + '%', ramNow >= 90 ? '1;31;47' : '30;47');
    scr.put(34, 0, 'PROSES ' + procCount, '30;47');
    scr.put(48, 0, adminCache === true ? 'ADMIN' : adminCache === false ? 'USER' : '…', '30;47');
    scr.put(w - 9, 0, hhmmss(new Date()), '30;47');
    scr.put(w - 33, 0, 'F10 Menu · F1 Bantuan', '30;47');
  } else {
    scr.put(12, 0, 'C:' + cpuNow.toFixed(0) + '%', cpuNow >= 85 ? '1;31;47' : '30;47');
    scr.put(20, 0, 'R:' + ramNow.toFixed(0) + '%', ramNow >= 90 ? '1;31;47' : '30;47');
    if (w >= 82) scr.put(29, 0, 'P:' + procCount, '30;47');
    scr.put(w - 9, 0, hhmmss(new Date()), '30;47');
  }

  // Tab bar dengan penanda bila ada tab yang tersembunyi di kiri atau kanan.
  scr.fill(0, 1, w, 1, ' ', '0;100');
  let x = 0;
  const widths = S.tabs.map((_, i) => (' ' + (i + 1) + ' ' + tabTitle(i) + ' ').length + 1);
  let start = S.active;
  while (start > 0 && widths.slice(start, S.active + 1).reduce((a, b) => a + b, 0) < w - 8) start--;
  if (start > 0) { scr.put(0, 1, '‹', '1;36;100'); x = 2; }
  let i = start;
  for (; i < S.tabs.length; i++) {
    const label = ' ' + (i + 1) + ' ' + tabTitle(i) + ' ';
    const reserve = i < S.tabs.length - 1 ? 3 : 0;
    if (x + label.length + reserve > w) break;
    scr.put(x, 1, label, i === S.active ? '1;30;46' : '37;100');
    x += label.length + 1;
  }
  if (i < S.tabs.length) scr.put(w - 2, 1, '›', '1;36;100');

  const tab = S.tabs[S.active], v = VIEWS[tab.type], r = { x: 0, y: 2, w, h: h - 3 };
  try { v.render(scr, r, tab); } catch (e) { scr.put(1, 3, 'Error tampilan: ' + e.message, '31'); }

  // Footer memisahkan bantuan kontekstual dari status pemantauan.
  scr.fill(0, h - 1, w, 1, ' ', '30;47');
  scr.put(1, h - 1, pad(v.hints, Math.max(0, w - 34)), '30;47');
  const live = S.paused ? 'JEDA' : S.polling ? 'MEMINDAI' : 'LIVE';
  scr.put(w - 32, h - 1, pad(live, 9), S.paused ? '1;31;47' : S.polling ? '1;33;47' : '1;32;47');
  scr.put(w - 22, h - 1, pad('RAM kosong ' + fmtMem(os.freemem()), 21, 'r'), '30;47');
  drawOverlay(scr);
  return scr;
}
function render() {
  const w = process.stdout.columns || 100, h = process.stdout.rows || 30, scr = buildFrame(w, h); let out = '';
  if (forceFull || prevRows.length !== h) { out += '\x1b[2J'; prevRows = []; forceFull = false; }
  for (let y = 0; y < h; y++) { const s = scr.row(y); if (s !== prevRows[y]) { out += '\x1b[' + (y + 1) + ';1H' + s; prevRows[y] = s; } }
  if (out) process.stdout.write(out);
}

// ------------------------------------------------------------------ input
function handleOverlayKey(str, k) {
  const o = S.overlay;
  if (o.type === 'menu') {
    if (k.name === 'up') o.sel = (o.sel + o.items.length - 1) % o.items.length; else if (k.name === 'down') o.sel = (o.sel + 1) % o.items.length;
    else if (k.name === 'return') { const it = o.items[o.sel]; S.overlay = null; it.fn(); } else if (k.name === 'escape' || k.name === 'f10' || str === 'm') S.overlay = null;
  } else if (o.type === 'confirm') {
    if (k.name === 'y' || k.name === 'return') { S.overlay = null; o.yes(); } else if (k.name === 'n' || k.name === 'escape') S.overlay = null;
  } else if (o.type === 'input') {
    if (k.name === 'return') { S.overlay = null; o.done(o.value); } else if (k.name === 'escape') S.overlay = null;
    else if (k.name === 'backspace') o.value = o.value.slice(0, -1); else if (str && str.length === 1 && str >= ' ' && !k.ctrl) o.value += str;
  } else S.overlay = null;
}
function handleKey(str, key) {
  const k = Object.assign({}, key, { str }); if (k.ctrl && k.name === 'c') return quit();
  if (S.overlay) return handleOverlayKey(str, k);
  const tab = S.tabs[S.active]; if (VIEWS[tab.type].key(k, tab)) return;
  if (k.name === 'right' || (k.name === 'tab' && !k.shift)) S.active = (S.active + 1) % S.tabs.length;
  else if (k.name === 'left' || (k.name === 'tab' && k.shift)) S.active = (S.active + S.tabs.length - 1) % S.tabs.length;
  else if (/^[1-9]$/.test(str || '')) { if (+str <= S.tabs.length) S.active = +str - 1; }
  else if (k.name === 'n') openNewTabMenu(); else if (k.name === 'w') closeTab(S.active);
  else if (k.name === 'f10' || k.name === 'm') openMenu(); else if (k.name === 'f1' || str === '?') openHelp();
  else if (k.name === 'p') { S.paused = !S.paused; } else if (k.name === 'r') refreshAll();
  else if (str === '+' || str === '=') cycleInterval(-1); else if (str === '-') cycleInterval(1); else if (k.name === 'q') quit();
}

let timers = [], quitting = false;
function cleanup() {
  if (quitting) return; quitting = true; emit('quit'); timers.forEach(clearTimeout); timers.forEach(clearInterval);
  if (S.headless) return;
  try { process.stdout.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l'); if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch (e) { /* abaikan */ }
}
function quit() { cleanup(); process.exit(0); }

// ------------------------------------------------------------------ API plugin (plugins/*.js)
let adminCache = null;
function detectAdmin() {
  if (!IS_WIN) { adminCache = typeof process.getuid === 'function' && process.getuid() === 0; return; }
  cp.execFile('net', ['session'], { windowsHide: true }, (err) => { adminCache = !err; });
}
function saveCfg(patch) {
  Object.assign(USER_CFG, patch);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(USER_CFG, null, 2)); } catch (e) { logLine('WARN', 'Config gagal disimpan: ' + e.message); return false; }
  applyCfg(); return true;
}
// Jalankan skrip PowerShell (ditulis ke file sementara + BOM agar karakter non-ASCII aman).
function runPS(script, cb, timeoutMs) {
  if (!IS_WIN) return cb(new Error('Hanya tersedia di Windows'), '', '');
  const f = path.join(os.tmpdir(), 'wc-' + process.pid + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6) + '.ps1');
  try { fs.writeFileSync(f, '\uFEFF[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";\n' + script); } catch (e) { return cb(e, '', ''); }
  cp.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs || 90000, encoding: 'utf8' }, (err, out, se) => {
    try { fs.unlinkSync(f); } catch (e) { /* abaikan */ }
    cb(err, String(out || ''), String(se || ''));
  });
}
const API = {
  os, fs, path, cp, S, VIEWS, VIEW_ORDER, IS_WIN, DATA_DIR, VERSION, LOG_FILE, https: require('https'), http: require('http'),
  get CFG() { return CFG; },
  u: { clamp, pad, fmtMem, fmtUp, hhmmss, colorFor, bar, spark, globRe, compile, matchAny, BLOCKS },
  ui: { drawTable, listKey, chartBox, drawChart },
  logLine, isProtected, isBloat, killPid, killGroup, cooldownOk, refreshStartup, removeStartup, pollProcs, refreshAll, saveCfg, runPS, emit,
  isAdmin: () => adminCache === true,
  on(ev, fn) { (HOOKS[ev] = HOOKS[ev] || []).push(fn); },
  confirm(text, yes) { S.overlay = { type: 'confirm', text, yes }; },
  input(title, value, done, mask) { S.overlay = { type: 'input', title, value: value || '', done, mask: !!mask }; },
  menu(title, items) { S.overlay = { type: 'menu', title, sel: 0, items }; },
  info(title, lines) { S.overlay = { type: 'help', title, lines }; },
  addView(id, view, opt) { VIEWS[id] = view; const i = opt && opt.before ? VIEW_ORDER.indexOf(opt.before) : -1; if (i >= 0) VIEW_ORDER.splice(i, 0, id); else VIEW_ORDER.push(id); },
};
function loadPlugins() {
  detectAdmin();
  const dir = path.join(__dirname, 'plugins'); let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch (e) { return; }
  for (const f of files) { try { require(path.join(dir, f))(API); } catch (e) { logLine('WARN', 'Plugin ' + f + ' gagal dimuat: ' + e.message); } }
}
function startLoops(onTick) {
  timers.push(setInterval(() => { if (!S.paused) sampleCpu(); emit('tick'); if (onTick) onTick(); }, 1000));
  const loop = () => { if (!S.paused) pollProcs(); timers.push(setTimeout(loop, S.procInterval)); }; timers.push(setTimeout(loop, S.procInterval));
  timers.push(setInterval(() => { if (!S.paused) refreshStartup(); }, 20000));
}
function runHeadless() {
  S.headless = true; const pidFile = path.join(DATA_DIR, 'headless.pid');
  try { const old = +fs.readFileSync(pidFile, 'utf8'); if (old && old !== process.pid) { process.kill(old, 0); console.error('WatchCat latar belakang sudah berjalan (PID ' + old + ').'); process.exit(1); } } catch (e) { /* tidak ada atau sudah mati */ }
  try { fs.writeFileSync(pidFile, String(process.pid)); } catch (e) { /* abaikan */ }
  process.on('SIGINT', quit); process.on('SIGTERM', quit);
  process.on('exit', () => { cleanup(); try { if (+fs.readFileSync(pidFile, 'utf8') === process.pid) fs.unlinkSync(pidFile); } catch (e) { /* abaikan */ } });
  process.on('uncaughtException', (e) => { logLine('WARN', 'Error tak terduga: ' + (e.stack || e)); });
  logLine('INFO', 'WatchCat mode latar belakang dimulai (PID ' + process.pid + ')'); emit('headless');
  sampleCpu(); refreshAll(); startLoops();
  console.log('WatchCat berjalan di latar belakang (PID ' + process.pid + '). Ctrl+C untuk berhenti.\nLog: ' + LOG_FILE);
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log('WatchCat TUI v' + VERSION + '\nPakai: node watchcat-tui.js            (antarmuka)\n       node watchcat-tui.js --headless  (latar belakang tanpa tampilan, untuk notifikasi Telegram)\nTombol: ← → pindah tab · n tab baru · w tutup · F10 menu · ? bantuan · q keluar\nData : ' + DATA_DIR); return; }
  if (process.argv.includes('--version')) { console.log(VERSION); return; }
  S.selftest = process.argv.includes('--selftest');
  loadCfg(); loadPlugins(); VIEW_ORDER.forEach(newTab); S.active = 0;
  if (process.argv.includes('--headless')) return runHeadless();
  if (S.selftest) return selftest();
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('WatchCat TUI harus dijalankan di terminal interaktif (cmd / PowerShell / Windows Terminal).'); process.exit(1); }
  // escapeCodeTimeout kecil supaya tombol Esc terasa instan (bawaan Node 500 ms).
  const rl = readline.createInterface({ input: process.stdin, escapeCodeTimeout: 50 });
  rl.on('SIGINT', quit); rl.on('close', () => {}); rl.on('line', () => {});
  readline.emitKeypressEvents(process.stdin, rl); process.stdin.setRawMode(true); process.stdin.resume();
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?7l');
  process.stdin.on('keypress', (str, key) => { try { handleKey(str, key || {}); } catch (e) { logLine('WARN', 'Error tombol: ' + e.message); } render(); });
  process.stdout.on('resize', () => { forceFull = true; render(); });
  process.on('SIGINT', quit); process.on('SIGTERM', quit); process.on('exit', cleanup);
  process.on('uncaughtException', (e) => { cleanup(); console.error('WatchCat error:', e.stack || e); process.exit(1); });
  logLine('INFO', 'WatchCat TUI dimulai (' + (IS_WIN ? 'Windows' : process.platform) + ')');
  sampleCpu(); refreshAll(); render();
  startLoops(render);
}

function selftest() {
  const arg = process.argv.find((a) => /^\d+x\d+$/.test(a)) || '110x32', [W, H] = arg.split('x').map(Number);
  for (let i = 0; i < 120; i++) { S.cpu.push(20 + 30 * Math.abs(Math.sin(i / 9)) + (i > 100 ? 40 : 0)); S.ram.push(55 + i * 0.25); } S.cores = [12, 45, 88, 70, 5, 30, 95, 60];
  const names = ['chrome', 'vmmemWSL', 'Memory Compression', 'svchost', 'OneDrive', 'node', 'Teams', 'Docker Desktop', 'leaky-app', 'explorer'], now = Date.now(), list = [];
  names.forEach((n, i) => { for (let j = 0; j < (n === 'chrome' ? 6 : 1); j++) list.push({ pid: 1000 + i * 10 + j, name: n, ws: (200 + i * 150) * 1048576, priv: (180 + i * 120) * 1048576, cpu: 1, pct: i === 2 ? 40 : i }); });
  applyProcs(list); S.groups.forEach((g, gi) => { const h = { t: [], v: [] }; for (let i = 0; i < 60; i++) { h.t.push(now - (60 - i) * 3000); h.v.push(g.priv / 1048576 + (g.key === 'leaky-app' ? i * 9 : Math.sin(i / 5) * 6)); } S.hist.set(g.key, h); });
  S.flagged.add('leaky-app'); refreshStartup().then(() => { S.backup = [{ key: 'HKCU\\...\\Run', name: 'Spotify', value: 'Spotify.exe' }]; logLine('ACTION', 'OneDrive: 1 dihentikan'); logLine('WARN', 'Kemungkinan memory leak: leaky-app +540 MB');
    const only = process.argv.find((a) => VIEWS[a] || ['menu', 'confirm', 'help', 'input', 'newtab'].includes(a));
    const show = (t, ov) => { S.active = VIEW_ORDER.indexOf(t); S.overlay = ov || null; const scr = buildFrame(W, H); console.log('=== ' + t + (ov ? ' + ' + ov.type : '') + ' ' + W + 'x' + H + ' ===\n' + scr.text() + '\n'); };
    if (only) { if (VIEWS[only]) show(only); else { openMenu(); const m = S.overlay; if (only === 'confirm') S.overlay = { type: 'confirm', text: ['Hentikan "chrome"?', '6 proses (1.2 GB).'], yes() {} }; else if (only === 'help') openHelp(); else if (only === 'input') S.overlay = { type: 'input', title: 'Cari proses', value: 'chr', done() {} }; else if (only === 'newtab') openNewTabMenu(); else S.overlay = m; show('procs', S.overlay); } } else VIEW_ORDER.forEach((t) => show(t));
    process.exit(0); });
}

main();
