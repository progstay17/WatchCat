<#
.SYNOPSIS
    Memasang WatchCat Windows untuk akun yang sedang login (tanpa perlu administrator).

.PARAMETER Live        Langsung aktifkan mode LIVE (bawaan: dry-run, hanya mencatat).
.PARAMETER ResetConfig Timpa config.json yang sudah terpasang dengan config bawaan.
.PARAMETER NoStart     Pasang saja, jangan langsung dijalankan.
#>
[CmdletBinding()]
param(
    [switch]$Live,
    [switch]$ResetConfig,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$src      = $PSScriptRoot
$dest     = Join-Path $env:LOCALAPPDATA 'WatchCat'
$taskName = 'WatchCat Windows'
$runKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Stop-RunningWatchCat {
    $procs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*\watchcat.ps1*' }
    foreach ($p in @($procs)) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "Menghentikan WatchCat lama (PID $($p.ProcessId))" } catch { }
    }
}

foreach ($f in 'watchcat.ps1', 'config.json', 'Uninstall-WatchCat.ps1') {
    if (-not (Test-Path (Join-Path $src $f))) { throw "File '$f' tidak ditemukan di $src. Ekstrak seluruh isi zip dulu, lalu jalankan lagi." }
}

Stop-RunningWatchCat

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $src 'watchcat.ps1') $dest -Force
Copy-Item (Join-Path $src 'Uninstall-WatchCat.ps1') $dest -Force

$cfgDest = Join-Path $dest 'config.json'
if ($ResetConfig -or -not (Test-Path $cfgDest)) {
    Copy-Item (Join-Path $src 'config.json') $cfgDest -Force
    Write-Host "Config dibuat: $cfgDest"
} else {
    Write-Host "Config lama dipertahankan: $cfgDest (pakai -ResetConfig untuk menimpa)"
}

if ($Live) {
    $c = Get-Content -Raw -Path $cfgDest -Encoding UTF8 | ConvertFrom-Json
    $c | Add-Member -NotePropertyName dryRun -NotePropertyValue $false -Force
    $c | ConvertTo-Json -Depth 6 | Set-Content -Path $cfgDest -Encoding UTF8
    Write-Host 'Mode LIVE diaktifkan.'
}

$psExe    = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$script   = Join-Path $dest 'watchcat.ps1'
$taskArgs = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script

$registered = $false
try {
    $user      = "$env:USERDOMAIN\$env:USERNAME"
    $action    = New-ScheduledTaskAction -Execute $psExe -Argument $taskArgs -WorkingDirectory $dest
    $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
                    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
                    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal `
        -Settings $settings -Description 'WatchCat Windows: pengawas bloatware, autostart, memory leak.' -Force | Out-Null
    $registered = $true
    Write-Host "Scheduled task '$taskName' dibuat (jalan otomatis saat login)."
} catch {
    Write-Warning "Scheduled task gagal dibuat ($($_.Exception.Message)). Memakai autostart registry sebagai cadangan."
    Set-ItemProperty -Path $runKey -Name $taskName -Value ('"{0}" {1}' -f $psExe, $taskArgs)
    Write-Host "Autostart registry dibuat: $runKey\$taskName"
}

if (-not $NoStart) {
    if ($registered) { Start-ScheduledTask -TaskName $taskName }
    else { Start-Process -FilePath $psExe -ArgumentList $taskArgs -WindowStyle Hidden }
    Write-Host 'WatchCat dijalankan.'
}

$mode = 'DRY-RUN (hanya mencatat; belum menghentikan apa pun)'
if ($Live) { $mode = 'LIVE' }
Write-Host ''
Write-Host "Selesai. Mode: $mode"
Write-Host "Log     : $dest\watchcat.log"
Write-Host "Config  : $cfgDest"
Write-Host 'Setelah log terlihat aman, ubah "dryRun" menjadi false di config.json (otomatis dimuat ulang).'
