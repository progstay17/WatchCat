'use strict';
// Kontrol proses lanjutan (menambah tab Proses): pohon proses (t), detail di panel bawah, menu kontrol (o):
// prioritas, batas core CPU, trim memori, bekukan/lanjutkan. Plus tab Layanan Windows (hanya admin yang bisa mengubah).
module.exports = function (WC) {
  const { S, u, ui, IS_WIN, VIEWS, fs, path, cp, DATA_DIR } = WC;
  const { pad, fmtMem } = u;
  const P = { parents: new Map(), lastParents: 0, loadingParents: false, parentsErr: '', detail: new Map(), want: null, loadingDetail: false, suspended: new Set() };
  const parentsWanted = () => S.tabs.some((t) => t.type === 'procs' && t.tree);

  // ------------------------------------------------------------ induk proses (untuk pohon)
  function fetchParents() {
    if (P.loadingParents) return; P.loadingParents = true;
    const done = (out, err) => { if (!err) { for (const l of out.split(/\r?\n/)) { const m = l.trim().match(/^(\d+)[|\s]+(\d+)$/); if (m) P.parents.set(+m[1], +m[2]); } P.lastParents = Date.now(); P.parentsErr = ''; } else P.parentsErr = String(err.message || err).split('\n')[0]; P.loadingParents = false; };
    if (IS_WIN) WC.runPS('Get-CimInstance Win32_Process | ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.ParentProcessId }', (e, out) => done(out || '', e), 30000);
    else cp.execFile('ps', ['-eo', 'pid=,ppid='], (e, out) => done(String(out || ''), e));
  }

  function treeRows(rows) {
    const have = new Map(rows.map((r) => [+r.k, r])), kids = new Map();
    for (const r of rows) { let pp = P.parents.get(+r.k); if (!have.has(pp) || pp === +r.k) pp = 0; if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(r); }
    const out = [], seen = new Set();
    const walk = (list, depth) => { list.sort((a, b) => b.ws - a.ws); for (const r of list) { const pid = +r.k; if (seen.has(pid)) continue; seen.add(pid); r.disp = (depth ? '  '.repeat(depth - 1) + '└ ' : '') + r.name; out.push(r); walk(kids.get(pid) || [], depth + 1); } };
    walk(kids.get(0) || [], 0);
    for (const r of rows) if (!seen.has(+r.k)) { r.disp = r.name; out.push(r); }
    return out;
  }

  // ------------------------------------------------------------ detail proses
  function fetchDetail(pid) {
    if (P.loadingDetail) return; P.loadingDetail = true;
    const fin = (d) => { P.detail.set(pid, Object.assign({ t: Date.now() }, d)); P.loadingDetail = false; };
    if (IS_WIN) {
      WC.runPS(['$id = ' + pid, '$c = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue', '$g = Get-Process -Id $id -ErrorAction SilentlyContinue',
        '$pc = $null; $st = $null; try { $pc = $g.PriorityClass.ToString() } catch {}; try { $st = $g.StartTime.ToString("yyyy-MM-dd HH:mm:ss") } catch {}',
        '[pscustomobject]@{ path = $c.ExecutablePath; cmd = $c.CommandLine; ppid = $c.ParentProcessId; thr = $c.ThreadCount; hnd = $c.HandleCount; prio = $pc; start = $st } | ConvertTo-Json -Compress'].join('\n'),
      (e, out) => { try { fin(e ? { err: e.message } : JSON.parse(out.trim())); } catch (x) { fin({ err: 'tidak terbaca' }); } }, 30000);
    } else {
      const d = {}; try { d.path = fs.readlinkSync('/proc/' + pid + '/exe'); d.cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ').trim(); d.ppid = P.parents.get(pid) || 0; const st = fs.readFileSync('/proc/' + pid + '/status', 'utf8'); d.thr = (st.match(/Threads:\s+(\d+)/) || [])[1]; d.hnd = '-'; } catch (e) { d.err = e.code || e.message; }
      fin(d);
    }
  }

  // ------------------------------------------------------------ aksi kontrol
  const ADD = "Add-Type -MemberDefinition '[DllImport(\"psapi.dll\")] public static extern bool EmptyWorkingSet(IntPtr h); [DllImport(\"ntdll.dll\")] public static extern int NtSuspendProcess(IntPtr h); [DllImport(\"ntdll.dll\")] public static extern int NtResumeProcess(IntPtr h);' -Name N -Namespace WC";
  function psFor(kind, ids, arg) {
    const body = { prio: "$p.PriorityClass = '" + arg + "'", aff: '$p.ProcessorAffinity = [IntPtr]' + arg, trim: '[void][WC.N]::EmptyWorkingSet($p.Handle)', suspend: '[void][WC.N]::NtSuspendProcess($p.Handle)', resume: '[void][WC.N]::NtResumeProcess($p.Handle)' }[kind];
    return (/trim|suspend|resume/.test(kind) ? ADD + '\n' : '') + '$ids = @(' + ids.join(',') + ')\nforeach ($i in $ids) { try { $p = Get-Process -Id $i -ErrorAction Stop; ' + body + '; "ok|$i" } catch { "err|$i|" + $_.Exception.Message } }';
  }
  function act(kind, cur, arg, label) {
    const ids = cur.pids.filter((p) => p !== process.pid); if (!ids.length) return;
    if (kind !== 'trim' && WC.isProtected(cur.name)) { WC.logLine('WARN', cur.name + ' dilindungi: ' + label + ' tidak diizinkan.'); return; }
    if (!IS_WIN) { WC.logLine('WARN', label + ': hanya tersedia di Windows.'); return; }
    WC.runPS(psFor(kind, ids, arg), (e, out) => {
      const ok = [], bad = []; for (const l of out.split(/\r?\n/)) { const p = l.trim().split('|'); if (p[0] === 'ok') ok.push(+p[1]); else if (p[0] === 'err') bad.push(p.slice(2).join('|')); }
      if (kind === 'suspend') ok.forEach((p) => P.suspended.add(p)); if (kind === 'resume') ok.forEach((p) => P.suspended.delete(p));
      WC.logLine(ok.length ? 'ACTION' : 'WARN', label + ' ' + cur.name + ': ' + ok.length + ' berhasil' + (bad.length ? ', ' + bad.length + ' gagal (' + bad[0] + ')' : '') + (e && !ok.length && !bad.length ? ' (' + e.message + ')' : ''));
    }, 45000);
  }
  function controlMenu(cur) {
    const cores = require('os').cpus().length, aff = (n) => '0x' + ((1 << Math.min(n, 30)) - 1).toString(16);
    const sus = cur.pids.some((p) => P.suspended.has(p));
    const items = [
      { label: 'Prioritas: Idle (paling rendah)', hint: '', fn: () => act('prio', cur, 'Idle', 'Prioritas → Idle') },
      { label: 'Prioritas: Rendah (BelowNormal)', hint: 'disarankan', fn: () => act('prio', cur, 'BelowNormal', 'Prioritas → Rendah') },
      { label: 'Prioritas: Normal (kembalikan)', hint: '', fn: () => act('prio', cur, 'Normal', 'Prioritas → Normal') },
      { label: 'Batasi CPU: 1 core', hint: '', fn: () => act('aff', cur, aff(1), 'Batas 1 core') },
      { label: 'Batasi CPU: ' + Math.max(1, Math.floor(cores / 2)) + ' core', hint: '', fn: () => act('aff', cur, aff(Math.max(1, Math.floor(cores / 2))), 'Batas ' + Math.max(1, Math.floor(cores / 2)) + ' core') },
      { label: 'Batasi CPU: semua core (kembalikan)', hint: '', fn: () => act('aff', cur, aff(cores), 'Batas semua core') },
      { label: 'Trim memori (kosongkan working set)', hint: 'sementara', fn: () => act('trim', cur, null, 'Trim memori') },
      sus ? { label: 'Lanjutkan proses (resume)', hint: '', fn: () => act('resume', cur, null, 'Lanjutkan') }
        : { label: 'Bekukan proses (suspend)', hint: 'hati-hati', fn: () => WC.confirm(['Bekukan "' + cur.name + '"?', 'Proses berhenti total sampai dilanjutkan (menu o → Lanjutkan). WatchCat otomatis melanjutkannya saat keluar.'], () => act('suspend', cur, null, 'Bekukan')) },
    ];
    WC.menu('Kontrol: ' + cur.name + (cur.pids.length > 1 ? ' (' + cur.pids.length + ' proses)' : ''), items);
  }

  // ------------------------------------------------------------ pasang ke tab Proses
  const PV = VIEWS.procs, baseRows = PV.rows, baseKey = PV.key;
  PV.hints = '↑↓ · k hentikan · o kontrol · t pohon · s urut · g grup · / cari';
  PV.rows = function (tab) { const rows = baseRows.call(this, tab); return tab.tree && !tab.group ? treeRows(rows) : rows; };
  PV.key = function (k, tab) {
    if (k.name === 't') { tab.tree = !tab.tree; tab.selKey = null; if (tab.tree) { tab.group = false; fetchParents(); } return true; }
    if (k.name === 'g') tab.tree = false;
    if (k.name === 'o') { const rows = this.rows(tab), cur = rows.find((x) => x.k === tab.selKey) || rows[0]; if (cur) controlMenu(cur); return true; }
    return baseKey.call(this, k, tab);
  };
  PV.detail = function (sel) {
    const pid = sel.pids[0]; P.want = { pid, since: P.want && P.want.pid === pid ? P.want.since : Date.now() };
    const d = P.detail.get(pid); if (!d) return [P.loadingDetail ? 'Memuat detail proses…' : 'Detail belum tersedia · pilih proses lagi untuk mencoba'];
    if (d.err) return ['Detail tidak tersedia: ' + d.err];
    const par = S.procs.find((p) => p.pid === d.ppid);
    return ['Path : ' + (d.path || '(tidak terbaca)') + (sel.pids.length > 1 ? '   [PID ' + pid + ' dari ' + sel.pids.length + ' proses]' : ''), 'Cmd  : ' + (d.cmd || '-'),
      'Induk: ' + d.ppid + (par ? ' (' + par.name + ')' : '') + ' · thread ' + d.thr + ' · handle ' + d.hnd + ' · prioritas ' + (d.prio || '?') + (P.suspended.has(pid) ? ' · DIBEKUKAN' : ''), 'Mulai: ' + (d.start || '?')];
  };
  WC.on('tick', () => {
    if (S.selftest) return;
    if (parentsWanted() && Date.now() - P.lastParents > 10000) fetchParents();
    const w = P.want; if (w && Date.now() - w.since >= 1000) { const d = P.detail.get(w.pid); if (!d || Date.now() - d.t > 30000) fetchDetail(w.pid); }
  });
  WC.on('quit', () => {
    if (!P.suspended.size || !IS_WIN) return;
    try { const f = path.join(require('os').tmpdir(), 'wc-resume-' + process.pid + '.ps1'); fs.writeFileSync(f, '\ufeff' + psFor('resume', [...P.suspended], null)); cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { timeout: 20000, windowsHide: true }); fs.unlinkSync(f); } catch (e) { /* abaikan */ }
  });

  // ------------------------------------------------------------ tab Layanan
  const SV = { rows: [], loading: false, err: '', at: 0 };
  const CRITICAL = /^(Rpc.*|Dcom.*|LSM|Winmgmt|EventLog|BFE|mpssvc|WinDefend|Sense|SecurityHealthService|wscsvc|Dhcp|Dnscache|nsi|Power|PlugPlay|ProfSvc|SamSs|Schedule|TrustedInstaller|UserManager|Themes|AudioSrv|AudioEndpointBuilder|CryptSvc|gpsvc|SENS|ShellHWDetection|LanmanServer|LanmanWorkstation|NlaSvc|netprofm|Netman|BrokerInfrastructure|CoreMessagingRegistrar|SystemEventsBroker|TimeBrokerSvc|StateRepository|DispBrokerDesktopSvc|UsoSvc|wuauserv|BITS|WlanSvc|Wpn.*|CDPSvc|DeviceAssociationService|FontCache|KeyIso|lmhosts|Wcmsvc|DPS|EventSystem|iphlpsvc|TokenBroker|DoSvc|WSearch_|Appinfo|CertPropSvc|vmcompute|vmms|WslService|LxssManager)$/i;
  const HINTS = [[/^DiagTrack$/i, 'Telemetri Microsoft (Connected User Experiences)'], [/^dmwappushservice$/i, 'Pesan WAP push (terkait telemetri)'], [/^MapsBroker$/i, 'Peta offline'], [/^Fax$/i, 'Layanan fax'], [/^(XblAuthManager|XblGameSave|XboxGipSvc|XboxNetApiSvc)$/i, 'Layanan Xbox (aman jika tidak pakai Xbox/Game Pass)'],
    [/^RetailDemo$/i, 'Mode demo toko'], [/^WMPNetworkSvc$/i, 'Berbagi media Windows Media Player'], [/^lfsvc$/i, 'Layanan lokasi (geolocation)'], [/^RemoteRegistry$/i, 'Registri jarak jauh (risiko keamanan)'], [/^icssvc$/i, 'Hotspot seluler Windows'], [/^PhoneSvc$/i, 'Layanan telepon'],
    [/^WalletService$/i, 'Dompet Windows'], [/^SCardSvr$|^ScDeviceEnum$|^SCPolicySvc$/i, 'Smart card (jarang dipakai di PC rumah)'], [/^SysMain$/i, 'Prefetch/Superfetch (opsional di SSD)'], [/^TabletInputService$|^TextInputManagementService$/i, 'Input tablet/pena'],
    [/^(HPAppHelperCap|HPDiagsCap|HPNetworkCap|HPSysInfoCap|HPSupportAssistant.*|HPTouchpointAnalytics.*|hpqwmiex|HPPrintScanDoctorService)$/i, 'Bawaan HP: telemetri/dukungan (bisa dinonaktifkan)'], [/^(McAfee.*|mfe.*|Norton.*|NortonSecurity|ccSvcHst)$/i, 'Antivirus trial bawaan OEM'], [/^(WildTangent.*|WTGames.*)$/i, 'Game bawaan OEM']];
  const note = (n) => { const h = HINTS.find((x) => x[0].test(n)); return h ? h[1] : ''; };
  const SAFE = /^[A-Za-z0-9_.\-$]+$/;
  const BK = path.join(DATA_DIR, 'service-backup.jsonl');
  const quoteSvc = (n) => "'" + n.replace(/'/g, "''") + "'";
  const modeMap = { Auto: 'Automatic', Manual: 'Manual', Disabled: 'Disabled' };

  function loadServices() {
    if (SV.loading || S.selftest) return; SV.loading = true;
    const fin = (rows, err) => { SV.rows = rows || SV.rows; SV.err = err || ''; SV.at = Date.now(); SV.loading = false; };
    if (!IS_WIN) return fin([], 'hanya Windows');
    WC.runPS('Get-CimInstance Win32_Service | ForEach-Object { [pscustomobject]@{ n = $_.Name; d = $_.DisplayName; s = $_.State; m = $_.StartMode; p = $_.PathName } } | ConvertTo-Json -Compress', (e, out) => {
      if (e) return fin(null, e.message.split('\n')[0]);
      try { let a = JSON.parse(out.trim()); if (!Array.isArray(a)) a = [a]; fin(a.map((x) => ({ k: x.n, name: x.n, disp: x.d || '', state: x.s, mode: x.m, path: x.p || '', hint: note(x.n), critical: CRITICAL.test(x.n) }))); } catch (x) { fin(null, 'data tidak terbaca'); }
    }, 60000);
  }
  function changeService(s, mode, stop, label) {
    if (!WC.isAdmin()) { WC.logLine('WARN', 'Mengubah layanan butuh administrator. Buka WatchCat dengan "Run as administrator".'); return; }
    if (s.critical || !SAFE.test(s.name)) { WC.logLine('WARN', 'Layanan ' + s.name + ' dilindungi, tidak diubah.'); return; }
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.appendFileSync(BK, JSON.stringify({ t: new Date().toISOString(), name: s.name, mode: s.mode, state: s.state }) + '\n'); } catch (e) { /* abaikan */ }
    const q = quoteSvc(s.name), lines = [];
    if (mode) lines.push('Set-Service -Name ' + q + ' -StartupType ' + modeMap[mode] + ' -ErrorAction Stop');
    if (stop) lines.push('Stop-Service -Name ' + q + ' -Force -ErrorAction SilentlyContinue');
    lines.push('"ok"');
    WC.runPS('try { ' + lines.join('; ') + ' } catch { "err|" + $_.Exception.Message }', (e, out) => { const ok = out.trim().endsWith('ok'); WC.logLine(ok ? 'ACTION' : 'WARN', 'Layanan ' + s.name + ': ' + label + (ok ? ' (sebelumnya ' + s.mode + '/' + s.state + ', u = batalkan)' : ' gagal: ' + (out.trim() || (e && e.message)))); SV.at = 0; loadServices(); }, 45000);
  }
  function undoService() {
    let last; try { last = fs.readFileSync(BK, 'utf8').trim().split('\n').filter(Boolean).pop(); last = JSON.parse(last); } catch (e) { WC.logLine('INFO', 'Tidak ada perubahan layanan untuk dibatalkan.'); return; }
    if (!WC.isAdmin()) { WC.logLine('WARN', 'Butuh administrator.'); return; } if (!SAFE.test(last.name) || !modeMap[last.mode]) return;
    const q = quoteSvc(last.name);
    WC.runPS('try { Set-Service -Name ' + q + ' -StartupType ' + modeMap[last.mode] + ' -ErrorAction Stop; ' + (last.state === 'Running' && last.mode !== 'Disabled' ? 'Start-Service -Name ' + q + ' -ErrorAction SilentlyContinue; ' : '') + '"ok" } catch { "err|" + $_.Exception.Message }', (e, out) => {
      const ok = out.trim().endsWith('ok'); WC.logLine(ok ? 'ACTION' : 'WARN', 'Layanan ' + last.name + ' dikembalikan ke ' + last.mode + (ok ? '' : ' gagal: ' + out.trim()));
      if (ok) { try { const L = fs.readFileSync(BK, 'utf8').trim().split('\n').filter(Boolean); L.pop(); fs.writeFileSync(BK, L.join('\n') + (L.length ? '\n' : '')); } catch (x) { /* abaikan */ } } SV.at = 0; loadServices();
    }, 45000);
  }

  if (S.selftest) {
    SV.rows = [['DiagTrack', 'Connected User Experiences and Telemetry', 'Running', 'Auto'], ['XblGameSave', 'Xbox Live Game Save', 'Stopped', 'Manual'], ['HPAppHelperCap', 'HP App Helper HSA Service', 'Running', 'Auto'], ['SysMain', 'SysMain', 'Running', 'Auto'], ['RpcSs', 'Remote Procedure Call (RPC)', 'Running', 'Auto'], ['Spooler', 'Print Spooler', 'Running', 'Auto'], ['WSearch', 'Windows Search', 'Running', 'Auto'], ['MapsBroker', 'Downloaded Maps Manager', 'Stopped', 'Auto']]
      .map((x) => ({ k: x[0], name: x[0], disp: x[1], state: x[2], mode: x[3], path: 'C:\\Windows\\System32\\svchost.exe', hint: note(x[0]), critical: CRITICAL.test(x[0]) }));
    SV.at = Date.now();
    P.detail.set(1090, { t: Date.now(), path: 'C:\\Windows\\explorer.exe', cmd: 'C:\\WINDOWS\\Explorer.EXE', ppid: 1010, thr: 112, hnd: 4410, prio: 'Normal', start: '2026-11-03 04:01:12' });
  }

  const modeShow = { svc: 'saran', all: 'semua', run: 'berjalan' };
  WC.addView('services', {
    title: 'Layanan', hints: '↑↓ · f jenis · / cari · Esc reset · d nonaktifkan · s hentikan · m manual · a otomatis · u batalkan · r muat ulang',
    init() { return { filter: 'svc', query: '' }; },
    rows(tab) {
      let rows = SV.rows.slice();
      if (tab.filter === 'svc') rows = rows.filter((x) => x.hint); else if (tab.filter === 'run') rows = rows.filter((x) => x.state === 'Running');
      if (tab.query) { const q = tab.query.toLowerCase(); rows = rows.filter((x) => (x.name + ' ' + x.disp + ' ' + x.hint).toLowerCase().includes(q)); }
      return rows.sort((a, b) => (!!b.hint - !!a.hint) || a.name.localeCompare(b.name));
    },
    render(scr, r, tab) {
      if (!SV.at && !SV.loading) loadServices(); else if (Date.now() - SV.at > 60000 && S.tabs[S.active] === tab) loadServices();
      const rows = this.rows(tab);
      scr.put(r.x, r.y, pad(' ' + SV.rows.length + ' layanan · tampil: ' + modeShow[tab.filter] + ' (' + rows.length + ')' + (tab.query ? ' · cari: ' + tab.query : '') + ' · ' + (WC.isAdmin() ? 'admin: bisa mengubah' : 'hanya lihat · jalankan WatchCat-Admin untuk mengubah') + (SV.loading ? ' · memuat…' : '') + (SV.err ? ' · ! ' + SV.err : ''), r.w), WC.isAdmin() ? '2' : '33');
      const cols = [{ t: 'Nama', w: 26, f: (x) => (x.critical ? '* ' : '') + x.name }, { t: 'Status', w: 9, f: (x) => x.state, style: (x) => (x.state === 'Running' ? '32' : '2') }, { t: 'Mulai', w: 9, f: (x) => x.mode },
        { t: 'Keterangan', flex: true, f: (x) => (x.hint ? '⚠ ' + x.hint : x.critical ? 'dilindungi (penting untuk sistem)' : x.disp), style: (x) => (x.hint ? '33' : '0') }];
      const sel = ui.drawTable(scr, r.x, r.y + 1, r.w, r.h - 1, cols, rows, tab.selKey, (x) => x.k, tab, (x) => (x.critical ? '2' : '0'));
      if (sel && !tab.selKey) tab.selKey = sel.k;
      if (!rows.length) scr.put(r.x + 2, r.y + 3, SV.loading ? 'Memuat daftar layanan…' : SV.err ? 'Data layanan gagal dimuat. Tekan r untuk mencoba lagi.' : tab.query ? 'Tidak ada layanan cocok. Esc untuk hapus pencarian.' : 'Tidak ada layanan pada filter ini (tekan f).', SV.err ? '33' : '2');
    },
    key(k, tab) {
      const rows = this.rows(tab), cur = rows.find((x) => x.k === tab.selKey) || rows[0];
      if (ui.listKey(tab, rows, k, (x) => x.k)) return true;
      if (k.name === 'f') { tab.filter = { svc: 'all', all: 'run', run: 'svc' }[tab.filter]; tab.selKey = null; return true; }
      if (k.str === '/') { WC.input('Cari layanan Windows', tab.query, (v) => { tab.query = v.trim(); tab.selKey = null; }); return true; }
      if (k.name === 'escape' && tab.query) { tab.query = ''; tab.selKey = null; return true; }
      if (k.name === 'r') { SV.at = 0; loadServices(); return true; }
      if (k.name === 'u') { WC.confirm(['Batalkan perubahan layanan terakhir?', 'Mode mulai (dan status jalan) dikembalikan seperti sebelum diubah.'], undoService); return true; }
      if (!cur) return false;
      const ask = (title, line, fn) => { if (cur.critical) WC.logLine('WARN', cur.name + ' dilindungi, tidak diubah.'); else WC.confirm([title + ' "' + cur.name + '"?', line], fn); return true; };
      if (k.name === 'd') return ask('Nonaktifkan layanan', 'Dihentikan sekarang dan tidak jalan saat boot. Bisa dibatalkan dengan u.', () => changeService(cur, 'Disabled', true, 'dinonaktifkan'));
      if (k.name === 's') return ask('Hentikan layanan', 'Hanya dihentikan sekarang; mode mulai tidak berubah.', () => changeService(cur, null, true, 'dihentikan'));
      if (k.name === 'm') return ask('Ubah ke Manual', 'Tidak jalan otomatis saat boot, tetap bisa dipakai bila dibutuhkan.', () => changeService(cur, 'Manual', false, 'diubah ke Manual'));
      if (k.name === 'a') return ask('Ubah ke Otomatis', 'Jalan otomatis saat boot.', () => changeService(cur, 'Auto', false, 'diubah ke Otomatis'));
      return false;
    },
  }, { before: 'log' });
};
