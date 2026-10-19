'use strict';
/** Isolated PostgreSQL-based API for phase 6.7. Existing server/index.js remains untouched. */
require('dotenv/config');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {WebSocketServer}=require('ws');
const repo=require('./pg/repository');
const adapter=require('./pg/adapters');
const jobs=require('./pg/jobs');
const runner=require('./bot-runner');
const ROOT=path.resolve(__dirname,'..');
const PUB=path.join(ROOT,'public');
const DATA=path.join(ROOT,'data');
const PORT=Number(process.env.PORT||3000);
const HOST=process.env.HOST||'127.0.0.1';
const JWT_SECRET=process.env.JWT_SECRET;
const ALLOW_SELF_REGISTER=process.env.NODE_ENV==='development'&&process.env.ALLOW_SELF_REGISTER==='true';
const MAX_BODY=760000;
if(!JWT_SECRET||JWT_SECRET.length<32)throw new Error('JWT_SECRET must be set to a persistent secret of at least 32 characters in .env');
if(!Number.isInteger(PORT)||PORT<1||PORT>65535)throw new Error('Invalid PORT');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const json=(res,status,value)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}};
const fail=(code,msg)=>Object.assign(new Error(msg),{status:code});
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{const originUrl=new URL(origin);return ['http:','https:'].includes(originUrl.protocol)&&originUrl.host===req.headers.host;}catch{return false;}}
async function parseBody(req){return new Promise((resolve,reject)=>{let length=0;const chunks=[];let rejected=false;req.on('data',b=>{length+=b.length;if(rejected)return;if(length>MAX_BODY){rejected=true;reject(fail(413,'Payload too large'));req.resume();}else chunks.push(b);});req.on('end',()=>{if(rejected)return;try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();resolve(parsed);}catch{reject(fail(400,'Invalid JSON object'));}});req.on('error',reject);});}
function makeToken(user){return jwt.sign({sub:user.username},JWT_SECRET,{expiresIn:'7d'});}
async function currentUser(req){const header=req.headers.authorization||'';if(!header.startsWith('Bearer '))return null;try{const token=jwt.verify(header.slice(7),JWT_SECRET,{algorithms:['HS256']});if(typeof token.sub!=='string')return null;const user=await repo.findUser(token.sub);return user?.isActive?user:null;}catch{return null;}}
const attempts=new Map();
function throttle(req,username){const now=Date.now();const key=(req.socket.remoteAddress||'unknown')+':'+username;const state=attempts.get(key);if(state&&state.until>now&&state.count>=10)throw fail(429,'Too many login attempts. Try later.');if(attempts.size>2000)attempts.clear();return {key,now};}
function recordFailed({key,now}){const old=attempts.get(key);const current=old&&old.until>now?old:{count:0,until:now+600000};attempts.set(key,{count:current.count+1,until:current.until});}
let wss;
function broadcast(event,data){if(!wss)return;const msg=JSON.stringify({event,...data});for(const client of wss.clients)if(client.readyState===1){try{client.send(msg);}catch{}}}
jobs.onBroadcast(broadcast);
const matchRE=/^\/api\/matches\/(M-[A-F0-9]{8})(?:\/(replay))?$/;
async function route(req,res,url){
  const p=url.pathname;
  if(!['GET','POST'].includes(req.method))throw fail(405,'Method not allowed');
  if(req.method==='POST'&&!sameOrigin(req))throw fail(403,'Cross-origin actions are disabled');
  if(p==='/api/health'&&req.method==='GET'){
    await repo.prisma.$queryRaw`SELECT 1`;
    return json(res,200,{ok:true,version:'2.1.0-pg',persistence:'PostgreSQL',botExecution:'docker-sandbox',...jobs.publicInfo()});
  }
  if(p==='/api/judge/status'&&req.method==='GET')return json(res,200,{dockerReady:runner.dockerAvailable(),images:runner.IMAGES,turnMs:runner.LIMITS.turnMs,...jobs.publicInfo()});
  if(p==='/api/game'&&req.method==='GET')return json(res,200,{id:'ott-rps',version:'1.0.0',rows:8,columns:8,pieceTypes:['rock','paper','scissors'],capture:{rock:'scissors',scissors:'paper',paper:'rock'},maxMoves:200,goals:{p1:'h8',p2:'a1'}});
  if(p==='/api/overview'&&req.method==='GET')return json(res,200,await repo.overview(jobs.publicInfo().activeJobs,jobs.publicInfo().pendingJobs,jobs.publicInfo().maxConcurrent));
  if(p==='/api/auth/register'&&req.method==='POST'){
    if(!ALLOW_SELF_REGISTER)throw fail(403,'Self-registration is disabled. Ask your organizer for an account.');
    const b=await parseBody(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
    if(!/^[a-z0-9_]{2,32}$/.test(username)||password.length<8||password.length>128)throw fail(400,'Invalid username or password (minimum 8 characters)');
    const hash=await bcrypt.hash(password,12);
    try{const user=await repo.createUser(username,hash);return json(res,201,{token:makeToken(user),username:user.username});}
    catch(e){if(e.code==='P2002')throw fail(409,'Username already exists');throw e;}
  }
  if(p==='/api/auth/login'&&req.method==='POST'){
    const b=await parseBody(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
    const limiter=throttle(req,username);
    if(username.length>32||password.length>128)throw fail(401,'Invalid username or password');
    const user=await repo.findUser(username);
    const okay=user?.isActive?await bcrypt.compare(password,user.passwordHash):false;
    if(!okay){recordFailed(limiter);throw fail(401,'Invalid username or password');}
    attempts.delete(limiter.key);
    return json(res,200,{token:makeToken(user),username:user.username});
  }
  if(p==='/api/auth/me'&&req.method==='GET'){
    const user=await currentUser(req);if(!user)throw fail(401,'Authentication required');
    const [bots,recentMatches]=await Promise.all([repo.listUserSubmissions(user.id),repo.listMyMatches(user.id)]);
    return json(res,200,{username:user.username,role:user.role,bots,recentMatches});
  }
  if(p==='/api/submissions'&&req.method==='GET')return json(res,200,await repo.listSubmissions());
  if(p==='/api/submissions'&&req.method==='POST'){
    const user=await currentUser(req);if(!user)throw fail(401,'Authentication required');
    if(!(await repo.getSettings()).submissionsOpen)throw fail(403,'Submissions are closed');
    const b=await parseBody(req),name=b.name,lang=b.lang,version=String(b.version||'v1.0').slice(0,24),source=b.content;
    try{runner.safeFile(name,lang);}catch(e){throw fail(400,e.message);}
    if(typeof source!=='string'||Buffer.byteLength(source,'utf8')<1||Buffer.byteLength(source,'utf8')>500000)throw fail(400,'Source must be 1-500 KB');
    const id='SUB-'+crypto.randomBytes(4).toString('hex').toUpperCase(),dir=runner.botDirectory(id);
    fs.mkdirSync(dir,{recursive:true,mode:0o755});fs.chmodSync(dir,0o755);
    try{
      fs.writeFileSync(path.join(dir,name),source,{flag:'wx',mode:0o644});
      var created=await repo.storeSubmission({id,userId:user.id,filename:name,language:lang,version,
        sha256:crypto.createHash('sha256').update(source).digest('hex'),sourcePath:`data/bots/${id}/${name}`});
    }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
    // Autoplay one local PRACTICE match for a newly submitted bot when Docker is ready.
    try{
      const opp=await repo.selectOpponent(id);
      if(opp&&runner.dockerAvailable()&&jobs.publicInfo().activeJobs+jobs.publicInfo().pendingJobs<50){
        const swap=crypto.randomInt(2)===0;
        const match=await repo.newMatch({kind:'PRACTICE',createdById:user.id,submissionAId:swap?id:opp.id,submissionBId:swap?opp.id:id,maxMoves:200,pieces:6,first:'Random',autoMatch:true});
        jobs.submit(match.id);
        return json(res,201,{...created,autoMatch:match.id});
      }
    }catch(e){console.error('[Auto-match skipped]',e.message);}
    return json(res,201,created);
  }
  if(p==='/api/leaderboard'&&req.method==='GET')return json(res,200,await repo.leaderboard());
  if(p==='/api/matches'&&req.method==='GET')return json(res,200,await repo.listMatches());
  const mm=p.match(matchRE);
  if(mm&&req.method==='GET'){
    const row=await repo.findMatch(mm[1]);if(!row)throw fail(404,'Match not found');
    if(!mm[2])return json(res,200,adapter.match(row));
    if(row.status!=='COMPLETED')throw fail(409,'Match '+row.status.toLowerCase());
    // Never use request-controlled paths; allow only canonical replay path in /data.
    if(row.replayPath!==`data/${row.id}.json`)throw fail(409,'Replay path is not canonical');
    const filename=path.join(DATA,row.id+'.json');
    let buffer;try{buffer=fs.readFileSync(filename);}catch{throw fail(404,'Replay missing');}
    const digest=crypto.createHash('sha256').update(buffer).digest('hex');
    if(digest!==row.replayHash)throw fail(409,'Replay integrity mismatch');
    try{return json(res,200,JSON.parse(buffer.toString('utf8')));}catch{throw fail(409,'Invalid replay data');}
  }
  if(p==='/api/matches'&&req.method==='POST'){
    const user=await currentUser(req);if(!user)throw fail(401,'Authentication required');
    const b=await parseBody(req),maxMoves=Number(b.maxMoves??200),pieces=Number(b.pieces??6),first=b.first||'Random';
    if(!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>1000||!Number.isInteger(pieces)||pieces<1||pieces>28||!['Random','Player A','Player B'].includes(first))throw fail(400,'Invalid match configuration');
    if(jobs.publicInfo().activeJobs+jobs.publicInfo().pendingJobs>=100)throw fail(429,'Match queue is full');
    if(b.submissionA&&!b.submissionB){
      const mine=await repo.findSubmission(String(b.submissionA));
      if(!mine||mine.userId!==user.id)throw fail(403,'You do not own this submission');
      if(!runner.dockerAvailable())throw fail(503,'Docker is not available');
      const opponent=await repo.selectOpponent(mine.id);
      if(!opponent)throw fail(400,'No other bots available');
      const swap=crypto.randomInt(2)===0;
      const m=await repo.newMatch({kind:'PRACTICE',createdById:user.id,submissionAId:swap?mine.id:opponent.id,submissionBId:swap?opponent.id:mine.id,maxMoves,pieces,first});
      jobs.submit(m.id);return json(res,202,{...m,opponent:opponent.filename,opponentId:opponent.id});
    }
    if(b.submissionA||b.submissionB)throw fail(403,'Manual bot selection is disabled. Use Challenge mode.');
    const m=await repo.newMatch({kind:'DEMO',createdById:user.id,maxMoves,pieces,first,
      a:typeof b.a==='string'?b.a.slice(0,64):'Greedy Bot',b:typeof b.b==='string'?b.b.slice(0,64):'Random Bot'});
    jobs.submit(m.id);return json(res,202,m);
  }
  if(p==='/api/settings'&&req.method==='GET')return json(res,200,await repo.getSettings());
  throw fail(404,'API route not found');
}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))return await route(req,res,url);
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
    const rel=decodeURIComponent(url.pathname).replace(/^\/+/,''),file=path.resolve(PUB,rel||'index.html');
    if(!file.startsWith(PUB+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'File not found'});
    res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com"});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(file).pipe(res);
  }catch(e){
    console.error('[API]',req.method,req.url,e.status?e.message:e);
    if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Internal server error'});
  }
});
wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(ws,req)=>{
  if(!sameOrigin(req)){ws.close(1008,'Invalid origin');return;}
  ws.send(JSON.stringify({event:'welcome',...jobs.publicInfo()}));
  ws.on('error',()=>{});
});
async function main(){
  await repo.prisma.$connect();
  await repo.prisma.appSetting.findMany({take:1}); // Fails fast if compatibility migration is missing.
  await jobs.recoverOnStart();
  server.listen(PORT,HOST,()=>console.log(`OTTv2 PostgreSQL API: http://${HOST}:${PORT}`));
}
if(require.main===module)main().catch(async e=>{console.error('Startup failed:',e);await repo.prisma.$disconnect();process.exitCode=1;});
module.exports=server;
