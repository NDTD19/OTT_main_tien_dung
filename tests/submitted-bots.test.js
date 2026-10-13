'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runMatch,legal}=require('../server/engine');
const {safeFile}=require('../server/bot-runner');

test('uploaded filename validation refuses paths and extensions',()=>{
 assert.equal(safeFile('Main.java','Java'),'Main.java');
 assert.equal(safeFile('greedy.py','Python'),'greedy.py');
 assert.throws(()=>safeFile('../outside.py','Python'));
 assert.throws(()=>safeFile('bot.js','Python'));
 assert.throws(()=>safeFile('bot.c','Java'));
});
test('async bot decisions result in authoritative moves and replay',async()=>{
 const replay=await runMatch({seed:456,maxMoves:28,decide:async ({moves})=>({from:moves[0].from,to:moves[0].to})});
 assert.equal(replay.snapshots.length,replay.events.length+1);
 assert.ok(replay.events.length>0);
 for(let i=0;i<replay.events.length;i++){
  const owner=replay.events[i].owner;
  const allowed=legal(replay.snapshots[i],owner);
  assert.ok(allowed.some(a=>a.from.join(',')===replay.events[i].from.join(',')&&a.to.join(',')===replay.events[i].to.join(',')));
 }
});
test('bad action forfeits immediately and records who failed',async()=>{
 const r=await runMatch({seed:123,maxMoves:20,first:'Player A',decide:async()=>({from:[0,0],to:[0,1]})});
 assert.equal(r.winner,'p2');assert.equal(r.reason,'invalid-action');assert.equal(r.turns,0);assert.equal(r.fault.owner,'p1');
});
test('bot runtime errors forfeit match with explicit reason',async()=>{
 const r=await runMatch({seed:123,maxMoves:20,first:'Player B',decide:async()=>{const e=new Error('CPU budget exceeded');e.kind='bot-timeout';throw e}});
 assert.equal(r.winner,'p1');assert.equal(r.reason,'bot-timeout');assert.equal(r.fault.owner,'p2');
});
