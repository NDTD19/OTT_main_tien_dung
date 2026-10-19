'use strict';

/** Convert Prisma rows to the public JSON contract used by public/api.js. */
const statusToLegacy = { STORED: 'Stored awaiting sandbox build', BUILDING: 'Building', READY: 'Ready', REJECTED: 'Rejected' };
const winToLegacy = { PLAYER_A: 'p1', PLAYER_B: 'p2', DRAW: null };
const stateToLegacy = { QUEUED: 'queued', RUNNING: 'running', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' };
function submission(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.filename, lang: row.language, version: row.version,
    sha256: row.sha256, status: statusToLegacy[row.status] || row.status,
    date: row.createdAt?.toISOString?.() || row.createdAt,
    ownedBy: row.user?.username || null
  };
}
function runnerSubmission(row) {
  if (!row) throw new Error('Submission not found');
  return {id: row.id, name: row.filename, lang: row.language, sha256: row.sha256, version: row.version};
}
function match(row) {
  if (!row) return null;
  const old = row.legacyMetadata && typeof row.legacyMetadata === 'object' && !Array.isArray(row.legacyMetadata) ? row.legacyMetadata : {};
  return {
    id: row.id, status: stateToLegacy[row.status], mode: row.kind === 'DEMO' ? 'demo' : 'submitted',
    submissionA: row.submissionAId || null, submissionB: row.submissionBId || null,
    a: row.submissionA?.filename || old.a || 'Greedy Bot',
    b: row.submissionB?.filename || old.b || 'Random Bot',
    seed: row.seed == null ? null : Number(row.seed), maxMoves: row.maxMoves ?? old.maxMoves ?? 200,
    pieces: row.pieces ?? old.pieces ?? 6, first: row.firstPlayerSetting || old.first || 'Random',
    autoMatch: Boolean(row.autoMatch), ownedBy: row.creator?.username || old.ownedBy || null,
    createdAt: row.createdAt?.toISOString?.() || row.createdAt,
    turns: row.turnCount || 0, winner: winToLegacy[row.winner] ?? null,
    reason: row.reason || null, fault: old.fault || null, error: old.error || null,
    finishedAt: row.finishedAt?.toISOString?.() || row.finishedAt || null
  };
}
function rating(row) {
  const sub = row.submission;
  return { id: row.submissionId, name: (sub?.filename || row.submissionId) + ' (' + row.submissionId.slice(-4) + ')',
    lang: sub?.language || 'Unknown', owner: sub?.user?.username || null,
    elo: row.elo, wins: row.wins, losses: row.losses, draws: row.draws, games: row.games };
}
module.exports = { submission, runnerSubmission, match, rating, winToLegacy };
