<#
.SYNOPSIS
    WatchCat Windows - pengawas ringan untuk bloatware, autostart liar, memory leak, CPU hog, dan RAM menipis.

.DESCRIPTION
    Berjalan di latar belakang sebagai akun biasa (tanpa admin) dan setiap interval:
      1. Bloatware     : menghentikan proses yang ada di daftar "bloatProcesses".
      2. Startup guard : menghapus entri autostart (registry Run) yang cocok dengan "blockStartup"
                         dan menyimpan cadangannya supaya bisa dipulihkan.
      3. Memory leak   : mendeteksi proses yang memorinya naik terus-menerus (heuristik) dan memberi peringatan.
      4. CPU hog       : memberi peringatan jika proses memakai CPU tinggi terus-menerus.
      5. RAM menipis   : memberi peringatan beserta 3 pemakai memori terbesar.

    Hanya proses di sesi login pengguna ini yang disentuh. Layanan sistem (sesi 0) dan akun lain tidak diganggu.
    Bawaan config adalah dryRun = true: hanya MENCATAT apa yang akan dilakukan. Setelah log terlihat aman,
    ubah dryRun menjadi false di config.json atau jalankan dengan -Live.

.PARAMETER ConfigPath   Lokasi config.json (bawaan: sefolder dengan script ini).
.PARAMETER Once         Jalankan satu siklus saja lalu keluar (untuk uji coba). Deteksi leak/CPU butuh berjalan lama.
.PARAMETER Live         Paksa mode LIVE (tindakan benar-benar dilakukan), mengabaikan dryRun di config.
.PARAMETER DryRun       Paksa mode dry-run (hanya mencatat).
.PARAMETER RestoreStartup  Pulihkan entri autostart yang pernah dihapus WatchCat, lalu keluar.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$Once,
    [switch]$Live,
    [switch]$DryRun,
    [switch]$RestoreStartup
)

$ErrorActionPreference = 'Continue'
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot 'config.json' }

$script:Version    = '1.0.0'
$script:DataDir    = Join-Path $env:LOCALAPPDATA 'WatchCat'
$script:LogFile    = Join-Path $script:DataDir 'watchcat.log'
$script:BackupFile = Join-Path $script:DataDir 'startup-backup.jsonl'
$script:Echo       = ($Once.IsPresent -or $RestoreStartup.IsPresent)
$script:Seen       = @{}
$script:Hist       = @{}
$script:CpuPrev    = @{}
$script:Tray       = $null
$script:Cfg        = $null
$script:CfgStamp   = $null
$script:Procs      = @()

New-Item -ItemType Directory -Force -Path $script:DataDir -ErrorAction SilentlyContinue | Out-Null

# Proses yang tidak boleh dihentikan oleh WatchCat, apa pun isi config.
$script:HardProtected = @(
    'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost',
    'dwm', 'explorer', 'fontdrvhost', 'sihost', 'ctfmon', 'conhost', 'audiodg', 'taskmgr',
    'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'textinputhost',
    'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray',
    'memory compression', 'vmmem', 'vmmemwsl', 'wslservice', 'wslhost', 'wsl',
    'powershell', 'pwsh', 'cmd', 'windowsterminal', 'openconsole'
)

# ---------------------------------------------------------------- util

function Write-Log {
    param([string]$Level, [string]$Message)
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    try {
        if ((Test-Path $script:LogFile) -and ((Get-Item $script:LogFile).Length -gt 1MB)) {
            Move-Item -Force -Path $script:LogFile -Destination ($script:LogFile + '.old')
        }
        Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    } catch { }
    if ($script:Echo) { Write-Host $line }
}

function Get-Opt {
    param($Object, [string]$Name, $Default)
    if ($null -ne $Object) {
        $prop = $Object.PSObject.Properties[$Name]
        if ($null -ne $prop -and $null -ne $prop.Value) { return $prop.Value }
    }
    return $Default
}

# True jika $Key belum dipakai dalam $Minutes menit terakhir (dan menandainya sekarang).
function Use-Cooldown {
    param([string]$Key, [double]$Minutes)
    $now = Get-Date
    if ($script:Seen.ContainsKey($Key) -and (($now - $script:Seen[$Key]).TotalMinutes -lt $Minutes)) { return $false }
    $script:Seen[$Key] = $now
    return $true
}

function Test-NameMatch {
    param([string]$Name, $Patterns)
    foreach ($p in $Patterns) { if ($Name -like $p) { return $p } }
    return $null
}

# ---------------------------------------------------------------- config

function Import-WatchCatConfig {
    $cfg = $null
    try {
        $cfg = Get-Content -Raw -Path $ConfigPath -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    } catch {
        Write-Log 'ERROR' "config.json tidak bisa dibaca ($($_.Exception.Message)). Memakai nilai bawaan."
    }

    # Tanda koma menjaga hasil tetap berupa array (juga saat kosong atau berisi satu item).
    $lower = { param($x) , @(@($x) | Where-Object { $_ } | ForEach-Object { "$_".ToLower() }) }

    $c = @{}
    $c.IntervalSeconds    = [int](Get-Opt $cfg 'intervalSeconds' 30)
    if ($c.IntervalSeconds -lt 5) { $c.IntervalSeconds = 5 }
    $c.DryRun             = [bool](Get-Opt $cfg 'dryRun' $true)
    $c.Notifications      = [bool](Get-Opt $cfg 'notifications' $true)
    $c.Protected          = & $lower (Get-Opt $cfg 'protectedProcesses' @())
    $c.Bloat              = & $lower (Get-Opt $cfg 'bloatProcesses' @())
    $c.BlockStartup       = @(@(Get-Opt $cfg 'blockStartup' @()) | Where-Object { $_ })
    $c.LeakWindow         = [int](Get-Opt $cfg 'leakWindowSamples' 20)
    if ($c.LeakWindow -lt 4) { $c.LeakWindow = 4 }
    $c.LeakMinGrowthMB    = [double](Get-Opt $cfg 'leakMinGrowthMB' 300)
    $c.LeakMinSizeMB      = [double](Get-Opt $cfg 'leakMinSizeMB' 600)
    $c.LeakRatio          = [double](Get-Opt $cfg 'leakMonotonicRatio' 0.8)
    $c.LeakCooldown       = [double](Get-Opt $cfg 'leakCooldownMinutes' 30)
    $c.LeakIgnore         = & $lower (Get-Opt $cfg 'leakIgnore' @())
    $c.LeakKillAllow      = & $lower (Get-Opt $cfg 'leakKillAllowlist' @())
    $c.CpuHogPercent      = [double](Get-Opt $cfg 'cpuHogPercent' 85)
    $c.CpuHogSamples      = [int](Get-Opt $cfg 'cpuHogSamples' 6)
    $c.CpuIgnore          = & $lower (Get-Opt $cfg 'cpuIgnore' @())
    $c.LowRamPercent      = [double](Get-Opt $cfg 'lowRamPercent' 8)
    $c.RamCooldown        = [double](Get-Opt $cfg 'ramCooldownMinutes' 20)

    if ($Live.IsPresent)   { $c.DryRun = $false }
    if ($DryRun.IsPresent) { $c.DryRun = $true }

    $script:Cfg = $c
    $script:ProtectedPatterns = @($script:HardProtected) + @($c.Protected)
    try { $script:CfgStamp = (Get-Item $ConfigPath -ErrorAction Stop).LastWriteTimeUtc } catch { $script:CfgStamp = $null }
}

function Update-ConfigIfChanged {
    try {
        $stamp = (Get-Item $ConfigPath -ErrorAction Stop).LastWriteTimeUtc
        if ($stamp -ne $script:CfgStamp) {
            Import-WatchCatConfig
            Write-Log 'INFO' 'config.json berubah, dimuat ulang.'
        }
    } catch { }
}

# ---------------------------------------------------------------- aksi & notifikasi

function Initialize-Tray {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $t = New-Object System.Windows.Forms.NotifyIcon
        $t.Icon = [System.Drawing.SystemIcons]::Information
        $t.Text = 'WatchCat Windows'
        $t.Visible = $true
        $script:Tray = $t
    } catch {
        Write-Log 'WARN' "Notifikasi desktop tidak tersedia: $($_.Exception.Message)"
    }
}

function Send-Notice {
    param([string]$Title, [string]$Text)
    Write-Log 'ALERT' "$Title - $Text"
    if ($script:Cfg.Notifications -and $null -ne $script:Tray) {
        try {
            $script:Tray.BalloonTipTitle = "WatchCat: $Title"
            $script:Tray.BalloonTipText  = $Text
            $script:Tray.ShowBalloonTip(10000)
        } catch { }
    }
}

function Stop-Target {
    param($Proc, [string]$Reason)
    if ($Proc.Id -eq $PID) { return }
    $name = $Proc.ProcessName
    if ($script:Cfg.DryRun) {
        if (Use-Cooldown "dry-stop:$name" 10) { Write-Log 'DRYRUN' "Akan menghentikan $name (PID $($Proc.Id)): $Reason" }
        return
    }
    try {
        Stop-Process -Id $Proc.Id -Force -ErrorAction Stop
        Write-Log 'ACTION' "Dihentikan $name (PID $($Proc.Id)): $Reason"
    } catch {
        Write-Log 'WARN' "Gagal menghentikan $name (PID $($Proc.Id)): $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------- pemeriksaan

function Invoke-BloatCheck {
    if ($script:Cfg.Bloat.Count -eq 0) { return }
    foreach ($p in $script:Procs) {
        $n = $p.ProcessName.ToLower()
        if (Test-NameMatch $n $script:ProtectedPatterns) { continue }
        $hit = Test-NameMatch $n $script:Cfg.Bloat
        if ($hit) { Stop-Target $p "masuk daftar bloatware ('$hit')" }
    }
}

function Invoke-StartupGuard {
    if ($script:Cfg.BlockStartup.Count -eq 0) { return }
    $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run')
    if ($script:IsAdmin) {
        $keys += 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
        $keys += 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
    }
    $skip = @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider')

    foreach ($key in $keys) {
        if (-not (Test-Path $key)) { continue }
        $item = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($null -eq $item) { continue }

        foreach ($prop in @($item.PSObject.Properties)) {
            if ($skip -contains $prop.Name) { continue }
            $value = [string]$prop.Value
            $hit = $null
            foreach ($pat in $script:Cfg.BlockStartup) {
                if (($prop.Name -like $pat) -or ($value -like $pat)) { $hit = $pat; break }
            }
            if ($null -eq $hit) { continue }

            if ($script:Cfg.DryRun) {
                if (Use-Cooldown "dry-startup:$key|$($prop.Name)" 60) {
                    Write-Log 'DRYRUN' "Akan menghapus autostart '$($prop.Name)' dari $key (cocok '$hit')"
                }
                continue
            }
            try {
                if (Use-Cooldown "bk-startup:$key|$($prop.Name)" 60) {
                    $rec = @{ time = (Get-Date -Format 's'); key = $key; name = $prop.Name; value = $value } | ConvertTo-Json -Compress
                    Add-Content -Path $script:BackupFile -Value $rec -Encoding UTF8
                }
                Remove-ItemProperty -Path $key -Name $prop.Name -ErrorAction Stop
                Write-Log 'ACTION' "Autostart dihapus: '$($prop.Name)' dari $key (cocok '$hit')"
            } catch {
                Write-Log 'WARN' "Gagal menghapus autostart '$($prop.Name)': $($_.Exception.Message)"
            }
        }
    }
}

function Invoke-LeakCheck {
    $win = $script:Cfg.LeakWindow
    $present = @{}

    foreach ($g in ($script:Procs | Group-Object ProcessName)) {
        $n = $g.Name.ToLower()
        if ($script:Cfg.LeakIgnore -contains $n) { continue }
        $present[$n] = $true

        $mb = [math]::Round((($g.Group | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB, 1)
        if (-not $script:Hist.ContainsKey($n)) {
            $script:Hist[$n] = New-Object 'System.Collections.Generic.List[double]'
        }
        $h = $script:Hist[$n]
        $h.Add($mb)
        while ($h.Count -gt $win) { $h.RemoveAt(0) }
        if ($h.Count -lt $win) { continue }

        $last   = $h[$h.Count - 1]
        $growth = $last - $h[0]
        if ($last -lt $script:Cfg.LeakMinSizeMB -or $growth -lt $script:Cfg.LeakMinGrowthMB) { continue }

        $up = 0
        for ($i = 1; $i -lt $h.Count; $i++) { if ($h[$i] -ge ($h[$i - 1] - 2)) { $up++ } }
        $ratio = $up / ($h.Count - 1)
        if ($ratio -lt $script:Cfg.LeakRatio) { continue }

        $minutes = [math]::Round(($win * $script:Cfg.IntervalSeconds) / 60, 0)
        $msg = '{0} naik +{1} MB dalam ~{2} menit (kini {3} MB). Kemungkinan memory leak.' -f $g.Name, [math]::Round($growth), $minutes, [math]::Round($last)

        if (-not (Use-Cooldown "leak:$n" $script:Cfg.LeakCooldown)) { continue }

        if ($script:Cfg.LeakKillAllow -contains $n) {
            if ($script:Cfg.DryRun) {
                Write-Log 'DRYRUN' "Akan menghentikan semua proses $($g.Name) karena leak. $msg"
            } else {
                Send-Notice 'Memory leak ditangani' "$msg Proses dihentikan."
                foreach ($p in $g.Group) { Stop-Target $p 'memory leak (ada di leakKillAllowlist)' }
            }
        } else {
            Send-Notice 'Memory leak?' $msg
        }
        $script:Hist[$n].Clear()
    }

    foreach ($k in @($script:Hist.Keys)) {
        if (-not $present.ContainsKey($k)) { $script:Hist.Remove($k) }
    }
}

function Invoke-CpuCheck {
    $now   = Get-Date
    $cores = [Environment]::ProcessorCount
    $alive = @{}

    foreach ($p in $script:Procs) {
        $n = $p.ProcessName.ToLower()
        if ($script:Cfg.CpuIgnore -contains $n) { continue }

        $cpu = $null
        try { $cpu = $p.TotalProcessorTime.TotalSeconds } catch { continue }
        $id = $p.Id
        $alive[$id] = $true

        if ($script:CpuPrev.ContainsKey($id)) {
            $prev = $script:CpuPrev[$id]
            $wall = ($now - $prev.At).TotalSeconds
            if ($wall -gt 1) {
                $pct = (($cpu - $prev.Cpu) / ($wall * $cores)) * 100
                $streak = 0
                if ($pct -ge $script:Cfg.CpuHogPercent) { $streak = $prev.Streak + 1 }
                $script:CpuPrev[$id] = @{ Cpu = $cpu; At = $now; Streak = $streak }
                if ($streak -ge $script:Cfg.CpuHogSamples -and (Use-Cooldown "cpu:$n" 30)) {
                    $mins = [math]::Round(($streak * $script:Cfg.IntervalSeconds) / 60, 1)
                    Send-Notice 'CPU tinggi terus-menerus' ('{0} (PID {1}) memakai ~{2}% CPU selama ~{3} menit.' -f $p.ProcessName, $id, [math]::Round($pct), $mins)
                }
            }
        } else {
            $script:CpuPrev[$id] = @{ Cpu = $cpu; At = $now; Streak = 0 }
        }
    }

    foreach ($id in @($script:CpuPrev.Keys)) {
        if (-not $alive.ContainsKey($id)) { $script:CpuPrev.Remove($id) }
    }
}

function Invoke-RamCheck {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if ($null -eq $os -or -not $os.TotalVisibleMemorySize) { return }
    $freePct = [math]::Round(($os.FreePhysicalMemory / $os.TotalVisibleMemorySize) * 100, 1)
    $script:FreeRamPct = $freePct

    if ($freePct -lt $script:Cfg.LowRamPercent -and (Use-Cooldown 'ram' $script:Cfg.RamCooldown)) {
        $top = $script:Procs | Group-Object ProcessName | ForEach-Object {
            [pscustomobject]@{ Name = $_.Name; MB = [math]::Round((($_.Group | Measure-Object WorkingSet64 -Sum).Sum) / 1MB) }
        } | Sort-Object MB -Descending | Select-Object -First 3
        $txt = (@($top) | ForEach-Object { '{0} {1} MB' -f $_.Name, $_.MB }) -join ', '
        Send-Notice 'RAM hampir habis' ("Sisa {0}%. Pemakai terbesar: {1}." -f $freePct, $txt)
    }
}

function Invoke-Cycle {
    $script:Procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $script:MySession -and $_.Id -ne $PID })
    foreach ($check in 'Invoke-BloatCheck', 'Invoke-StartupGuard', 'Invoke-LeakCheck', 'Invoke-CpuCheck', 'Invoke-RamCheck') {
        try { & $check } catch { Write-Log 'ERROR' "$check gagal: $($_.Exception.Message)" }
    }
}

function Restore-Startup {
    if (-not (Test-Path $script:BackupFile)) { Write-Log 'INFO' 'Tidak ada cadangan autostart untuk dipulihkan.'; return }
    $done = @{}
    Get-Content -Path $script:BackupFile -Encoding UTF8 | ForEach-Object {
        if (-not $_.Trim()) { return }
        try {
            $r  = $_ | ConvertFrom-Json
            $id = $r.key + '|' + $r.name
            if ($done.ContainsKey($id)) { return }
            $done[$id] = $true
            if (-not (Test-Path $r.key)) { New-Item -Path $r.key -Force | Out-Null }
            Set-ItemProperty -Path $r.key -Name $r.name -Value $r.value -ErrorAction Stop
            Write-Log 'ACTION' "Autostart dipulihkan: '$($r.name)' di $($r.key)"
        } catch {
            Write-Log 'WARN' "Gagal memulihkan satu entri: $($_.Exception.Message)"
        }
    }
    Write-Log 'INFO' 'Selesai. Hentikan WatchCat atau hapus polanya dari blockStartup di config.json agar entri tidak dihapus lagi.'
}

# ---------------------------------------------------------------- main

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$script:IsAdmin   = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$script:MySession = (Get-Process -Id $PID).SessionId

Import-WatchCatConfig

if ($RestoreStartup.IsPresent) { Restore-Startup; return }

$mutex = $null
if (-not $Once.IsPresent) {
    $created = $false
    $mutex = New-Object System.Threading.Mutex($true, 'Local\WatchCatWindows', [ref]$created)
    if (-not $created) { Write-Log 'INFO' 'WatchCat sudah berjalan di sesi ini. Keluar.'; return }
    Initialize-Tray
}

$modeText = 'LIVE (tindakan dijalankan)'
if ($script:Cfg.DryRun) { $modeText = 'DRY-RUN (hanya mencatat)' }
Write-Log 'INFO' "WatchCat Windows v$($script:Version) mulai. Mode: $modeText, interval $($script:Cfg.IntervalSeconds)s, admin=$($script:IsAdmin), sesi=$($script:MySession)"

try {
    while ($true) {
        Update-ConfigIfChanged
        Invoke-Cycle
        if ($Once.IsPresent) { break }
        Start-Sleep -Seconds $script:Cfg.IntervalSeconds
    }
    if ($Once.IsPresent) {
        Write-Log 'INFO' ("Satu siklus selesai. Proses dipantau: {0}. RAM kosong: {1}%. Log: {2}" -f $script:Procs.Count, $script:FreeRamPct, $script:LogFile)
    }
} finally {
    if ($null -ne $script:Tray) { try { $script:Tray.Visible = $false; $script:Tray.Dispose() } catch { } }
    if ($null -ne $mutex) { try { $mutex.ReleaseMutex() } catch { }; $mutex.Dispose() }
    Write-Log 'INFO' 'WatchCat berhenti.'
}
