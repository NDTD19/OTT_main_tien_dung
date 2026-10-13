'use strict';
// Local Docker-based isolated bot runner. Never executes untrusted student source on the host.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const BOT_ROOT=path.resolve(__dirname,'../data/bots');
const LIMITS={turnMs:Math.max(300,Math.min(15000,Number(process.env.BOT_TURN_MS)||5000)),buildMs:45000,startMs:16000,stdoutBytes:65536,stderrBytes:8192};
const IMAGES={Python:'python:3.12-alpine',Java:'eclipse-temurin:21-jdk',JavaRun:'eclipse-temurin:21-jre',C:'gcc:13-bookworm',CRun:'debian:bookworm-slim'};
function error(message,kind='sandbox-error'){const e=new Error(message);e.kind=kind;return e}
function cleanId(id){if(!/^SUB-[A-F0-9]{8}$/.test(id))throw error('Invalid submission ID');return id}
function botDirectory(id){return path.join(BOT_ROOT,cleanId(id))}
function safeFile(name,lang){if(typeof name!=='string'||!(/^[A-Za-z][A-Za-z0-9_]{0,60}\.(py|java|c)$/.test(name)))throw error('Use an ASCII filename starting with a letter, with letters, numbers or underscores only.');const ext=name.split('.').pop();if(({py:'Python',java:'Java',c:'C'})[ext]!==lang)throw error('Filename does not match selected language');return name}
function dockerAvailable(){const r=spawnSync('docker',['info','--format','{{.ServerVersion}}'],{timeout:4500,stdio:'ignore'});return !r.error&&r.status===0}
function dockerArgs(name,{buildDir,sourceDir,writeBuild=false,memory='256m'}={}){
  const a=['run','--rm','-i','--name',name,'--network','none','--read-only','--cpus','1','--memory',memory,'--memory-swap',memory,'--pids-limit','64','--cap-drop=ALL','--security-opt','no-new-privileges','--user','65534:65534','--tmpfs','/tmp:rw,nosuid,size=64m','--env','HOME=/tmp','--env','PYTHONDONTWRITEBYTECODE=1','--workdir','/tmp'];
  if(sourceDir)a.push('--mount',`type=bind,source=${sourceDir},target=/src,readonly`);
  if(buildDir)a.push('--mount',`type=bind,source=${buildDir},target=/build${writeBuild?'':',readonly'}`);
  return a;
}
function runLimited(args,timeoutMs,kind='build-error'){
  return new Promise((resolve,reject)=>{
    const child=spawn('docker',args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
    let out='',err='',ended=false;
    const timer=setTimeout(()=>fail(error('Build timeout',kind)),timeoutMs);
    function fail(e){if(ended)return;ended=true;clearTimeout(timer);child.kill('SIGKILL');reject(e)}
    child.on('error',e=>fail(error('Cannot invoke Docker: '+e.message,'sandbox-unavailable')));
    for(const [stream,key] of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',chunk=>{
      if(key==='out')out=(out+chunk.toString()).slice(-10000);else err=(err+chunk.toString()).slice(-10000);
    });
    child.on('close',code=>{if(ended)return;ended=true;clearTimeout(timer);if(code!==0)reject(error((err||out||'Build failed').slice(0,1500),kind));else resolve({out,err})});
  });
}
const imagePromises=new Map();
async function ensureImage(image){
 if(imagePromises.has(image))return imagePromises.get(image);
 const p=(async()=>{
   const r=spawnSync('docker',['image','inspect',image],{timeout:5000,stdio:'ignore'});
   if(r.status!==0)await runLimited(['pull',image],240000,'sandbox-unavailable');
 })();
 imagePromises.set(image,p);
 try{await p}catch(e){imagePromises.delete(image);throw e}
}
function stopContainer(name){const r=spawn('docker',['rm','-f',name],{stdio:'ignore',windowsHide:true});r.on('error',()=>{});r.unref()}
async function ensureBuilt(submission){
  const id=cleanId(submission.id),name=safeFile(submission.name,submission.lang),base=botDirectory(id),buildDir=path.join(base,'build'),marker=path.join(base,'build.ok');
  if(!fs.existsSync(path.join(base,name)))throw error('Submission source is missing','build-error');
  if(fs.existsSync(marker))return {base,buildDir,name,lang:submission.lang};
  if(!dockerAvailable())throw error('Docker Desktop/Engine is not running. Start Docker and retry. Student code is never executed outside the sandbox.','sandbox-unavailable');
  fs.mkdirSync(buildDir,{recursive:true,mode:0o777});fs.chmodSync(buildDir,0o777);
  const container='ott-build-'+crypto.randomBytes(6).toString('hex');
  let image,command;
  switch(submission.lang){
    case 'Python': image=IMAGES.Python;command=['python3','-c',`import ast;ast.parse(open('/src/${name}',encoding='utf-8').read())`];break;
    case 'Java': image=IMAGES.Java;command=['javac','-encoding','UTF-8','-d','/build',`/src/${name}`];break;
    case 'C':image=IMAGES.C;command=['gcc','-std=c11','-O2','-Wall','-Wextra',`/src/${name}`,'-o','/build/bot'];break;
    default:throw error('Unsupported bot language');
  }
  await ensureImage(image);
  try{await runLimited([...dockerArgs(container,{sourceDir:base,buildDir,writeBuild:true,memory:'512m'}),image,...command],LIMITS.buildMs)}catch(e){stopContainer(container);throw e}
  fs.writeFileSync(marker,submission.sha256+'\n',{mode:0o600});
  return {base,buildDir,name,lang:submission.lang};
}
class BotSession{
  constructor(submission){this.submission=submission;this.id=crypto.randomBytes(6).toString('hex');this.name='ott-run-'+this.id;this.child=null;this.lines=[];this.waiter=null;this.stdoutBytes=0;this.stderr='';this.buffer='';this.dead=null;}
  async start(){
    const built=await ensureBuilt(this.submission);
    let image,command;
    if(built.lang==='Python'){image=IMAGES.Python;command=['python3','-u',`/src/${built.name}`]}
    else if(built.lang==='Java'){image=IMAGES.JavaRun;command=['java','-XX:MaxRAMPercentage=65','-cp','/build',built.name.slice(0,-5)]}
    else{image=IMAGES.CRun;command=['/build/bot']}
    const child=spawn('docker',[...dockerArgs(this.name,{sourceDir:built.base,buildDir:built.buildDir}),image,...command],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child=child;
    child.stdout.on('data',b=>this.onOutput(b));
    child.stderr.on('data',b=>{this.stderr=(this.stderr+b.toString()).slice(-LIMITS.stderrBytes)});
    child.on('error',e=>this.terminate(error('Docker failed: '+e.message,'sandbox-unavailable')));
    child.on('close',code=>this.terminate(error(`Bot process exited (${code}). ${this.stderr}`.slice(0,350),'bot-crash')));
    return this;
  }
  onOutput(chunk){
    if(this.dead)return;
    this.stdoutBytes+=chunk.length;
    if(this.stdoutBytes>LIMITS.stdoutBytes)return this.terminate(error('Bot stdout exceeded 64 KB for one action','bot-output-limit'));
    this.buffer+=chunk.toString('utf8');
    if(this.buffer.length>LIMITS.stdoutBytes)return this.terminate(error('Bot produced an oversized response','bot-output-limit'));
    let i;while((i=this.buffer.indexOf('\n'))!==-1){const line=this.buffer.slice(0,i).trim();this.buffer=this.buffer.slice(i+1);this.deliver(line)}
  }
  deliver(line){if(!line)return; if(this.waiter){const w=this.waiter;this.waiter=null;clearTimeout(w.timer);w.resolve(line)}else{this.lines.push(line);if(this.lines.length>1)this.terminate(error('Bot printed multiple actions for one observation','bot-protocol-error'))}}
  ask(observation){
    if(this.dead)return Promise.reject(this.dead);
    if(this.waiter||this.lines.length||this.buffer.trim())return Promise.reject(error('Unexpected bot output before observation','bot-protocol-error'));
    this.stdoutBytes=0;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.terminate(error('Bot exceeded per-turn wall-clock safety limit','bot-timeout')),LIMITS.turnMs);
      this.waiter={resolve,reject,timer};
      this.child.stdin.write(JSON.stringify(observation)+'\n',e=>{if(e)this.terminate(error('Could not send observation to bot','bot-crash'))});
    }).then(line=>{
      let action;try{action=JSON.parse(line)}catch{throw error('Bot returned invalid JSON','bot-protocol-error')}
      if(action&&typeof action==='object'&&action.action)action=action.action;
      if(!action||!Array.isArray(action.from)||!Array.isArray(action.to))throw error('Bot must return {"from":[row,col],"to":[row,col]}','bot-protocol-error');
      return action;
    });
  }
  terminate(e){if(this.dead)return;this.dead=e||error('Bot stopped','bot-crash');if(this.waiter){const w=this.waiter;this.waiter=null;clearTimeout(w.timer);w.reject(this.dead)};if(this.child){this.child.kill('SIGKILL');stopContainer(this.name)}}
  stop(){this.terminate(error('Session ended','bot-stopped'))}
}
async function prepare(submissions){for(const s of submissions){await ensureBuilt(s);await ensureImage(s.lang==='Java'?IMAGES.JavaRun:s.lang==='C'?IMAGES.CRun:IMAGES.Python)}}
async function duel(subA,subB,options,runMatch){
  await prepare([subA,subB]);
  const left=new BotSession(subA),right=new BotSession(subB);
  try{
    await left.start();await right.start();
    const result=await runMatch({...options,decide:async ({board,owner,moves,turn})=>{
      const session=owner==='p1'?left:right;
      const obs={protocolVersion:'1.0',game:'ott-rps',owner,turn,board,moves,legalActions:moves,goal:owner==='p1'?[0,7]:[7,0]};
      return session.ask(obs);
    }});
    return result;
  }finally{left.stop();right.stop()}
}
module.exports={dockerAvailable,botDirectory,safeFile,ensureBuilt,BotSession,duel,LIMITS,IMAGES};
