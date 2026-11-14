'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/app.cjs');

function fixture() {
  const app=loadApp();app.apiExports.setup(app.main,null);app.apiExports.setupSession();
  const state={token:'FAKE_OLD',points:100,failIdentity:false};
  app.session.cookies.get=async({name})=>name==='auth-token'&&state.token?[{value:state.token}]:[];
  app.session.fetch=async(_url,init)=>{
    const query=JSON.parse(init.body).query;
    if(query.includes('currentUser')&&state.failIdentity)return new Response('{}',{status:503});
    const data={currentUser:state.token?{id:'1',login:'tester',displayName:'Tester'}:null};
    for(const match of query.matchAll(/(c\d+): user\(login: ("[^"\n]+")\)/g)) {
      data[match[1]]={displayName:JSON.parse(match[2]),stream:{id:'live'},channel:{self:{communityPoints:{balance:state.points}},communityPointsSettings:{isEnabled:true,customRewards:[]}}};
    }
    return new Response(JSON.stringify({data}));
  };
  return {app,state};
}

test('a failed identity batch during renewal preserves all point baselines and warming players',async()=>{
  const {app,state}=fixture();await app.apiExports.poll();
  const players=app.state.windows.filter(w=>w.options.type==='toolbar');
  state.points=110;state.token='FAKE_NEW';state.failIdentity=true;
  app.session.cookies.emit('changed',{}, {name:'auth-token',domain:'.twitch.tv'});
  await app.fireTimers(100);
  const laterSlug=app.apiExports.config.channels[12];
  assert.equal(app.apiExports.status.get(laterSlug).points,100,'unverified later batches cannot replace a known baseline');
  assert(players.every(w=>!w.isDestroyed()),'unknown identity during retry must not restart warming media');
  assert.equal(app.apiExports.snapshot().sessionChecking,true);
  state.failIdentity=false;await app.apiExports.poll();
  assert.equal(app.apiExports.snapshot().today,app.apiExports.config.channels.length*10);
  assert(players.every(w=>!w.isDestroyed()));
});

test('a routine poll does not close login opened by an already verified account',async()=>{
  const {app}=fixture();await app.apiExports.poll();
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  const login=app.state.windows.find(w=>w.options.title==='Twitch — login'&&!w.isDestroyed());assert(login);
  await app.apiExports.poll();
  assert.equal(login.isDestroyed(),false,'the existing cookie is not evidence that the new login flow completed');
});

test('an empty channel list still verifies login and releases the completed login document',async()=>{
  const {app,state}=fixture();state.token=null;app.apiExports.config.channels=[];
  await app.runtimes[0].invoke('login:show',app.event(),[]);
  const login=app.state.windows.find(w=>w.options.title==='Twitch — login'&&!w.isDestroyed());
  state.token='FAKE_LOGIN';app.session.cookies.emit('changed',{}, {name:'auth-token',domain:'.twitch.tv'});
  await app.fireTimers(100);
  assert.equal(app.apiExports.snapshot().loggedIn,true);
  assert.equal(app.apiExports.snapshot().username,'Tester');assert(login.isDestroyed());
});
