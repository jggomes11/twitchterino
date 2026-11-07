'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createAccountViewGuard}=require('../security/account-view');

test('late state and report responses cannot replace a newly selected account, including A to B to A', async()=>{
 const view=createAccountViewGuard();let release;
 const delayed=view.run(()=>new Promise(resolve=>{release=resolve;}));
 const previous=view.select('account-2'); view.select('account-1');
 release({accountId:'account-1',purchases:['old-report']});
 assert.equal(await delayed,null);
 assert.equal(view.isCurrent(previous),false);
 assert.equal(view.accept({accountId:'account-2'}),false);
 assert.equal(view.accept({accountId:'account-1'}),true);
 assert.equal(await view.run(async()=>42),42);
});

test('preload captures account commands at call time and filters foreign-account events', async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../preload.js'),'utf8');
 const calls=[],listeners=new Map();let tt;
 vm.runInNewContext(source,{process:{isMainFrame:true,argv:['--app-ui-url=file:///ui.html']},location:{href:'file:///ui.html'},require:()=>({
  contextBridge:{exposeInMainWorld(_name,bridge){tt=bridge;}},
  ipcRenderer:{invoke:async(channel,...args)=>{calls.push([channel,...args]);return channel==='account:command'?{accountId:args[0].accountId,result:{channels:[]}}:{accountId:'account-2',channels:[]};},on:(key,fn)=>listeners.set(key,fn)}
 })});
 await tt.setFarming(false); await tt.selectAccount('account-2'); await tt.setFarming(true);
 assert.equal(calls[0][0],'account:command'); assert.equal(calls[0][1].accountId,'account-1');
 assert.equal(calls[2][1].accountId,'account-2'); assert.equal(calls[2][1].command,'farming:set');
 const chats=[];tt.onChat(data=>chats.push(data));
 listeners.get('chat')({}, {accountId:'account-1',payload:{slug:'rodil'}});
 listeners.get('chat')({}, {accountId:'account-2',payload:{slug:'faturetosl'}});
 assert.equal(chats.length,1); assert.equal(chats[0].slug,'faturetosl');
});
