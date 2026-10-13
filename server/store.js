'use strict';
const fs=require('node:fs');const path=require('node:path');
const dir=path.resolve(__dirname,'../data'),file=path.join(dir,'db.json');fs.mkdirSync(dir,{recursive:true});
const defaults=()=>({submissions:[],matches:[],ratings:{},settings:{submissionsOpen:true}});
let db;try{db=JSON.parse(fs.readFileSync(file,'utf8'))}catch{db=defaults()}
function save(){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,file)}
function get(){return db}
module.exports={get,save};
