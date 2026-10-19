'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = require('./repository');
const {runnerSubmission} = require('./adapters');
const {runMatch} = require('../engine');
const runner = require('../bot-runner');
const DATA=path.resolve(__dirname,'../../data');
const RATEABLE=new Set(['victory','move-limit','no-legal-actions','invalid-action','bot-timeout','bot-crash','bot-output-limit','bot-protocol-error']);
const MAX_CONCURRENT=Math.max(1,Math.min(4,Number(process.env.WORKER_CONCURRENCY)||2));
const MAX_PENDING=100;
let activeJobs=0;
const pending=[];
let broadcaster=()=>{};
const publicInfo=()=>({activeJobs,pendingJobs:pending.length,maxConcurrent:MAX_CONCURRENT});
function onBroadcast(fn){broadcaster=fn;}
function wins(winner){return winner==='p1'?'PLAYER_A':winner==='p2'?'PLAYER_B':'DRAW';}
function rawName(row, side){return side==='a'?row.submissionA?.filename||row.legacyMetadata?.a||'Greedy Bot':row.submissionB?.filename||row.legacyMetadata?.b||'Random Bot';}
async function saveReplay(id,replay) {
  const finalPath=path.join(DATA,id+'.json');
  const content=JSON.stringify(replay);
  const hash=crypto.createHash('sha256').update(content).digest('hex');
  const temp=path.join(DATA,`.${id}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  await fs.mkdir(DATA,{recursive:true});
  try {await fs.writeFile(temp,content,{flag:'wx',mode:0o600});await fs.rename(temp,finalPath);}
  catch(e){await fs.rm(temp,{force:true}).catch(()=>{});throw e;}
  return {replayPath:`data/${id}.json`,replayHash:hash};
}
async function finishMatch(row,replay,files) {
  const winner=wins(replay.winner);
  for(let attempt=0;attempt<4;attempt++){
    try{
      return await repo.prisma.$transaction(async tx=>{
        const updated=await tx.match.updateMany({where:{id:row.id,status:'RUNNING'},data:{
          status:'COMPLETED',winner,reason:replay.reason,turnCount:replay.turns,
          replayPath:files.replayPath,replayHash:files.replayHash,finishedAt:new Date(),
          legacyMetadata:{...(row.legacyMetadata||{}),fault:replay.fault||null}
        }});
        if(updated.count!==1)return false;
        const last=await tx.matchHistory.aggregate({where:{matchId:row.id},_max:{sequence:true}});
        await tx.matchHistory.create({data:{matchId:row.id,sequence:(last._max.sequence||0)+1,fromStatus:'RUNNING',toStatus:'COMPLETED',reason:replay.reason}});
        const rated=row.kind==='PRACTICE' && row.submissionAId && row.submissionBId && row.submissionAId!==row.submissionBId && RATEABLE.has(replay.reason);
        if(rated){
          const idA=row.submissionAId,idB=row.submissionBId;
          for(const id of [idA,idB])await tx.practiceRating.upsert({where:{submissionId:id},update:{},create:{submissionId:id}});
          const [A,B]=await Promise.all([tx.practiceRating.findUnique({where:{submissionId:idA}}),tx.practiceRating.findUnique({where:{submissionId:idB}})]);
          const expected=1/(1+10**((B.elo-A.elo)/400));
          const score=winner==='PLAYER_A'?1:winner==='PLAYER_B'?0:0.5;
          const delta=Math.round(24*(score-expected));
          const scoreDiffA={elo:delta,games:1,wins:score===1?1:0,losses:score===0?1:0,draws:score===0.5?1:0};
          const scoreDiffB={elo:-delta,games:1,wins:score===0?1:0,losses:score===1?1:0,draws:score===0.5?1:0};
          for(const [id,diff] of [[idA,scoreDiffA],[idB,scoreDiffB]]){
            await tx.practiceRating.update({where:{submissionId:id},data:Object.fromEntries(Object.entries(diff).map(([k,v])=>[k,{increment:v}]))});
            await tx.ratingEvent.create({data:{matchId:row.id,submissionId:id,delta:diff.elo}});
            await tx.submission.update({where:{id},data:{status:'READY'}});
          }
        }
        return true;
      },{isolationLevel:'Serializable',timeout:10000});
    }catch(e){if(e.code==='P2034'&&attempt<3)continue;throw e;}
  }
}
async function runOne(id){
  let row;
  try{
    row=await repo.findMatch(id);
    if(!row||!(await repo.setStatus(id,'QUEUED','RUNNING',{startedAt:new Date()})))return;
    broadcaster('match-started',{matchId:id,a:rawName(row,'a'),b:rawName(row,'b'),ownedBy:row.creator?.username||null,...publicInfo()});
    const opts={seed:Number(row.seed),maxMoves:row.maxMoves||200,pieces:row.pieces||6,first:row.firstPlayerSetting||'Random'};
    let replay;
    if(row.kind==='PRACTICE'){
      const [a,b]=await Promise.all([repo.findSubmission(row.submissionAId),repo.findSubmission(row.submissionBId)]);
      if(!a||!b)throw new Error('Match references a missing submission');
      replay=await runner.duel(runnerSubmission(a),runnerSubmission(b),opts,runMatch);
    }else if(row.kind==='DEMO'){
      replay=await runMatch({...opts,bots:['greedy','random']});
    }else throw new Error('Official matches are not supported by this local practice worker');
    const files=await saveReplay(id,replay);
    const changed=await finishMatch(row,replay,files);
    if(changed)broadcaster('match-finished',{matchId:id,status:'completed',winner:replay.winner,reason:replay.reason,turns:replay.turns,a:rawName(row,'a'),b:rawName(row,'b'),ownedBy:row.creator?.username||null,...publicInfo()});
  }catch(e){
    console.error('[Worker]',id,e.message);
    const kind=e.kind||'judge-error';
    const old=row?.legacyMetadata && typeof row.legacyMetadata==='object'?row.legacyMetadata:{};
    try{await repo.setStatus(id,'RUNNING','FAILED',{finishedAt:new Date(),reason:kind,legacyMetadata:{...old,error:String(e.message||e).slice(0,500)}});}catch(dbError){console.error('[Worker persist failed]',id,dbError);}
    broadcaster('match-finished',{matchId:id,status:'failed',winner:null,reason:kind,turns:0,a:row?rawName(row,'a'):'',b:row?rawName(row,'b'):'',ownedBy:row?.creator?.username||null,...publicInfo()});
  }
}
function drain(){while(activeJobs<MAX_CONCURRENT&&pending.length){const id=pending.shift();activeJobs++;runOne(id).catch(e=>console.error('[Unhandled worker]',e)).finally(()=>{activeJobs--;drain();});}}
function submit(id){if(pending.length+activeJobs>=MAX_PENDING)throw Object.assign(new Error('Match queue is full'),{status:429});pending.push(id);drain();}
async function recoverOnStart(){
  // Older running jobs cannot be trusted after restart; mark FAILED but preserve their previous metadata.
  const interrupted=await repo.prisma.match.findMany({where:{status:'RUNNING'},select:{id:true}});
  for(const row of interrupted)await repo.setStatus(row.id,'RUNNING','FAILED',{reason:'server-restarted',finishedAt:new Date()});
  const queued=await repo.prisma.match.findMany({where:{status:'QUEUED'},select:{id:true},orderBy:{createdAt:'asc'}});
  for(const item of queued)submit(item.id);
}
module.exports={onBroadcast,submit,publicInfo,recoverOnStart};
