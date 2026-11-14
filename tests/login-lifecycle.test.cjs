'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/app.cjs');
const loginWindows=app=>app.state.windows.filter(w=>w.options.title==='Twitch — login'&&!w.isDestroyed());
function sessionFixture(app) {
  let token=null;
  for(const ses of app.sessions.values())ses.cookies.get=async()=>[];
  app.session.cookies.get=async({name})=>name==='auth-token'&&token?[{value:token}]:[];
  app.session.fetch=async(_url,init)=>{
    const data={currentUser:token?{id:'1',login:'tester',displayName:'Tester'}:null};
    for(const match of JSON.parse(init.body).query.matchAll(/(c\d+): user\(login: ("[^"\n]+")\)/g)) {
      const slug=JSON.parse(match[2]);data[match[1]]={displayName:slug,stream:{id:'live'},channel:{self:{communityPoints:{balance:100}},communityPointsSettings:{isEnabled:true,customRewards:[]}}};
    }
    return new Response(JSON.stringify({data}));
  };
  return value=>{token=value;};
}
test('starting four slots creates no login documents and restores a saved cookie natively',async()=>{
  const app=loadApp();const setToken=sessionFixture(app);setToken('FAKE_SAVED');
  await app.start();
  assert.equal(loginWindows(app).length,0);
  assert.equal(app.runtimes[0].snapshot().loggedIn,true);
  assert.equal(app.runtimes[0].snapshot().channels.filter(c=>c.watching).length,2);
});
test('login is created on demand, reused and released on cancellation',async()=>{
  const app=loadApp();sessionFixture(app);await app.start();
  assert.equal(loginWindows(app).length,0);
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  const first=loginWindows(app)[0];assert(first);
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  assert.equal(loginWindows(app).length,1);
  first.close();assert.equal(loginWindows(app).length,0);
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  assert.equal(loginWindows(app).length,1);assert.notEqual(loginWindows(app)[0],first);
});
test('cookie verification completes after the login window closes and keeps warming players alive',async()=>{
  const app=loadApp();const setToken=sessionFixture(app);await app.start();
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  loginWindows(app)[0].close();
  setToken('FAKE_RENEWED');
  app.session.cookies.emit('changed',{}, {name:'auth-token',domain:'.twitch.tv'});
  await app.fireTimers(100);
  assert.equal(app.runtimes[0].snapshot().loggedIn,true);
  assert.equal(app.runtimes[0].snapshot().sessionChecking,false);
  const players=app.state.windows.filter(w=>w.options.type==='toolbar'&&!w.isDestroyed());assert.equal(players.length,2);
  app.session.cookies.emit('changed',{}, {name:'auth-token',domain:'.twitch.tv'});
  await app.fireTimers(100);
  assert(players.every(w=>!w.isDestroyed()));
  assert.equal(loginWindows(app).length,0);
});
test('logout works without a login document and shutdown cannot recreate one',async()=>{
  const app=loadApp();const setToken=sessionFixture(app);setToken('FAKE_SAVED');await app.start();
  await app.runtimes[0].invoke('logout',app.event(),[]);
  assert.equal(app.runtimes[0].snapshot().loggedIn,false);assert.equal(loginWindows(app).length,0);
  app.app.emit('before-quit');
  for(const timer of [...app.state.timers])if(!timer.cancelled)await timer.callback();
  await assert.rejects(app.runtimes[0].invoke('login:show',app.event(),[]),/Session changed/);
  assert.equal(loginWindows(app).length,0);
});

test('verified login releases its document and retains the Session cookie',async()=>{
  const app=loadApp();const setToken=sessionFixture(app);await app.start();
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  const login=loginWindows(app)[0];setToken('FAKE_LOGIN');
  app.session.cookies.emit('changed',{}, {name:'auth-token',domain:'.twitch.tv'});await app.fireTimers(100);
  assert(login.isDestroyed());assert.equal(loginWindows(app).length,0);
  assert.equal(app.runtimes[0].snapshot().loggedIn,true);
  assert.equal((await app.session.cookies.get({name:'auth-token'}))[0].value,'FAKE_LOGIN');
});

test('closing a stalled login settles its pending navigation without leaving listeners',async()=>{
  const app=loadApp();sessionFixture(app);await app.start();
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  const login=loginWindows(app)[0];let started=false;login.loadURL=()=>{started=true;return new Promise(()=>{});};
  const pending=app.runtimes[0].invoke('login:show',app.event(),[]);
  await Promise.resolve();assert.equal(started,true,'the test must exercise a pending real navigation');
  login.close();
  await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('Login remained pending after close')),100))]);
  assert.equal(login.listenerCount('closed'),1,'only the ownership cleanup listener remains');
});
