'use strict';
// Adds safe, known example sources to the local submissions list. Does not execute source.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const store=require('./store'),{botDirectory,safeFile}=require('./bot-runner');
const db=store.get();
const files=[['greedy.py','Python'],['random.py','Python'],['Main.java','Java'],['bot.c','C'],['speed_rusher.py','Python'],['tactical_hunter.py','Python']];
for(const [name,lang] of files){
 const content=fs.readFileSync(path.join(__dirname,'../examples/bots',name),'utf8');
 const sha256=crypto.createHash('sha256').update(content).digest('hex');
 if(db.submissions.some(s=>s.sha256===sha256)){console.log('Already seeded:',name);continue}
 safeFile(name,lang);
 const id='SUB-'+crypto.randomBytes(4).toString('hex').toUpperCase();
 const dir=botDirectory(id);fs.mkdirSync(dir,{recursive:true,mode:0o755});fs.chmodSync(dir,0o755);
 fs.writeFileSync(path.join(dir,name),content,{mode:0o644,flag:'wx'});
 db.submissions.unshift({id,name,lang,version:'example-v1',sha256,status:'Stored · awaiting sandbox build',date:new Date().toISOString()});
 console.log('Seeded:',id,name);
}
store.save();
