<#
.SYNOPSIS
    Menghapus WatchCat Windows dari akun yang sedang login.

.PARAMETER RemoveData  Hapus juga seluruh folder %LOCALAPPDATA%\WatchCat (log, config, cadangan autostart).
#>
[CmdletBinding()]
param([switch]$RemoveData)

$taskName = 'WatchCat Windows'
$runKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$dest     = Join-Path $env:LOCALAPPDATA 'WatchCat'

$procs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*\watchcat.ps1*' }
foreach ($p in @($procs)) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "WatchCat dihentikan (PID $($p.ProcessId))" } catch { }
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Scheduled task '$taskName' dihapus."
}

if (Get-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name $taskName
    Write-Host 'Autostart registry dihapus.'
}

if ($RemoveData) {
    try { Remove-Item -Recurse -Force -Path $dest -ErrorAction Stop; Write-Host "Folder $dest dihapus." }
    catch { Write-Warning "Sebagian file di $dest tidak bisa dihapus: $($_.Exception.Message)" }
} else {
    Write-Host "Log, config, dan cadangan autostart tetap ada di $dest (tambahkan -RemoveData untuk menghapusnya)."
}
Write-Host 'Selesai. Entri autostart yang dulu dihapus WatchCat bisa dipulihkan dengan: watchcat.ps1 -RestoreStartup'
