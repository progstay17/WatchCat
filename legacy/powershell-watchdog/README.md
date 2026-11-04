# WatchCat Windows

Pengawas ringan (satu script PowerShell, tanpa install tambahan) yang berjalan di latar belakang dan menjaga PC tetap lega.

## Yang dilakukan
| Fitur | Cara kerja | Tindakan |
|---|---|---|
| **Bloatware** | Memeriksa proses yang cocok dengan `bloatProcesses` | Menghentikan prosesnya |
| **Startup guard** | Memeriksa registry `Run` terhadap `blockStartup` | Menghapus entri, cadangannya disimpan |
| **Memory leak** | Memori privat suatu proses naik terus ≥ `leakMinGrowthMB` dalam jendela `leakWindowSamples` sampel | Notifikasi (opsional: hentikan lewat `leakKillAllowlist`) |
| **CPU hog** | CPU ≥ `cpuHogPercent`% selama `cpuHogSamples` sampel berturut-turut | Notifikasi |
| **RAM menipis** | RAM kosong < `lowRamPercent`% | Notifikasi + 3 pemakai terbesar |

Hanya proses di sesi login Anda yang disentuh. Layanan Windows dan akun lain di PC yang sama tidak diganggu. Daftar proses sistem penting (explorer, svchost, Defender, WSL, dll.) selalu dilindungi, apa pun isi config.

## Pasang
1. Ekstrak seluruh zip ke folder mana saja.
2. Klik dua kali `install.cmd`.
   Bawaannya **dry-run**: WatchCat hanya mencatat apa yang *akan* dilakukan.
3. Biarkan beberapa jam, lalu buka log: `%LOCALAPPDATA%\WatchCat\watchcat.log` (baris `DRYRUN` dan `ALERT`).
4. Kalau sudah aman, ubah `"dryRun": false` di `%LOCALAPPDATA%\WatchCat\config.json`. Config dimuat ulang otomatis, tidak perlu restart.

Langsung mode aktif: `install.cmd -Live`.
Uji satu siklus tanpa memasang: `powershell -ExecutionPolicy Bypass -File watchcat.ps1 -Once` (deteksi leak dan CPU butuh berjalan lama, jadi tidak muncul di sini).

## Config penting (`config.json`)
- `protectedProcesses`: pola nama (boleh `*`) yang tidak akan pernah dihentikan. Sudah berisi VS Code.
- `bloatProcesses`: nama proses tanpa `.exe`, huruf besar/kecil bebas. Contoh menambah: `"namaproses"`.
- `blockStartup`: pola nama atau perintah autostart yang dihapus. Aplikasi tetap terpasang.
- `leakIgnore`: proses yang diabaikan untuk deteksi leak. Browser sengaja diabaikan karena memorinya naik wajar saat tab bertambah.
- `leakKillAllowlist`: proses yang boleh dihentikan otomatis saat terdeteksi leak (kosong secara bawaan).

## Pulihkan autostart yang pernah dihapus
Hentikan WatchCat (atau hapus polanya dari `blockStartup`), lalu:
`powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\WatchCat\watchcat.ps1" -RestoreStartup`

## Copot
Klik dua kali `uninstall.cmd` (tambahkan `-RemoveData` untuk menghapus log dan config juga).

## Batasan yang jujur
- Deteksi memory leak itu **heuristik**: pola "naik terus" bisa juga terjadi pada aplikasi yang memang sedang bekerja berat (render, build, game). Karena itu bawaannya hanya memberi peringatan.
- Berjalan tanpa admin, jadi hanya registry `HKCU\...\Run` yang dijaga. Entri sistem-lebar (`HKLM`) hanya dijaga jika WatchCat dijalankan sebagai administrator.
- Autostart lewat Startup folder, Scheduled Task, atau layanan Windows tidak dijaga.
- Bukan antivirus dan tidak membersihkan malware.
- Aplikasi yang menulis ulang autostart-nya sendiri (misalnya Edge) akan dihapus lagi di siklus berikutnya.
