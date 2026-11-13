'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app.cjs');
const { validateIpcArgs } = require('../security/ipc');

const ids = ['account-1', 'account-2', 'account-3', 'account-4'];
function setAccount(runtime, session, id, points) {
  session.cookies.get = async ({name}) => name === 'auth-token' ? [{value:'FAKE_TOKEN_'+id}] : [];
  session.fetch = async (_url, init) => {
    const data = {currentUser:{id:String(id),login:'account_'+id,displayName:'Account '+id}};
    for (const match of JSON.parse(init.body).query.matchAll(/(c[0-9]+): user\(login: ("[^"\n]+")\)/g)) {
      const slug = JSON.parse(match[2]);
      data[match[1]]={id:'channel-'+slug,login:slug,displayName:slug,stream:{id:'stream',viewersCount:10,title:'Live'},channel:{self:{communityPoints:{balance:points}},communityPointsSettings:{isEnabled:true,customRewards:[]}}};
    }
    return new Response(JSON.stringify({data}));
  };
}

test('one application contains four independent request sessions and mutable configurations', async () => {
  const app = loadApp();
  assert.equal(app.runtimes?.length, 4, 'must own four scoped account runtimes');
  assert.equal(new Set(app.runtimes.map(r=>r.partition)).size, 4);
  for (let i=0;i<4;i++) {
    const r=app.runtimes[i]; const ses=app.sessions.get(r.partition);
    setAccount(r,ses,i+1,100*(i+1)); await r.poll();
  }
  for(let i=0;i<4;i++) {
    const s=app.runtimes[i].snapshot();
    assert.equal(s.username,'Account '+(i+1)); assert.equal(s.channels[0].points,100*(i+1));
    assert.equal(s.maxWatchers,2); assert.equal(s.watchAll,false); assert.equal(s.rotation,true);
    assert.equal(s.channels.filter(c=>c.watching).length,2);
  }
  app.runtimes[0].__test.config.favorites.push('rodil');
  app.runtimes[0].__test.config.daily.example=50;
  assert.equal(app.runtimes[1].__test.config.favorites.includes('rodil'),false);
  assert.equal(app.runtimes[1].__test.config.daily.example,undefined);
  assert.equal(new Set(app.state.windows.filter(w=>w.options.webPreferences?.partition).map(w=>w.options.webPreferences.partition)).size,4);
});

test('changing the displayed account keeps background players and captures delayed commands', async () => {
  const app=loadApp(); assert.equal(app.runtimes?.length,4);
  for(let i=0;i<2;i++){const r=app.runtimes[i];setAccount(r,app.sessions.get(r.partition),i+1,100);await r.poll();}
  const existing=app.state.windows.filter(w=>w.options.webPreferences?.partition===app.runtimes[0].partition);
  let release; app.state.dialogResponse=0;
  app.dialog.showMessageBox=()=>new Promise(resolve=>{release=resolve;});
  const pending=app.handlers.get('account:command')(app.event(),{accountId:ids[0],command:'logout',args:[]});
  await app.handlers.get('account:select')(app.event(),ids[1]);
  assert(existing.every(w=>!w.isDestroyed()));
  release({response:0}); await pending;
  assert.equal(app.runtimes[0].snapshot().loggedIn,false);
  assert.equal(app.runtimes[1].snapshot().loggedIn,true);
  assert.equal(app.runtimes[1].snapshot().channels.filter(c=>c.watching).length,2);
  assert.equal(app.manager.snapshot().accountId,ids[1]);
});

test('cookie invalidation and report updates stay in the originating slot', async () => {
  const app=loadApp(); assert.equal(app.runtimes?.length,4);
  for(let i=0;i<2;i++){const r=app.runtimes[i];r.__test.setupSession();setAccount(r,app.sessions.get(r.partition),i+1,100);await r.poll();}
  const a=app.runtimes[0], b=app.runtimes[1]; const before=b.__test.client.generation;
  app.sessions.get(a.partition).cookies.emit('changed',{}, {name:'auth-token',domain:'.twitch.tv'});
  assert.equal(b.__test.client.generation,before); assert.equal(b.snapshot().loggedIn,true);
  await app.handlers.get('account:command')(app.event(),{accountId:ids[0],command:'purchase:add',args:['xp']});
  assert.equal(b.snapshot().purchases.length,0);
});

test('account IPC validates slot and channel ownership before dispatch and rejects recursive or global commands', () => {
  const context={platform:'twitch',accounts:{'account-1':{channels:['rodil']},'account-2':{channels:['faturetosl']}}};
  const valid={accountId:'account-1',command:'store:open',args:['rodil']};
  assert.deepEqual(validateIpcArgs('account:command',[valid],context),[valid]);
  for(const value of [
    {...valid,accountId:'../../other'}, {...valid,accountId:'toString'}, {...valid,args:['faturetosl']},
    {...valid,command:'app:quit',args:[]}, {...valid,command:'account:command'}, {...valid,command:'autostart:set',args:[true]},
    {...valid,token:'unexpected'}, {...valid,args:'rodil'},
  ]) assert.throws(()=>validateIpcArgs('account:command',[value],context),/Invalid IPC/);
});

test('official popups keep their source session after another account is selected', async () => {
  const app=loadApp(); await app.start();
  await app.runtimes[1].invoke('login:show',app.event(),[]);
  const login=app.state.windows.find(w=>w.options.webPreferences?.partition==='persist:twitch-account-2');
  app.manager.select('account-4');
  const options=login.webContents.openHandler({url:'https://accounts.google.com/ServiceLogin'});
  assert.equal(options.action,'allow');
  assert.equal(options.overrideBrowserWindowOptions.webPreferences.session,app.sessions.get('persist:twitch-account-2'));
  assert.equal(options.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
  assert.equal(options.overrideBrowserWindowOptions.webPreferences.sandbox,true);
  assert.equal(login.webContents.openHandler({url:'https://evil.invalid'}).action,'deny');
});

test('slot1 retains existing profile paths and no aggregate snapshot contains a credential', async () => {
  const app=loadApp({env:{TWITCHTERINO_DATA:'/existing installation'}}); await app.start();
  const paths=app.state.writes.filter(([p])=>p.endsWith('config.json')).map(([p])=>p.replaceAll('\\','/'));
  assert(paths.includes('/existing installation/config.json'));
  for(let i=2;i<=4;i++) assert(paths.includes('/existing installation/accounts/account-'+i+'/config.json'));
  assert.equal(app.runtimes[0].partition,'persist:twitch');
  for(let i=0;i<4;i++) {const r=app.runtimes[i];setAccount(r,app.sessions.get(r.partition),i+1,100);await r.poll();}
  assert(!JSON.stringify(app.manager.snapshot()).includes('FAKE_TOKEN'));
  assert.equal(app.manager.snapshot().accounts.length,4);
});
