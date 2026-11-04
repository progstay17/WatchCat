@echo off
rem Klik dua kali untuk mencopot WatchCat Windows. Tambahkan -RemoveData untuk menghapus log dan config.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-WatchCat.ps1" %*
echo.
pause
