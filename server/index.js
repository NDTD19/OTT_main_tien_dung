'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {runMatch}=require('./engine');
const runner=require('./bot-runner');
const store=require('./store');
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST||'127.0.0.1';
const PUB=path.resolve(__dirname,'../public');
const DATA=path.resolve(__dirname,'../data');
const MAX_BODY=760000;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const send=(res,status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
function body(req){return new Promise((resolve,reject)=>{let chunks=[],size=0,done=false;req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>MAX_BODY){done=true;reject(Object.assign(new Error('Payload too large'),{code:413}));req.resume()}else chunks.push(chunk)});req.on('end',()=>{if(done)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'))}catch{reject(Object.assign(new Error('Invalid JSON'),{code:400}))}});req.on('error',reject)})}
const db=store.get();
if(!db.ratings)db.ratings={};
for(const m of db.matches){if(['running','queued'].includes(m.status)){m.status='failed';m.error='Server restarted during match';}}
store.save();
const jobs=[];let processing=false;
function matchMeta(id){return db.matches.find(x=>x.id===id)}
function recordMatch(b){const id='M-'+crypto.randomBytes(4).toString('hex').toUpperCase(),a=b.submissionA?db.submissions.find(s=>s.id===b.submissionA)?.name:b.a||'Greedy Bot',c=b.submissionB?db.submissions.find(s=>s.id===b.submissionB)?.name:b.b||'Random Bot';const rec={id,status:'queued',mode:b.submissionA?'submitted':'demo',submissionA:b.submissionA||null,submissionB:b.submissionB||null,a,b:c,seed:crypto.randomBytes(4).readUInt32LE(0),maxMoves:b.maxMoves,pieces:b.pieces,first:b.first,createdAt:new Date().toISOString(),turns:0,winner:null,reason:null};db.matches.unshift(rec);if(db.matches.length>500)db.matches.length=500;store.save();return rec}
function computeRatings(rec){if(rec.mode!=='submitted'||!['victory','move-limit','no-legal-actions','invalid-action','bot-timeout','bot-crash','bot-output-limit','bot-protocol-error'].includes(rec.reason))return;
 const idA=rec.submissionA,idB=rec.submissionB;if(idA===idB)return;for(const id of [idA,idB])db.ratings[id]??={elo:1200,wins:0,losses:0,draws:0,games:0};
 const A=db.ratings[idA],B=db.ratings[idB],ea=1/(1+10**((B.elo-A.elo)/400)),score=rec.winner==='p1'?1:rec.winner==='p2'?0:.5;const delta=Math.round(24*(score-ea));A.elo+=delta;B.elo-=delta;A.games++;B.games++;if(score===1){A.wins++;B.losses++}else if(score===0){B.wins++;A.losses++}else{A.draws++;B.draws++}}
async function executeJob(rec){
  rec.status='running';store.save();
  try{
    const opts={seed:rec.seed,maxMoves:rec.maxMoves,pieces:rec.pieces,first:rec.first};
    const replay=rec.mode==='submitted'?await runner.duel(db.submissions.find(s=>s.id===rec.submissionA),db.submissions.find(s=>s.id===rec.submissionB),opts,runMatch):await runMatch({...opts,bots:['greedy','random']});
    fs.writeFileSync(path.join(DATA,rec.id+'.json'),JSON.stringify(replay));
    rec.status='completed';rec.winner=replay.winner;rec.reason=replay.reason;rec.turns=replay.turns;rec.fault=replay.fault;rec.finishedAt=new Date().toISOString();
    if(rec.mode==='submitted'){for(const id of [rec.submissionA,rec.submissionB]){const s=db.submissions.find(x=>x.id===id);if(s&&s.status!=='Ready'){s.status='Ready'}}computeRatings(rec)}
  }catch(e){rec.status='failed';rec.error=String(e.message||e).slice(0,500);rec.reason=e.kind||'judge-error';rec.finishedAt=new Date().toISOString()}
  store.save();
}
async function work(){if(processing)return;processing=true;try{while(jobs.length)await executeJob(jobs.shift())}finally{processing=false}}
function submitJob(rec){jobs.push(rec);setImmediate(()=>{void work()})}
function originAllowed(req){const origin=req.headers.origin;if(!origin)return true;return origin===`http://localhost:${PORT}`||origin===`http://127.0.0.1:${PORT}`}
async function route(req,res,url){const pathname=url.pathname;
 if(!['GET','POST'].includes(req.method))return send(res,405,{error:'Method not allowed'});
 if(req.method==='POST'&&!originAllowed(req))return send(res,403,{error:'Cross-origin actions are disabled'});
 if(pathname==='/api/health'&&req.method==='GET')return send(res,200,{ok:true,version:'2.0.0',botExecution:'docker-sandbox',persistence:'JSON file',running:processing,queue:jobs.length});
 if(pathname==='/api/judge/status'&&req.method==='GET')return send(res,200,{dockerReady:runner.dockerAvailable(),images:runner.IMAGES,turnMs:runner.LIMITS.turnMs,queue:jobs.length,notice:'Local prototype only. Do not expose publicly without authentication and a dedicated isolated judge host.'});
 if(pathname==='/api/game'&&req.method==='GET')return send(res,200,{id:'ott-rps',version:'1.0.0',rows:8,columns:8,pieceTypes:['rock','paper','scissors'],capture:{rock:'scissors',scissors:'paper',paper:'rock'},maxMoves:200,goals:{p1:'h8',p2:'a1'}});
 if(pathname==='/api/overview'&&req.method==='GET')return send(res,200,{submissions:db.submissions.length,matches:db.matches.length,latest:db.matches.slice(0,5),registeredBotProfiles:Object.keys(db.ratings).length});
 if(pathname==='/api/submissions'&&req.method==='GET')return send(res,200,db.submissions);
 if(pathname==='/api/submissions'&&req.method==='POST'){
   if(!db.settings.submissionsOpen)return send(res,403,{error:'Submissions are closed'});
   const b=await body(req),name=String(b.name||''),lang=String(b.lang||''),version=String(b.version||'v1.0').slice(0,24),source=b.content;
   try{runner.safeFile(name,lang)}catch(e){return send(res,400,{error:e.message})}
   if(typeof source!=='string'||!source.length||Buffer.byteLength(source,'utf8')>500000)return send(res,400,{error:'Source must be 1–500 KB'});
   const id='SUB-'+crypto.randomBytes(4).toString('hex').toUpperCase(),dir=runner.botDirectory(id);
   fs.mkdirSync(dir,{recursive:true,mode:0o755});fs.chmodSync(dir,0o755);
   fs.writeFileSync(path.join(dir,name),source,{mode:0o644,flag:'wx'});
   const record={id,name,lang,version,sha256:crypto.createHash('sha256').update(source).digest('hex'),status:'Stored · awaiting sandbox build',date:new Date().toISOString()};
   db.submissions.unshift(record);store.save();return send(res,201,record);
 }
 if(pathname==='/api/leaderboard'&&req.method==='GET')return send(res,200,Object.entries(db.ratings).map(([id,stats])=>{const s=db.submissions.find(x=>x.id===id)||{};return {id,name:`${s.name||id} (${id.slice(-4)})`,lang:s.lang||'Unknown',...stats}}).sort((a,b)=>b.elo-a.elo));
 if(pathname==='/api/matches'&&req.method==='GET')return send(res,200,db.matches);
 if(/^\/api\/matches\/M-[A-F0-9]{8}$/.test(pathname)&&req.method==='GET'){const rec=matchMeta(pathname.slice('/api/matches/'.length));return rec?send(res,200,rec):send(res,404,{error:'Match not found'})}
 if(/^\/api\/matches\/M-[A-F0-9]{8}\/replay$/.test(pathname)&&req.method==='GET'){
   const id=pathname.split('/')[3],rec=matchMeta(id);
   if(!rec)return send(res,404,{error:'Match not found'});
   if(rec.status!=='completed')return send(res,409,{error:rec.status==='failed'?rec.error:`Match ${rec.status}`});
   return send(res,200,JSON.parse(fs.readFileSync(path.join(DATA,id+'.json'),'utf8')));
 }
 if(pathname==='/api/matches'&&req.method==='POST'){
   const b=await body(req),maxMoves=Number(b.maxMoves??200),pieces=Number(b.pieces??6),first=b.first||'Random';
   if(!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>1000||!Number.isInteger(pieces)||pieces<1||pieces>28||!['Random','Player A','Player B'].includes(first))return send(res,400,{error:'Invalid match configuration'});
   const ids=[b.submissionA,b.submissionB],mode=ids.every(x=>typeof x==='string')?'submitted':ids.some(Boolean)?'invalid':'demo';
   if(mode==='invalid')return send(res,400,{error:'Choose two submissions or use Demo match mode'});
   if(mode==='submitted'){
     if(ids[0]===ids[1])return send(res,400,{error:'Select two different submissions'});
     if(ids.some(id=>!db.submissions.some(s=>s.id===id)))return send(res,404,{error:'Submission not found'});
     if(!runner.dockerAvailable())return send(res,503,{error:'Docker is not available. Start Docker Desktop/Engine to run submitted bots. No unsafe host execution fallback.'});
   }
   if(jobs.length>=20)return send(res,429,{error:'Local match queue is full (20). Try again later'});
   const rec=recordMatch({...b,maxMoves,pieces,first});submitJob(rec);return send(res,202,rec);
 }
 if(pathname==='/api/settings'&&req.method==='GET')return send(res,200,db.settings);
 return send(res,404,{error:'API route not found'});
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/'))return await route(req,res,url);
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Method not allowed'});
  let rel=decodeURIComponent(url.pathname).replace(/^\/+/,''),file=path.resolve(PUB,rel||'index.html');
  if(!file.startsWith(PUB+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'File not found'});
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com"});fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)send(res,e.code&&Number.isInteger(e.code)?e.code:500,{error:e.message||'Unexpected error'})}
});
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`OTT Arena ready: http://${HOST}:${PORT} (local-only; Docker required for submitted bots)`));
module.exports=server;
