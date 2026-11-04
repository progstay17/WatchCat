<div align="center">

<img src="assets/icon.png" width="110" alt="WatchCat">

# WatchCat for Windows

**Pemantau & penjaga Windows di terminal** — dashboard dengan grafik langsung, banyak tab, pembasmi bloatware, deteksi memory leak, pembersih disk, dan notifikasi Telegram.

Tanpa dependensi · Satu perintah `node` · Bahasa Indonesia

[![CI](https://github.com/progstay17/watchcat-windows/actions/workflows/ci.yml/badge.svg)](https://github.com/progstay17/watchcat-windows/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D18-3c873a)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![License](https://img.shields.io/badge/license-MIT-blue)

</div>

> *English summary:* WatchCat is a zero-dependency Node.js terminal UI (TUI) for Windows. It shows live CPU/RAM/network charts, finds and stops bloatware, flags suspected memory leaks, cleans junk files, lists suspicious services, and can push alerts to Telegram. Everything runs locally; nothing is sent anywhere except the Telegram alerts you configure. UI language is Indonesian.

---

## Fitur

| Tab | Fungsi |
|---|---|
| **Dashboard** | Grafik CPU & RAM langsung, status per-core, disk, pemakai RAM terbesar |
| **Proses** | Daftar proses (per nama / per PID), urut, cari, hentikan, **pohon proses**, **menu kontrol** (prioritas, batas core, trim memori, bekukan/lanjutkan), panel detail |
| **Startup** | Entri autostart registry; hapus dengan cadangan otomatis dan pulihkan kapan saja |
| **Memori** | Deteksi dugaan *memory leak* dengan grafik tren per proses |
| **Bloatware** | Proses bloatware yang sedang jalan, hentikan satu/semua, mode auto-hentikan |
| **Jaringan** | Grafik unduh/unggah (adapter fisik) + koneksi aktif per proses / per koneksi |
| **Disk** | Ruang tiap drive, pembersih file sampah dengan konfirmasi, pencari folder terbesar |
| **Layanan** | Layanan Windows dengan saran yang aman dinonaktifkan; ubah (admin) + batalkan |
| **Scan** | Pindai aplikasi terpasang vs. database bloatware (Appx + Win32 + bawaan HP/Dell/Lenovo/ASUS/Acer), kaitkan ke proses/startup/layanan, kill / hapus startup / uninstall |
| **Notif** | Notifikasi Telegram (RAM, disk, CPU, leak, bloatware, startup muncul lagi, scan baru) |
| **Log** | Semua aktivitas WatchCat |

Setiap fitur adalah tab tersendiri. Satu fitur boleh dibuka di banyak tab (`n` → pilih fitur).

## Mulai cepat

Butuh **Windows 10/11** dan **[Node.js 18+](https://nodejs.org)** (`node --version`). Tidak ada `npm install`.

```bat
git clone https://github.com/progstay17/watchcat-windows.git
cd watchcat-windows
WatchCat.cmd
```

Gunakan **Windows Terminal** atau PowerShell agar warna dan karakter kotak tampil benar. Ukuran minimal jendela 70×18.

| Launcher | Untuk apa |
|---|---|
| `WatchCat.cmd` | Buka antarmuka (TUI) |
| `WatchCat-Admin.cmd` | Buka sebagai administrator (ubah layanan, bersihkan Temp Windows) |
| `WatchCat-Background.cmd` | Mode latar tanpa tampilan, khusus untuk notifikasi Telegram terus-menerus |
| `tools\Create-Shortcut.ps1` | Membuat pintasan di Desktop dengan ikon kucing |

Alternatif tanpa launcher: `node watchcat-tui.js` (`--help` untuk bantuan, `--version`, `--headless`).

## Tombol

| Tombol | Aksi |
|---|---|
| `←` `→` / `Tab` / `1`–`9` | Pindah tab |
| `n` / `w` | Tab baru / tutup tab |
| `F10` atau `m` | Menu |
| `F1` atau `?` | Bantuan |
| `p` | Jeda pemantauan |
| `+` `-` | Ganti interval pantau proses (2 / 3 / 5 / 10 dtk) |
| `r` | Segarkan sekarang |
| `↑ ↓ PgUp PgDn Home End` | Navigasi daftar |
| `q` / `Ctrl+C` | Keluar |

Tombol khusus per tab ada di baris bawah layar dan di [docs/USAGE.md](docs/USAGE.md).

## Keamanan — baca ini dulu

WatchCat bisa menghentikan proses dan menghapus entri autostart, jadi dirancang konservatif:

- **Proses sistem dan daftar `protected` tidak pernah bisa dihentikan** (explorer, svchost, Defender, WSL, terminal, dll.).
- Semua aksi yang merusak **meminta konfirmasi** (`Y`/`N`).
- Autostart yang dihapus **dicadangkan** dan bisa dipulihkan; perubahan layanan bisa dibatalkan (`u`).
- Pembersih disk hanya menyentuh lokasi cache/temp yang dikenal, menghapus per-file, melewati symlink, dan menolak folder akar.
- Deteksi memory leak adalah **dugaan** (memori naik terus), bukan kepastian.
- Token Telegram **tidak pernah** ditulis ke log. WatchCat hanya *mengirim* pesan; tidak menerima perintah dari Telegram.
- Tidak ada telemetri. Tidak ada koneksi jaringan selain ke Telegram jika Anda mengaktifkannya.

Detail lengkap: [docs/SAFETY.md](docs/SAFETY.md).

## Notifikasi Telegram

1. Buat bot lewat **@BotFather** (`/newbot`) dan salin token.
2. Buka tab **Notif** → `e` (tempel token) → kirim `/start` ke bot → `c` (deteksi chat) → `t` (tes) → `a` (aktifkan).
3. Agar tetap jalan saat jendela TUI ditutup, jalankan `WatchCat-Background.cmd`.

Panduan, ambang batas, dan batas pengiriman: [docs/TELEGRAM.md](docs/TELEGRAM.md).

## Konfigurasi

Config dibuat otomatis di `%LOCALAPPDATA%\WatchCat\tui-config.json` (ubah lokasinya dengan variabel `WATCHCAT_DATA`). Daftar proses dilindungi, bloatware, startup yang diblokir, pola scan tambahan, dan ambang Telegram bisa diubah di sana. Lihat [docs/CONFIG.md](docs/CONFIG.md).

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/USAGE.md](docs/USAGE.md) | Panduan tiap tab dan tombolnya |
| [docs/CONFIG.md](docs/CONFIG.md) | Semua opsi konfigurasi dan lokasi file data |
| [docs/TELEGRAM.md](docs/TELEGRAM.md) | Menyiapkan notifikasi Telegram |
| [docs/SAFETY.md](docs/SAFETY.md) | Model keamanan, apa yang disentuh dan tidak |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Struktur kode dan cara kerja |
| [docs/PLUGINS.md](docs/PLUGINS.md) | Menulis plugin/tab sendiri |
| [docs/TESTING.md](docs/TESTING.md) | Cara menjalankan tes |
| [CHANGELOG.md](CHANGELOG.md) | Riwayat versi |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Panduan kontribusi |

## Batasan yang jujur

- **Tidak ada bandwidth per proses.** Windows tidak menyediakannya tanpa ETW/admin; tab Jaringan menampilkan total adapter fisik dan jumlah koneksi/tujuan per proses.
- Memory leak hanya terdeteksi setelah proses diamati beberapa menit (butuh ≥20 sampel).
- Aksi layanan dan pembersihan Temp Windows butuh administrator.
- Aksi *uninstall* Win32 hanya membuka uninstaller bawaan aplikasi; Anda yang mengonfirmasi di sana.
- Pengujian otomatis berjalan di Linux/Windows lewat mode `--selftest` dengan data contoh; aksi yang mengubah sistem tidak diuji otomatis. Lihat [docs/TESTING.md](docs/TESTING.md).
- Antarmuka hanya dalam Bahasa Indonesia.

## Versi PowerShell lama

`legacy/powershell-watchdog/` berisi watchdog PowerShell satu file (tanpa Node) yang berjalan sebagai tugas terjadwal. Fiturnya lebih sedikit; dipertahankan untuk yang tidak ingin memasang Node.js.

## Lisensi

[MIT](LICENSE). Perangkat lunak ini diberikan apa adanya, tanpa jaminan. Anda bertanggung jawab atas proses yang Anda hentikan dan aplikasi yang Anda hapus.
