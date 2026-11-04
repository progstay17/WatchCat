# Model keamanan

WatchCat menjalankan aksi nyata pada sistem Anda. Dokumen ini menjelaskan apa yang disentuh, apa yang tidak, dan pengamannya.

## Hak akses

Berjalan dengan hak akun Anda. Tanpa admin, hanya proses dan registry milik akun Anda yang bisa diubah; yang lain gagal dengan pesan di log. Admin hanya diperlukan untuk **mengubah layanan** dan **membersihkan Temp Windows** (`WatchCat-Admin.cmd`).

## Yang tidak pernah disentuh

- Proses di daftar `protected` (bawaan: proses inti Windows, Defender, shell, terminal, WSL, VS Code, dll.). Aksi hentikan/prioritas/core/bekukan ditolak; hanya *trim memori* yang diizinkan.
- Layanan Windows penting (RPC, event log, firewall, Defender, jaringan, audio, update, dll.) — tidak bisa dinonaktifkan dari tab Layanan.
- Berkas pribadi: pembersih hanya bekerja pada daftar lokasi cache/temp tetap.

## Pengaman per aksi

| Aksi | Pengaman |
|---|---|
| Hentikan proses | Konfirmasi, daftar dilindungi, menolak PID WatchCat sendiri |
| Hapus autostart | Konfirmasi, cadangan `startup-backup.jsonl`, bisa dipulihkan |
| Ubah layanan | Admin, konfirmasi, daftar kritis, nama divalidasi (`[A-Za-z0-9_.-$]`), cadangan + `u` batalkan |
| Bekukan proses | Konfirmasi; otomatis dilanjutkan saat WatchCat keluar |
| Pembersih disk | Konfirmasi; hanya lokasi yang dikenal; hapus per-file; lewati symlink/junction; file terpakai dilewati; menolak folder akar (profil, `C:\`, Windows) |
| Uninstall Appx | Konfirmasi; nama paket divalidasi; paket `NonRemovable` ditolak; bisa dipasang ulang dari Store |
| Uninstall Win32 | Konfirmasi; hanya membuka uninstaller bawaan aplikasi |
| Auto-hentikan bloatware | Mati secara bawaan; satu kali per proses per menit |

## Yang dikirim keluar

Tidak ada, kecuali Anda mengaktifkan Telegram: pesan teks ke `api.telegram.org` berisi nama host dan ringkasan peringatan. Tidak ada telemetri, pembaruan otomatis, atau pelaporan.

## Risiko yang tersisa

- Mengubah daftar `protected` atau menulis pola `bloat` yang terlalu luas (mis. `*`) dapat menghentikan aplikasi yang Anda butuhkan. Lindungi dulu proses penting.
- Aplikasi bertanda **cek** di tab Scan kadang dibutuhkan (driver audio/keyboard OEM, OneDrive, komponen Xbox). Periksa sebelum uninstall.
- Pemicu leak dan CPU adalah heuristik; perlakukan sebagai petunjuk.
- Cache tertentu (mis. Chrome) lebih lambat sekali setelah dibersihkan.

## Melaporkan celah

Lihat [../SECURITY.md](../SECURITY.md).
