'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createResourceRecorder}=require('../security/diagnostics');
test('resource diagnostics records roles and PIDs without URLs, credentials or chat',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'terino-resources-'));
  try {
    const recorder=createResourceRecorder({fs,directory,rootProcessId:100,version:'test'});
    const window={isDestroyed:()=>false,isVisible:()=>true,webContents:{id:2,getOSProcessId:()=>200,getURL:()=>'?token=SECRET'}};
    assert(recorder.record([{role:'player',accountId:'account-1',window,manual:false,token:'SECRET',chat:'PRIVATE'}]));
    const file=path.join(directory,'resources-log.jsonl');const raw=fs.readFileSync(file,'utf8');const entry=JSON.parse(raw);
    assert(!/SECRET|PRIVATE|token|chat|url/i.test(raw));
    assert.equal(entry.rootProcessId,100);assert.equal(entry.resources[0].rendererProcessId,200);
    assert.equal(entry.resources[0].role,'player');assert.equal(entry.resources[0].accountId,'account-1');
    recorder.record([{role:'player',accountId:'account-1',window,manual:false}]);
    assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,1,'unchanged resources do not generate disk writes');
    recorder.record([]);assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,2);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('resource diagnostics rotates bounded output and ignores invalid resources',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'terino-resources-'));
  try {
    const file=path.join(directory,'resources-log.jsonl');fs.writeFileSync(file,'old output\n');
    const recorder=createResourceRecorder({fs,directory,rootProcessId:100,version:'test',maxBytes:1});
    recorder.record([{role:'unknown',accountId:'other',window:{}}]);
    assert(fs.existsSync(file+'.old'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).resources,[]);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
