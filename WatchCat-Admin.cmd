@echo off
rem Buka WatchCat sebagai administrator (perlu untuk mengubah layanan dan membersihkan Temp Windows).
powershell -NoProfile -Command "Start-Process -FilePath cmd.exe -ArgumentList '/c','\"%~dp0WatchCat.cmd\"' -Verb RunAs"
