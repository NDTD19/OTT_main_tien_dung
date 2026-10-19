'use strict';
/** One-time safe patch: hide obsolete registration screen in legacy UI. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const target=path.resolve(__dirname,'../public/api.js');
const original=fs.readFileSync(target,'utf8');
const marker='// Phase 6.7: login-only interface; accounts are provisioned by organizers.';
if(original.includes(marker)){console.log('Login-only UI patch already applied.');process.exit(0);}
const anchor='function setupAuthIntegration() {';
if(original.split(anchor).length!==2)throw Error('UI structure differs from reviewed GitHub source; not modifying file.');
const inject=`${marker}
const _phase67LoginRender = renderLoginPage;
renderLoginPage = function() {
  authPageMode = 'login';
  _phase67LoginRender();
  document.querySelector('.login-tabs')?.remove();
  const footer = document.querySelector('.login-card > div[style*="margin-top:22px"]');
  if (footer) footer.innerHTML = '<p class="tiny muted" style="text-align:center">Tài khoản được Ban tổ chức cung cấp.</p>';
};
const _phase67SwitchAuth = switchAuthMode;
switchAuthMode = function(mode) {
  if (mode !== 'login') return;
  return _phase67SwitchAuth(mode);
};

`;
const dest=path.join(os.homedir(),'ottv2-backups','phase67-public-api.js.bak');
fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
if(!fs.existsSync(dest))fs.writeFileSync(dest,original,{mode:0o600});
fs.writeFileSync(target,original.replace(anchor,inject+anchor));
console.log('Login-only UI applied. Backup:',dest);
