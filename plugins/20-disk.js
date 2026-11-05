'use strict';
// Tab Disk: ruang drive, pembersih file sampah (hanya lokasi cache/temp yang dikenal, dengan konfirmasi),
// dan pencari folder terbesar. Penghapusan dilakukan per-file (bukan hapus rekursif), melewati symlink/junction,
// dan file yang sedang dipakai dilewati begitu saja.
const fs = require('fs'), fsp = fs.promises, path = require('path'), os = require('os'), cp = require('child_process');
const tick = () => new Promise((r) => setImmediate(r));

async function dirSize(root, filter, ctl) {
  let bytes = 0, files = 0, t0 = Date.now(); const stack = [root];
  while (stack.length) {
    if (ctl && ctl.cancel) break;
    const d = stack.pop(); let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(fp); continue; }
      try { const st = await fsp.lstat(fp); if (st.isSymbolicLink()) continue; if (filter && !filter(e.name, st)) continue; bytes += st.size; files++; } catch (x) { /* dilewati */ }
    }
    if (Date.now() - t0 > 25) { await tick(); t0 = Date.now(); }
  }
  return { bytes, files };
}

async function cleanDir(root, filter) {
  let freed = 0, files = 0, skipped = 0, t0 = Date.now(); const dirs = [], stack = [root];
  while (stack.length) {
    const d = stack.pop(); dirs.push(d); let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { stack.push(fp); continue; }
      try {
        const st = await fsp.lstat(fp); if (st.isSymbolicLink()) continue; if (filter && !filter(e.name, st)) continue;
        try { await fsp.unlink(fp); } catch (er) { await fsp.chmod(fp, 0o666).catch(() => {}); await fsp.unlink(fp); }
        freed += st.size; files++;
      } catch (x) { skipped++; }
    }
    if (Date.now() - t0 > 25) { await tick(); t0 = Date.now(); }
  }
  for (const d of dirs.reverse()) { if (d === root) continue; try { await fsp.rmdir(d); } catch (e) { /* tidak kosong atau dipakai */ } }
  return { freed, files, skipped };
}

module.exports = function (WC) {
  const { S, u, ui, IS_WIN } = WC;
  const { pad, clamp, fmtMem, bar, colorFor } = u;
  const D = { drives: [], cands: [], scanned: false, scanning: false, big: [], bigRun: false, bigDone: 0, bigTotal: 0, ctl: { cancel: false }, lastMsg: '' };
  const J = path.join;
  const T = process.env.TEMP || os.tmpdir(), L = process.env.LOCALAPPDATA, W = process.env.SystemRoot, HOME = process.env.USERPROFILE || os.homedir();
  const older = (h) => (n, st) => Date.now() - st.mtimeMs > h * 3600e3;

  function build() {
    const c = [{ id: 'temp', label: 'File sementara pengguna (Temp)', paths: [T], filter: older(24), note: 'Hanya file lebih dari 1 hari. Aman.' }];
    if (IS_WIN && L) {
      const chrome = J(L, 'Google', 'Chrome', 'User Data', 'Default'), edge = J(L, 'Microsoft', 'Edge', 'User Data', 'Default');
      c.push(
        { id: 'chrome', label: 'Cache Chrome', paths: ['Cache', 'Code Cache', 'GPUCache'].map((x) => J(chrome, x)), note: 'Login dan riwayat tidak terhapus. Situs dimuat sedikit lebih lambat sekali.' },
        { id: 'edge', label: 'Cache Edge', paths: ['Cache', 'Code Cache', 'GPUCache'].map((x) => J(edge, x)), note: 'Login dan riwayat tidak terhapus.' },
        { id: 'dx', label: 'Cache shader DirectX', paths: [J(L, 'D3DSCache')], note: 'Dibuat ulang otomatis oleh game/aplikasi.' },
        { id: 'npm', label: 'Cache npm', paths: [J(L, 'npm-cache')], note: 'Unduhan paket diulang bila dibutuhkan.' },
        { id: 'pip', label: 'Cache pip', paths: [J(L, 'pip', 'Cache')], note: 'Unduhan paket diulang bila dibutuhkan.' },
        { id: 'crash', label: 'Crash dump aplikasi', paths: [J(L, 'CrashDumps')], note: 'Hanya berguna untuk debugging.' },
        { id: 'wer', label: 'Laporan error Windows', paths: [J(L, 'Microsoft', 'Windows', 'WER')], note: 'Arsip laporan crash.' },
        { id: 'thumb', label: 'Cache thumbnail & ikon', paths: [J(L, 'Microsoft', 'Windows', 'Explorer')], filter: (n) => /^(thumbcache|iconcache).*\.db$/i.test(n), note: 'Dibuat ulang Explorer. File yang sedang dipakai dilewati.' },
      );
    }
    if (IS_WIN && W) c.push({ id: 'wintemp', label: 'Temp Windows', paths: [J(W, 'Temp')], filter: older(24), admin: true, note: 'Butuh administrator. Hanya file lebih dari 1 hari.' });
    if (IS_WIN) c.push({ id: 'recycle', label: 'Tempat sampah (semua drive)', special: 'recycle', note: 'Dikosongkan lewat Windows. TIDAK bisa dibatalkan.' });
    if (process.env.WATCHCAT_DISK_TEST) c.push({ id: 'test', label: '[uji] folder uji', paths: [process.env.WATCHCAT_DISK_TEST], note: 'Khusus pengujian.' });
    return c.map((x) => Object.assign({ bytes: null, files: null, busy: false }, x));
  }
  D.cands = build();

  // Pagar pengaman: hanya hapus di dalam lokasi yang kita definisikan sendiri dan bukan akar penting.
  const NEVER = new Set([HOME, L, W, 'C:\\', 'C:', os.homedir(), path.parse(HOME).root].filter(Boolean).map((x) => path.resolve(x).toLowerCase()));
  const safe = (p) => { const r = path.resolve(p).toLowerCase(); return r.split(path.sep).filter(Boolean).length >= 2 && !NEVER.has(r); };

  async function scanCand(c) {
    c.busy = true;
    try {
      if (c.special === 'recycle') {
        c.bytes = await new Promise((res) => WC.runPS('try { $s = (New-Object -ComObject Shell.Application).NameSpace(10); $t = 0; foreach ($i in $s.Items()) { $t += [int64]$i.ExtendedProperty("System.Size") }; $t } catch { "" }', (e, out) => res(e || !/^\d+$/.test(out.trim()) ? null : +out.trim()), 30000));
        c.files = null;
      } else {
        let b = 0, f = 0;
        for (const p of c.paths) { const r = await dirSize(p, c.filter, D.ctl); b += r.bytes; f += r.files; }
        c.bytes = b; c.files = f;
      }
    } catch (e) { c.bytes = null; }
    c.busy = false;
  }
  async function scanAll() {
    if (D.scanning) return; D.scanning = true;
    for (const c of D.cands) await scanCand(c);
    D.scanning = false; D.scanned = true;
  }

  async function runClean(c) {
    if (c.admin && !WC.isAdmin()) { WC.logLine('WARN', c.label + ': butuh administrator. Jalankan WatchCat sebagai administrator.'); return 0; }
    c.busy = true; let freed = 0, files = 0, skipped = 0;
    try {
      if (c.special === 'recycle') {
        const before = c.bytes || 0;
        await new Promise((res) => WC.runPS('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', () => res(), 60000));
        freed = before;
      } else {
        for (const p of c.paths) {
          if (!safe(p)) { WC.logLine('WARN', 'Dilewati (lokasi tidak aman): ' + p); continue; }
          const r = await cleanDir(p, c.filter); freed += r.freed; files += r.files; skipped += r.skipped;
        }
      }
      WC.logLine('ACTION', 'Pembersihan "' + c.label + '": ' + fmtMem(freed) + ' dibebaskan' + (files ? ' (' + files + ' file)' : '') + (skipped ? ', ' + skipped + ' dilewati karena dipakai' : ''));
    } catch (e) { WC.logLine('WARN', 'Pembersihan "' + c.label + '" gagal: ' + e.message); }
    c.busy = false; await scanCand(c); refreshDrives(); return freed;
  }

  // ---- drive
  function refreshDrives() {
    D.drives = D.drives.map((d) => { try { const s = fs.statfsSync(d.root), tot = s.blocks * s.bsize, free = s.bavail * s.bsize; return Object.assign(d, { total: tot, free }); } catch (e) { return d; } });
  }
  function initDrives() {
    const set = (names) => { D.drives = names.map((n) => ({ name: n, root: IS_WIN ? n + '\\' : n, total: 0, free: 0 })); refreshDrives(); };
    if (!IS_WIN) return set(['/']);
    set(['C:']);
    WC.runPS('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { $_.DeviceID }', (e, out) => { const n = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^[A-Za-z]:$/.test(x)); if (!e && n.length) set(n); }, 20000);
  }

  // ---- folder terbesar
  async function scanBig() {
    if (D.bigRun) return; D.bigRun = true; D.ctl.cancel = false; D.big = []; D.bigDone = 0;
    const targets = [];
    const sub = async (base, prefix) => { try { for (const e of await fsp.readdir(base, { withFileTypes: true })) if (e.isDirectory() && !e.isSymbolicLink()) targets.push({ path: path.join(base, e.name), name: prefix + e.name }); } catch (x) { /* abaikan */ } };
    await sub(HOME, ''); if (IS_WIN) { await sub(J(HOME, 'AppData', 'Local'), 'AppData\\Local\\'); await sub(J(HOME, 'AppData', 'Roaming'), 'AppData\\Roaming\\'); }
    D.bigTotal = targets.length;
    for (const t of targets) { if (D.ctl.cancel) break; const r = await dirSize(t.path, null, D.ctl); D.big.push({ path: t.path, name: t.name, bytes: r.bytes, files: r.files }); D.big.sort((a, b) => b.bytes - a.bytes); D.bigDone++; }
    D.bigRun = false;
  }
  const openFolder = (p) => { try { cp.spawn(IS_WIN ? 'explorer.exe' : 'xdg-open', [p], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { WC.logLine('WARN', 'Tidak bisa membuka ' + p); } };

  WC.on('tick', () => {
    const want = S.tabs.some((t) => t.type === 'disk');
    if (want && !D.scanned && !D.scanning && !S.selftest && !S.headless) { initDrives(); scanAll(); }
    if (want && S.selftest === undefined) { /* tidak dipakai */ }
    if (want && S.tabs.length && Date.now() % 10 < 1) refreshDrives();
  });
  WC.on('quit', () => { D.ctl.cancel = true; });

  if (S.selftest) {
    D.drives = [{ name: 'C:', root: 'C:\\', total: 476e9, free: 353e9 }, { name: 'D:', root: 'D:\\', total: 931e9, free: 40e9 }];
    const fake = { temp: [2.4e9, 1840], chrome: [610e6, 5230], edge: [180e6, 1200], dx: [95e6, 60], npm: [1.2e9, 22000], pip: [40e6, 90], crash: [0, 0], wer: [12e6, 31], thumb: [88e6, 12], wintemp: [320e6, 410], recycle: [1.1e9, null] };
    D.cands.forEach((c) => { const f = fake[c.id]; if (f) { c.bytes = f[0]; c.files = f[1]; } else { c.bytes = 0; c.files = 0; } });
    D.scanned = true; D.lastMsg = 'Contoh: terakhir membersihkan "Cache Edge" 210 MB';
    D.big = [['AppData\\Local\\Docker', 31.5e9], ['AppData\\Local\\Google', 4.1e9], ['Downloads', 3.8e9], ['AppData\\Roaming\\npm', 1.4e9], ['Videos', 1.1e9], ['Documents', 640e6]].map((x) => ({ name: x[0], path: 'C:\\x\\' + x[0], bytes: x[1], files: 1000 }));
    D.bigDone = 40; D.bigTotal = 40;
  } else initDrives();

  WC.addView('disk', {
    title: 'Disk', hints: '↑↓ pilih · c bersihkan · C bersihkan semua · r hitung ulang · v folder terbesar · s pindai ulang
    init() { return { mode: 'clean' }; },
    rows(tab) { return tab.mode === 'clean' ? D.cands.map((c) => Object.assign(c, { k: c.id })) : D.big.map((b) => Object.assign(b, { k: b.path })); },
    render(scr, r, tab) {
      const dh = Math.min(Math.max(D.drives.length, 1), 4) + 2;
      scr.box(r.x, r.y, r.w, dh, '36', 'Drive');
      if (!D.drives.length) scr.put(r.x + 2, r.y + 1, 'Menunggu informasi drive…', '2');
      D.drives.slice(0, 4).forEach((d, i) => { const used = d.total ? 1 - d.free / d.total : 0, st = colorFor(used * 100); scr.put(r.x + 2, r.y + 1 + i, pad(d.name, 4) + (d.total ? bar(used, clamp(r.w - 50, 10, 40)) + ' ' + pad((used * 100).toFixed(0) + '%', 4, 'r') + '  kosong ' + fmtMem(d.free) + ' dari ' + fmtMem(d.total) : 'kapasitas belum terbaca'), d.total ? st : '2'); });
      const y0 = r.y + dh, th = r.h - dh - 1;
      const rows = this.rows(tab);
      if (tab.mode === 'clean') {
        const tot = D.cands.reduce((a, c) => a + (c.admin && !WC.isAdmin() ? 0 : c.bytes || 0), 0);
        scr.put(r.x, y0, pad('Pembersih · potensi ' + fmtMem(tot) + (D.scanning ? ' · sedang menghitung…' : D.scanned ? ' · hasil tersedia' : ' · menunggu scan') + (D.lastMsg ? ' · ' + D.lastMsg : ''), r.w), D.scanning ? '36' : '2');
        const cols = [{ t: 'Lokasi', w: 34, f: (x) => x.label }, { t: 'Ukuran', w: 10, a: 'r', f: (x) => (x.busy ? '…' : x.bytes == null ? '?' : fmtMem(x.bytes)), style: (x) => (x.bytes > 1e9 ? '33' : '0') },
          { t: 'File', w: 8, a: 'r', f: (x) => (x.files == null ? '' : x.files) }, { t: 'Catatan', flex: true, f: (x) => (x.admin && !WC.isAdmin() ? '[butuh admin] ' : '') + x.note }];
        const sel = ui.drawTable(scr, r.x, y0 + 1, r.w, th, cols, rows, tab.selKey, (x) => x.k, tab, (x) => (x.admin && !WC.isAdmin() ? '2' : '0'));
        if (sel && !tab.selKey) tab.selKey = sel.k;
        if (!rows.length) scr.put(r.x + 2, y0 + 3, D.scanning ? 'Menghitung ukuran file sementara…' : 'Tidak ada lokasi pembersihan yang tersedia.', '2');
      } else {
        scr.put(r.x, y0, pad(' Folder terbesar di profil Anda · ' + (D.bigRun ? 'memindai ' + D.bigDone + '/' + D.bigTotal + '… (x batal)' : D.big.length ? 'selesai (' + D.bigDone + ' folder) · Enter buka di Explorer · s pindai ulang' : 'tekan s untuk memindai'), r.w), '2');
        const mx = Math.max(1, ...rows.map((x) => x.bytes));
        const cols = [{ t: 'Folder', w: 38, f: (x) => x.name }, { t: 'Ukuran', w: 10, a: 'r', f: (x) => fmtMem(x.bytes) }, { t: 'File', w: 8, a: 'r', f: (x) => x.files }, { t: '', flex: true, f: (x, w) => bar(x.bytes / mx, w), style: () => '34' }];
        const sel = ui.drawTable(scr, r.x, y0 + 1, r.w, th, cols, rows, tab.selKey, (x) => x.k, tab);
        if (sel && !tab.selKey) tab.selKey = sel.k;
        if (!rows.length) scr.put(r.x + 2, y0 + 3, D.bigRun ? 'Memindai folder profil…' : 'Belum ada hasil. Tekan s untuk memindai folder terbesar.', '2');
      }
    },
    key(k, tab) {
      const rows = this.rows(tab), cur = rows.find((x) => x.k === tab.selKey) || rows[0];
      if (ui.listKey(tab, rows, k, (x) => x.k)) return true;
      if (k.name === 'v') { tab.mode = tab.mode === 'clean' ? 'big' : 'clean'; tab.selKey = null; if (tab.mode === 'big' && !D.big.length && !D.bigRun && !S.selftest) scanBig(); return true; }
      if (tab.mode === 'big') {
        if (k.name === 's') { scanBig(); return true; }
        if (k.name === 'x') { D.ctl.cancel = true; return true; }
        if (k.name === 'return' && cur) { openFolder(cur.path); return true; }
        return false;
      }
      if (k.name === 'r') { D.scanned = false; scanAll(); return true; }
      if (k.name === 'c' && !k.shift && cur) {
        if (cur.busy) return true;
        if (cur.admin && !WC.isAdmin()) { WC.logLine('WARN', cur.label + ': butuh administrator.'); return true; }
        WC.confirm(['Bersihkan "' + cur.label + '"?', 'Perkiraan ' + (cur.bytes == null ? '?' : fmtMem(cur.bytes)) + (cur.files ? ' (' + cur.files + ' file)' : '') + '. ' + cur.note], () => { runClean(cur).then((f) => { D.lastMsg = '"' + cur.label + '": ' + fmtMem(f) + ' dibebaskan'; }); });
        return true;
      }
      if ((k.name === 'c' && k.shift) || k.str === 'C') {
        const list = D.cands.filter((c) => (c.bytes || 0) > 0 && !(c.admin && !WC.isAdmin()) && c.special !== 'recycle');
        if (!list.length) return true;
        WC.confirm(['Bersihkan ' + list.length + ' lokasi sekaligus?', list.map((c) => c.label.replace(/ \(.*\)/, '')).join(', '), 'Total ± ' + fmtMem(list.reduce((a, c) => a + c.bytes, 0)) + '. Tempat sampah tidak ikut dikosongkan.'], async () => { let t = 0; for (const c of list) t += await runClean(c); D.lastMsg = 'dibebaskan total ' + fmtMem(t); });
        return true;
      }
      return false;
    },
  }, { before: 'log' });
};
module.exports.helpers = { dirSize, cleanDir };
