'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const scripts=path.resolve(__dirname,'../public');
function makeContext(){
 const app={innerHTML:''};
 const ctx={console,location:{hash:''},setTimeout,clearTimeout,setInterval,clearInterval,
  localStorage:{getItem:()=>null,setItem:()=>{}},
  window:{scrollTo:()=>{},addEventListener:()=>{}},
  document:{documentElement:{className:''},getElementById:id=>id==='app'?app:null,querySelector:()=>null,createElement:()=>({textContent:''}),body:{append:()=>{}}},
  fetch:async url=>({ok:true,json:async()=>url.includes('/submissions')?[{id:'SUB-A1B2C3D4',name:'bot.c',lang:'C',date:new Date().toISOString(),status:'Stored',version:'v1'}]:url.includes('/matches')?[]:url.includes('/leaderboard')?[]:{dockerReady:false}})
 };
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(scripts,'app.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(path.join(scripts,'api.js'),'utf8'),ctx);
 return {app,ctx};
}
test('all major frontend views render without a browser runtime error',()=>{
 const {app,ctx}=makeContext();
 for(const page of ['overview','arena','submit','leaderboard','tournaments','admin']){
  vm.runInContext(`go('${page}')`,ctx);
  assert.ok(app.innerHTML.includes('OTT'));
 }
 assert.ok(app.innerHTML.includes('Submitted Bot vs Submitted Bot'));
 assert.ok(app.innerHTML.includes('id="submissionA"'));
 assert.ok(app.innerHTML.includes('id="submissionB"'));
});
test('server data replaces mock matches with empty state and avoids fake replay',async()=>{
 const {app,ctx}=makeContext();
 await vm.runInContext('loadBackend()',ctx);
 vm.runInContext("go('arena')",ctx);
 assert.ok(app.innerHTML.includes('No match replays yet'));
});
