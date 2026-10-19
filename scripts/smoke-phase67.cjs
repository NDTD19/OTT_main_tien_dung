'use strict';
const origin=process.env.SMOKE_BASE_URL||'http://127.0.0.1:3001';
async function check(method,url,expected){
  const response=await fetch(origin+url,{method});
  let data;try{data=await response.json();}catch{data=null;}
  if(response.status!==expected)throw new Error(`${method} ${url} expected ${expected} got ${response.status}: ${JSON.stringify(data)}`);
  console.log(`OK ${response.status}: ${method} ${url}`);
  return data;
}
async function main(){
  const health=await check('GET','/api/health',200);
  if(health.persistence!=='PostgreSQL')throw new Error('Wrong backend: persistence must be PostgreSQL');
  await check('GET','/api/overview',200);
  await check('GET','/api/submissions',200);
  await check('GET','/api/matches',200);
  await check('GET','/api/leaderboard',200);
  await check('GET','/api/settings',200);
  await check('GET','/api/auth/me',401);
  await check('POST','/api/matches',401);
  await check('POST','/api/auth/register',403);
  console.log('Smoke test PASSED. Does not test real bot execution or authorized login.');
}
main().catch(e=>{console.error('Smoke test FAILED:',e.message);process.exitCode=1;});
