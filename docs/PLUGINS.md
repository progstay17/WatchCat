# Menulis plugin

Plugin = satu berkas di `plugins/` yang mengekspor fungsi `function (WC) { ... }`. Berkas dimuat urut abjad, jadi gunakan awalan angka (`60-contoh.js`). Tidak perlu mendaftar di tempat lain.

## Contoh minimal: tab baru

```js
'use strict';
module.exports = function (WC) {
  const { u, ui } = WC;           // helper tampilan
  WC.addView('hello', {
    title: 'Halo',
    hints: '↑↓ pilih · Enter aksi',
    init() { return {}; },                       // state awal per tab
    rows() { return [{ k: 'a', name: 'Satu' }, { k: 'b', name: 'Dua' }]; },
    render(scr, r, tab) {                        // r = { x, y, w, h } area konten
      const rows = this.rows(tab);
      const cols = [{ t: 'Nama', flex: true, f: (x) => x.name }];
      const sel = ui.drawTable(scr, r.x, r.y, r.w, r.h, cols, rows, tab.selKey, (x) => x.k, tab);
      if (sel && !tab.selKey) tab.selKey = sel.k;
    },
    key(k, tab) {                                // true = tombol sudah ditangani
      if (ui.listKey(tab, this.rows(tab), k, (x) => x.k)) return true;
      if (k.name === 'return') { WC.logLine('INFO', 'Enter ditekan'); return true; }
      return false;
    },
  }, { before: 'log' });                         // letakkan sebelum tab Log
};
```

## API `WC`

| Anggota | Keterangan |
|---|---|
| `S` | State bersama: `tabs`, `procs`, `groups` (per nama), `hist`, `startup`, `backup`, `log`, `cpu`, `ram`, `cores`, `paused`, `autoKill`, `selftest`, `headless` |
| `VIEWS`, `VIEW_ORDER` | Registri tampilan; plugin boleh membungkus view yang ada (lihat `30-procx.js` untuk `procs`) |
| `addView(id, view, {before})` | Daftarkan tab |
| `on(event, fn)` | Hook: `log` (entri), `procs`, `tick` (1 dtk), `startup`, `leak` (`{name, growth, slope, last}`), `headless`, `quit` |
| `emit(event, arg)` | Memicu hook |
| `logLine(level, msg)` | `INFO` / `WARN` / `ACTION` / `ALERT` → tab Log, `tui.log`, hook `log` |
| `confirm(lines, yes)` | Dialog Y/N |
| `input(title, value, done, mask)` | Dialog teks (`mask=true` untuk rahasia) |
| `menu(title, items)` | Menu pilih; `items = [{ label, hint, fn }]` |
| `info(title, lines)` | Panel teks |
| `runPS(script, cb, timeoutMs)` | Jalankan PowerShell (Windows); `cb(err, stdout, stderr)` |
| `isProtected(name)`, `isBloat(name)` | Cocokkan dengan config |
| `killPid(pid, cb)`, `killGroup(g)` | Hentikan proses (hormati proteksi pada `killGroup`) |
| `removeStartup(entry)`, `refreshStartup()`, `pollProcs()`, `refreshAll()` | Aksi inti |
| `cooldownOk(key, ms)` | Pembatas frekuensi |
| `CFG` | Config efektif (read-only); `saveCfg(patch)` menulis ke `tui-config.json` |
| `isAdmin()` | `true` bila berjalan sebagai administrator |
| `u` | `clamp pad fmtMem fmtUp hhmmss colorFor bar spark globRe compile matchAny BLOCKS` |
| `ui` | `drawTable listKey chartBox drawChart` |
| `IS_WIN`, `DATA_DIR`, `LOG_FILE`, `VERSION`, `os fs path cp https http` | Utilitas |

## Aturan yang harus dipatuhi

1. **Selftest**: jika `WC.S.selftest` benar, jangan menyentuh jaringan/sistem; isi data contoh (lihat plugin yang ada).
2. **Headless**: jika `WC.S.headless`, jangan memakai UI; pekerjaan latar didaftarkan lewat `on('headless', ...)`.
3. **Aksi merusak** wajib lewat `WC.confirm` dan menghormati `WC.isProtected`.
4. **Jangan menulis rahasia ke log.** Samarkan di layar (`input(..., mask=true)`).
5. Bungkus pekerjaan async dengan penanganan error; kesalahan di `render`/`key` hanya ditampilkan di tab itu, tetapi `tick` yang lambat memperlambat seluruh UI.
6. Bersihkan proses anak pada hook `quit`.
7. Beri `hints` singkat (satu baris) untuk baris status.
