const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.PORT = '0';
process.env.OTT_DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ott-'));
process.env.HOST = '127.0.0.1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';

const server = require(path.join(__dirname, '..', 'server', 'index.js'));

let base;
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

test('tournament flows', async (t) => {
  if (!server.listening) await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const sfx = Date.now().toString(36);
  const adminName = 'admin';
  let admin = await call('POST', '/api/auth/register', null, { username: adminName, password: 'pass1234' });
  if (admin.status !== 201) admin = await call('POST', '/api/auth/login', null, { username: adminName, password: 'pass1234' });
  const adminTok = admin.body.token;
  assert.ok(adminTok, 'admin token (admin account may exist with other password)');

  const users = [];
  for (let i = 0; i < 5; i++) {
    const u = `p${i}${sfx}`;
    const r = await call('POST', '/api/auth/register', null, { username: u, password: 'pass1234' });
    users.push({ name: u, token: r.body.token });
  }

  await t.test('player cannot create', async () => {
    const r = await call('POST', '/api/tournaments', users[0].token, { name: 'X', format: 'round-robin' });
    assert.strictEqual(r.status, 403);
  });

  async function setup(format) {
    const c = await call('POST', '/api/tournaments', adminTok, { name: 'T-' + format, format });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    const id = c.body.id || c.body.tournament?.id;
    await call('POST', `/api/tournaments/${id}/open-registration`, adminTok, {});
    for (const u of users) {
      const r = await call('POST', `/api/tournaments/${id}/register`, u.token, {});
      assert.ok(r.status < 300, JSON.stringify(r.body));
      const a = await call('POST', `/api/tournaments/${id}/approve-participant`, adminTok, { userId: u.name });
      assert.ok(a.status < 300, JSON.stringify(a.body));
      const sid = 'SUB-' + u.name;
      require('../server/store').get().submissions.push({ id: sid, name: 'bot.py', ownedBy: u.name });
      const ob = await call('POST', `/api/tournaments/${id}/set-official-bot`, u.token, { submissionId: sid });
      assert.ok(ob.status < 300, JSON.stringify(ob.body));
    }
    await call('POST', `/api/tournaments/${id}/close-registration`, adminTok, {});
    const g = await call('POST', `/api/tournaments/${id}/generate-rounds`, adminTok, {});
    assert.ok(g.status < 300, JSON.stringify(g.body));
    return id;
  }

  const get = async id => (await call('GET', `/api/tournaments/${id}`, null)).body;
  const unwrap = x => x.tournament || x;

  await t.test('round robin scoring 3/1/0', async () => {
    const id = await setup('round-robin');
    let tr = unwrap(await get(id));
    // 5 players -> 10 matches (bye excluded)
    const real = tr.rounds.flatMap(r => r.matches.map(m => ({ r, m }))).filter(x => x.m.winner !== 'bye' && x.m.playerB !== 'BYE' && x.m.playerA !== 'BYE');
    assert.strictEqual(real.length, 10);
    let k = 0;
    for (const { r, m } of real) {
      const w = ['a', 'b', 'draw'][k++ % 3];
      const rep = await call('POST', `/api/tournaments/${id}/report-match`, adminTok, { roundId: r.id, matchId: m.id, winner: w });
      assert.ok(rep.status < 300, JSON.stringify(rep.body));
    }
    const st = (await call('GET', `/api/tournaments/${id}/standings`, null)).body;
    const rows = st.standings || st;
    const total = rows.reduce((s, x) => s + x.points, 0);
    // wins*3 + draws*2 : k=10 -> a:4,b:3,draw:3 => 21 + 6 = 27? compute: (4+3)*3 + 3*2
    assert.strictEqual(total, 7 * 3 + 3 * 2);
  });

  await t.test('elimination with bye reaches champion', async () => {
    const id = await setup('elimination');
    for (let guard = 0; guard < 6; guard++) {
      const tr = unwrap(await get(id));
      if (tr.champion || tr.status === 'completed') break;
      const round = tr.rounds[tr.rounds.length - 1];
      for (const m of round.matches) {
        if (m.status === 'completed' || m.winner === 'bye') continue;
        const rep = await call('POST', `/api/tournaments/${id}/report-match`, adminTok, { roundId: round.id, matchId: m.id, winner: 'a' });
        assert.ok(rep.status < 300, JSON.stringify(rep.body));
      }
    }
    const tr = unwrap(await get(id));
    assert.ok(tr.champion || tr.status === 'completed', 'champion decided: ' + tr.status);
  });

  server.close();
});
