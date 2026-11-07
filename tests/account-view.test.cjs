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

test('renderer accepts the frozen bridge returned by native Electron contextBridge', async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../renderer/renderer.js'),'utf8');
 const prefix=source.slice(0,source.indexOf('let state ='));
 let reads=0;
 const nativeBridge=Object.freeze({getState:async()=>{reads++;return {accountId:'account-1'};},onStatus:()=>{}});
 const result=await vm.runInNewContext(prefix+'\napi.getState();',{window:{tt:nativeBridge},AccountView:{createAccountViewGuard},document:{querySelector(){}}});
 assert.equal(reads,1);assert.equal(result.accountId,'account-1');
});

test('reload synchronizes the saved active account into both the bridge and view before commands',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../preload.js'),'utf8');
 const calls=[],listeners=new Map();let tt;
 vm.runInNewContext(source,{process:{isMainFrame:true,argv:['--app-ui-url=file:///ui.html']},location:{href:'file:///ui.html'},require:()=>({contextBridge:{exposeInMainWorld(_n,b){tt=b;}},ipcRenderer:{invoke:async(channel,...args)=>{calls.push([channel,...args]);return channel==='account:command'?{accountId:args[0].accountId,result:{channels:[]}}:{accountId:'account-2',channels:[]};},on:(k,fn)=>listeners.set(k,fn)}})});
 const view=createAccountViewGuard();
 assert.equal(view.accept(await tt.getState()),true);
 assert.equal(view.accountId,'account-2');
 await tt.setFarming(false);assert.equal(calls.at(-1)[1].accountId,'account-2');
 let received=false;tt.onStatus(()=>{received=true;});listeners.get('status')({}, {accountId:'account-2'});assert.equal(received,true);
});

test('a delayed chat notification activates its source account and obeys later selection',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../renderer/renderer.js'),'utf8');
 const functionSource=source.slice(source.indexOf('function chatAlert('),source.indexOf('// ---------- Comemorações'));
 const view=createAccountViewGuard();const notifications=[],selected=[],activations=[];
 let release;
 const context={state:{notifyChat:true,username:'Account A',channels:[{slug:'rodil',displayName:'Rodil'}]},active:null,document:{hasFocus:()=>false},lastGiveawayAlert:new Map(),accountView:view,
  window:{focus(){}},Notification:class {constructor(title){this.title=title;notifications.push(this);}},
  select:slug=>selected.push({accountId:view.accountId,slug}),selectAccount:id=>{activations.push(id);view.select(id);return new Promise(resolve=>{release=resolve;});}};
 vm.runInNewContext(functionSource+'\nchatAlert("rodil",{sender:{username:"Viewer"},content:"@Account A"},{mention:true});',context);
 view.select('account-2');const pending=notifications[0].onclick();
 assert.deepEqual(activations,['account-1']);assert.match(notifications[0].title,/Account A/);
 release(true);await pending;assert.deepEqual(selected,[{accountId:'account-1',slug:'rodil'}]);
 selected.length=0;view.select('account-2');const raced=notifications[0].onclick();view.select('account-3');release(true);await raced;assert.equal(selected.length,0);
});

test('an initial read completing late cannot override an explicit account selection',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../preload.js'),'utf8');let tt,release;const calls=[];
 vm.runInNewContext(source,{process:{isMainFrame:true,argv:['--app-ui-url=file:///ui.html']},location:{href:'file:///ui.html'},require:()=>({contextBridge:{exposeInMainWorld(_n,b){tt=b;}},ipcRenderer:{invoke:async(channel,...args)=>{calls.push([channel,...args]);if(channel==='state:get')return new Promise(resolve=>{release=resolve;});return channel==='account:command'?{accountId:args[0].accountId,result:{channels:[]}}:{accountId:args[0],channels:[]};},on(){}}})});
 const pending=tt.getState();await tt.selectAccount('account-3');release({accountId:'account-2',channels:[]});await pending;
 await tt.setFarming(false);assert.equal(calls.at(-1)[1].accountId,'account-3');
 const view=createAccountViewGuard();view.select('account-3');assert.equal(view.accept({accountId:'account-2'}),false);
});
