'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const adapt=require('../server/pg/adapters');
test('Map Prisma submission to frontend contract',()=>{
  const item=adapt.submission({id:'SUB-12345678',filename:'Main.java',language:'Java',version:'v1',sha256:'abc',status:'STORED',createdAt:new Date('2026-10-19T00:00:00Z'),user:{username:'student1'}});
  assert.equal(item.name,'Main.java');assert.equal(item.lang,'Java');assert.equal(item.ownedBy,'student1');assert.equal(item.status,'Stored awaiting sandbox build');
});
test('Map Prisma match to frontend contract',()=>{
  const item=adapt.match({id:'M-12345678',kind:'PRACTICE',status:'COMPLETED',winner:'PLAYER_A',createdAt:new Date('2026-10-19T00:00:00Z'),turnCount:18,seed:'4294967295',creator:{username:'student1'},submissionA:{filename:'a.py'},submissionB:{filename:'b.py'},legacyMetadata:{}});
  assert.equal(item.status,'completed');assert.equal(item.winner,'p1');assert.equal(item.a,'a.py');assert.equal(item.seed,4294967295);
});
test('Map Prisma bot to legacy runner contract',()=>{
  assert.deepEqual(adapt.runnerSubmission({id:'SUB-12345678',filename:'a.py',language:'Python',sha256:'abc',version:'v1'}),{id:'SUB-12345678',name:'a.py',lang:'Python',sha256:'abc',version:'v1'});
});
