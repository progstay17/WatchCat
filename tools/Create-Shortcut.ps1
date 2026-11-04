<#
  Membuat pintasan "WatchCat" di Desktop dengan ikon kucing.
  Pakai:  powershell -ExecutionPolicy Bypass -File tools\Create-Shortcut.ps1 [-Admin]
  -Admin  : pintasan membuka WatchCat-Admin.cmd (akan meminta UAC).
#>
param([switch]$Admin)
$root   = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root ($(if ($Admin) { 'WatchCat-Admin.cmd' } else { 'WatchCat.cmd' }))
$icon   = Join-Path $root 'assets\WatchCat.ico'
$name   = $(if ($Admin) { 'WatchCat (Admin).lnk' } else { 'WatchCat.lnk' })
$lnk    = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
$sh = New-Object -ComObject WScript.Shell
$s  = $sh.CreateShortcut($lnk)
$s.TargetPath = $target; $s.WorkingDirectory = $root; $s.IconLocation = "$icon,0"
$s.Description = 'WatchCat - pemantau & penjaga Windows'; $s.WindowStyle = 1
$s.Save()
Write-Host "Pintasan dibuat: $lnk"
