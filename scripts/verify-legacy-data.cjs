'use strict';
/** Verify legacy import against the frozen snapshot (run while old API is stopped). */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const prisma=require('../server/db');
const ROOT=path.resolve(__dirname,'..');
const DATA=path.join(ROOT,'data');
const legacy=JSON.parse(fs.readFileSync(path.join(DATA,'db.json'),'utf8'));
const failures=[];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const check=(ok,msg)=>{if(!ok)failures.push(msg)};
(async()=>{
try{
  const [users,subs,matches,ratings,settings]=await Promise.all([
    prisma.user.findMany({select:{id:true,username:true,passwordHash:true}}),
    prisma.submission.findMany({select:{id:true,userId:true,filename:true,language:true,sha256:true,sourcePath:true}}),
    prisma.match.findMany({select:{id:true,kind:true,submissionAId:true,submissionBId:true,replayPath:true,replayHash:true,seed:true,createdById:true}}),
    prisma.practiceRating.findMany(),
    prisma.appSetting.findUnique({where:{key:'submissionsOpen'}})
  ]);
  const userByName=new Map(users.map(x=>[x.username,x]));
  const subById=new Map(subs.map(x=>[x.id,x]));
  const matchById=new Map(matches.map(x=>[x.id,x]));
  const ratingById=new Map(ratings.map(x=>[x.submissionId,x]));
  for(const [name,u] of Object.entries(legacy.users||{})) {
    const actual=userByName.get(name.toLowerCase());
    check(Boolean(actual),`Missing user ${name}`);
    if(actual)check(actual.passwordHash===u.passwordHash,`Password hash differs for user ${name}`);
  }
  for(const s of legacy.submissions||[]) {
    const actual=subById.get(s.id);check(Boolean(actual),`Missing submission ${s.id}`);
    if(!actual)continue;
    check(actual.filename===s.name&&actual.language===s.lang,`Metadata differs for submission ${s.id}`);
    check(actual.sha256===s.sha256.toLowerCase(),`SHA metadata differs for submission ${s.id}`);
    const intendedOwner=s.ownedBy?userByName.get(String(s.ownedBy).toLowerCase())?.id:null;
    check(actual.userId===(intendedOwner||null),`Owner differs for submission ${s.id}`);
    const source=path.resolve(ROOT,actual.sourcePath);
    check(source.startsWith(DATA+path.sep)&&fs.existsSync(source),`Source file not found for ${s.id}`);
    if(fs.existsSync(source))check(hash(source)===actual.sha256,`Source SHA mismatch for ${s.id}`);
  }
  for(const m of legacy.matches||[]) {
    const actual=matchById.get(m.id);check(Boolean(actual),`Missing match ${m.id}`);
    if(!actual)continue;
    check(actual.submissionAId===(m.submissionA||null)&&actual.submissionBId===(m.submissionB||null),`Participants differ in match ${m.id}`);
    check(actual.kind===(m.mode==='submitted'?'PRACTICE':'DEMO'),`Kind mismatch ${m.id}`);
    check(actual.seed===(m.seed==null?null:String(m.seed)),`Seed mismatch ${m.id}`);
    if(m.status==='completed') {
      check(Boolean(actual.replayPath&&actual.replayHash),`Completed match ${m.id} has no replay metadata`);
      if(actual.replayPath) {
        const rp=path.resolve(ROOT,actual.replayPath);
        check(rp.startsWith(DATA+path.sep)&&fs.existsSync(rp),`Replay missing ${m.id}`);
        if(fs.existsSync(rp))check(hash(rp)===actual.replayHash,`Replay hash mismatch ${m.id}`);
      }
    }
  }
  for(const [id,old] of Object.entries(legacy.ratings||{})) {
    const r=ratingById.get(id);
    check(Boolean(r),`Missing practice rating ${id}`);
    if(r) for(const key of ['elo','wins','losses','draws','games']) check(r[key]===old[key],`Rating ${id} ${key} differs`);
  }
  check(settings?.value===(legacy.settings?.submissionsOpen??true),'submissionsOpen differs');
  console.log('Legacy counts vs PostgreSQL counts:');
  console.table({
    Users:{legacy:Object.keys(legacy.users||{}).length,postgres:users.length},
    Submissions:{legacy:(legacy.submissions||[]).length,postgres:subs.length},
    Matches:{legacy:(legacy.matches||[]).length,postgres:matches.length},
    PracticeRatings:{legacy:Object.keys(legacy.ratings||{}).length,postgres:ratings.length}
  });
  if(failures.length){for(const item of failures)console.error('FAIL:',item);throw new Error(`${failures.length} verification failure(s)`)}
  console.log('VERIFICATION PASSED. This verifies legacy snapshot fidelity, not production API migration.');
} catch(e){console.error('VERIFICATION FAILED:',e.message);process.exitCode=1}
finally{await prisma.$disconnect()}
})();
