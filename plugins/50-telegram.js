'use strict';
// Notifikasi Telegram: kirim peringatan (RAM, disk, CPU, leak, bloatware, autostart, scan) ke bot Telegram Anda.
// Satu arah saja: WatchCat hanya MENGIRIM ke chat id Anda dan tidak menerima/menjalankan perintah apa pun dari Telegram.
// Token disimpan di tui-config.json (folder data WatchCat, hanya terbaca oleh akun Anda). Token tidak pernah ditulis ke log.
module.exports = function (WC) {
  const { S, u, ui, fs, path, os, DATA_DIR } = WC;
  const { pad, fmtMem } = u;
  const DEF = { enabled: false, token: '', chatId: '', apiBase: 'https://api.telegram.org', ramPercent: 8, diskPercent: 10, cpuPercent: 85, cpuPolls: 6, events: { ram: true, disk: true, cpu: true, leak: true, bloat: true, startup: true, scan: true, action: true } };
  const EVENTS = [['ram', 'RAM hampir habis', 'sisa RAM < ramPercent%'], ['disk', 'Disk hampir penuh', 'sisa ruang C: < diskPercent%'], ['cpu', 'CPU tinggi terus-menerus', '>= cpuPercent% selama cpuPolls pindai'],
    ['leak', 'Dugaan memory leak', 'memori proses naik terus'], ['bloat', 'Bloatware berjalan', 'proses di daftar bloatware muncul'], ['startup', 'Autostart terblokir muncul lagi', 'Edge/OneDrive/dll. mendaftar ulang'],
    ['scan', 'Hasil scan bloatware baru', 'aplikasi bloatware baru terdeteksi'], ['action', 'Tindakan otomatis (mode latar)', 'kill otomatis saat mode --headless']];
  const T = { me: '', last: null, queue: [], sent: [], timer: null, startupSnap: null, cpuStreak: new Map(), dropped: 0, busy: false, tick: 0 };
  const cfg = () => { const c = Object.assign({}, DEF, WC.CFG.telegram || {}); c.events = Object.assign({}, DEF.events, (WC.CFG.telegram || {}).events); return c; };
  const ready = () => { const c = cfg(); return !!(c.token && c.chatId); };
  const mask = (t) => (t ? t.slice(0, 5) + '…' + t.slice(-4) : '(belum diisi)');
  const clean = (s) => { const t = cfg().token; return String(s || '').split(t || '\u0000').join('***'); };
  const host = os.hostname();

  function headlessAlive() {
    if (S.headless) return false;
    try { const p = +fs.readFileSync(path.join(DATA_DIR, 'headless.pid'), 'utf8'); if (p && p !== process.pid) { process.kill(p, 0); return p; } } catch (e) { /* tidak ada */ }
    return false;
  }

  // ------------------------------------------------------------ HTTP
  function api(method, params, cb) {
    const c = cfg(); if (!c.token) return cb(new Error('token belum diisi'));
    let url; try { url = new URL(c.apiBase.replace(/\/+$/, '') + '/bot' + c.token + '/' + method); } catch (e) { return cb(new Error('apiBase tidak valid')); }
    const mod = url.protocol === 'http:' ? WC.http : WC.https, body = JSON.stringify(params || {});
    const req = mod.request({ method: 'POST', hostname: url.hostname, port: url.port || undefined, path: url.pathname + url.search, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'WatchCat' }, timeout: 15000 }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (x) => { d += x; });
      res.on('end', () => { try { const j = JSON.parse(d); j.ok ? cb(null, j.result) : cb(Object.assign(new Error(clean(j.description || ('HTTP ' + res.statusCode))), { retry: j.parameters && j.parameters.retry_after })); } catch (e) { cb(new Error('balasan tidak valid (HTTP ' + res.statusCode + ')')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', (e) => cb(new Error(clean(e.message)))); req.end(body);
  }

  // ------------------------------------------------------------ antrean kirim (dibatch + dibatasi)
  function notify(ev, text) {
    const c = cfg(); if (!c.enabled || !ready() || !c.events[ev]) return;
    if (headlessAlive()) return; // proses latar belakang yang mengirim, hindari pesan ganda
    T.queue.push(text);
    if (S.selftest) return; // mode uji: tidak pernah mengirim ke jaringan
    if (!T.timer) T.timer = setTimeout(flush, 3000);
  }
  function flush() {
    T.timer = null; if (!T.queue.length) return;
    const now = Date.now(); T.sent = T.sent.filter((t) => now - t < 600000);
    if (T.sent.length >= 10) { T.dropped += T.queue.length; T.queue = []; if (WC.cooldownOk('tg:drop', 600000)) WC.logLine('WARN', 'Telegram: terlalu banyak pesan, sebagian dibuang (batas 10 pesan / 10 menit).'); return; }
    const text = ('🐱 WatchCat · ' + host + ' · ' + u.hhmmss(new Date()) + '\n\n' + T.queue.join('\n\n')).slice(0, 3900); T.queue = [];
    send(text);
  }
  function send(text, cb) {
    T.sent.push(Date.now());
    api('sendMessage', { chat_id: cfg().chatId, text, disable_web_page_preview: true }, (err) => {
      T.last = { ok: !err, at: Date.now(), err: err ? err.message : '' };
      if (err && err.retry) { T.queue.unshift(text); T.timer = setTimeout(flush, (err.retry + 1) * 1000); }
      else if (err) WC.logLine('WARN', 'Telegram gagal: ' + err.message);
      if (cb) cb(err);
    });
  }
  const test = () => {
    if (!ready()) return WC.logLine('WARN', 'Telegram: isi token dan chat id dulu (tekan e lalu c).');
    send('🐱 WatchCat · ' + host + '\n\n✅ Tes notifikasi berhasil. Peringatan RAM, disk, CPU, memory leak, bloatware, dan autostart akan dikirim ke chat ini.', (err) => WC.logLine(err ? 'WARN' : 'INFO', err ? 'Tes Telegram gagal: ' + err.message : 'Tes Telegram terkirim.'));
  };
  function setCfg(patch) { const cur = Object.assign({}, WC.CFG.telegram || {}); WC.saveCfg({ telegram: Object.assign(cur, patch) }); }
  function verifyToken() { api('getMe', {}, (e, r) => { T.me = e ? '' : '@' + r.username; WC.logLine(e ? 'WARN' : 'INFO', e ? 'Token Telegram ditolak: ' + e.message : 'Bot Telegram terhubung: @' + r.username); }); }
  function detectChat() {
    api('getUpdates', { limit: 30, timeout: 0 }, (e, r) => {
      if (e) return WC.logLine('WARN', 'Gagal membaca chat: ' + e.message);
      const msgs = (r || []).map((x) => x.message || x.edited_message || x.channel_post).filter(Boolean);
      if (!msgs.length) return WC.logLine('WARN', 'Belum ada pesan ke bot. Kirim /start ke bot Anda di Telegram, lalu tekan c lagi.');
      const m = msgs.reverse().find((x) => x.chat && x.chat.type === 'private') || msgs[0];
      setCfg({ chatId: String(m.chat.id) }); WC.logLine('INFO', 'Chat terdeteksi: ' + (m.chat.first_name || m.chat.title || m.chat.id) + ' (id ' + m.chat.id + '). Tekan t untuk uji.');
    });
  }

  // ------------------------------------------------------------ pemicu peringatan
  const cool = (k, ms) => WC.cooldownOk('tg:' + k, ms);
  const top3 = () => [...S.groups].sort((a, b) => b.ws - a.ws).slice(0, 3).map((g) => g.name + ' ' + fmtMem(g.ws)).join(', ');
  WC.on('tick', () => {
    T.tick++; if (S.selftest || T.tick % 10) return; const c = cfg(); if (!c.enabled) return;
    const free = os.freemem() / os.totalmem() * 100;
    if (free < c.ramPercent && cool('ram', 20 * 60e3)) notify('ram', '🔴 RAM hampir habis: sisa ' + free.toFixed(0) + '% (' + fmtMem(os.freemem()) + ').\nTerbesar: ' + top3());
    if (T.tick % 60 === 0) try { const d = fs.statfsSync(WC.IS_WIN ? 'C:\\' : '/'), pct = d.bavail / d.blocks * 100; if (pct < c.diskPercent && cool('disk', 6 * 3600e3)) notify('disk', '💾 Disk hampir penuh: sisa ' + pct.toFixed(0) + '% (' + fmtMem(d.bavail * d.bsize) + ').'); } catch (e) { /* abaikan */ }
  });
  WC.on('procs', () => {
    const c = cfg(); if (!c.enabled) return;
    const ign = ['idle', 'system', 'memory compression', 'msmpeng', 'vmmem', 'vmmemwsl'], bloat = [];
    for (const g of S.groups) {
      const k = g.key; if (ign.includes(k)) continue;
      const n = (g.pct >= c.cpuPercent ? (T.cpuStreak.get(k) || 0) + 1 : 0); T.cpuStreak.set(k, n);
      if (n >= c.cpuPolls && cool('cpu:' + k, 30 * 60e3)) notify('cpu', '🔥 CPU tinggi terus-menerus: ' + g.name + ' memakai ±' + g.pct.toFixed(0) + '% CPU selama ' + Math.round(n * S.procInterval / 1000) + ' detik.');
      if (WC.isBloat(g.name) && cool('bloat:' + k, 6 * 3600e3)) bloat.push(g.name + ' (' + fmtMem(g.ws) + ')');
    }
    for (const k of [...T.cpuStreak.keys()]) if (!S.groups.some((g) => g.key === k)) T.cpuStreak.delete(k);
    if (bloat.length) notify('bloat', '🗑️ Bloatware berjalan: ' + bloat.join(', ') + (S.autoKill ? ' (auto-hentikan aktif)' : '.'));
  });
  WC.on('leak', (l) => notify('leak', '🧠 Dugaan memory leak: ' + l.name + ' naik +' + Math.round(l.growth) + ' MB (' + l.slope.toFixed(1) + ' MB/menit), kini ' + Math.round(l.last) + ' MB.'));
  WC.on('startup', () => {
    const now = new Set((S.startup || []).map((e) => e.key + '|' + e.name)); if (!T.startupSnap) { T.startupSnap = now; return; }
    const fresh = (S.startup || []).filter((e) => !T.startupSnap.has(e.key + '|' + e.name) && e.bloat); T.startupSnap = now;
    if (fresh.length) notify('startup', '🚀 Autostart terblokir muncul lagi: ' + fresh.map((e) => e.name).join(', ') + '.');
  });
  WC.on('log', (e) => {
    if (!cfg().enabled) return;
    if (e.level === 'ALERT' && /^\[scan\]/.test(e.msg)) notify('scan', '🔎 ' + e.msg.replace(/^\[scan\]\s*/, 'Scan: '));
    else if (e.level === 'ALERT') notify('action', '⚠️ ' + e.msg);
    else if (e.level === 'ACTION' && S.headless) notify('action', '✅ ' + e.msg);
  });
  WC.on('headless', () => { const c = cfg(); if (c.enabled && ready()) setTimeout(() => notify('action', '🟢 WatchCat mode latar aktif di ' + host + '. Memantau RAM, disk, CPU, memory leak, bloatware, dan autostart.'), 4000); });

  if (S.selftest) { setCfgMem({ enabled: true, token: '123456789:AAFakeTokenForSelftestOnly_abcdefghij', chatId: '55501234' }); T.me = '@watchcat_demo_bot'; T.last = { ok: true, at: Date.now() - 95000, err: '' }; }
  function setCfgMem(p) { WC.CFG.telegram = Object.assign({}, WC.CFG.telegram || {}, p); }

  const HELP = ['Cara mengaktifkan notifikasi Telegram', '', '1. Di Telegram, cari @BotFather, kirim /newbot, ikuti langkahnya, lalu SALIN token bot.', '2. Di tab ini tekan  e  dan tempel token (tampil sebagai titik).', '3. Kirim pesan apa saja (mis. /start) ke bot Anda di Telegram.',
    '4. Tekan  c  agar chat id terdeteksi otomatis (atau  i  untuk mengisi manual).', '5. Tekan  t  untuk mengirim pesan uji, lalu  a  untuk mengaktifkan.', '', 'Catatan:', '- WatchCat hanya MENGIRIM ke chat Anda; tidak ada perintah yang diterima dari Telegram.',
    '- Token disimpan di tui-config.json (folder data WatchCat). Jangan dibagikan; jika bocor, buat token baru di @BotFather (/revoke).', '- Agar notifikasi tetap jalan saat TUI ditutup: jalankan WatchCat-Background.cmd (mode --headless).',
    '- Ambang batas (ramPercent, diskPercent, cpuPercent) bisa diubah di tui-config.json bagian "telegram".', '', 'Tekan tombol apa saja untuk menutup.'];

  WC.addView('notif', {
    title: 'Notif', hints: 'e token · i chat id · c deteksi chat · t tes kirim · a aktif/mati · Enter ubah event · h panduan',
    init() { return {}; },
    rows() { const c = cfg(); return EVENTS.map((x) => ({ k: x[0], name: x[1], desc: x[2].replace('ramPercent', c.ramPercent).replace('diskPercent', c.diskPercent).replace('cpuPercent', c.cpuPercent).replace('cpuPolls', c.cpuPolls), on: !!c.events[x[0]] })); },
    render(scr, r, tab) {
      const c = cfg(), hp = headlessAlive(), L = [];
      const st = !ready() ? ['BELUM SIAP (isi token & chat id, tekan h untuk panduan)', '33'] : c.enabled ? ['AKTIF' + (hp ? ' · dikirim oleh proses latar (PID ' + hp + ')' : S.headless ? ' · mode latar' : ' · hanya saat WatchCat ini terbuka (pakai WatchCat-Background untuk terus-menerus)'), '1;32'] : ['MATI (tekan a untuk mengaktifkan)', '33'];
      scr.box(r.x, r.y, r.w, 7, '36', 'Telegram');
      const put = (i, t, s) => scr.put(r.x + 2, r.y + 1 + i, pad(t, r.w - 4), s || '0');
      put(0, 'Status   : ' + st[0], st[1]); put(1, 'Token    : ' + mask(c.token) + (T.me ? '   bot ' + T.me : ''), c.token ? '0' : '33'); put(2, 'Chat ID  : ' + (c.chatId || '(belum diisi)'), c.chatId ? '0' : '33');
      put(3, 'Terakhir : ' + (T.last ? (T.last.ok ? 'terkirim ' : 'GAGAL ' + T.last.err + ' ') + u.hhmmss(new Date(T.last.at)) : 'belum ada pengiriman'), T.last && !T.last.ok ? '31' : '2'); put(4, 'Antrean  : ' + T.queue.length + ' · terkirim 10 menit terakhir: ' + T.sent.filter((t) => Date.now() - t < 600000).length + '/10' + (T.dropped ? ' · dibuang: ' + T.dropped : ''), '2');
      const rows = this.rows(), cols = [{ t: 'Kirim', w: 7, f: (x) => (x.on ? '[ON] ' : '[off]'), style: (x) => (x.on ? '32' : '2') }, { t: 'Peringatan', w: 34, f: (x) => x.name }, { t: 'Pemicu', flex: true, f: (x) => x.desc }];
      const sel = ui.drawTable(scr, r.x, r.y + 7, r.w, r.h - 7, cols, rows, tab.selKey, (x) => x.k, tab);
      if (sel && !tab.selKey) tab.selKey = sel.k;
    },
    key(k, tab) {
      const rows = this.rows(), cur = rows.find((x) => x.k === tab.selKey) || rows[0], c = cfg();
      if (ui.listKey(tab, rows, k, (x) => x.k)) return true;
      if (k.name === 'return' || k.name === 'space') { if (cur) setCfg({ events: Object.assign({}, c.events, { [cur.k]: !cur.on }) }); return true; }
      if (k.name === 'e') { WC.input('Token bot Telegram (dari @BotFather)', '', (v) => { v = v.trim(); if (!/^\d{5,}:[\w-]{20,}$/.test(v)) return WC.logLine('WARN', 'Format token tidak valid (contoh: 123456789:AA...).'); setCfg({ token: v }); verifyToken(); }, true); return true; }
      if (k.name === 'i') { WC.input('Chat ID Telegram', c.chatId, (v) => { v = v.trim(); if (!/^-?\d+$/.test(v)) return WC.logLine('WARN', 'Chat ID harus berupa angka.'); setCfg({ chatId: v }); }); return true; }
      if (k.name === 'c') { if (!c.token) WC.logLine('WARN', 'Isi token dulu (tekan e).'); else detectChat(); return true; }
      if (k.name === 't') { test(); return true; }
      if (k.name === 'a') { if (!ready()) { WC.logLine('WARN', 'Isi token dan chat id dulu (tekan h untuk panduan).'); return true; } setCfg({ enabled: !c.enabled }); WC.logLine('INFO', 'Notifikasi Telegram ' + (!c.enabled ? 'DIAKTIFKAN' : 'dimatikan')); return true; }
      if (k.name === 'h') { WC.info('Panduan Telegram', HELP); return true; }
      return false;
    },
  }, { before: 'log' });
};
