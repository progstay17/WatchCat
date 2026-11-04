@echo off
rem Klik dua kali untuk memasang WatchCat Windows (mode dry-run). Tambahkan -Live untuk mode aktif.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-WatchCat.ps1" %*
echo.
pause
