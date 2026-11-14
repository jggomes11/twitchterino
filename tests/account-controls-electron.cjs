'use strict';
// Native renderer regression fixture: real preload and UI, controlled local IPC only.
const {BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {checkpoint,within,captureAccountScreenshot}=require('./electron-fixture-support.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(name,namespace){
 const root=path.resolve(__dirname,'..'), calls=[], errors=[];
 let selected='account-1',mode='normal',releaseLogout;
 const slots=Array.from({length:4},(_,i)=>({id:'account-'+(i+1),label:'Conta '+(i+1),username:['fulecossauro','gymgomes','jivo_gomes',null][i],loggedIn:i<3,sessionChecking:false,farming:true,watching:2,today:8750+i*375}));
 const snapshot=(id=selected)=>({...slots.find(s=>s.id===id),accountId:id,accounts:slots.map(s=>({...s})),sessionRevision:1,
   channels:[],favorites:[],purchases:[],bonuses:[],bonusOptions:[],bonusTarget:'',platform:'win32',maxWatchers:2,watchAll:false,rotation:true,intro:null});
 for(const channel of ['state:get','account:select','account:command'])ipcMain.removeHandler(channel);
 ipcMain.handle('state:get',()=>snapshot());
 ipcMain.handle('account:select',(_event,id)=>{selected=id;calls.push({command:'select',id});return snapshot();});
 ipcMain.handle('account:command',async(_event,{accountId:id,command})=>{
   calls.push({command,id});
   if(command==='logout'){
     if(mode==='defer')await new Promise(resolve=>{releaseLogout=resolve;});
     if(mode==='fail')throw new Error('Fixture disconnect failure');
     if(mode!=='cancel'){const slot=slots.find(s=>s.id===id);slot.loggedIn=false;slot.username=null;}
   }
   return {accountId:id,result:command==='login:show'?undefined:snapshot(id)};
 });
 const win=new BrowserWindow({show:false,width:1132,height:850,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,preload:path.join(root,'preload.js'),additionalArguments:['--app-ui-url='+pathToFileURL(path.join(root,'renderer/index.html')).href]}});
 const wc=win.webContents;
 const evaluate=code=>within(wc.executeJavaScript(code),'Account renderer evaluation: '+code.slice(0,100));
 const debug=(method,params)=>within(wc.debugger.sendCommand(method,params),'Account CDP '+method);
 async function until(code){for(let i=0;i<150;i++){if(await evaluate(code))return;await pause(20);}throw new Error('Condition failed: '+code);}
 async function click(selector){await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing control');b.focus();b.click();})()`);}
 const card=id=>`[data-account-id="account-${id}"]`;
 try{
   checkpoint('account UI load');
   await within(win.loadFile(path.join(root,'renderer/index.html')),'Account UI load');
   wc.debugger.attach('1.3');
   wc.debugger.on('message',(_event,method,params)=>{if(method==='Runtime.exceptionThrown')errors.push(params.exceptionDetails.text);});
   await debug('Runtime.enable');
   await debug('Emulation.setDeviceMetricsOverride',{width:1132,height:850,deviceScaleFactor:1,mobile:false});
   checkpoint('account cards and settings geometry');
   await until(`document.querySelectorAll('.account-card').length===4`);
   assert.equal(await evaluate(`document.querySelectorAll('.account-settings:not([hidden])').length`),3);
   assert.equal(await evaluate(`document.querySelector('${card(4)} b').textContent`),'Adicionar conta');
   assert.equal(await evaluate(`!!document.querySelector('#btn-login,#btn-logout,#farming')`),false);
   assert.equal(await evaluate(`!!document.querySelector('.account-tab button')`),false);
   assert.equal(await evaluate(`[...document.querySelectorAll('.account-settings:not([hidden])')].every(g=>{const r=g.getBoundingClientRect();return g.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})`),true,'bonus panel must not cover profile settings');
   await click(card(2)+' .account-settings');
   assert.equal(selected,'account-1');
   assert.equal(await evaluate(`document.querySelector('${card(2)} .account-menu').hidden`),false);
   wc.send('status',snapshot());
   await pause(25);
   assert.equal(await evaluate(`document.activeElement===document.querySelector('${card(2)} .account-disconnect')`),true);
   assert.equal(await evaluate(`document.querySelector('${card(2)} .account-menu').hidden`),false);
   await captureAccountScreenshot(wc.debugger,name,process.env.ACCOUNT_CONTROLS_SCREENSHOTS);
   checkpoint('account menu focus and empty-slot login');
   await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
   assert.equal(await evaluate(`document.activeElement===document.querySelector('${card(2)} .account-settings')`),true);
   await click(card(2)+' .account-settings');await click('#btn-settings');
   assert.equal(await evaluate(`document.querySelector('${card(2)} .account-menu').hidden`),true);
   await click(card(4)+' .account-tab');
   await until(`state.accountId==='account-4'`);
   for(let i=0;i<100&&!calls.some(c=>c.command==='login:show');i++)await pause(10);
   assert(calls.some(c=>c.command==='login:show'&&c.id==='account-4'));
   await click(card(1)+' .account-tab');await until(`state.accountId==='account-1'`);
   checkpoint('account-scoped logout race');
   mode='defer';await click(card(2)+' .account-settings');await click(card(2)+' .account-disconnect');
   for(let i=0;i<100&&!releaseLogout;i++)await pause(10);
   assert(releaseLogout);
   await click(card(3)+' .account-tab');await until(`state.accountId==='account-3'`);
   mode='normal';releaseLogout();
   await until(`document.querySelector('${card(2)} b').textContent==='Adicionar conta'`);
   assert.equal(selected,'account-3');assert.equal(slots[0].loggedIn,true);assert.equal(slots[2].loggedIn,true);
   assert.equal(calls.filter(c=>c.command==='logout').length,1);
   assert.equal(calls.filter(c=>c.command==='login:show').length,1);
   checkpoint('account logout cancellation and error');
   mode='cancel';await click(card(1)+' .account-settings');await click(card(1)+' .account-disconnect');
   await until(`!document.querySelector('${card(1)} .account-tab').disabled`);
   assert.equal(slots[0].loggedIn,true);
   assert.equal(await evaluate(`document.activeElement===document.querySelector('${card(1)} .account-tab')`),true,'cancelled logout must restore focus');
   mode='fail';await click(card(1)+' .account-settings');await click(card(1)+' .account-disconnect');
   await until(`!document.querySelector('${card(1)} .account-tab').disabled`);
   assert.equal(slots[0].loggedIn,true);
   assert.equal(await evaluate(`document.activeElement===document.querySelector('${card(1)} .account-tab')`),true,'failed logout must restore focus');
   assert.equal(await evaluate(`!!document.querySelector('.toast')`),true);
   slots[3].sessionChecking=true;wc.send('status',snapshot());
   await until(`document.querySelector('${card(4)} .account-tab').disabled`);
   assert.equal(await evaluate(`document.querySelector('${card(4)} .account-settings').hidden`),true);
   checkpoint('account narrow layout');
   await debug('Emulation.setDeviceMetricsOverride',{width:600,height:850,deviceScaleFactor:1,mobile:false});
   assert.equal(await evaluate(`getComputedStyle(document.querySelector('#accounts')).gridTemplateColumns.split(' ').length`),2);
   assert.equal(await evaluate(`[...document.querySelectorAll('.account-card')].every(c=>c.getBoundingClientRect().right<=innerWidth)`),true);
   assert.deepEqual(errors,[]);
   console.log(name+': PASS — four cards, per-account gears, empty slots, scoped login, background logout race, polling/menu focus, Escape/outside dismissal, cancel/error focus, checking state and narrow layout.');
 }finally{win.destroy();for(const channel of ['state:get','account:select','account:command'])ipcMain.removeHandler(channel);}
}
module.exports=()=>verify('twitchterino','tt');
