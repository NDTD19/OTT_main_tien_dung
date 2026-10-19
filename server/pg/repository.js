'use strict';
const crypto = require('node:crypto');
const prisma = require('../db');
const adapter = require('./adapters');

const includeMatch = { creator: {select:{username:true}}, submissionA: {select:{id:true, filename:true}}, submissionB: {select:{id:true, filename:true}} };

async function getSettings() {
  const settings = await prisma.appSetting.findUnique({where:{key:'legacySettings'}});
  const raw = settings?.value && typeof settings.value === 'object' && !Array.isArray(settings.value) ? settings.value : {};
  const open = await prisma.appSetting.findUnique({where:{key:'submissionsOpen'}});
  return {...raw, submissionsOpen: typeof open?.value === 'boolean' ? open.value : (raw.submissionsOpen === true)};
}
async function overview(activeJobs, pendingJobs, maxConcurrent) {
  const [users, submissions, matches, registeredBotProfiles, latest] = await Promise.all([
    prisma.user.count(), prisma.submission.count(), prisma.match.count(), prisma.practiceRating.count(),
    prisma.match.findMany({take:5,orderBy:{createdAt:'desc'},include:includeMatch})
  ]);
  return {registeredUsers:users, submissions, matches, registeredBotProfiles,
    latest:latest.map(adapter.match), activeJobs, pendingJobs, maxConcurrent};
}
async function findUser(username) { return prisma.user.findUnique({where:{username}}); }
async function findUserById(id) { return prisma.user.findUnique({where:{id}}); }
async function createUser(username, passwordHash) {return prisma.user.create({data:{username,passwordHash,role:'STUDENT'}});}
async function listSubmissions(max=250) { const rows=await prisma.submission.findMany({orderBy:{createdAt:'desc'},take:max,include:{user:{select:{username:true}}}});return rows.map(adapter.submission); }
async function listUserSubmissions(userId) { const rows=await prisma.submission.findMany({where:{userId},orderBy:{createdAt:'desc'},take:100,include:{user:{select:{username:true}}}});return rows.map(adapter.submission); }
async function findSubmission(id){return prisma.submission.findUnique({where:{id},include:{user:{select:{username:true}}}});}
async function selectOpponent(excludeId){const bots=await prisma.submission.findMany({where:{id:{not:excludeId},status:{not:'REJECTED'}},select:{id:true,filename:true},take:250});return bots.length?bots[crypto.randomInt(bots.length)]:null;}
async function storeSubmission({id,userId,filename,language,version,sha256,sourcePath}) {
  const row=await prisma.submission.create({data:{id,userId,filename,language,version,sha256,sourcePath,status:'STORED'},include:{user:{select:{username:true}}}});
  return adapter.submission(row);
}
async function listMatches(max=150) { const rows=await prisma.match.findMany({orderBy:{createdAt:'desc'},take:max,include:includeMatch});return rows.map(adapter.match); }
async function findMatch(id) {return prisma.match.findUnique({where:{id},include:includeMatch});}
async function listMyMatches(userId) { const rows=await prisma.match.findMany({where:{createdById:userId},orderBy:{createdAt:'desc'},take:20,include:includeMatch});return rows.map(adapter.match); }
async function leaderboard() { const rows=await prisma.practiceRating.findMany({orderBy:{elo:'desc'},take:250,include:{submission:{include:{user:{select:{username:true}}}}}});return rows.map(adapter.rating); }
async function newMatch({kind,submissionAId=null,submissionBId=null,createdById=null,maxMoves,pieces,first,autoMatch=false,a,b}) {
  const id='M-'+crypto.randomBytes(4).toString('hex').toUpperCase();
  const seed=String(crypto.randomBytes(4).readUInt32LE(0));
  const row=await prisma.$transaction(async tx=>{
    const rec=await tx.match.create({data:{id,kind,status:'QUEUED',gameId:'ott-rps',rulesetVersion:'1.0.0',seed,
      maxMoves,pieces,firstPlayerSetting:first,autoMatch,
      ...(createdById?{creator:{connect:{id:createdById}}}:{}),
      ...(submissionAId?{submissionA:{connect:{id:submissionAId}}}:{}),
      ...(submissionBId?{submissionB:{connect:{id:submissionBId}}}:{}),
      legacyMetadata:{a:a||'Greedy Bot',b:b||'Random Bot'}},include:includeMatch});
    await tx.matchHistory.create({data:{matchId:id,sequence:1,toStatus:'QUEUED',reason:'New match'}});
    return rec;
  });
  return adapter.match(row);
}
async function setStatus(id,fromStatus,toStatus,extra={}) {
  return prisma.$transaction(async tx=>{
    const updated=await tx.match.updateMany({where:{id,status:fromStatus},data:{...extra,status:toStatus}});
    if(updated.count!==1) return false;
    const last=await tx.matchHistory.aggregate({where:{matchId:id},_max:{sequence:true}});
    await tx.matchHistory.create({data:{matchId:id,sequence:(last._max.sequence||0)+1,fromStatus,toStatus}});
    return true;
  });
}
module.exports={prisma,includeMatch,getSettings,overview,findUser,findUserById,createUser,listSubmissions,listUserSubmissions,findSubmission,selectOpponent,storeSubmission,listMatches,findMatch,listMyMatches,leaderboard,newMatch,setStatus};
