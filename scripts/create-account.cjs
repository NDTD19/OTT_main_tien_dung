'use strict';
require('dotenv/config');
const bcrypt=require('bcryptjs');
const prisma=require('../server/db');
const username=String(process.argv[2]||'').trim().toLowerCase();
const role=String(process.argv[3]||'STUDENT').toUpperCase();
const password=process.env.OTT_NEW_PASSWORD||'';
async function main(){
  if(!/^[a-z0-9_]{2,32}$/.test(username))throw new Error('Usage: node scripts/create-account.cjs <username> <STUDENT|JUDGE|ADMIN>');
  if(!['STUDENT','JUDGE','ADMIN'].includes(role))throw new Error('Unknown role');
  if(password.length<8||password.length>128)throw new Error('Password must have 8-128 characters; provide it via OTT_NEW_PASSWORD');
  if(await prisma.user.findUnique({where:{username}}))throw new Error('Account exists; no changes made');
  const hash=await bcrypt.hash(password,12);
  const created=await prisma.user.create({data:{username,passwordHash:hash,role}});
  console.log(`Created ${created.username} (${created.role}); id=${created.id}`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
