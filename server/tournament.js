'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const engine = require('./engine');
const runner = require('./bot-runner');

// ─── Live match controllers (in-memory, keyed by match id) ─────────────────────
const live = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEFAULT_SETTINGS = { maxMoves: 200, pieces: 6, turnDelayMs: 350 };
function replayFile(tid, mid) { return path.join(store.dir, tid + '_' + mid + '.json'); }

// Matches marked running before a server restart can never finish -> put back to pending
(function recoverStaleMatches() {
  const db = store.get();
  let changed = false;
  for (const t of (db.tournaments || [])) for (const r of (t.rounds || [])) for (const m of (r.matches || [])) {
    if (m.status === 'running') { m.status = 'pending'; m.paused = false; m.error = 'Server khoi dong lai trong luc tran dang chay'; changed = true; }
  }
  if (changed) store.save();
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
function nowISO() { return new Date().toISOString(); }
function getDb() { return store.get(); }
function ensureTournaments() {
  const db = getDb();
  if (!db.tournaments) db.tournaments = [];
  return db;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────
function auditLog(tournament, actor, action, detail) {
  if (!tournament.logs) tournament.logs = [];
  tournament.logs.unshift({ ts: nowISO(), actor, action, detail: detail || '' });
  if (tournament.logs.length > 500) tournament.logs.length = 500;
}

// ─── Round-robin pairing ──────────────────────────────────────────────────────
function generateRoundRobin(participants) {
  const list = participants.length % 2 === 1
    ? [...participants, { id: 'BYE', name: 'BYE' }]
    : [...participants];
  const total = list.length;
  const rounds = [];
  for (let r = 0; r < total - 1; r++) {
    const round = [];
    for (let i = 0; i < total / 2; i++) {
      const a = list[i], b = list[total - 1 - i];
      if (a.id !== 'BYE' && b.id !== 'BYE') round.push({ a: a.id, b: b.id });
    }
    rounds.push(round);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

// ─── Round name ───────────────────────────────────────────────────────────────
function getRoundName(n) {
  if (n <= 2) return 'Chung Ket';
  if (n <= 4) return 'Ban Ket';
  if (n <= 8) return 'Tu Ket';
  if (n <= 16) return 'Vong 16';
  if (n <= 32) return 'Vong 32';
  return 'Vong ' + n;
}

// ─── Advance elimination ──────────────────────────────────────────────────────
function advanceElimination(t) {
  const rounds = t.rounds;
  if (!rounds || rounds.length === 0) return;
  const last = rounds[rounds.length - 1];
  const allDone = last.matches.every(m => m.status === 'completed');
  if (!allDone) return;
  last.status = 'completed';
  const winners = last.matches.map(m => {
    if (m.winner === 'a') return m.playerA;
    if (m.winner === 'b') return m.playerB;
    if (m.winner === 'bye') return m.byeWinner;
    return null;
  }).filter(Boolean);
  if (winners.length <= 1) {
    t.status = 'completed';
    t.champion = winners[0] || null;
    return;
  }
  const parts = winners.map(uid2 => {
    const p = t.participants.find(x => x.userId === uid2);
    return { id: uid2, name: p ? p.username : uid2 };
  });
  const newRound = {
    id: uid('RND'), roundNumber: rounds.length + 1,
    name: getRoundName(winners.length), status: 'pending', matches: []
  };
  for (let i = 0; i < parts.length; i += 2) {
    if (i + 1 < parts.length) {
      newRound.matches.push({ id: uid('MTH'), playerA: parts[i].id, playerB: parts[i+1].id, status: 'pending', winner: null, scheduledAt: null });
    } else {
      newRound.matches.push({ id: uid('MTH'), playerA: parts[i].id, playerB: 'BYE', status: 'completed', winner: 'bye', byeWinner: parts[i].id });
    }
  }
  rounds.push(newRound);
}

// ─── Standings (round-robin) ──────────────────────────────────────────────────
function computeStandings(t) {
  const pts = {}, stats = {};
  for (const p of (t.participants || [])) {
    if (p.approved && p.officialBot) {
      pts[p.userId] = 0;
      stats[p.userId] = { wins: 0, draws: 0, losses: 0, played: 0, name: p.username };
    }
  }
  for (const round of (t.rounds || [])) {
    for (const m of (round.matches || [])) {
      if (m.status !== 'completed' || m.winner === 'bye') continue;
      const a = m.playerA, b = m.playerB;
      if (!stats[a] || !stats[b]) continue;
      stats[a].played++; stats[b].played++;
      if (m.winner === 'a') { pts[a] = (pts[a]||0)+3; stats[a].wins++; stats[b].losses++; }
      else if (m.winner === 'b') { pts[b] = (pts[b]||0)+3; stats[b].wins++; stats[a].losses++; }
      else if (m.winner === 'draw') { pts[a]=(pts[a]||0)+1; pts[b]=(pts[b]||0)+1; stats[a].draws++; stats[b].draws++; }
    }
  }
  return Object.entries(pts)
    .map(([userId, points]) => ({ userId, points, ...stats[userId] }))
    .sort((a, b) => b.points - a.points);
}

function isAdmin(db, username) {
  const u = (db.users || {})[username];
  return !!(u && (u.role === 'admin' || username === 'admin'));
}

function nameOf(t, id) {
  if (id === 'BYE') return 'BYE';
  return ((t.participants || []).find(p => p.userId === id) || { username: id }).username;
}
function findMatch(t, roundId, matchId) {
  for (const r of (t.rounds || [])) {
    if (roundId && r.id !== roundId) continue;
    const m = r.matches.find(x => x.id === matchId);
    if (m) return { round: r, match: m };
  }
  return { round: null, match: null };
}

// Apply a final result to a match and advance the tournament
function applyResult(t, round, match, winner, actor, note) {
  match.winner = winner; match.status = 'completed'; match.paused = false; match.finishedAt = nowISO();
  const nameA = nameOf(t, match.playerA), nameB = nameOf(t, match.playerB);
  const txt = winner === 'a' ? nameA + ' thang' : winner === 'b' ? nameB + ' thang' : 'Hoa';
  auditLog(t, actor, 'match-result', '[' + round.name + '] ' + nameA + ' vs ' + nameB + ': ' + txt + (note ? ' (' + note + ')' : ''));
  if (t.format === 'elimination') {
    const before = t.rounds.length;
    advanceElimination(t);
    if (t.rounds.length > before) auditLog(t, 'system', 'new-round', 'Tao ' + t.rounds[t.rounds.length - 1].name);
    if (t.status === 'completed') auditLog(t, 'system', 'tournament-complete', 'Giai ket thuc. Vo dich: ' + nameOf(t, t.champion));
  } else {
    if (round.matches.every(m => m.status === 'completed' || m.status === 'cancelled')) round.status = 'completed';
    if (t.rounds.every(r => r.matches.every(m => m.status === 'completed' || m.status === 'cancelled'))) {
      t.status = 'completed';
      const st = computeStandings(t); t.champion = st[0]?.userId || null;
      auditLog(t, 'system', 'tournament-complete', 'Giai ket thuc. Vo dich: ' + (st[0]?.name || 'N/A'));
    }
  }
}

function countPieces(board, owner) { return board.flat().filter(p => p && p.owner === owner).length; }

// Run a tournament match on the game engine with a pause/cancel gate between turns
function startMatch(t, round, match, actor, opts = {}) {
  const db = store.get();
  if (match.status !== 'pending') throw Object.assign(new Error('Chi chay duoc tran dang cho (pending)'), { code: 400 });
  if (match.playerB === 'BYE') throw Object.assign(new Error('Tran BYE khong can chay'), { code: 400 });
  const pA = t.participants.find(p => p.userId === match.playerA), pB = t.participants.find(p => p.userId === match.playerB);
  const subA = db.submissions.find(s => s.id === pA?.officialBot), subB = db.submissions.find(s => s.id === pB?.officialBot);
  const demo = !!opts.demo;
  if (!demo) {
    if (!subA || !subB) throw Object.assign(new Error('Thieu bot chinh thuc cua mot ben'), { code: 400 });
    if (!runner.dockerAvailable()) throw Object.assign(new Error('Docker chua chay. Bat Docker Desktop hoac chay thu bang bot mau.'), { code: 503, dockerUnavailable: true });
  }
  const settings = { ...DEFAULT_SETTINGS, ...(t.settings || {}) };
  const seed = crypto.randomBytes(4).readUInt32LE(0);
  const ctrl = { tid: t.id, paused: false, cancelled: false, waiters: [], board: engine.initial(seed, settings.pieces), turn: 0, events: [], delayMs: Number(opts.delayMs ?? settings.turnDelayMs) || 0, seed };
  live.set(match.id, ctrl);
  match.status = 'running'; match.paused = false; match.error = null; match.startedAt = nowISO();
  match.engine = demo ? 'demo' : 'docker'; match.hasReplay = false; match.result = null;
  auditLog(t, actor, 'start-match', 'Bat dau tran ' + nameOf(t, match.playerA) + ' vs ' + nameOf(t, match.playerB) + (demo ? ' (bot mau)' : ''));
  store.save();

  const cancelErr = () => Object.assign(new Error('Trong tai huy tran'), { kind: 'cancelled' });
  const gate = async () => {
    if (ctrl.cancelled) throw cancelErr();
    while (ctrl.paused) { await new Promise(r => ctrl.waiters.push(r)); if (ctrl.cancelled) throw cancelErr(); }
  };
  const rng = engine.rand(seed ^ 0x9e3779b9);
  const wrapped = o => engine.runMatch({ ...o, decide: async ctx => {
    if (ctrl.delayMs) await sleep(ctrl.delayMs);
    await gate();
    const mv = o.decide ? await o.decide(ctx) : engine.choose(ctx.moves, ctx.board, ctx.owner, rng, 'greedy');
    await gate();
    const sel = mv && ctx.moves.find(m => m.from[0] === mv.from?.[0] && m.from[1] === mv.from?.[1] && m.to[0] === mv.to?.[0] && m.to[1] === mv.to?.[1]);
    if (sel) { const nx = engine.apply(ctx.board, sel); ctrl.board = nx.board; ctrl.events.push(nx.event); ctrl.turn = ctx.turn; }
    return mv;
  } });
  const base = { seed, maxMoves: settings.maxMoves, pieces: settings.pieces, first: 'Random' };
  const run = demo ? wrapped(base) : runner.duel(subA, subB, base, wrapped);

  run.then(replay => {
    if (ctrl.cancelled) return;
    let winner = replay.winner === 'p1' ? 'a' : replay.winner === 'p2' ? 'b' : 'draw';
    let note = replay.reason;
    if (winner === 'draw' && t.format === 'elimination') {
      // Knockout needs a winner: more pieces left wins, otherwise seed coin-flip
      const fin = replay.snapshots[replay.snapshots.length - 1];
      const a = countPieces(fin, 'p1'), b = countPieces(fin, 'p2');
      winner = a > b ? 'a' : b > a ? 'b' : (seed & 1 ? 'a' : 'b');
      note = 'tiebreak: ' + a + '-' + b + ' quan';
    }
    replay.players = { a: nameOf(t, match.playerA), b: nameOf(t, match.playerB), botA: pA?.officialBotName || 'Greedy (mau)', botB: pB?.officialBotName || 'Greedy (mau)' };
    fs.writeFileSync(replayFile(t.id, match.id), JSON.stringify(replay));
    match.hasReplay = true;
    match.result = { reason: replay.reason, turns: replay.turns, note, fault: replay.fault || null };
    applyResult(t, round, match, winner, 'judge', note);
    store.save();
  }).catch(e => {
    if (ctrl.cancelled) return;
    match.status = 'pending'; match.paused = false; match.error = String(e.message || e).slice(0, 300);
    auditLog(t, 'judge', 'match-error', 'Loi chay tran ' + match.id + ': ' + match.error);
    store.save();
  }).finally(() => { live.delete(match.id); });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
async function handleTournament(req, res, pathname, bodyFn, verifyToken, send) {
  const db = ensureTournaments();

  // LIST
  if (pathname === '/api/tournaments' && req.method === 'GET') {
    return send(res, 200, db.tournaments.map(t => ({
      id: t.id, name: t.name, status: t.status, format: t.format,
      createdAt: t.createdAt, createdBy: t.createdBy, description: t.description || '',
      participantCount: (t.participants||[]).filter(p=>p.approved).length,
      champion: t.champion
    })));
  }

  // CREATE
  if (pathname === '/api/tournaments' && req.method === 'POST') {
    const payload = verifyToken(req);
    if (!payload) return send(res, 401, { error: 'Can dang nhap' });
    if (!isAdmin(db, payload.sub)) return send(res, 403, { error: 'Chi admin moi duoc tao giai' });
    const b = await bodyFn(req);
    const name = String(b.name || '').trim();
    const format = b.format === 'elimination' ? 'elimination' : 'round-robin';
    if (!name || name.length < 2 || name.length > 100) return send(res, 400, { error: 'Ten giai 2-100 ky tu' });
    const t = {
      id: uid('TRN'), name, format, description: String(b.description||'').slice(0,500),
      status: 'draft', createdAt: nowISO(), createdBy: payload.sub,
      participants: [], rounds: [], logs: [],
      registrationOpen: false, submissionsLocked: false, champion: null, announcement: null
    };
    auditLog(t, payload.sub, 'create', 'Tao giai "'+name+'" the thuc '+(format==='elimination'?'dau loai':'vong tron'));
    db.tournaments.unshift(t);
    store.save();
    return send(res, 201, t);
  }

  // DELETE tournament
  const mDel = pathname.match(/^\/api\/tournaments\/(TRN-[A-F0-9]{8})(?:\/delete)?$/);
  if (mDel && (req.method === 'DELETE' || (req.method === 'POST' && pathname.endsWith('/delete')))) {
    const tid = mDel[1];
    const payload = verifyToken(req);
    if (!payload) return send(res, 401, { error: 'Cần đăng nhập' });
    if (!isAdmin(db, payload.sub)) return send(res, 403, { error: 'Chỉ Admin mới có quyền xóa giải đấu' });
    const idx = db.tournaments.findIndex(x => x.id === tid);
    if (idx === -1) return send(res, 404, { error: 'Không tìm thấy giải đấu' });
    const [deletedTrn] = db.tournaments.splice(idx, 1);
    for (const r of (deletedTrn.rounds || [])) {
      for (const m of (r.matches || [])) {
        const c = live.get(m.id);
        if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(fn => fn()); live.delete(m.id); }
      }
    }
    store.save();
    return send(res, 200, { ok: true, id: tid, name: deletedTrn.name });
  }

  // GET single
  const mGet = pathname.match(/^\/api\/tournaments\/(TRN-[A-F0-9]{8})$/);
  if (mGet && req.method === 'GET') {
    const t = db.tournaments.find(x => x.id === mGet[1]);
    if (!t) return send(res, 404, { error: 'Khong tim thay giai dau' });
    return send(res, 200, t);
  }

  // LIVE state / REPLAY of a match
  const mLive = pathname.match(/^\/api\/tournaments\/(TRN-[A-F0-9]{8})\/matches\/(MTH-[A-F0-9]{8})\/(live|replay)$/);
  if (mLive && req.method === 'GET') {
    const t = db.tournaments.find(x => x.id === mLive[1]);
    if (!t) return send(res, 404, { error: 'Khong tim thay giai' });
    const { match } = findMatch(t, null, mLive[2]);
    if (!match) return send(res, 404, { error: 'Khong tim thay tran' });
    if (mLive[3] === 'replay') {
      const f = replayFile(t.id, match.id);
      if (!fs.existsSync(f)) return send(res, 404, { error: 'Tran chua co ban ghi' });
      return send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
    }
    const c = live.get(match.id);
    const settings = { ...DEFAULT_SETTINGS, ...(t.settings || {}) };
    return send(res, 200, {
      matchId: match.id, status: match.status, paused: !!match.paused, winner: match.winner, result: match.result || null,
      hasReplay: !!match.hasReplay, engine: match.engine || null, error: match.error || null,
      players: { a: nameOf(t, match.playerA), b: nameOf(t, match.playerB) },
      maxMoves: settings.maxMoves,
      turn: c ? c.turn : 0, board: c ? c.board : null,
      lastMove: c && c.events.length ? c.events[c.events.length - 1] : null,
      events: c ? c.events.slice(-12) : []
    });
  }

  // STANDINGS
  const mSt = pathname.match(/^\/api\/tournaments\/(TRN-[A-F0-9]{8})\/standings$/);
  if (mSt && req.method === 'GET') {
    const t = db.tournaments.find(x => x.id === mSt[1]);
    if (!t) return send(res, 404, { error: 'Khong tim thay giai' });
    return send(res, 200, computeStandings(t));
  }

  // ACTIONS
  const mAct = pathname.match(/^\/api\/tournaments\/(TRN-[A-F0-9]{8})\/([a-z-]+)$/);
  if (mAct && req.method === 'POST') {
    const [, tid, action] = mAct;
    const t = db.tournaments.find(x => x.id === tid);
    if (!t) return send(res, 404, { error: 'Khong tim thay giai dau' });
    const payload = verifyToken(req);
    if (!payload) return send(res, 401, { error: 'Can dang nhap' });
    const admin = isAdmin(db, payload.sub);
    const b = await bodyFn(req);

    if (action === 'delete') {
      if (!admin) return send(res, 403, { error: 'Chỉ Admin mới có quyền xóa giải đấu' });
      const idx = db.tournaments.findIndex(x => x.id === tid);
      if (idx === -1) return send(res, 404, { error: 'Không tìm thấy giải đấu' });
      const [deletedTrn] = db.tournaments.splice(idx, 1);
      for (const r of (deletedTrn.rounds || [])) {
        for (const m of (r.matches || [])) {
          const c = live.get(m.id);
          if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(fn => fn()); live.delete(m.id); }
        }
      }
      store.save();
      return send(res, 200, { ok: true, id: tid, name: deletedTrn.name });
    }

    if (action === 'register') {
      if (!t.registrationOpen) return send(res, 403, { error: 'Dang ky chua mo hoac da dong' });
      if (t.status !== 'registration' && t.status !== 'draft') return send(res, 400, { error: 'Giai khong o trang thai dang ky' });
      if ((t.participants||[]).find(p => p.userId === payload.sub)) return send(res, 409, { error: 'Ban da dang ky roi' });
      if (!t.participants) t.participants = [];
      t.participants.push({ userId: payload.sub, username: payload.sub, approved: false, officialBot: null, officialBotName: null, registeredAt: nowISO() });
      auditLog(t, payload.sub, 'register', payload.sub + ' dang ky tham gia');
      store.save();
      return send(res, 201, { ok: true });
    }

    if (action === 'open-registration') {
      if (!admin) return send(res, 403, { error: 'Chỉ Admin mới có quyền mở đăng ký' });
      if (t.status === 'completed' || t.status === 'cancelled') return send(res, 400, { error: 'Giải đấu đã kết thúc hoặc bị hủy' });
      t.status = 'registration'; t.registrationOpen = true;
      auditLog(t, payload.sub, 'open-registration', 'Mở đăng ký tham gia');
      store.save(); return send(res, 200, t);
    }

    if (action === 'close-registration') {
      if (!admin) return send(res, 403, { error: 'Chỉ Admin mới có quyền đóng đăng ký' });
      t.registrationOpen = false;
      auditLog(t, payload.sub, 'close-registration', 'Đóng đăng ký');
      store.save(); return send(res, 200, t);
    }

    if (action === 'lock-submissions') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      t.submissionsLocked = true;
      auditLog(t, payload.sub, 'lock-submissions', 'Khoa bai nop');
      store.save(); return send(res, 200, t);
    }

    if (action === 'unlock-submissions') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      t.submissionsLocked = false;
      auditLog(t, payload.sub, 'unlock-submissions', 'Mo lai bai nop');
      store.save(); return send(res, 200, t);
    }

    if (action === 'approve-participant') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      const p = (t.participants||[]).find(x => x.userId === String(b.userId||''));
      if (!p) return send(res, 404, { error: 'Khong tim thay nguoi tham gia' });
      p.approved = true;
      auditLog(t, payload.sub, 'approve-participant', 'Duyet: '+p.username);
      store.save(); return send(res, 200, t);
    }

    if (action === 'reject-participant') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      const idx = (t.participants||[]).findIndex(x => x.userId === String(b.userId||''));
      if (idx === -1) return send(res, 404, { error: 'Khong tim thay nguoi tham gia' });
      const [rem] = t.participants.splice(idx, 1);
      auditLog(t, payload.sub, 'reject-participant', 'Tu choi: '+rem.username);
      store.save(); return send(res, 200, t);
    }

    if (action === 'set-official-bot') {
      const userId = String(b.userId || payload.sub);
      if (!admin && userId !== payload.sub) return send(res, 403, { error: 'Khong co quyen' });
      const p = (t.participants||[]).find(x => x.userId === userId);
      if (!p) return send(res, 404, { error: 'Khong tim thay nguoi tham gia' });
      if (t.submissionsLocked && !admin) return send(res, 403, { error: 'Bai nop da bi khoa' });
      const sub = db.submissions.find(s => s.id === String(b.submissionId||'') && s.ownedBy === userId);
      if (!sub) return send(res, 404, { error: 'Khong tim thay bai nop cua ban' });
      p.officialBot = sub.id; p.officialBotName = sub.name;
      auditLog(t, payload.sub, 'set-official-bot', p.username + ' chon bot: ' + sub.name);
      store.save(); return send(res, 200, t);
    }

    if (action === 'generate-rounds') {
      if (!admin) return send(res, 403, { error: 'Chỉ Admin mới có quyền bốc thăm tạo lịch đấu' });
      if (!t.participants || t.participants.length < 2) {
        return send(res, 400, { error: 'Cần ít nhất 2 thí sinh tham gia giải đấu (hiện có ' + (t.participants ? t.participants.length : 0) + ' người)' });
      }
      if ((t.rounds || []).some(r => r.matches.some(m => m.status === 'running'))) {
        return send(res, 409, { error: 'Đang có trận đấu đang chạy, không thể tạo lại vòng' });
      }

      // Auto-approve participants and auto-assign official bot if missing
      for (const p of t.participants) {
        p.approved = true;
        if (!p.officialBot) {
          const userSub = (db.submissions || []).find(s => s.ownedBy === p.userId);
          if (userSub) {
            p.officialBot = userSub.id;
            p.officialBotName = userSub.name;
          } else {
            p.officialBot = 'demo-bot';
            p.officialBotName = 'Bot Mẫu (Greedy)';
          }
        }
      }

      const approved = t.participants;
      t.rounds = [];
      if (t.format === 'round-robin') {
        const rgs = generateRoundRobin(approved.map(p => ({ id: p.userId, name: p.username })));
        rgs.forEach((pairs, ri) => {
          t.rounds.push({
            id: uid('RND'), roundNumber: ri+1, name: 'Vong '+(ri+1), status: 'pending',
            matches: pairs.map(pair => ({ id: uid('MTH'), playerA: pair.a, playerB: pair.b, status: 'pending', winner: null, scheduledAt: null, matchRef: null }))
          });
        });
      } else {
        const list = approved.map(p => ({ id: p.userId, name: p.username }));
        const round = { id: uid('RND'), roundNumber: 1, name: getRoundName(list.length), status: 'pending', matches: [] };
        for (let i = 0; i < list.length; i += 2) {
          if (i+1 < list.length) {
            round.matches.push({ id: uid('MTH'), playerA: list[i].id, playerB: list[i+1].id, status: 'pending', winner: null, scheduledAt: null });
          } else {
            round.matches.push({ id: uid('MTH'), playerA: list[i].id, playerB: 'BYE', status: 'completed', winner: 'bye', byeWinner: list[i].id });
          }
        }
        t.rounds.push(round);
      }
      t.status = 'active';
      t.registrationOpen = false;
      auditLog(t, payload.sub, 'generate-rounds', 'Bốc thăm tạo ' + t.rounds.length + ' vòng đấu (' + approved.length + ' thí sinh)');
      store.save(); return send(res, 200, t);
    }

    if (action === 'report-match') {
      if (!admin) return send(res, 403, { error: 'Chi admin/trong tai' });
      const { round, match } = findMatch(t, String(b.roundId||''), String(b.matchId||''));
      if (!match) return send(res, 404, { error: 'Khong tim thay tran dau' });
      if (match.status === 'cancelled') return send(res, 400, { error: 'Tran da bi huy. Dat lai tran truoc.' });
      if (match.status === 'completed') return send(res, 400, { error: 'Tran da co ket qua' });
      if (match.status === 'running') return send(res, 409, { error: 'Tran dang chay. Huy tran truoc khi nhap tay.' });
      if (!['a', 'b', 'draw'].includes(b.winner)) return send(res, 400, { error: 'Ket qua khong hop le' });
      if (b.winner === 'draw' && t.format === 'elimination') return send(res, 400, { error: 'Dau loai truc tiep khong co hoa' });
      match.matchRef = b.matchRef || null;
      applyResult(t, round, match, b.winner, payload.sub, 'nhap tay');
      store.save(); return send(res, 200, t);
    }

    if (action === 'start-match') {
      if (!admin) return send(res, 403, { error: 'Chi admin/trong tai' });
      if (t.status !== 'active') return send(res, 400, { error: 'Giai chua bat dau hoac da ket thuc' });
      const { round, match } = findMatch(t, String(b.roundId||''), String(b.matchId||''));
      if (!match) return send(res, 404, { error: 'Khong tim thay tran' });
      try { startMatch(t, round, match, payload.sub, { demo: b.demo === true, delayMs: b.delayMs }); }
      catch (e) { return send(res, e.code || 500, { error: e.message, dockerUnavailable: !!e.dockerUnavailable }); }
      return send(res, 200, t);
    }

    if (action === 'run-round') {
      if (!admin) return send(res, 403, { error: 'Chi admin/trong tai' });
      if (t.status !== 'active') return send(res, 400, { error: 'Giai chua bat dau hoac da ket thuc' });
      const round = t.rounds.find(r => r.id === String(b.roundId||''));
      if (!round) return send(res, 404, { error: 'Khong tim thay vong' });
      const todo = round.matches.filter(m => m.status === 'pending' && m.playerB !== 'BYE');
      if (!todo.length) return send(res, 400, { error: 'Vong nay khong con tran cho' });
      try { for (const m of todo) startMatch(t, round, m, payload.sub, { demo: b.demo === true, delayMs: b.delayMs }); }
      catch (e) { return send(res, e.code || 500, { error: e.message, dockerUnavailable: !!e.dockerUnavailable }); }
      return send(res, 200, t);
    }

    if (action === 'cancel-match') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      const { match } = findMatch(t, String(b.roundId||''), String(b.matchId||''));
      if (!match) return send(res, 404, { error: 'Khong tim thay tran' });
      if (match.status === 'completed') return send(res, 400, { error: 'Tran da ket thuc, khong the huy' });
      if (match.status === 'cancelled') return send(res, 400, { error: 'Tran da bi huy' });
      const c = live.get(match.id);
      if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(r => r()); }
      match.status = 'cancelled'; match.paused = false; match.cancelReason = String(b.reason || 'Trong tai huy');
      auditLog(t, payload.sub, 'cancel-match', 'Huy tran ' + nameOf(t, match.playerA) + ' vs ' + nameOf(t, match.playerB) + ': ' + match.cancelReason);
      store.save(); return send(res, 200, t);
    }

    if (action === 'reset-match') {
      if (!admin) return send(res, 403, { error: 'Chỉ Admin mới có quyền đặt lại trận đấu' });
      let { round, match } = findMatch(t, String(b.roundId||''), String(b.matchId||''));
      if (!match) {
        const alt = findMatch(t, null, String(b.matchId||''));
        round = alt.round; match = alt.match;
      }
      if (!match) return send(res, 404, { error: 'Không tìm thấy trận đấu' });
      if (match.playerB === 'BYE') return send(res, 400, { error: 'Trận vào thẳng (BYE) không cần đặt lại' });

      // If elimination format, any rounds generated after this round are now invalid and must be removed
      if (t.format === 'elimination' && round) {
        const rIdx = (t.rounds || []).findIndex(r => r.id === round.id);
        if (rIdx !== -1 && rIdx < t.rounds.length - 1) {
          const removed = t.rounds.splice(rIdx + 1);
          for (const remR of removed) {
            for (const remM of (remR.matches || [])) {
              const c = live.get(remM.id);
              if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(fn => fn()); live.delete(remM.id); }
              const f = replayFile(t.id, remM.id);
              if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
            }
          }
        }
      }

      const c = live.get(match.id);
      if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(r => r()); live.delete(match.id); }
      const f = replayFile(t.id, match.id);
      if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
      Object.assign(match, { status: 'pending', winner: null, paused: false, cancelReason: null, error: null, result: null, hasReplay: false, startedAt: null, finishedAt: null });
      if (round) round.status = 'pending';
      t.status = 'active';
      t.champion = null;
      auditLog(t, payload.sub, 'reset-match', 'Đặt lại trận ' + nameOf(t, match.playerA) + ' vs ' + nameOf(t, match.playerB) + ' về chờ đấu');
      store.save(); return send(res, 200, t);
    }

    if (action === 'reset-round') {
      if (!admin) return send(res, 403, { error: 'Chỉ Admin mới có quyền đặt lại vòng đấu' });
      const round = (t.rounds || []).find(r => r.id === String(b.roundId||''));
      if (!round) return send(res, 404, { error: 'Không tìm thấy vòng đấu' });

      // If elimination format, remove all subsequent rounds
      if (t.format === 'elimination') {
        const rIdx = (t.rounds || []).findIndex(r => r.id === round.id);
        if (rIdx !== -1 && rIdx < t.rounds.length - 1) {
          const removed = t.rounds.splice(rIdx + 1);
          for (const remR of removed) {
            for (const remM of (remR.matches || [])) {
              const c = live.get(remM.id);
              if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(fn => fn()); live.delete(remM.id); }
              const f = replayFile(t.id, remM.id);
              if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
            }
          }
        }
      }

      for (const match of (round.matches || [])) {
        if (match.playerB === 'BYE') continue;
        const c = live.get(match.id);
        if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(r => r()); live.delete(match.id); }
        const f = replayFile(t.id, match.id);
        if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        Object.assign(match, { status: 'pending', winner: null, paused: false, cancelReason: null, error: null, result: null, hasReplay: false, startedAt: null, finishedAt: null });
      }
      round.status = 'pending';
      t.status = 'active';
      t.champion = null;
      auditLog(t, payload.sub, 'reset-round', 'Đặt lại toàn bộ vòng ' + (round.name || round.id) + ' về chờ đấu');
      store.save(); return send(res, 200, t);
    }

    if (action === 'pause-match' || action === 'resume-match') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      const { match } = findMatch(t, String(b.roundId||''), String(b.matchId||''));
      if (!match) return send(res, 404, { error: 'Khong tim thay tran' });
      const c = live.get(match.id);
      if (match.status !== 'running' || !c) return send(res, 400, { error: 'Chi tam dung/tiep tuc duoc tran dang chay' });
      const pause = action === 'pause-match';
      if (pause === c.paused) return send(res, 400, { error: pause ? 'Tran dang tam dung roi' : 'Tran dang chay roi' });
      c.paused = pause; match.paused = pause;
      if (!pause) c.waiters.splice(0).forEach(r => r());
      auditLog(t, payload.sub, action, (pause ? 'Tam dung' : 'Tiep tuc') + ' tran ' + nameOf(t, match.playerA) + ' vs ' + nameOf(t, match.playerB) + ' o luot ' + c.turn);
      store.save(); return send(res, 200, t);
    }

    if (action === 'schedule-match') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      const match = t.rounds.find(r=>r.id===String(b.roundId||''))?.matches.find(m=>m.id===String(b.matchId||''));
      if (!match) return send(res, 404, { error: 'Khong tim thay tran' });
      match.scheduledAt=String(b.scheduledAt||'');
      auditLog(t, payload.sub, 'schedule-match', 'Lich tran '+b.matchId+': '+b.scheduledAt);
      store.save(); return send(res, 200, t);
    }

    if (action === 'announce') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      t.announcement=String(b.message||'').slice(0,1000); t.announcedAt=nowISO();
      auditLog(t, payload.sub, 'announce', t.announcement);
      store.save(); return send(res, 200, t);
    }

    if (action === 'cancel') {
      if (!admin) return send(res, 403, { error: 'Chi admin' });
      t.status='cancelled';
      for (const r of (t.rounds || [])) for (const m of r.matches) {
        const c = live.get(m.id);
        if (c) { c.cancelled = true; c.paused = false; c.waiters.splice(0).forEach(fn => fn()); m.status = 'cancelled'; m.paused = false; m.cancelReason = 'Giai bi huy'; }
      }
      auditLog(t, payload.sub, 'cancel-tournament', String(b.reason||''));
      store.save(); return send(res, 200, t);
    }

    return send(res, 404, { error: 'Hanh dong khong hop le' });
  }

  return null;
}

module.exports = { handleTournament };
