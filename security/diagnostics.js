'use strict';
const path=require('node:path');
const ROLES=new Set(['main','login','player','store','chest']);

function createResourceRecorder({fs,directory,rootProcessId,version,maxBytes=5*1024*1024}) {
  let previous=null;
  function record(resources) {
    try {
      const rows=[];
      for(const item of resources.slice(0,500)) {
        const win=item.window;
        if(!ROLES.has(item.role) || (item.role!=='main'&&!/^account-[1-4]$/.test(item.accountId)) || !win || win.isDestroyed())continue;
        const wc=win.webContents;
        rows.push({role:item.role,accountId:item.role==='main'?null:item.accountId,webContentsId:wc.id,
          rendererProcessId:wc.getOSProcessId(),visible:win.isVisible(),manual:!!item.manual});
      }
      const signature=JSON.stringify(rows);
      if(signature===previous)return true;
      const filename=path.join(directory,'resources-log.jsonl');
      fs.mkdirSync(directory,{recursive:true});
      if(fs.existsSync(filename)&&fs.statSync(filename).size>maxBytes) {
        if(fs.existsSync(filename+'.old'))fs.unlinkSync(filename+'.old');
        fs.renameSync(filename,filename+'.old');
      }
      fs.appendFileSync(filename,JSON.stringify({utc:new Date().toISOString(),version,rootProcessId,resources:rows})+'\n');
      previous=signature;return true;
    }catch{return false;}
  }
  return {record};
}
module.exports={createResourceRecorder};
