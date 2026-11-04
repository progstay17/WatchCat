# Kebijakan keamanan

## Versi yang didukung
Hanya rilis terbaru.

## Melaporkan celah
Jangan membuka Issue publik untuk celah keamanan. Gunakan **Security → Report a vulnerability** (GitHub private vulnerability reporting) pada repositori ini. Sertakan langkah reproduksi dan dampaknya. Kami berupaya menanggapi dalam 7 hari.

## Cakupan yang relevan
- Eksekusi perintah/injeksi lewat nama proses, nama layanan, nama paket, atau isi config
- Kebocoran token Telegram (log, layar, pesan error)
- Aksi yang melewati daftar proses/layanan dilindungi
- Penghapusan berkas di luar lokasi pembersih yang dikenal

Model keamanan dijelaskan di [docs/SAFETY.md](docs/SAFETY.md).
