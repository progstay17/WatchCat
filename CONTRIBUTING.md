# Berkontribusi

Terima kasih! Isu dan PR dipersilakan (Bahasa Indonesia atau Inggris).

## Menjalankan dari sumber
```bash
git clone https://github.com/progstay17/watchcat-windows.git && cd watchcat-windows
node watchcat-tui.js            # TUI
npm test                        # tes asap
```
Butuh Node.js ≥ 18. **Tidak ada dependensi runtime dan tidak boleh ditambah** kecuali ada alasan kuat — tujuan proyek ini adalah "salin dan jalan".

## Pedoman
- Ikuti gaya yang ada (`'use strict'`, tanpa framework, fungsi kecil, komentar singkat dalam Bahasa Indonesia).
- Fitur baru sebaiknya berupa **plugin** ([docs/PLUGINS.md](docs/PLUGINS.md)). Mendukung `--selftest` (data contoh, tanpa efek ke sistem) dan `--headless` bila relevan.
- Aksi yang merusak: konfirmasi, hormati daftar dilindungi, sediakan cadangan/batalkan jika mungkin.
- Jangan menulis rahasia (token) ke log atau layar.
- Tambahkan pemeriksaan ke `tests/smoke.js` bila menambah tab/overlay. Pastikan `npm test` hijau di Linux **dan** Windows (CI memeriksa keduanya).
- Perubahan yang berefek ke pengguna: tambahkan ke `CHANGELOG.md` dan perbarui `docs/`.
- Menambah pola bloatware (tab Scan): beri risiko `aman` hanya bila benar-benar tidak dibutuhkan fungsi perangkat (audio, keyboard, driver, keamanan); selain itu `cek`.

## Melaporkan bug
Sertakan versi (`node watchcat-tui.js --version`), versi Windows/Node, langkah, dan potongan `tui.log` (hapus informasi pribadi; token tidak pernah ada di log). Untuk celah keamanan lihat [SECURITY.md](SECURITY.md).
