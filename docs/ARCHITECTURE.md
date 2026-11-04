# Arsitektur

Tanpa dependensi, satu proses Node.js.

```
watchcat-tui.js        inti: data, aksi, renderer, input, API plugin, mode headless, selftest
plugins/10-net.js      tab Jaringan
plugins/20-disk.js     tab Disk
plugins/30-procx.js    kontrol proses lanjutan (menambah tab Proses) + tab Layanan
plugins/40-scan.js     tab Scan
plugins/50-telegram.js tab Notif + pengirim Telegram
```

## Inti (`watchcat-tui.js`)

| Bagian | Cara kerja |
|---|---|
| **Pengumpul data** | `sampleCpu()` tiap 1 dtk (`os.cpus`, `os.freemem`). `pollProcs()` tiap `procInterval` (3 dtk): satu panggilan `Get-Process` PowerShell → `parseProcs` → `applyProcs` (hitung CPU% dari selisih waktu CPU, kelompokkan per nama, riwayat memori maks. 180 sampel/proses, deteksi leak). Di non-Windows memakai `ps`. |
| **Startup** | `reg query` pada tiga kunci `Run`; hapus = `reg delete` + tulis cadangan JSONL; pulihkan = `reg add`. |
| **Layar** | Kelas `Screen`: grid sel (karakter + gaya SGR). Tiap frame digambar ke grid lalu hanya baris yang berubah yang ditulis (diff), di *alternate screen* tanpa kursor. |
| **Tampilan (view)** | Objek `{ title, hints, init(), rows(), render(scr, rect, tab), key(k, tab) }` di `VIEWS`. Helper `drawTable`, `chartBox`, `listKey`. Satu view bisa punya banyak *tab* (state per tab: `selKey`, `scroll`, dst.). |
| **Input** | `readline.emitKeypressEvents` dengan `escapeCodeTimeout: 50` supaya `Esc` instan. Overlay (menu/konfirmasi/input/bantuan) mencegat tombol lebih dulu. |
| **Konfigurasi** | `DEFAULT_CFG` + `tui-config.json` (shallow merge) → pola dikompilasi ke regex (`globRe`). |
| **Hook** | `emit(event, arg)`; kesalahan di hook ditangkap dan dicatat, tidak menjatuhkan inti. |
| **Headless** | `--headless`: tanpa layar, tanpa raw-mode; pid file mencegah dua instans; loop yang sama, plugin tetap menerima hook. |
| **Selftest** | `--selftest [view\|overlay] [WxH]` mengisi data contoh dan mencetak frame sebagai teks; plugin mengenali `S.selftest` untuk memakai data contoh dan **tidak** menyentuh jaringan/sistem. |

Menjalankan PowerShell: `runPS(script, cb)` menulis skrip ke berkas `.ps1` sementara (dengan BOM agar Unicode aman), menjalankannya dengan `-NoProfile -ExecutionPolicy Bypass`, lalu menghapusnya. Tidak ada string dari pengguna yang disisipkan ke skrip tanpa validasi/penghindaran (nama paket dan layanan divalidasi, tanda kutip di-escape).

## Plugin

Dimuat dari `plugins/*.js` berurutan menurut nama berkas (`NN-nama.js`) saat start. Plugin yang gagal dimuat dicatat sebagai `WARN` dan dilewati. Lihat [PLUGINS.md](PLUGINS.md).

## Alur data

```
PowerShell/os ──► S (state) ──► emit('procs'|'tick'|'startup'|'leak'|'log')
                      │                         │
                      ▼                         ▼
               VIEWS[x].render        plugin (Telegram, Scan, ...)
```
