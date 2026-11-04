# Pengujian

```bash
node tests/smoke.js        # atau: npm test
```

Tes asap (31 pemeriksaan) berjalan di Linux, macOS, dan Windows tanpa dependensi:

- sintaks semua berkas (`node --check`)
- `--version` cocok dengan `package.json`, `--help`
- render semua 11 tab di 3 ukuran terminal (80×24, 110×32, 160×45) memakai data contoh
- semua overlay (menu, konfirmasi, bantuan, input, tab baru)
- tidak ada plugin yang gagal dimuat atau error hook
- token contoh tidak bocor ke layar/log, tidak ada pid file tertinggal

Tes memakai direktori data sementara (`WATCHCAT_DATA`) sehingga config Anda tidak tersentuh.

## Mode selftest manual

```bash
node watchcat-tui.js --selftest                # semua tab, 110x32
node watchcat-tui.js --selftest disk 120x40    # satu tab, ukuran tertentu
node watchcat-tui.js --selftest confirm        # overlay
```

## Yang diuji manual di Windows (Node 24) sebelum rilis 1.1.0

Skrip PowerShell dijalankan pada PC nyata dan diverifikasi:

| Area | Hasil |
|---|---|
| Pekerja jaringan (statistik adapter + koneksi TCP) | Koneksi dan proses terbaca |
| Scan (Appx, registry Uninstall, proses, layanan) | ~2 detik, puluhan kandidat, proses terkait terdeteksi |
| Daftar layanan | ~290 layanan terbaca, saran dan penanda kritis benar |
| Detail proses | Path, command line, induk, thread, handle, prioritas, waktu mulai |
| Kontrol proses (pada proses uji buatan sendiri) | Prioritas, affinity, trim memori, bekukan, lanjutkan — keadaan diverifikasi |
| Selftest | Semua tab dirender di Windows |

**Belum** diuji otomatis maupun manual: hapus autostart/pulihkan, uninstall Appx/Win32, ubah layanan (admin), pembersihan disk nyata di Windows (diuji di Linux dengan folder sementara), pengiriman Telegram ke API sungguhan (diuji dengan server tiruan lokal). Mohon laporkan masalah lewat Issues.

## CI

`.github/workflows/ci.yml` menjalankan `node tests/smoke.js` pada Ubuntu dan Windows dengan Node 18, 20, dan 22.
