'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { runMatch } = require('./engine');
const runner = require('./bot-runner');
const store = require('./store');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUB = path.resolve(__dirname, '../public');
const DATA = path.resolve(__dirname, '../data');
const MAX_BODY = 760000;
const MAX_CONCURRENT = Math.max(2, Math.min(16, os.cpus().length));
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
console.log('[Config] Parallel match slots: ' + MAX_CONCURRENT + ' (' + os.cpus().length + ' CPU cores)');
const send = (res, status, value) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
function body(req) { return new Promise((resolve, reject) => { let chunks = [], size = 0, done = false; req.on('data', chunk => { if (done) return; size += chunk.length; if (size > MAX_BODY) { done = true; reject(Object.assign(new Error('Payload too large'), { code: 413 })); req.resume(); } else chunks.push(chunk); }); req.on('end', () => { if (done) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } }); req.on('error', reject); }); }
const db = store.get();
if (!db.ratings) db.ratings = {};
if (!db.users) db.users = {};
if (!db.matches) db.matches = [];
for (const m of db.matches) { if (['running', 'queued'].includes(m.status)) { m.status = 'failed'; m.error = 'Server restarted during match'; } }
store.save();
let wss = null;
function broadcast(event, data) { if (!wss) return; const msg = JSON.stringify({ event, ...data }); for (const client of wss.clients) { if (client.readyState === 1) { try { client.send(msg); } catch { } } } }
let activeJobs = 0;
const pendingJobs = [];
function matchMeta(id) { return db.matches.find(x => x.id === id); }
function recordMatch(b) { const id = 'M-' + crypto.randomBytes(4).toString('hex').toUpperCase(); const a = b.submissionA ? db.submissions.find(s => s.id === b.submissionA)?.name : b.a || 'Greedy Bot'; const c = b.submissionB ? db.submissions.find(s => s.id === b.submissionB)?.name : b.b || 'Random Bot'; const rec = { id, status: 'queued', mode: b.submissionA ? 'submitted' : 'demo', submissionA: b.submissionA || null, submissionB: b.submissionB || null, a, b: c, seed: crypto.randomBytes(4).readUInt32LE(0), maxMoves: b.maxMoves, pieces: b.pieces, first: b.first, autoMatch: b.autoMatch || false, ownedBy: b.ownedBy || null, createdAt: new Date().toISOString(), turns: 0, winner: null, reason: null }; db.matches.unshift(rec); if (db.matches.length > 500) db.matches.length = 500; store.save(); broadcast('match-queued', { match: rec }); return rec; }
function computeRatings(rec) { if (rec.mode !== 'submitted' || !['victory', 'move-limit', 'no-legal-actions', 'invalid-action', 'bot-timeout', 'bot-crash', 'bot-output-limit', 'bot-protocol-error'].includes(rec.reason)) return; const idA = rec.submissionA, idB = rec.submissionB; if (idA === idB) return; for (const id of [idA, idB]) db.ratings[id] ??= { elo: 1200, wins: 0, losses: 0, draws: 0, games: 0 }; const A = db.ratings[idA], B = db.ratings[idB], ea = 1 / (1 + 10 ** ((B.elo - A.elo) / 400)), score = rec.winner === 'p1' ? 1 : rec.winner === 'p2' ? 0 : 0.5; const delta = Math.round(24 * (score - ea)); A.elo += delta; B.elo -= delta; A.games++; B.games++; if (score === 1) { A.wins++; B.losses++; } else if (score === 0) { B.wins++; A.losses++; } else { A.draws++; B.draws++; } }
async function executeJob(rec) { activeJobs++; rec.status = 'running'; store.save(); broadcast('match-started', { matchId: rec.id, a: rec.a, b: rec.b, ownedBy: rec.ownedBy }); try { const opts = { seed: rec.seed, maxMoves: rec.maxMoves, pieces: rec.pieces, first: rec.first }; const replay = rec.mode === 'submitted' ? await runner.duel(db.submissions.find(s => s.id === rec.submissionA), db.submissions.find(s => s.id === rec.submissionB), opts, runMatch) : await runMatch({ ...opts, bots: ['greedy', 'random'] }); fs.writeFileSync(path.join(DATA, rec.id + '.json'), JSON.stringify(replay)); rec.status = 'completed'; rec.winner = replay.winner; rec.reason = replay.reason; rec.turns = replay.turns; rec.fault = replay.fault; rec.finishedAt = new Date().toISOString(); if (rec.mode === 'submitted') { for (const id of [rec.submissionA, rec.submissionB]) { const s = db.submissions.find(x => x.id === id); if (s && s.status !== 'Ready') s.status = 'Ready'; } computeRatings(rec); } } catch (e) { rec.status = 'failed'; rec.error = String(e.message || e).slice(0, 500); rec.reason = e.kind || 'judge-error'; rec.finishedAt = new Date().toISOString(); } store.save(); broadcast('match-finished', { matchId: rec.id, status: rec.status, winner: rec.winner, reason: rec.reason, turns: rec.turns, a: rec.a, b: rec.b, ownedBy: rec.ownedBy }); activeJobs--; drainPending(); }
function drainPending() { while (pendingJobs.length > 0 && activeJobs < MAX_CONCURRENT) { const next = pendingJobs.shift(); executeJob(next).catch(() => {}); } }
function submitJob(rec) { if (activeJobs < MAX_CONCURRENT) { executeJob(rec).catch(() => {}); } else { pendingJobs.push(rec); broadcast('match-pending', { matchId: rec.id, queuePos: pendingJobs.length }); } }
function signToken(username) { return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '7d' }); }
function verifyToken(req) { const auth = req.headers.authorization || ''; if (!auth.startsWith('Bearer ')) return null; try { return jwt.verify(auth.slice(7), JWT_SECRET); } catch { return null; } }
function originAllowed(req) { return true; }
async function route(req, res, url) {
  const pathname = url.pathname;
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
  if (req.method === 'POST' && !originAllowed(req)) return send(res, 403, { error: 'Cross-origin actions are disabled' });
  if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, version: '2.1.0', botExecution: 'docker-sandbox', persistence: 'JSON file', activeJobs, pendingJobs: pendingJobs.length, maxConcurrent: MAX_CONCURRENT });
  if (pathname === '/api/judge/status' && req.method === 'GET') return send(res, 200, { dockerReady: runner.dockerAvailable(), images: runner.IMAGES, turnMs: runner.LIMITS.turnMs, activeJobs, pendingJobs: pendingJobs.length, maxConcurrent: MAX_CONCURRENT });
  if (pathname === '/api/game' && req.method === 'GET') return send(res, 200, { id: 'ott-rps', version: '1.0.0', rows: 8, columns: 8, pieceTypes: ['rock', 'paper', 'scissors'], capture: { rock: 'scissors', scissors: 'paper', paper: 'rock' }, maxMoves: 200, goals: { p1: 'h8', p2: 'a1' } });
  if (pathname === '/api/overview' && req.method === 'GET') return send(res, 200, { submissions: db.submissions.length, matches: db.matches.length, latest: db.matches.slice(0, 5), registeredBotProfiles: Object.keys(db.ratings).length, registeredUsers: Object.keys(db.users).length, activeJobs, pendingJobs: pendingJobs.length, maxConcurrent: MAX_CONCURRENT });
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const b = await body(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[a-z0-9_]{2,32}$/.test(username)) return send(res, 400, { error: 'Username từ 2-32 ký tự, chỉ dùng chữ thường, số, dấu _' });
    if (!password || password.length > 128) return send(res, 400, { error: 'Vui lòng nhập mật khẩu (tối đa 128 ký tự)' });
    if (db.users[username]) return send(res, 409, { error: 'Username đã tồn tại. Hãy đăng nhập hoặc chọn tên khác' });
    const passwordHash = await bcrypt.hash(password, 10);
    db.users[username] = { passwordHash, createdAt: new Date().toISOString() };
    store.save();
    return send(res, 201, { token: signToken(username), username });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const b = await body(req);
    const username = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!username || !password) return send(res, 400, { error: 'Vui lòng nhập đầy đủ username và password' });
    const user = db.users[username];
    if (!user) return send(res, 401, { error: 'Username không tồn tại. Vui lòng nhấn Đăng ký!' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return send(res, 401, { error: 'Mật khẩu không chính xác' });
    return send(res, 200, { token: signToken(username), username });
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') { const payload = verifyToken(req); if (!payload) return send(res, 401, { error: 'Chua dang nhap' }); const myBots = db.submissions.filter(s => s.ownedBy === payload.sub); const myMatches = db.matches.filter(m => m.ownedBy === payload.sub).slice(0, 20); return send(res, 200, { username: payload.sub, bots: myBots, recentMatches: myMatches }); }
  if (pathname === '/api/submissions' && req.method === 'GET') return send(res, 200, db.submissions);
  if (pathname === '/api/submissions' && req.method === 'POST') {
    if (!db.settings.submissionsOpen) return send(res, 403, { error: 'Submissions are closed' });
    const payload = verifyToken(req);
    if (!payload) return send(res, 401, { error: 'Can dang nhap de upload bot' });
    const b = await body(req), name = String(b.name || ''), lang = String(b.lang || ''), version = String(b.version || 'v1.0').slice(0, 24), source = b.content;
    try { runner.safeFile(name, lang); } catch (e) { return send(res, 400, { error: e.message }); }
    if (typeof source !== 'string' || !source.length || Buffer.byteLength(source, 'utf8') > 500000) return send(res, 400, { error: 'Source must be 1-500 KB' });
    const id = 'SUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(), dir = runner.botDirectory(id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); fs.chmodSync(dir, 0o755);
    fs.writeFileSync(path.join(dir, name), source, { mode: 0o644, flag: 'wx' });
    const record = { id, name, lang, version, sha256: crypto.createHash('sha256').update(source).digest('hex'), status: 'Stored awaiting sandbox build', date: new Date().toISOString(), ownedBy: payload.sub };
    db.submissions.unshift(record); store.save();
    const opponents = db.submissions.filter(s => s.id !== id);
    if (opponents.length >= 1 && runner.dockerAvailable() && (activeJobs + pendingJobs.length) < 50) {
      const opp = opponents[Math.floor(Math.random() * opponents.length)];
      const [subA, subB] = Math.random() < 0.5 ? [id, opp.id] : [opp.id, id];
      const autoRec = recordMatch({ submissionA: subA, submissionB: subB, maxMoves: 200, pieces: 6, first: 'Random', autoMatch: true, ownedBy: payload.sub });
      submitJob(autoRec);
      console.log('[Auto-match] ' + id + ' vs ' + opp.id + ' -> ' + autoRec.id + ' (active=' + activeJobs + ', pending=' + pendingJobs.length + ')');
      return send(res, 201, { ...record, autoMatch: autoRec.id });
    }
    return send(res, 201, record);
  }
  if (pathname === '/api/leaderboard' && req.method === 'GET') return send(res, 200, Object.entries(db.ratings).map(([id, stats]) => { const s = db.submissions.find(x => x.id === id) || {}; return { id, name: (s.name || id) + ' (' + id.slice(-4) + ')', lang: s.lang || 'Unknown', owner: s.ownedBy || null, ...stats }; }).sort((a, b) => b.elo - a.elo));
  if (pathname === '/api/matches' && req.method === 'GET') return send(res, 200, db.matches);
  if (/^\/api\/matches\/M-[A-F0-9]{8}$/.test(pathname) && req.method === 'GET') { const rec = matchMeta(pathname.slice('/api/matches/'.length)); return rec ? send(res, 200, rec) : send(res, 404, { error: 'Match not found' }); }
  if (/^\/api\/matches\/M-[A-F0-9]{8}\/replay$/.test(pathname) && req.method === 'GET') { const id = pathname.split('/')[3], rec = matchMeta(id); if (!rec) return send(res, 404, { error: 'Match not found' }); if (rec.status !== 'completed') return send(res, 409, { error: rec.status === 'failed' ? rec.error : 'Match ' + rec.status }); return send(res, 200, JSON.parse(fs.readFileSync(path.join(DATA, id + '.json'), 'utf8'))); }
  if (pathname === '/api/matches' && req.method === 'POST') {
    const payload = verifyToken(req);
    const b = await body(req), maxMoves = Number(b.maxMoves ?? 200), pieces = Number(b.pieces ?? 6), first = b.first || 'Random';
    if (!Number.isInteger(maxMoves) || maxMoves < 1 || maxMoves > 1000 || !Number.isInteger(pieces) || pieces < 1 || pieces > 28 || !['Random', 'Player A', 'Player B'].includes(first)) return send(res, 400, { error: 'Invalid match configuration' });
    if (b.submissionA && !b.submissionB) {
      if (!payload) return send(res, 401, { error: 'Can dang nhap de tham gia tran dau' });
      const myId = String(b.submissionA);
      if (!db.submissions.some(s => s.id === myId)) return send(res, 404, { error: 'Your submission not found' });
      if (!runner.dockerAvailable()) return send(res, 503, { error: 'Docker is not available. Start Docker Desktop to run bots.' });
      const opponents = db.submissions.filter(s => s.id !== myId);
      if (opponents.length < 1) return send(res, 400, { error: 'No other bots available yet. Wait for someone else to upload.' });
      if (activeJobs + pendingJobs.length >= 100) return send(res, 429, { error: 'Server qua tai (100+ jobs). Thu lai sau.' });
      const opp = opponents[Math.floor(Math.random() * opponents.length)];
      const [subA, subB] = Math.random() < 0.5 ? [myId, opp.id] : [opp.id, myId];
      const rec = recordMatch({ submissionA: subA, submissionB: subB, maxMoves, pieces, first, autoMatch: false, ownedBy: payload.sub });
      submitJob(rec);
      console.log('[Challenge] ' + myId + ' vs random ' + opp.id + ' -> ' + rec.id + ' (active=' + activeJobs + ', pending=' + pendingJobs.length + ')');
      return send(res, 202, { ...rec, opponent: opp.name, opponentId: opp.id });
    }
    const ids = [b.submissionA, b.submissionB], mode = ids.every(x => typeof x === 'string') ? 'submitted' : ids.some(Boolean) ? 'invalid' : 'demo';
    if (mode === 'invalid') return send(res, 400, { error: 'Use challenge mode: send only submissionA.' });
    if (mode === 'submitted') return send(res, 403, { error: 'Manual opponent selection is disabled. Use Challenge mode.' });
    if (activeJobs + pendingJobs.length >= 100) return send(res, 429, { error: 'Server qua tai. Thu lai sau.' });
    const rec = recordMatch({ ...b, maxMoves, pieces, first, ownedBy: payload?.sub || null }); submitJob(rec); return send(res, 202, rec);
  }
  if (pathname === '/api/settings' && req.method === 'GET') return send(res, 200, db.settings);
  return send(res, 404, { error: 'API route not found' });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await route(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, ''), file = path.resolve(PUB, rel || 'index.html');
    if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'File not found' });
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com" });
    fs.createReadStream(file).pipe(res);
  } catch (e) { if (!res.headersSent) send(res, e.code && Number.isInteger(e.code) ? e.code : 500, { error: e.message || 'Unexpected error' }); }
});
wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  console.log('[WS] Client connected: ' + req.socket.remoteAddress);
  ws.send(JSON.stringify({ event: 'welcome', activeJobs, pendingJobs: pendingJobs.length, maxConcurrent: MAX_CONCURRENT, recentMatches: db.matches.slice(0, 10) }));
  ws.on('error', () => {});
});
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const ifaces = require('node:os').networkInterfaces();
    const lanIPs = Object.values(ifaces).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log('OTT Arena v2.1 ready on port ' + PORT);
    console.log('  Parallel match slots: ' + MAX_CONCURRENT);
    if (HOST === '127.0.0.1' || HOST === '::1') { console.log('  Local:   http://127.0.0.1:' + PORT); }
    else { console.log('  Local:   http://127.0.0.1:' + PORT); lanIPs.forEach(ip => console.log('  Network: http://' + ip + ':' + PORT + '  <-- chia se link nay cho nguoi choi')); console.log('  WebSocket: ws://<ip>:' + PORT + '/ws'); }
  });
}
module.exports = server;