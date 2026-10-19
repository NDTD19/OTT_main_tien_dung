'use strict';
require('dotenv/config');
const {Prisma}=require('@prisma/client');
const prisma=require('../server/db');
const required={
  User:['id','username','role','isActive','createdMatches'],
  Submission:['id','userId','filename','language','sourcePath','sha256','status'],
  Match:['id','kind','status','submissionAId','submissionBId','createdById','creator','seed','maxMoves','pieces','firstPlayerSetting','autoMatch','legacyMetadata','replayPath','replayHash','turnCount','resultStatus'],
  AppSetting:['key','value'],PracticeRating:['submissionId','elo'],RatingEvent:['matchId','submissionId'],MatchHistory:['matchId','sequence']
};
async function main(){
  let missing=[];
  for(const [name,fields] of Object.entries(required)){
    const model=Prisma.dmmf.datamodel.models.find(x=>x.name===name);
    const actual=new Set(model?.fields.map(x=>x.name)||[]);
    for(const field of fields)if(!actual.has(field))missing.push(`${name}.${field}`);
  }
  if(missing.length){console.error('MISSING Prisma Client fields:',missing.join(', '));process.exitCode=1;return;}
  console.log('Schema/Prisma Client: OK');
  const [users,submissions,matches,ratings,settings]=await Promise.all([
    prisma.user.count(),prisma.submission.count(),prisma.match.count(),prisma.practiceRating.count(),prisma.appSetting.findUnique({where:{key:'submissionsOpen'}})
  ]);
  console.table({users,submissions,matches,ratings});
  console.log('submissionsOpen:',settings?.value);
  if(!users||!submissions||!matches||!settings){console.error('The import may be incomplete. Run verify-legacy-data.cjs first.');process.exitCode=1;return;}
  console.log('Preflight passed (NOT a replacement for verify-legacy-data.cjs).');
}
main().catch(e=>{console.error('Preflight failed:',e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
