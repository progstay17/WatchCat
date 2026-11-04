# Notifikasi Telegram

WatchCat dapat mengirim peringatan ke chat Telegram Anda. Satu arah saja: WatchCat **hanya mengirim**; tidak ada perintah yang diterima atau dijalankan dari Telegram.

## Menyiapkan

1. Di Telegram buka **@BotFather**, kirim `/newbot`, ikuti langkahnya, lalu salin **token** (bentuk `123456789:AA…`).
2. Jalankan WatchCat → tab **Notif**.
3. `e` → tempel token (tampil sebagai titik; format divalidasi dan token dites ke Telegram).
4. Kirim pesan apa saja (mis. `/start`) ke bot Anda.
5. `c` → chat id terdeteksi otomatis (atau `i` untuk mengisi manual).
6. `t` → kirim pesan tes. `a` → aktifkan.
7. `Enter`/spasi pada baris peringatan mengaktifkan/mematikan jenis peringatan tertentu.

### Agar terus berjalan

Dari TUI, notifikasi hanya terkirim selama jendelanya terbuka. Untuk pemantauan terus-menerus jalankan `WatchCat-Background.cmd` (`node watchcat-tui.js --headless`): tanpa tampilan, hanya memantau dan mengirim. Bila proses latar hidup, TUI tidak ikut mengirim (menghindari pesan ganda). Hanya satu proses latar yang bisa berjalan.

Mode latar **tidak otomatis terpasang di startup**. Jika ingin, buat pintasan `WatchCat-Background.cmd` di folder `shell:startup`.

## Peringatan

| Jenis | Pemicu | Jeda ulang |
|---|---|---|
| `ram` | RAM kosong < `ramPercent`% (bawaan 8) | 20 menit |
| `disk` | Ruang C: < `diskPercent`% (bawaan 10) | 6 jam |
| `cpu` | Sebuah proses ≥ `cpuPercent`% (bawaan 85) selama `cpuPolls` (bawaan 6) pindai beruntun | 30 menit / proses |
| `leak` | Dugaan memory leak terdeteksi | sekali per kejadian |
| `bloat` | Proses bloatware berjalan | 6 jam / proses |
| `startup` | Autostart terblokir mendaftar lagi | tiap kejadian |
| `scan` | Bloatware baru terdeteksi tab Scan (mode latar memindai tiap 6 jam) | tiap temuan baru |
| `action` | Tindakan otomatis saat mode latar (mis. auto-kill) dan `ALERT` lain | tiap kejadian |

Pesan dikumpulkan (batch 3 detik) dan dibatasi **10 pesan per 10 menit**; kelebihannya dibuang dan dicatat di log.

## Privasi dan keamanan token

- Token disimpan **apa adanya** di `tui-config.json` (folder data Anda). Jaga file itu; jangan di-commit.
- Token tidak pernah ditulis ke log atau layar (disamarkan `12345…ghij`, dan dibersihkan dari pesan error).
- Jika token bocor: `/revoke` di @BotFather lalu masukkan token baru.
- Pesan berisi nama host dan nama proses/aplikasi. Tidak ada data pribadi lain.
- Satu-satunya tujuan jaringan: `https://api.telegram.org` (`apiBase` di config; dipakai juga untuk pengujian dengan server tiruan).
