const {test}=require('node:test'),assert=require('node:assert/strict');const {initial,legal,runMatch}=require('../server/engine');
test('deterministic initial board',()=>assert.deepEqual(initial(123),initial(123)));
test('all moves are adjacent and legal',()=>{const b=initial(123);for(const m of legal(b,'p1')){assert.equal(Math.max(Math.abs(m.from[0]-m.to[0]),Math.abs(m.from[1]-m.to[1])),1)}});
test('replay snapshots and moves consistent',async()=>{const r=await runMatch({seed:125,maxMoves:80});assert.equal(r.snapshots.length,r.events.length+1);assert.ok(r.turns<=80)});
