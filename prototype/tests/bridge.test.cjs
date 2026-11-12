'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBridge}=require('../bridge.js');
test('commands capture source account across A B A switches', async()=>{
  let resolve; const calls=[];
  const bridge=createBridge((command,args)=>{ calls.push({command,args}); return command==='account_command'?new Promise(r=>resolve=r):Promise.resolve({}); },async()=>()=>{});
  const pending=bridge.addChannel('alpha');
  await bridge.selectAccount('account-2'); await bridge.selectAccount('account-1');
  resolve({accountId:'account-1',result:{ok:true}}); assert.equal(await pending,null);
  assert.equal(calls[0].args.id,'account-1');
  assert.deepEqual(calls.filter(x=>x.command==='select_account').map(x=>x.args.id),['account-2','account-1']);
});
test('remote payload from another account is not dispatched',async()=>{
  let handler;let count=0;
  const bridge=createBridge(async()=>({}),async(name,cb)=>{if(name==='chat')handler=cb;return()=>{};});
  bridge.onChat(()=>count++); await Promise.resolve();
  handler({payload:{accountId:'account-2',payload:{slug:'alpha'}}});
  assert.equal(count,0);
  handler({payload:{accountId:'account-1',payload:{slug:'alpha'}}});assert.equal(count,1);
});
test('out of scope functions reject without invoking native commands',async()=>{
  let count=0; const bridge=createBridge(async()=>count++,async()=>()=>{});
  await assert.rejects(()=>bridge.getReport(),/protótipo/); assert.equal(count,0);
});
test('persisted selection owns the first command after restart',async()=>{
  const calls=[];const bridge=createBridge(async(command,args)=>{calls.push({command,args});return command==='snapshot'?{accountId:'account-3'}:{result:{ok:true}};},async()=>()=>{});
  await bridge.getState();await bridge.addChannel('alpha');assert.equal(calls[1].args.id,'account-3');
});
