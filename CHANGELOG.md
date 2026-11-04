# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/); versi mengikuti [SemVer](https://semver.org/lang/id/).

## [1.1.0] — 2026-11-04

### Ditambahkan
- Arsitektur plugin (`plugins/NN-nama.js`) dengan API dan hook (`log`, `procs`, `tick`, `startup`, `leak`, `headless`, `quit`).
- Tab **Jaringan**: grafik unduh/unggah dan koneksi aktif per proses/per koneksi.
- Tab **Disk**: ruang drive, pembersih file sampah dengan konfirmasi, pencari folder terbesar.
- Tab **Layanan**: layanan Windows dengan saran, ubah (admin) dan batalkan.
- Tab **Scan**: pindai Appx + Win32 terhadap database bloatware (termasuk OEM), kaitkan ke proses/startup/layanan; kill, hapus startup, uninstall.
- Tab **Notif**: notifikasi Telegram (RAM, disk, CPU, leak, bloatware, startup, scan) dengan batch dan pembatas kirim.
- Tab **Proses**: pohon proses (`t`), menu kontrol (`o`: prioritas, batas core, trim memori, bekukan/lanjutkan), panel detail.
- Mode `--headless` untuk notifikasi tanpa tampilan; `WatchCat-Background.cmd`, `WatchCat-Admin.cmd`, `tools/Create-Shortcut.ps1`.
- Tes asap (`tests/smoke.js`) dan CI GitHub Actions; dokumentasi lengkap di `docs/`.

## [1.0.0] — 2026-11-04

- Rilis awal TUI: Dashboard, Proses, Startup, Memori (deteksi leak), Bloatware, Log; banyak tab; grafik langsung.
- Watchdog PowerShell sebelumnya dipindahkan ke `legacy/powershell-watchdog/`.
