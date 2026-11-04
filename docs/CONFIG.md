# Konfigurasi

## Lokasi file

Folder data: `%LOCALAPPDATA%\WatchCat` (di Linux/macOS: `~/.watchcat`). Ubah dengan variabel lingkungan `WATCHCAT_DATA`.

| File | Isi |
|---|---|
| `tui-config.json` | Konfigurasi (dibuat otomatis saat pertama jalan) |
| `tui.log` | Log aktivitas |
| `startup-backup.jsonl` | Cadangan entri autostart yang dihapus |
| `service-backup.jsonl` | Keadaan layanan sebelum diubah (untuk batalkan) |
| `scan-seen.json` | ID bloatware yang pernah terdeteksi (untuk memberi tahu hanya yang baru) |
| `headless.pid` | PID proses latar (mencegah dua instans) |
| `net-worker.ps1` | Skrip pekerja jaringan yang dibuat otomatis |

> `tui-config.json` dapat berisi **token Telegram**. Jangan di-commit atau dibagikan. Repo ini sudah mengabaikannya lewat `.gitignore`.

## Opsi

Daftar berupa **pola nama** tanpa `.exe`, huruf besar/kecil bebas; `*` = sembarang teks, `?` = satu karakter.

```json
{
  "protected":    ["explorer", "svchost", "..."],
  "bloat":        ["compattelrunner", "onedrive", "skype*", "teams"],
  "blockStartup": ["MicrosoftEdgeAutoLaunch*", "OneDrive*", "Spotify*"],
  "leakIgnore":   ["chrome", "msedge", "firefox", "vmmem"],
  "scanExtra": [
    ["win32", "Contoh Aplikasi*", "Contoh Aplikasi", "cek", "catatan opsional"],
    ["appx",  "Vendor.NamaPaket*", "Nama tampil", "aman", ""]
  ],
  "telegram": {
    "enabled": false, "token": "", "chatId": "",
    "ramPercent": 8, "diskPercent": 10, "cpuPercent": 85, "cpuPolls": 6,
    "events": { "ram": true, "disk": true, "cpu": true, "leak": true,
                "bloat": true, "startup": true, "scan": true, "action": true }
  }
}
```

| Kunci | Arti |
|---|---|
| `protected` | Proses yang **tidak akan pernah** dihentikan/diubah (kecuali trim memori). Menang atas `bloat`. |
| `bloat` | Proses yang dianggap bloatware (tab Bloatware, auto-hentikan, notifikasi). |
| `blockStartup` | Entri autostart yang ditandai bloat di tab Startup dan memicu notifikasi bila muncul lagi. |
| `leakIgnore` | Proses yang dikecualikan dari deteksi leak. |
| `scanExtra` | Pola tambahan untuk tab Scan: `[jenis, pola, label, risiko, catatan]` dengan jenis `appx` atau `win32`, risiko `aman` atau `cek`. Pola entri sendiri didahulukan atas bawaan. |
| `telegram.*` | Lihat [TELEGRAM.md](TELEGRAM.md). |

### Penting: kunci menggantikan, tidak menggabungkan

Jika Anda menulis `"bloat": [...]` di config, daftar itu **menggantikan seluruh** daftar bawaan untuk kunci tersebut. Salin dulu isi bawaan dari file config yang dibuat otomatis lalu tambahkan milik Anda. Setelah mengubah file, tekan `r` di tab Bloatware untuk memuat ulang.

Nilai `telegram` yang tidak Anda tulis memakai nilai bawaan.
