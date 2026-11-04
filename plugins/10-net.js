'use strict';
// Tab Jaringan: grafik unduh/unggah (adapter fisik) + koneksi aktif per proses.
// Catatan jujur: Windows tidak menyediakan bandwidth per proses tanpa ETW/admin, jadi yang ditampilkan per proses
// adalah jumlah koneksi dan tujuan, sedangkan kecepatan adalah total adapter fisik.
module.exports = function (WC) {
  const { S, u, ui, IS_WIN, fs, path, cp, DATA_DIR } = WC;
  const { pad, clamp, fmtMem } = u;
  const N = { rx: [], tx: [], conns: [], tmp: [], err: '', child: null, prev: null, tot: { rx: 0, tx: 0 }, restarts: 0, stopping: false, ticks: 0 };

  const PORTS = { 20: 'ftp', 21: 'ftp', 22: 'ssh', 25: 'smtp', 53: 'dns', 80: 'http', 110: 'pop3', 143: 'imap', 443: 'https', 465: 'smtps', 587: 'smtp', 993: 'imaps', 3306: 'mysql', 3389: 'rdp', 5432: 'postgres', 5228: 'gcm', 8080: 'http-alt', 8443: 'https-alt' };
  const rate = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : Math.round(b / 1024) + ' KB/s');
  const axis = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + 'M' : Math.round(b / 1024) + 'K');
  const nice = (v) => [102400, 262144, 524288, 1048576, 2097152, 5242880, 10485760, 26214400, 52428800, 104857600, 262144000, 1048576000].find((s) => s >= v) || v;
  const isPrivate = (a) => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|fe80|fc|fd|0\.0\.0\.0)/i.test(a);

  function push(rx, tx) {
    const now = Date.now();
    if (N.prev) {
      const dt = (now - N.prev.t) / 1000;
      if (dt > 0.2) {
        const dr = Math.max(0, rx - N.prev.rx), dtx = Math.max(0, tx - N.prev.tx);
        N.rx.push(dr / dt); N.tx.push(dtx / dt); N.tot.rx += dr; N.tot.tx += dtx;
        if (N.rx.length > 300) { N.rx.shift(); N.tx.shift(); }
      }
    }
    N.prev = { rx, tx, t: now };
  }

  const WORKER_PS = [
    'param([int]$ParentPid)',
    '$i = 0; $names = $null',
    'while ($true) {',
    '  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }',
    '  try {',
    '    if ($i % 30 -eq 0) { $names = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq "Up" } | ForEach-Object { $_.Name }) }',
    '    if ($names.Count -gt 0) { $s = Get-NetAdapterStatistics -Name $names -ErrorAction Stop } else { $s = Get-NetAdapterStatistics -ErrorAction Stop }',
    '    $rx = ($s | Measure-Object ReceivedBytes -Sum).Sum; $tx = ($s | Measure-Object SentBytes -Sum).Sum',
    '    "S|$rx|$tx"',
    '  } catch { "S|0|0" }',
    '  if ($i % 5 -eq 0) {',
    '    try {',
    '      $map = @{}; Get-Process | ForEach-Object { $map[[int]$_.Id] = $_.ProcessName }',
    '      Get-NetTCPConnection -State Established -ErrorAction Stop | ForEach-Object { "C|{0}|{1}|{2}|{3}|{4}" -f $_.OwningProcess, $map[[int]$_.OwningProcess], $_.RemoteAddress, $_.RemotePort, $_.LocalPort }',
    '    } catch { }',
    '    "E"',
    '  }',
    '  $i++; Start-Sleep -Seconds 1',
    '}',
  ].join('\n');

  function onLine(line) {
    if (!line) return;
    if (line[0] === 'S') { const p = line.split('|'); push(+p[1] || 0, +p[2] || 0); }
    else if (line[0] === 'C') { const p = line.split('|'); N.tmp.push({ pid: +p[1], name: p[2] || '?', addr: p[3], port: +p[4], lport: +p[5] }); }
    else if (line[0] === 'E') { N.conns = N.tmp; N.tmp = []; }
  }

  function startWorker() {
    if (N.child || S.selftest || S.headless) return;
    if (!IS_WIN) return;
    const f = path.join(DATA_DIR, 'net-worker.ps1');
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, '\uFEFF' + WORKER_PS); } catch (e) { N.err = e.message; return; }
    const c = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f, String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    N.child = c; let buf = ''; c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); onLine(line); } });
    c.on('error', (e) => { N.err = e.message; N.child = null; });
    c.on('exit', (code) => { N.child = null; if (!N.stopping && ++N.restarts <= 5) { N.err = 'pekerja jaringan berhenti (kode ' + code + '), mencoba lagi…'; setTimeout(startWorker, 5000); } });
  }

  function linuxPoll() {
    try {
      let rx = 0, tx = 0;
      for (const l of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) { const m = l.trim().match(/^(\S+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/); if (m && m[1] !== 'lo') { rx += +m[2]; tx += +m[3]; } }
      push(rx, tx);
    } catch (e) { N.err = e.message; }
    if (N.ticks % 5 === 0) cp.execFile('ss', ['-tnpH', 'state', 'established'], { timeout: 4000 }, (err, out) => {
      if (err) return; const list = [];
      for (const l of String(out).split('\n')) { const m = l.match(/(\S+):(\d+)\s+(\S+):(\d+)\s+users:\(\("([^"]+)",pid=(\d+)/); if (m) list.push({ pid: +m[6], name: m[5], addr: m[3], port: +m[4], lport: +m[2] }); }
      N.conns = list;
    });
  }

  WC.on('tick', () => {
    N.ticks++;
    const want = S.tabs.some((t) => t.type === 'net');
    if (want && IS_WIN && !N.child && N.restarts <= 5) startWorker();
    if (!want && N.child) { N.stopping = true; N.child.kill(); N.child = null; N.stopping = false; N.restarts = 0; }
    if (!IS_WIN && want && !S.selftest) linuxPoll();
  });
  WC.on('quit', () => { N.stopping = true; if (N.child) { try { N.child.kill(); } catch (e) { /* abaikan */ } } });

  if (S.selftest) {
    for (let i = 0; i < 120; i++) { N.rx.push(900000 + 700000 * Math.sin(i / 8) * Math.sin(i / 8) + (i > 100 ? 2500000 : 0)); N.tx.push(80000 + 60000 * Math.abs(Math.sin(i / 5))); }
    N.tot = { rx: 812 * 1048576, tx: 96 * 1048576 };
    N.conns = [['chrome', '142.250.190.46', 443], ['chrome', '151.101.1.69', 443], ['chrome', '104.18.32.7', 443], ['msedge', '13.107.42.14', 443], ['rustdesk', '103.2.3.4', 21116], ['onedrive', '20.190.159.4', 443], ['node', '127.0.0.1', 8080], ['com.docker.backend', '192.168.1.5', 2375], ['svchost', '23.50.60.7', 80]]
      .map((c, i) => ({ pid: 100 + i, name: c[0], addr: c[1], port: c[2], lport: 50000 + i }));
  }

  const groupRows = () => {
    const m = new Map();
    for (const c of N.conns) { const k = c.name.toLowerCase(); let g = m.get(k); if (!g) { g = { k, name: c.name, n: 0, hosts: new Map(), pub: 0 }; m.set(k, g); } g.n++; const h = c.addr + ':' + c.port; g.hosts.set(h, (g.hosts.get(h) || 0) + 1); if (!isPrivate(c.addr)) g.pub++; }
    return [...m.values()].sort((a, b) => b.n - a.n);
  };
  const connRows = () => N.conns.map((c) => ({ k: c.pid + '|' + c.addr + '|' + c.port + '|' + c.lport, c })).sort((a, b) => a.c.name.localeCompare(b.c.name) || a.c.addr.localeCompare(b.c.addr));

  WC.addView('net', {
    title: 'Jaringan', hints: '↑↓ pilih · v ganti tampilan (per proses / per koneksi)',
    init() { return { mode: 'proc' }; },
    rows(tab) { return tab.mode === 'proc' ? groupRows() : connRows(); },
    render(scr, r, tab) {
      const chH = clamp(r.h - 9, 5, 11), lw = Math.floor(r.w / 2), cur = (a) => (a.length ? a[a.length - 1] : 0);
      const max = nice(Math.max(1, ...N.rx.slice(-r.w), ...N.tx.slice(-r.w)));
      ui.chartBox(scr, r.x, r.y, lw, chH, 'Unduh  ' + rate(cur(N.rx)), N.rx, { top: axis(max), bottom: '0', span: max, style: () => '32' });
      ui.chartBox(scr, r.x + lw, r.y, r.w - lw, chH, 'Unggah  ' + rate(cur(N.tx)), N.tx, { top: axis(max), bottom: '0', span: max, style: () => '35' });
      const procs = new Set(N.conns.map((c) => c.name.toLowerCase())).size;
      scr.put(r.x, r.y + chH, pad(' Sesi ini: ↓ ' + fmtMem(N.tot.rx) + '  ↑ ' + fmtMem(N.tot.tx) + ' · ' + N.conns.length + ' koneksi dari ' + procs + ' proses · tampilan: ' + (tab.mode === 'proc' ? 'per proses' : 'per koneksi') + (IS_WIN ? '' : ' · [bukan Windows]') + (N.err ? ' · ! ' + N.err : ''), r.w), N.err ? '33' : '2');
      const rows = this.rows(tab), th = r.h - chH - 1; if (th < 3) return;
      const cols = tab.mode === 'proc'
        ? [{ t: 'Proses', w: 24, f: (x) => x.name }, { t: 'Koneksi', w: 8, a: 'r', f: (x) => x.n }, { t: 'Publik', w: 7, a: 'r', f: (x) => x.pub },
          { t: 'Tujuan teratas', flex: true, f: (x) => { const top = [...x.hosts.entries()].sort((a, b) => b[1] - a[1]); return top.slice(0, 3).map((h) => h[0]).join(', ') + (top.length > 3 ? '  +' + (top.length - 3) : ''); } }]
        : [{ t: 'Proses', w: 22, f: (x) => x.c.name }, { t: 'Tujuan', w: 40, f: (x) => x.c.addr, style: (x) => (isPrivate(x.c.addr) ? '2' : '0') },
          { t: 'Port', flex: true, f: (x) => x.c.port + (PORTS[x.c.port] ? '  (' + PORTS[x.c.port] + ')' : '') }, { t: 'Lokal', w: 7, a: 'r', f: (x) => x.c.lport }];
      const sel = ui.drawTable(scr, r.x, r.y + chH + 1, r.w, th, cols, rows, tab.selKey, (x) => x.k, tab);
      if (sel && !tab.selKey) tab.selKey = sel.k;
      if (!rows.length) scr.put(r.x + 2, r.y + chH + 3, N.child || S.selftest || !IS_WIN ? 'Menunggu data koneksi…' : 'Pekerja jaringan belum jalan.', '2');
    },
    key(k, tab) {
      if (ui.listKey(tab, this.rows(tab), k, (x) => x.k)) return true;
      if (k.name === 'v') { tab.mode = tab.mode === 'proc' ? 'conn' : 'proc'; tab.selKey = null; return true; }
      return false;
    },
  }, { before: 'log' });
};
