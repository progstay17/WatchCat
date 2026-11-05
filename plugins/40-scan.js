'use strict';
// Tab Scan: pindai aplikasi terpasang (Appx/UWP + program Win32) terhadap database bloatware, lalu hubungkan dengan
// proses yang sedang jalan, entri startup, dan layanan. Aksi: kill (k/K), nonaktifkan startup (d), uninstall (u).
// Risiko: "aman" = umumnya aman dibuang, "cek" = periksa dulu apakah Anda memakainya.
module.exports = function (WC) {
  const { S, u, ui, IS_WIN, fs, path, cp, DATA_DIR } = WC;
  const { pad, fmtMem, globRe } = u;

  // [jenis, pola nama (glob), label, risiko, catatan]
  const DB = [
    ['appx', 'Microsoft.BingNews', 'Microsoft Berita', 'aman', 'Aplikasi berita'], ['appx', 'Microsoft.BingWeather', 'Cuaca', 'aman', 'Aplikasi cuaca'], ['appx', 'Microsoft.BingFinance', 'Keuangan Bing', 'aman', ''], ['appx', 'Microsoft.BingSports', 'Olahraga Bing', 'aman', ''],
    ['appx', 'Microsoft.BingSearch', 'Pencarian Bing', 'aman', 'Widget pencarian'], ['appx', 'Microsoft.ZuneVideo', 'Film & TV', 'aman', 'Pemutar film Microsoft'], ['appx', 'Microsoft.ZuneMusic', 'Media Player', 'cek', 'Pemutar musik/video bawaan'],
    ['appx', 'Microsoft.MicrosoftSolitaireCollection', 'Solitaire Collection', 'aman', 'Game dengan iklan'], ['appx', 'Clipchamp.Clipchamp', 'Clipchamp', 'cek', 'Editor video'], ['appx', 'Microsoft.GetHelp', 'Dapatkan Bantuan', 'aman', ''],
    ['appx', 'Microsoft.Getstarted', 'Tips', 'aman', ''], ['appx', 'Microsoft.WindowsFeedbackHub', 'Hub Umpan Balik', 'aman', 'Pengiriman feedback/telemetri'], ['appx', 'Microsoft.People', 'People', 'aman', ''],
    ['appx', 'Microsoft.MicrosoftOfficeHub', 'Hub Office / Microsoft 365', 'aman', 'Iklan langganan M365'], ['appx', 'Microsoft.SkypeApp', 'Skype', 'aman', ''], ['appx', 'Microsoft.YourPhone', 'Phone Link', 'cek', 'Sambung ke HP; aman jika tidak dipakai'],
    ['appx', 'MicrosoftWindows.CrossDevice', 'Cross Device', 'cek', 'Terkait Phone Link'], ['appx', 'Microsoft.549981C3F5F10', 'Cortana', 'aman', ''], ['appx', 'Microsoft.MixedReality.Portal', 'Mixed Reality Portal', 'aman', ''],
    ['appx', 'Microsoft.3DBuilder', '3D Builder', 'aman', ''], ['appx', 'Microsoft.Microsoft3DViewer', '3D Viewer', 'aman', ''], ['appx', 'Microsoft.Print3D', 'Print 3D', 'aman', ''], ['appx', 'Microsoft.OneConnect', 'Mobile Plans', 'aman', ''],
    ['appx', 'Microsoft.Wallet', 'Microsoft Pay', 'aman', ''], ['appx', 'Microsoft.WindowsMaps', 'Peta', 'cek', ''], ['appx', 'Microsoft.PowerAutomateDesktop', 'Power Automate', 'cek', ''], ['appx', 'Microsoft.Todos', 'Microsoft To Do', 'cek', ''],
    ['appx', 'Microsoft.MicrosoftStickyNotes', 'Sticky Notes', 'cek', ''], ['appx', 'Microsoft.Office.OneNote', 'OneNote', 'cek', ''], ['appx', 'Microsoft.OutlookForWindows', 'Outlook (baru)', 'cek', ''], ['appx', 'Microsoft.Windows.DevHome', 'Dev Home', 'cek', ''],
    ['appx', 'MSTeams', 'Microsoft Teams (bawaan)', 'aman', 'Teams konsumen'], ['appx', 'MicrosoftTeams', 'Microsoft Teams (bawaan)', 'aman', 'Teams konsumen'], ['appx', 'Microsoft.GamingApp', 'Aplikasi Xbox', 'cek', 'Perlu untuk Game Pass'],
    ['appx', 'Microsoft.Xbox*', 'Komponen Xbox', 'cek', 'Xbox Identity dibutuhkan game Microsoft Store; Game Bar memakai overlay ini'], ['appx', 'Microsoft.Copilot', 'Copilot', 'cek', ''],
    ['appx', 'king.com.*', 'Candy Crush / game King', 'aman', 'Game promosi'], ['appx', 'SpotifyAB.SpotifyMusic', 'Spotify (Store)', 'cek', ''], ['appx', 'Disney*', 'Disney+', 'aman', 'Aplikasi promosi'], ['appx', '*Netflix*', 'Netflix', 'cek', ''],
    ['appx', '*Facebook*', 'Facebook', 'aman', ''], ['appx', '*Instagram*', 'Instagram', 'aman', ''], ['appx', '*TikTok*', 'TikTok', 'aman', ''], ['appx', 'BytedancePte.*', 'TikTok / Bytedance', 'aman', ''], ['appx', 'Amazon*', 'Amazon / Prime Video', 'aman', ''],
    ['appx', 'AmazonVideo.*', 'Prime Video', 'aman', ''], ['appx', '*LinkedIn*', 'LinkedIn', 'aman', ''], ['appx', '*Twitter*', 'Twitter / X', 'aman', ''], ['appx', 'ROBLOXCORPORATION.*', 'Roblox', 'cek', ''], ['appx', 'HULULLC.*', 'Hulu', 'aman', ''],
    ['appx', 'Duolingo*', 'Duolingo', 'aman', ''], ['appx', 'PandoraMedia*', 'Pandora', 'aman', ''], ['appx', 'Flipboard*', 'Flipboard', 'aman', ''], ['appx', 'AdobeSystemsIncorporated.AdobePhotoshopExpress', 'Photoshop Express', 'aman', ''],
    ['appx', 'ActiproSoftwareLLC*', 'Acti pro (bawaan OEM)', 'aman', ''], ['appx', 'EclipseManager*', 'Eclipse Manager', 'aman', ''], ['appx', 'McAfee*', 'McAfee (Store)', 'aman', 'Antivirus trial'], ['appx', '*NortonSecurity*', 'Norton (Store)', 'aman', 'Antivirus trial'],
    ['appx', 'AD2F1837.HPSupportAssistant', 'HP Support Assistant', 'cek', 'Dukungan & update driver HP'], ['appx', 'AD2F1837.HPJumpStarts', 'HP JumpStarts', 'aman', 'Promosi HP'], ['appx', 'AD2F1837.HPPrivacySettings', 'HP Privacy Settings', 'aman', ''],
    ['appx', 'AD2F1837.HPQuickDrop', 'HP QuickDrop', 'cek', 'Transfer file HP-HP'], ['appx', 'AD2F1837.HPEasyClean', 'HP Easy Clean', 'aman', ''], ['appx', 'AD2F1837.myHP', 'myHP', 'cek', ''], ['appx', 'AD2F1837.HPSystemInformation', 'HP System Information', 'aman', ''],
    ['appx', 'AD2F1837.*', 'Aplikasi bawaan HP', 'cek', 'Periksa fungsinya dulu (audio/keyboard/dukungan)'], ['appx', 'DellInc.*', 'Aplikasi bawaan Dell', 'cek', ''], ['appx', 'E046963F.*', 'Aplikasi bawaan Lenovo', 'cek', ''],
    ['appx', 'LenovoCompanyLimited.*', 'Aplikasi bawaan Lenovo', 'cek', ''], ['appx', 'ASUSCOMPUTERINC.*', 'Aplikasi bawaan ASUS', 'cek', ''], ['appx', 'AcerIncorporated.*', 'Aplikasi bawaan Acer', 'cek', ''],
    ['win32', 'McAfee*', 'McAfee', 'aman', 'Antivirus trial bawaan OEM; Defender sudah cukup'], ['win32', 'Norton*', 'Norton', 'aman', 'Antivirus trial bawaan OEM; Defender sudah cukup'], ['win32', 'WildTangent*', 'WildTangent Games', 'aman', 'Game promosi OEM'],
    ['win32', 'HP Touchpoint Analytics*', 'HP Touchpoint Analytics', 'aman', 'Telemetri HP'], ['win32', 'HP Notifications*', 'HP Notifications', 'aman', ''], ['win32', 'HP Registration Service*', 'HP Registration Service', 'aman', ''], ['win32', 'HP Documentation*', 'HP Documentation', 'aman', ''],
    ['win32', 'HP Connection Optimizer*', 'HP Connection Optimizer', 'aman', ''], ['win32', 'HP Support Assistant*', 'HP Support Assistant', 'cek', 'Dukungan & update driver HP'], ['win32', 'HP Wolf Security*', 'HP Wolf Security', 'cek', 'Fitur keamanan HP; hapus hanya jika paham'],
    ['win32', 'HP Sure*', 'HP Sure (keamanan)', 'cek', 'Fitur keamanan HP'], ['win32', 'HP System Event Utility*', 'HP System Event Utility', 'cek', 'Dipakai tombol khusus keyboard HP (HPSEU)'], ['win32', 'HP Smart*', 'HP Smart', 'cek', 'Aplikasi printer HP'],
    ['win32', 'Dell SupportAssist*', 'Dell SupportAssist', 'cek', ''], ['win32', 'Dell Update*', 'Dell Update', 'cek', ''], ['win32', 'Lenovo Vantage*', 'Lenovo Vantage', 'cek', ''], ['win32', 'ASUS*', 'Utilitas ASUS', 'cek', ''],
    ['win32', 'Microsoft Teams*', 'Microsoft Teams', 'aman', 'Jika tidak dipakai kerja/kuliah'], ['win32', 'Teams Machine-Wide Installer*', 'Teams Machine-Wide Installer', 'aman', ''], ['win32', 'Skype*', 'Skype', 'aman', ''],
    ['win32', 'Microsoft OneDrive*', 'Microsoft OneDrive', 'cek', 'Jangan hapus jika Anda sinkron file lewat OneDrive'], ['win32', 'Spotify*', 'Spotify', 'cek', ''], ['win32', 'Adobe Creative Cloud*', 'Adobe Creative Cloud', 'cek', 'Aman hanya jika tidak memakai produk Adobe'],
    ['win32', 'Adobe Genuine*', 'Adobe Genuine Service', 'cek', ''], ['win32', 'CyberLink*', 'CyberLink (bawaan OEM)', 'cek', ''], ['win32', 'WebCompanion*', 'Web Companion', 'aman', 'Adware (Lavasoft)'], ['win32', '*Toolbar*', 'Toolbar browser', 'aman', 'Biasanya adware'],
    ['win32', 'Conduit*', 'Conduit', 'aman', 'Adware'], ['win32', 'Candy Crush*', 'Candy Crush', 'aman', ''],
  ];

  const seenFile = path.join(DATA_DIR, 'scan-seen.json');
  const A = { items: [], scanning: false, at: 0, err: '', sum: '', timer: null };
  let extra = [];
  const matchDb = (kind, name) => {
    for (const e of extra.concat(DB)) if (e[0] === kind && globRe(e[1]).test(name)) return e;
    return null;
  };

  const SCAN_PS = [
    '$ErrorActionPreference = "SilentlyContinue"', '$o = [ordered]@{}',
    '$o.appx = @(Get-AppxPackage | Where-Object { -not $_.IsFramework } | ForEach-Object { [pscustomobject]@{ n = $_.Name; f = $_.PackageFullName; l = $_.InstallLocation; r = [bool]$_.NonRemovable } })',
    '$keys = "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
    '$o.win32 = @(Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object { [pscustomobject]@{ n = $_.DisplayName; p = $_.Publisher; v = $_.DisplayVersion; l = $_.InstallLocation; u = $_.UninstallString; q = $_.QuietUninstallString; i = $_.DisplayIcon } })',
    '$o.proc = @(Get-Process | Where-Object { $_.Path } | ForEach-Object { [pscustomobject]@{ id = $_.Id; n = $_.ProcessName; p = $_.Path; m = $_.WorkingSet64 } })',
    '$o.svc = @(Get-CimInstance Win32_Service | ForEach-Object { [pscustomobject]@{ n = $_.Name; d = $_.DisplayName; s = $_.State; p = $_.PathName } })',
    '$o | ConvertTo-Json -Depth 4 -Compress',
  ].join('\n');

  const GENERIC = new Set(['c:\\program files', 'c:\\program files (x86)', 'c:\\programdata', 'c:\\windows', 'c:\\windows\\system32', 'c:\\users']);
  function dirOf(w) {
    let d = String(w.l || '').replace(/"/g, '').trim();
    if (!d) { const src = String(w.i || '').split(',')[0].replace(/"/g, '') || String(w.u || '').replace(/^"/, ''); const m = src.match(/^([A-Za-z]:\\.+)\\[^\\]+\.(exe|ico|dll)/i); if (m) d = m[1]; }
    d = d.replace(/\\+$/, ''); const low = d.toLowerCase();
    if (!d || d.split('\\').length < 3 || GENERIC.has(low) || low.startsWith('c:\\windows')) return '';
    return d;
  }
  const under = (p, dir) => !!dir && String(p).toLowerCase().startsWith(dir.toLowerCase() + '\\');

  function evaluate(data) {
    const items = [], procs = data.proc || [], svcs = data.svc || [], start = S.startup || [];
    const attach = (it, dir) => {
      it.pids = procs.filter((p) => under(p.p, dir)).map((p) => ({ pid: p.id, name: p.n, mem: p.m })); it.mem = it.pids.reduce((a, p) => a + (p.mem || 0), 0);
      it.startup = dir ? start.filter((s) => String(s.value).toLowerCase().includes(dir.toLowerCase())) : [];
      it.svcs = dir ? svcs.filter((s) => String(s.p).toLowerCase().includes(dir.toLowerCase())) : [];
      it.dir = dir; return it;
    };
    for (const a of data.appx || []) { const d = matchDb('appx', a.n); if (!d) continue; items.push(attach({ id: 'appx:' + a.n, kind: 'Appx', name: d[1].includes('*') ? d[2] + ' · ' + a.n.replace(/^[^.]+\./, '') : d[2], pkg: a.n, risk: d[3], note: d[4], undo: { type: 'appx', pkg: a.n, removable: !a.r }, publisher: '', version: '' }, a.l)); }
    for (const w of data.win32 || []) { const d = matchDb('win32', w.n); if (!d) continue; items.push(attach({ id: 'win32:' + w.n, kind: 'Win32', name: w.n, pkg: w.n, risk: d[3], note: d[4] || d[2], undo: { type: 'win32', cmd: w.u || '', quiet: w.q || '' }, publisher: w.p || '', version: w.v || '' }, dirOf(w))); }
    const seen = new Set(); return items.filter((i) => (seen.has(i.id) ? false : seen.add(i.id))).sort((a, b) => (b.pids.length > 0) - (a.pids.length > 0) || (a.risk === 'aman' ? 0 : 1) - (b.risk === 'aman' ? 0 : 1) || a.name.localeCompare(b.name));
  }

  function finish(items, err) {
    if (items) {
      const prev = A.items.length; A.items = items; A.err = '';
      const run = items.filter((i) => i.pids.length), mem = run.reduce((a, i) => a + i.mem, 0), st = items.filter((i) => i.startup.length).length;
      A.sum = items.length + ' kandidat · ' + run.length + ' sedang jalan (' + fmtMem(mem) + ') · ' + st + ' di startup';
      let seenIds = []; try { seenIds = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch (e) { /* belum ada */ }
      const fresh = items.filter((i) => !seenIds.includes(i.id));
      if (fresh.length) {
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(seenFile, JSON.stringify(items.map((i) => i.id))); } catch (e) { /* abaikan */ }
        WC.logLine('ALERT', '[scan] ' + (prev || seenIds.length ? 'Bloatware baru terdeteksi' : 'Pemindaian awal') + ' (' + fresh.length + '): ' + fresh.slice(0, 8).map((i) => i.name).join(', ') + (fresh.length > 8 ? ' …' : '') + ' · ' + run.length + ' sedang jalan');
      } else WC.logLine('INFO', 'Scan selesai: ' + A.sum);
    } else A.err = err || 'gagal';
    A.scanning = false; A.at = Date.now();
  }
  function scan() {
    if (A.scanning) return; A.scanning = true; extra = Array.isArray(WC.CFG.scanExtra) ? WC.CFG.scanExtra.filter((e) => Array.isArray(e) && e.length >= 4) : [];
    if (!IS_WIN) { finish(evaluate(fakeData()), ''); return; }
    WC.runPS(SCAN_PS, (e, out) => {
      if (e && !out) return finish(null, e.message.split('\n')[0]);
      try { finish(evaluate(JSON.parse(out.trim()))); } catch (x) { finish(null, 'hasil pindai tidak terbaca'); }
    }, 120000);
  }

  // ------------------------------------------------------------ aksi
  function killItem(it) {
    const list = it.pids.filter((p) => !WC.isProtected(p.name) && p.pid !== process.pid);
    if (!list.length) { WC.logLine('INFO', it.name + ': tidak ada proses yang bisa dihentikan.'); return; }
    let ok = 0, bad = 0, left = list.length, last = '';
    list.forEach((p) => WC.killPid(p.pid, (e) => { if (e) { bad++; last = e.message; } else ok++; if (--left === 0) { WC.logLine(ok ? 'ACTION' : 'WARN', 'Kill ' + it.name + ': ' + ok + ' proses dihentikan' + (bad ? ', ' + bad + ' gagal (' + last + ')' : '')); setTimeout(scan, 1500); } }));
  }
  function disableStartup(it) { it.startup.forEach((e) => WC.removeStartup(e)); setTimeout(scan, 2500); }
  function uninstall(it) {
    const x = it.undo;
    if (x.type === 'appx') {
      if (!x.removable) { WC.logLine('WARN', it.name + ' adalah bagian dari Windows dan tidak bisa dihapus.'); return; }
      if (!/^[A-Za-z0-9_.\-]+$/.test(x.pkg)) { WC.logLine('WARN', 'Nama paket tidak valid: ' + x.pkg); return; }
      WC.runPS('try { Get-AppxPackage -Name "' + x.pkg + '" | Remove-AppxPackage -ErrorAction Stop; "ok" } catch { "err|" + $_.Exception.Message }', (e, out) => { const ok = out.trim().endsWith('ok'); WC.logLine(ok ? 'ACTION' : 'WARN', 'Uninstall ' + it.name + (ok ? ' berhasil (bisa dipasang lagi dari Microsoft Store)' : ' gagal: ' + (out.trim().slice(0, 160) || (e && e.message)))); setTimeout(scan, 2000); }, 120000);
    } else {
      if (!x.cmd) { WC.logLine('WARN', it.name + ': tidak ada perintah uninstall di registry. Gunakan Pengaturan > Aplikasi.'); return; }
      try { cp.spawn(x.cmd, { shell: true, detached: true, stdio: 'ignore' }).unref(); WC.logLine('ACTION', 'Uninstaller ' + it.name + ' dibuka. Ikuti langkah di jendela tersebut.'); setTimeout(scan, 20000); } catch (e) { WC.logLine('WARN', 'Gagal membuka uninstaller ' + it.name + ': ' + e.message); }
    }
  }
  function detail(it) {
    const L = [it.name + '  [' + it.kind + ' · risiko: ' + it.risk + ']', ''];
    if (it.note) L.push('Catatan   : ' + it.note); if (it.publisher) L.push('Penerbit  : ' + it.publisher); L.push((it.kind === 'Appx' ? 'Paket     : ' : 'Nama      : ') + it.pkg + (it.version ? '  v' + it.version : '')); L.push('Lokasi    : ' + (it.dir || '(tidak diketahui; proses/startup tidak bisa dikaitkan)'));
    L.push('Proses    : ' + (it.pids.length ? it.pids.map((p) => p.name + '#' + p.pid).slice(0, 8).join(', ') + ' · ' + fmtMem(it.mem) : 'tidak jalan'));
    L.push('Startup   : ' + (it.startup.length ? it.startup.map((s) => s.name).join(', ') : '-')); L.push('Layanan   : ' + (it.svcs.length ? it.svcs.map((s) => s.n + ' (' + s.s + ')').join(', ') : '-'));
    L.push('Uninstall : ' + (it.undo.type === 'appx' ? (it.undo.removable ? 'Remove-AppxPackage (akun ini; bisa dipasang lagi dari Store)' : 'tidak bisa (bagian dari Windows)') : it.undo.cmd || '(tidak ada)'), '', 'Tekan tombol apa saja untuk menutup.');
    WC.info('Detail', L);
  }

  function fakeData() {
    return { appx: [{ n: 'Microsoft.BingNews', f: 'x', l: 'C:\\Program Files\\WindowsApps\\Microsoft.BingNews_4.5_x64', r: false }, { n: 'king.com.CandyCrushSaga', f: 'x', l: 'C:\\Program Files\\WindowsApps\\king.com.CandyCrushSaga_1_x64', r: false }, { n: 'AD2F1837.HPSupportAssistant', f: 'x', l: 'C:\\Program Files\\WindowsApps\\AD2F1837.HPSupportAssistant_9', r: false }, { n: 'Microsoft.WindowsStore', f: 'x', l: 'C:\\x', r: true }, { n: 'Microsoft.XboxIdentityProvider', f: 'x', l: 'C:\\Program Files\\WindowsApps\\Microsoft.XboxIdentityProvider_12', r: true }],
      win32: [{ n: 'McAfee LiveSafe', p: 'McAfee, LLC', v: '16.0', l: 'C:\\Program Files\\McAfee', u: 'MsiExec.exe /X{1234}' }, { n: 'HP Touchpoint Analytics Client', p: 'HP Inc.', v: '4.1', l: '', i: 'C:\\Program Files\\HP\\HP Touchpoint Analytics Client\\HPTouchpoint.exe,0', u: '"C:\\Program Files\\HP\\unins000.exe"' }, { n: 'Microsoft OneDrive', p: 'Microsoft', v: '24', l: 'C:\\Users\\Demo\\AppData\\Local\\Microsoft\\OneDrive', u: '"C:\\Users\\Demo\\AppData\\Local\\Microsoft\\OneDrive\\Setup.exe" /uninstall' }, { n: 'Google Chrome', p: 'Google', v: '1', l: 'C:\\Program Files\\Google\\Chrome', u: 'x' }],
      proc: [{ id: 2201, n: 'OneDrive', p: 'C:\\Users\\Demo\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe', m: 180 * 1048576 }, { id: 2310, n: 'HPTouchpointAnalyticsService', p: 'C:\\Program Files\\HP\\HP Touchpoint Analytics Client\\svc.exe', m: 60 * 1048576 }, { id: 2330, n: 'McUICnt', p: 'C:\\Program Files\\McAfee\\mcuicnt.exe', m: 95 * 1048576 }, { id: 9, n: 'chrome', p: 'C:\\Program Files\\Google\\Chrome\\chrome.exe', m: 300 * 1048576 }],
      svc: [{ n: 'HPTouchpointAnalyticsService', d: 'HP Touchpoint', s: 'Running', p: '"C:\\Program Files\\HP\\HP Touchpoint Analytics Client\\svc.exe"' }] };
  }

  if (S.selftest) { S.startup = S.startup || []; WC.on('startup', () => {}); setTimeout(() => {}, 0); }
  WC.on('headless', () => { setTimeout(scan, 45000); setInterval(scan, 6 * 3600e3).unref(); });
  WC.on('tick', () => { if (!S.headless && !A.at && !A.scanning && !S.selftest && S.tabs.some((t) => t.type === 'scan') && Date.now() - WC.S.startedAt > 8000) scan(); });
  S.startedAt = S.startedAt || Date.now();

  const RISK = { aman: '32', cek: '33' };
  WC.addView('scan', {
    title: 'Scan', hints: '↑↓ · / cari · Esc reset · s pindai · Enter detail · k hentikan · d startup · u uninstall',
    init() { return { query: '' }; },
    rows(tab) { let rows = A.items.map((i) => Object.assign(i, { k: i.id })); if (tab.query) { const q = tab.query.toLowerCase(); rows = rows.filter((i) => (i.name + ' ' + i.kind + ' ' + i.note).toLowerCase().includes(q)); } return rows; },
    render(scr, r, tab) {
      if (S.selftest && !A.at) { S.startup = [{ scope: 'HKCU', key: 'HKCU\\x', name: 'OneDrive', value: '"C:\\Users\\Demo\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background' }]; scan(); }
      const rows = this.rows(tab), safe = A.items.filter((i) => i.risk === 'aman').length, review = A.items.filter((i) => i.risk === 'cek').length;
      scr.put(r.x, r.y, pad(' ' + (A.scanning ? 'Memindai aplikasi terpasang… (10-30 dtk)' : A.err ? '! ' + A.err + ' · tekan s untuk ulangi' : A.at ? A.items.length + ' temuan · ' + safe + ' aman · ' + review + ' perlu cek · ' + u.hhmmss(new Date(A.at)) : 'Belum dipindai · tekan s') + (tab.query ? ' · cari: ' + tab.query : '') + (IS_WIN ? '' : ' · [data contoh, bukan Windows]'), r.w), A.err ? '33' : A.scanning ? '36' : '2');
      const cols = [{ t: 'Risiko', w: 7, f: (x) => x.risk, style: (x) => RISK[x.risk] }, { t: 'Jenis', w: 6, f: (x) => x.kind }, { t: 'Nama', w: 32, f: (x) => x.name },
        { t: 'Jalan', w: 16, f: (x) => (x.pids.length ? x.pids.length + ' proses · ' + fmtMem(x.mem) : '-'), style: (x) => (x.pids.length ? '1;31' : '2') }, { t: 'Start', w: 5, a: 'r', f: (x) => (x.startup.length ? x.startup.length : '-') }, { t: 'Catatan', flex: true, f: (x) => x.note }];
      const sel = ui.drawTable(scr, r.x, r.y + 1, r.w, r.h - 1, cols, rows, tab.selKey, (x) => x.k, tab);
      if (sel && !tab.selKey) tab.selKey = sel.k;
      if (!rows.length) scr.put(r.x + 2, r.y + 3, A.scanning ? 'Memindai aplikasi dan menghubungkan proses…' : A.err ? 'Scan gagal. Tekan s untuk mencoba lagi.' : tab.query ? 'Tidak ada hasil cocok. Esc untuk hapus pencarian.' : A.at ? 'Tidak ada aplikasi yang cocok dengan database bloatware.' : 'Belum ada hasil. Tekan s untuk memulai scan.', A.err ? '33' : '2');
    },
    key(k, tab) {
      const rows = this.rows(tab), cur = rows.find((x) => x.k === tab.selKey) || rows[0];
      if (ui.listKey(tab, rows, k, (x) => x.k)) return true;
      if (k.str === '/') { WC.input('Cari hasil scan', tab.query, (v) => { tab.query = v.trim(); tab.selKey = null; }); return true; }
      if (k.name === 'escape' && tab.query) { tab.query = ''; tab.selKey = null; return true; }
      if (k.name === 's') { A.at = 0; scan(); return true; }
      if (!cur) return false;
      if (k.name === 'return') { detail(cur); return true; }
      const warn = cur.risk === 'cek' ? ['⚠ Risiko "cek": ' + (cur.note || 'periksa dulu apakah Anda memakainya') + '.'] : [];
      if (k.name === 'k' && !k.shift) { if (!cur.pids.length) { WC.logLine('INFO', cur.name + ' tidak sedang berjalan.'); return true; } WC.confirm(['Hentikan semua proses "' + cur.name + '"? (' + cur.pids.length + ' proses, ' + fmtMem(cur.mem) + ')'].concat(warn), () => killItem(cur)); return true; }
      if (k.name === 'k' || k.str === 'K') { const list = rows.filter((i) => i.risk === 'aman' && i.pids.length); if (!list.length) { WC.logLine('INFO', 'Tidak ada bloatware "aman" yang sedang jalan.'); return true; } WC.confirm(['Hentikan SEMUA bloatware berisiko "aman" yang sedang jalan?', list.map((i) => i.name).join(', ')], () => list.forEach(killItem)); return true; }
      if (k.name === 'd') { if (!cur.startup.length) { WC.logLine('INFO', cur.name + ': tidak ada entri startup yang terkait.'); return true; } WC.confirm(['Hapus ' + cur.startup.length + ' entri startup milik "' + cur.name + '"?', cur.startup.map((s) => s.name).join(', '), 'Aplikasi tetap terpasang. Cadangan disimpan (tab Startup, Enter untuk memulihkan).'].concat(warn), () => disableStartup(cur)); return true; }
      if (k.name === 'u') { WC.confirm(['UNINSTALL "' + cur.name + '"?', cur.undo.type === 'appx' ? 'Aplikasi Store ini dihapus untuk akun ini (bisa dipasang lagi dari Microsoft Store).' : 'Uninstaller aplikasi akan dibuka; Anda mengonfirmasi di sana.'].concat(warn), () => uninstall(cur)); return true; }
      return false;
    },
  }, { before: 'log' });
};
