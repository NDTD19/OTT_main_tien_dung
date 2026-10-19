'use strict';
/** OTTv2 Phase 6 — snapshot importer. Run only after stopping the legacy API.
 *  node scripts/import-legacy-data.cjs --check
 *  node scripts/import-legacy-data.cjs --apply
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DB_JSON = path.join(DATA, 'db.json');
const mode = process.argv[2];
if (!['--check', '--apply'].includes(mode) || process.argv.length !== 3) {
  console.error('Usage: node scripts/import-legacy-data.cjs --check|--apply');
  process.exit(2);
}
const errors = [], warnings = [];
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function date(value, what) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) { errors.push(`${what}: invalid date`); return null; }
  return d;
}
function text(value) { return typeof value === 'string' ? value : ''; }
function int(value, fallback = 0) { return Number.isSafeInteger(Number(value)) ? Number(value) : fallback; }
function normalizePath(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }
function readLegacy() {
  if (!fs.existsSync(DB_JSON)) throw new Error(`Legacy JSON not found: ${DB_JSON}`);
  const db = JSON.parse(fs.readFileSync(DB_JSON, 'utf8'));
  if (!db || typeof db !== 'object' || Array.isArray(db)) throw new Error('Invalid root JSON object');
  if (db.users && (typeof db.users !== 'object' || Array.isArray(db.users))) throw new Error('Invalid users object');
  for (const key of ['submissions', 'matches']) if (db[key] && !Array.isArray(db[key])) throw new Error(`Invalid ${key} array`);
  if (db.ratings && (typeof db.ratings !== 'object' || Array.isArray(db.ratings))) throw new Error('Invalid ratings object');
  return db;
}
function prepare(db) {
  const users = [], submissions = [], matches = [], ratings = [];
  const usernames = new Set(), submissionIds = new Set(), matchIds = new Set();
  for (const [rawName, user] of Object.entries(db.users || {})) {
    const username = rawName.toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(username) || usernames.has(username)) errors.push(`Invalid/duplicate user: ${rawName}`);
    usernames.add(username);
    if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(text(user?.passwordHash))) errors.push(`Invalid bcrypt hash for ${rawName} (not printed)`);
    users.push({username, passwordHash: text(user?.passwordHash), createdAt: date(user?.createdAt, `user ${rawName}`)});
  }
  for (const s of db.submissions || []) {
    const id = text(s?.id), filename = text(s?.name), language = text(s?.lang);
    if (!/^SUB-[A-F0-9]{8}$/.test(id) || submissionIds.has(id)) errors.push(`Invalid/duplicate submission id ${id}`);
    submissionIds.add(id);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}\.(py|java|c)$/.test(filename) || ({py:'Python',java:'Java',c:'C'}[filename.split('.').pop()] !== language)) errors.push(`Invalid submission filename/language ${id}`);
    const owner = s?.ownedBy == null ? null : String(s.ownedBy).toLowerCase();
    if (owner && !usernames.has(owner)) errors.push(`Submission ${id} references missing owner ${owner}`);
    if (!owner) warnings.push(`Submission ${id}: no owner; remains unclaimed (userId=null)`);
    const sourceFile = path.join(DATA, 'bots', id, filename);
    let sourceHash = null;
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) errors.push(`Submission ${id}: source file missing`);
    else sourceHash = sha(fs.readFileSync(sourceFile));
    if (!/^[a-f0-9]{64}$/i.test(text(s?.sha256)) || (sourceHash && sourceHash !== String(s.sha256).toLowerCase())) errors.push(`Submission ${id}: SHA-256 missing/mismatch`);
    let status = 'STORED';
    if (s?.status === 'Ready') status = 'READY';
    else if (/build/i.test(text(s?.status)) && !/awaiting/i.test(text(s?.status))) status = 'BUILDING';
    else if (/reject|error|invalid/i.test(text(s?.status))) status = 'REJECTED';
    submissions.push({id, owner, filename, language, version:text(s?.version) || 'v1.0', sourcePath:normalizePath(sourceFile), sha256:text(s?.sha256).toLowerCase(), status, createdAt:date(s?.date,`submission ${id}`)});
  }
  for (const m of db.matches || []) {
    const id = text(m?.id);
    if (!/^M-[A-F0-9]{8}$/.test(id) || matchIds.has(id)) errors.push(`Invalid/duplicate match id ${id}`);
    matchIds.add(id);
    const a = m?.submissionA || null, b = m?.submissionB || null;
    if (a && !submissionIds.has(a)) errors.push(`Match ${id}: missing submissionA ${a}`);
    if (b && !submissionIds.has(b)) errors.push(`Match ${id}: missing submissionB ${b}`);
    if ((a && !b) || (!a && b)) errors.push(`Match ${id}: only one submission provided`);
    if (a && b && a === b) errors.push(`Match ${id}: same submission on both sides`);
    const kind = m?.mode === 'submitted' ? 'PRACTICE' : m?.mode === 'demo' ? 'DEMO' : null;
    if (!kind) errors.push(`Match ${id}: unknown mode ${m?.mode}`);
    const originStatus = m?.status;
    const status = ({queued:'FAILED',running:'FAILED',completed:'COMPLETED',failed:'FAILED',cancelled:'CANCELLED'})[originStatus];
    if (!status) errors.push(`Match ${id}: unknown status ${originStatus}`);
    if (['queued','running'].includes(originStatus)) warnings.push(`Match ${id}: was ${originStatus}; imported as FAILED (interrupted legacy work)`);
    const owner = m?.ownedBy == null ? null : String(m.ownedBy).toLowerCase();
    if (owner && !usernames.has(owner)) errors.push(`Match ${id}: unknown creator ${owner}`);
    const replayFile = path.join(DATA, id + '.json');
    let replayHash = null;
    if (fs.existsSync(replayFile) && fs.statSync(replayFile).isFile()) {
      const bytes = fs.readFileSync(replayFile);
      replayHash = sha(bytes);
      try { JSON.parse(bytes.toString('utf8')); } catch { errors.push(`Match ${id}: malformed replay JSON`); }
    } else if (originStatus === 'completed') errors.push(`Match ${id}: completed but replay is missing`);
    let winner = null;
    if (m?.winner === 'p1') winner = 'PLAYER_A';
    else if (m?.winner === 'p2') winner = 'PLAYER_B';
    else if (m?.winner == null && originStatus === 'completed') winner = 'DRAW';
    else if (m?.winner != null) errors.push(`Match ${id}: unknown winner ${m.winner}`);
    const reason = ['queued','running'].includes(originStatus) ? 'legacy-interrupted' : text(m?.reason || m?.error) || null;
    matches.push({id, kind, status, submissionAId:a, submissionBId:b, owner, seed:m?.seed == null ? null : String(m.seed), winner, reason, replayPath:replayHash?normalizePath(replayFile):null, replayHash, turnCount:m?.turns == null?null:int(m.turns), createdAt:date(m?.createdAt,`match ${id}`), finishedAt:date(m?.finishedAt,`match ${id} finishedAt`), maxMoves:m?.maxMoves == null?null:int(m.maxMoves), pieces:m?.pieces == null?null:int(m.pieces), firstPlayerSetting:text(m?.first) || null, autoMatch:Boolean(m?.autoMatch),legacyMetadata:m});
  }
  for (const [id, r] of Object.entries(db.ratings || {})) {
    if (!submissionIds.has(id)) { errors.push(`Rating ${id}: submission not found`); continue; }
    const row={submissionId:id, elo:int(r?.elo,1200),wins:int(r?.wins),losses:int(r?.losses),draws:int(r?.draws),games:int(r?.games)};
    if ([row.wins,row.losses,row.draws,row.games].some(v=>v<0) || row.games!==row.wins+row.losses+row.draws) warnings.push(`Rating ${id}: legacy counters inconsistent, preserving snapshot`);
    ratings.push(row);
  }
  return {users,submissions,matches,ratings,setting:Boolean(db.settings?.submissionsOpen ?? true),legacySettings:db.settings || {}};
}
async function apply(p) {
  const prisma = require('../server/db');
  try {
    const oldCounts = await Promise.all([prisma.user.count(),prisma.submission.count(),prisma.match.count(),prisma.practiceRating.count()]);
    if (oldCounts.some(Boolean)) {
      console.log('Database is not empty. Checking whether IDs already exist before idempotent import...');
      for (const u of p.users) {const old=await prisma.user.findUnique({where:{username:u.username}});if(old&&old.passwordHash!==u.passwordHash) throw new Error(`Conflicting existing user: ${u.username}`)}
      for (const s of p.submissions) {const old=await prisma.submission.findUnique({where:{id:s.id}});if(old&&(old.sha256!==s.sha256||old.filename!==s.filename)) throw new Error(`Conflicting existing submission: ${s.id}`)}
      for (const m of p.matches) {const old=await prisma.match.findUnique({where:{id:m.id}});if(old&&(old.kind!==m.kind||old.submissionAId!==m.submissionAId||old.submissionBId!==m.submissionBId)) throw new Error(`Conflicting existing match: ${m.id}`)}
    }
    // Intended for the local legacy dataset, not large production imports.
    await prisma.$transaction(async tx=>{
      const ids=new Map();
      for(const u of p.users) {
        const record=await tx.user.upsert({where:{username:u.username},update:{},create:{username:u.username,passwordHash:u.passwordHash,role:'STUDENT',...(u.createdAt?{createdAt:u.createdAt}:{})}});
        ids.set(u.username,record.id);
      }
      for(const s of p.submissions) await tx.submission.upsert({where:{id:s.id},update:{},create:{id:s.id,userId:s.owner?ids.get(s.owner):null,filename:s.filename,language:s.language,version:s.version,sourcePath:s.sourcePath,sha256:s.sha256,status:s.status,...(s.createdAt?{createdAt:s.createdAt}:{})}});
      for(const m of p.matches) {
        await tx.match.upsert({where:{id:m.id},update:{},create:{id:m.id,kind:m.kind,status:m.status,...(m.owner?{creator:{connect:{id:ids.get(m.owner)}}}:{}),...(m.submissionAId?{submissionA:{connect:{id:m.submissionAId}}}:{}),...(m.submissionBId?{submissionB:{connect:{id:m.submissionBId}}}:{}),gameId:'ott-rps',rulesetVersion:'legacy-unversioned',seed:m.seed,winner:m.winner,resultStatus:'PENDING',reason:m.reason,replayPath:m.replayPath,replayHash:m.replayHash,turnCount:m.turnCount,maxMoves:m.maxMoves,pieces:m.pieces,firstPlayerSetting:m.firstPlayerSetting,autoMatch:m.autoMatch,legacyMetadata:m.legacyMetadata,...(m.createdAt?{createdAt:m.createdAt}:{}),...(m.finishedAt?{finishedAt:m.finishedAt}:{})}});
        await tx.matchHistory.upsert({where:{matchId_sequence:{matchId:m.id,sequence:1}},update:{},create:{matchId:m.id,sequence:1,fromStatus:null,toStatus:m.status,reason:'Imported legacy snapshot; earlier state transitions unavailable',...(m.createdAt?{createdAt:m.createdAt}:{})}});
      }
      for(const r of p.ratings) await tx.practiceRating.upsert({where:{submissionId:r.submissionId},update:{},create:r});
      await tx.appSetting.upsert({where:{key:'submissionsOpen'},update:{},create:{key:'submissionsOpen',value:p.setting}});
      await tx.appSetting.upsert({where:{key:'legacySettings'},update:{},create:{key:'legacySettings',value:p.legacySettings}});
    },{maxWait:10000,timeout:120000});
    console.log('IMPORT COMPLETE. Run: node scripts/verify-legacy-data.cjs');
  } finally {await prisma.$disconnect()}
}
(async()=>{
  try {
    const prepared=prepare(readLegacy());
    console.log('Legacy snapshot:', {users:prepared.users.length,submissions:prepared.submissions.length,matches:prepared.matches.length,ratings:prepared.ratings.length,submissionsOpen:prepared.setting});
    for(const w of warnings) console.warn('WARN:',w);
    for(const e of errors) console.error('ERROR:',e);
    if(errors.length) throw new Error(`${errors.length} preflight error(s): no database writes performed`);
    if(mode==='--check'){console.log('CHECK PASSED. No database changes made.');return}
    await apply(prepared);
  } catch(e){console.error('FAILED:',e.message);process.exitCode=1}
})();
