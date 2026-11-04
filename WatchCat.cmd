@echo off
chcp 65001 >nul
title WatchCat TUI
node "%~dp0watchcat-tui.js" %*
if errorlevel 1 (
  echo.
  echo WatchCat berhenti dengan error. Pastikan Node.js terpasang ^(node --version^).
  pause
)
