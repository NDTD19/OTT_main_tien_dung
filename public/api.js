/* OTT Arena local API bridge. Open through the Node server, not as file://. */
const api={
 async call(url,options={}){const response=await fetch('/api'+url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const value=await response.json();if(!response.ok)throw Error(value.error||'Request failed');return value},
 get(path){return this.call(path)},
 post(path,payload){return this.call(path,{method:'POST',body:JSON.stringify(payload)})}
};
let serverMatches=[];
let watchingMatch=false;
async function loadBackend(){
 try{
  const [sub,match,rank]=await Promise.all([api.get('/submissions'),api.get('/matches'),api.get('/leaderboard')]);
  state.submissions=sub.map(s=>({...s,date:new Date(s.date).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'})}));
  serverMatches=match;
  // Display only authoritative server matches (never mix mock results into server history).
  matches.splice(0,matches.length,...match.map(m=>({
    ...m,score:m.status==='completed'?(m.winner==='p1'?'1 – 0':m.winner==='p2'?'0 – 1':'½ – ½'):m.status,
    type:m.mode==='submitted'?'Submitted bots':'Built-in demo',
    time:new Date(m.createdAt).toLocaleString('en-US'),turns:m.turns||0
  })));
  if(match.length){
    const completed=match.find(m=>m.status==='completed');
    if(completed&&(!match.some(m=>m.id===state.selectedMatch)||!replayCache[state.selectedMatch])){
      state.selectedMatch=completed.id;
      try{replayCache[completed.id]=await api.get('/matches/'+encodeURIComponent(completed.id)+'/replay')}catch(e){console.warn('Replay not loaded:',e.message)}
    }
  }
  players.splice(0,players.length,...rank.map((p,i)=>[String(i+1).padStart(2,'0'),p.name,p.name.slice(0,2).toUpperCase(),p.lang,p.elo,'+0',['purple','blue','orange','pink'][i%4]]));
  state.serverOnline=true;render();
 }catch(e){state.serverOnline=false;console.warn('Backend unavailable:',e.message);notice('Backend unavailable. Start the Node server to enable live features.')}
}
const demoReplayBuilder=buildReplay;
buildReplay=function(id){if(replayCache[id])return replayCache[id];if(serverMatches.some(m=>m.id===id))return {snapshots:[initialOTT(1)],events:[],winner:null};return demoReplayBuilder(id)};
async function openServerMatch(id){
 try{
  state.playing=false;clearInterval(timer);
  const replay=await api.get('/matches/'+encodeURIComponent(id)+'/replay');
  replayCache[id]=replay;state.selectedMatch=id;state.play=0;go('arena');
 }catch(e){notice('Replay not ready: '+e.message)}
}
openMatch=function(id){
 if(serverMatches.some(m=>m.id===id))return openServerMatch(id);
 state.selectedMatch=id;state.play=0;state.playing=false;clearInterval(timer);go('arena');
};
async function waitForMatch(id){
 if(watchingMatch)return notice('Another match is already being watched.');
 watchingMatch=true;
 try{
  for(let attempts=0;attempts<240;attempts++){
   const match=await api.get('/matches/'+encodeURIComponent(id));
   if(match.status==='completed'){await loadBackend();await openServerMatch(id);notice(`Match completed · ${match.reason}`);return}
   if(match.status==='failed'){await loadBackend();notice(`Match failed: ${match.error||match.reason}`);return}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  notice('The match is still running. Check Match Arena for its status.');
 }catch(e){notice('Could not track match: '+e.message)}finally{watchingMatch=false}
}
async function createServerMatch(){
 const a=document.getElementById('playerA')?.value||'Greedy Bot',b=document.getElementById('playerB')?.value||'Random Bot';
 try{
  const job=await api.post('/matches',{a,b,maxMoves:Number(state.maxMoves)||200,first:state.firstMove,pieces:6});
  notice('Built-in demo match queued.');await loadBackend();await waitForMatch(job.id)
 }catch(e){notice('Could not create demo match: '+e.message)}
}
async function createSubmittedMatch(){
 const submissionA=document.getElementById('submissionA')?.value,submissionB=document.getElementById('submissionB')?.value;
 const maxMoves=Number(document.getElementById('duelMaxMoves')?.value||200),first=document.getElementById('duelFirst')?.value||'Random';
 if(!submissionA||!submissionB||submissionA===submissionB)return notice('Choose two different uploaded bots.');
 if(!Number.isInteger(maxMoves)||maxMoves<1||maxMoves>1000)return notice('Move limit must be 1–1000.');
 try{
  const job=await api.post('/matches',{submissionA,submissionB,maxMoves,first,pieces:6});
  notice(`Running uploaded bots · ${job.id}. The first run may download Docker images.`);
  await loadBackend();await waitForMatch(job.id);
 }catch(e){notice('Unable to start submitted-bot match: '+e.message)}
}
async function checkJudge(){try{const status=await api.get('/judge/status');state.dockerReady=status.dockerReady;const el=document.getElementById('judgeEnvironment');if(el)el.textContent=status.dockerReady?'● Docker sandbox ready':'● Start Docker Desktop to run submitted bots'}catch{state.dockerReady=false}}
window.addEventListener('hashchange',()=>{if(location.hash==='#admin')void checkJudge()});
window.addEventListener('DOMContentLoaded',()=>{void loadBackend();void checkJudge()});
