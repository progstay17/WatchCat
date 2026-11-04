@echo off
chcp 65001 >nul
title WatchCat (mode latar belakang)
echo WatchCat mode latar belakang: memantau dan mengirim notifikasi Telegram tanpa tampilan.
echo Tutup jendela ini (atau tekan Ctrl+C) untuk menghentikan. Atur token di tab Notif pada WatchCat.cmd.
echo.
node "%~dp0watchcat-tui.js" --headless
if errorlevel 1 (
  echo.
  echo WatchCat latar berhenti. Mungkin sudah berjalan, atau Node.js belum terpasang.
  pause
)
