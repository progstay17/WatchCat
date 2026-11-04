# Panduan penggunaan

Tombol global (`← →`, `n`, `w`, `F10`, `p`, `r`, `+/-`, `q`) ada di [README](../README.md#tombol). Dokumen ini membahas tiap tab.

## Dashboard
Grafik CPU dan RAM (satu titik per detik, selebar layar), kotak **Sistem** (host, uptime, RAM, disk C:, beban per-core, status), dan **Pemakai RAM terbesar**. Peringatan muncul di baris status: error pemantauan, RAM < 10%, atau jumlah proses yang dicurigai leak.

## Proses
| Tombol | Aksi |
|---|---|
| `↑ ↓` | Pilih |
| `s` | Urut: memori → CPU → nama |
| `g` | Tampilan per nama (digabung) / per PID |
| `/` | Cari; `Esc` hapus filter |
| `k` | Hentikan (konfirmasi; proses dilindungi ditolak) |
| `t` | Tampilan **pohon** proses (induk → anak) |
| `o` | **Menu kontrol**: prioritas Idle/Rendah/Normal, batas CPU 1 core / setengah / semua, trim memori, bekukan/lanjutkan |

Nama bertanda `*` dilindungi; baris kuning adalah bloatware. Panel **Detail** di bawah menampilkan path, command line, induk, jumlah thread/handle, prioritas, dan waktu mulai (butuh layar tinggi ≥ 22 baris untuk panel penuh). Proses yang Anda **bekukan** otomatis dilanjutkan saat WatchCat keluar.

Catatan: menyetel prioritas/affinity pada proses milik akun lain atau proses sistem bisa gagal tanpa admin; kegagalan dicatat di tab Log.

## Startup
Entri `Run` registry (HKCU, HKLM, HKLM 32-bit). `d` menghapus entri (konfirmasi) dan menyimpan cadangan di `startup-backup.jsonl`; baris berstatus *dihapus* bisa dipulihkan dengan `Enter`. `r` memuat ulang. Aplikasinya tetap terpasang.

## Memori
Setiap proses dikelompokkan per nama dan dipantau memori privatnya. Dianggap **dugaan leak** jika memenuhi semuanya: ≥ 20 sampel, memori sekarang ≥ 300 MB, naik ≥ 80 MB, dan ≥ 75% langkahnya tidak turun — kecuali nama ada di `leakIgnore` (browser dan VM sengaja diabaikan). `s` mengganti urutan (laju naik / ukuran). Grafik tren muncul untuk baris terpilih.

## Bloatware
Proses yang cocok dengan `bloat` di config (dan tidak dilindungi). `k` hentikan, `K` hentikan semua, `a` auto-hentikan proses bloatware baru (tiap 60 dtk per proses), `r` muat ulang config.

## Jaringan
Dua grafik: unduh dan unggah (jumlah adapter fisik yang *Up*). Di bawahnya daftar koneksi TCP *Established*. `v` mengganti tampilan **per proses** (jumlah koneksi, koneksi publik, tujuan teratas) dan **per koneksi** (alamat, port + nama layanan umum, port lokal). Tujuan privat (LAN/loopback) diberi warna redup. Memakai satu proses PowerShell latar yang berhenti sendiri saat WatchCat tutup atau tab dilepas.

## Disk
Mode **Pembersih** (bawaan) dan **Folder terbesar** (`v` untuk ganti).

Pembersih: `↑↓` pilih, `c` bersihkan lokasi terpilih, `C` bersihkan semua yang punya isi (tempat sampah tidak ikut), `r` hitung ulang.

| Lokasi | Catatan |
|---|---|
| Temp pengguna | Hanya file > 24 jam |
| Cache Chrome / Edge | Cache, Code Cache, GPUCache profil *Default*; login/riwayat aman |
| Cache shader DirectX, npm, pip | Dibuat ulang otomatis bila perlu |
| Crash dump, laporan error Windows | Hanya berguna untuk debugging |
| Cache thumbnail & ikon | File yang sedang dipakai dilewati |
| Temp Windows | Butuh admin; hanya file > 24 jam |
| Tempat sampah | `Clear-RecycleBin`; **tidak bisa dibatalkan** |

Folder terbesar: memindai folder tingkat atas profil, `AppData\Local`, dan `AppData\Roaming`. `Enter` membuka di Explorer, `s` pindai ulang, `x` batalkan.

## Layanan
Daftar layanan Windows. Layanan yang cocok dengan pola saran (telemetri, Xbox, bawaan HP, antivirus trial OEM, dll.) tampil di atas dengan ikon ⚠. Layanan penting sistem bertanda `*` dan **tidak bisa diubah**.

| Tombol | Aksi (butuh admin) |
|---|---|
| `d` | Nonaktifkan (hentikan + Disabled) |
| `s` | Hentikan saja |
| `m` / `a` | Mode Manual / Otomatis |
| `u` | Batalkan perubahan terakhir (dari `service-backup.jsonl`) |
| `f` | Filter: saran → semua → berjalan |
| `r` | Muat ulang |

## Scan
Membandingkan aplikasi terpasang (paket Appx/UWP dan program di registry *Uninstall*) dengan database bloatware, lalu mengaitkan tiap temuan ke proses yang sedang jalan (lewat folder instalasi), entri startup, dan layanan.

Risiko: **aman** = umumnya aman dibuang; **cek** = periksa dulu apakah Anda memakainya (mis. OneDrive, Xbox, komponen OEM). `Enter` menampilkan detail; `s` pindai ulang; `k` hentikan proses temuan; `K` hentikan semua yang berisiko *aman*; `d` hapus entri startup terkait; `u` uninstall (Appx dihapus untuk akun ini dan bisa dipasang ulang dari Store; Win32 membuka uninstaller bawaan).

Tambah pola sendiri lewat `scanExtra` di config ([CONFIG.md](CONFIG.md)). Temuan baru dicatat sebagai `ALERT` dan dikirim ke Telegram.

## Notif
Lihat [TELEGRAM.md](TELEGRAM.md).

## Log
Semua aktivitas: `INFO`, `WARN`, `ACTION`, `ALERT`. `↑↓` gulir, `End` ke yang terbaru. Juga ditulis ke `tui.log`.
