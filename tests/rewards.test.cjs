'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadApp } = require('./helpers/app.cjs');

const rewards = [
  { id: 'capture-10', title: '+15% Capture Boost (10 h)', cost: 5000, isEnabled: true },
  { id: 'lure-10', title: '+15% Secret Lure (10 h)', cost: 5000, isEnabled: true },
];
async function fixture(shop = rewards) {
  const app = loadApp();
  let reply={data:{redeemCustomReward:{redemption:{id:'redemption'}}}};
  let points = 10000;
  const slug = app.apiExports.config.channels[0];
  app.session.fetch = async (_url, init) => {
    const data = { currentUser: { id: '1', login: 'tester', displayName: 'Tester' } };
    for (const match of JSON.parse(init.body).query.matchAll(/(c\d+): user\(login: ("[^"\n]+")\)/g)) {
      data[match[1]] = { displayName: JSON.parse(match[2]), channel: {
        self: { communityPoints: { balance: JSON.parse(match[2]) === slug ? points : 10000 } },
        communityPointsSettings: { isEnabled: true, customRewards: shop },
      } };
    }
    return new Response(JSON.stringify({ data }));
  };
  await app.apiExports.poll();
  const dbg = new EventEmitter();
  dbg.isAttached = () => true;
  dbg.sendCommand = async method => method === 'Network.getResponseBody'
    ? { body: JSON.stringify(reply) } : {};
  app.apiExports.watchRedemptions(slug, { debugger: dbg, isDestroyed: () => false });
  return { app, response(value){reply=value;}, async spend(amount = 5000) { points -= amount; await app.apiExports.poll(); },
    fail(){dbg.emit('message',{},'Network.loadingFailed',{requestId:'redeem'});},
    request(input,requestId='redeem') { dbg.emit('message', {}, 'Network.requestWillBeSent', { requestId, request: {
      url: 'https://gql.twitch.tv/gql', postData: JSON.stringify({ operationName: 'RedeemCustomReward', variables: { input } }),
    } }); },
    async finish(requestId='redeem') { dbg.emit('message', {}, 'Network.loadingFinished', { requestId }); await new Promise(resolve => setImmediate(resolve)); },
  };
}

for (const title of [undefined, '+15% Secret Lure (10 h)']) {
  test(`the redeemed reward ID identifies Capture 10h even with ${title ? 'a stale title' : 'no title'}`, async () => {
    const f = await fixture();
    f.request({ rewardID: 'capture-10', cost: 5000, title });
    await f.finish();
    const state = f.app.apiExports.snapshot();
    assert.equal(state.purchases.length, 1);
    assert.equal(state.purchases[0].kind, 'capture');
    assert.equal(state.purchases[0].hours, 10);
    assert.ok(state.bonuses.find(b => b.kind === 'capture').endsAt > Date.now());
    assert.equal(state.bonuses.find(b => b.kind === 'lure').endsAt, null);
    await f.spend();
    assert.equal(f.app.apiExports.config.purchases.length, 1, 'the balance drop must not count the same redemption twice');
  });
}

test('an ambiguous balance drop must not invent a Lure purchase before Capture redemption completes', async () => {
  const f = await fixture();
  f.request({ rewardID: 'capture-10', cost: 5000 });
  await f.spend();
  assert.equal(f.app.apiExports.config.purchases.length, 0);
  await f.finish();
  assert.equal(f.app.apiExports.config.purchases.length, 1);
  assert.equal(f.app.apiExports.config.purchases[0].kind, 'capture');
  assert.equal(f.app.apiExports.config.purchases[0].hours, 10);
});

test('a balance drop still detects a uniquely priced external Capture purchase', async () => {
  const f = await fixture([rewards[0]]);
  await f.spend();
  assert.equal(f.app.apiExports.config.purchases.length, 1);
  assert.equal(f.app.apiExports.config.purchases[0].kind, 'capture');
  assert.equal(f.app.apiExports.config.purchases[0].hours, 10);
});

test('a unique balance drop before shop confirmation is not an extra purchase',async()=>{
  const f=await fixture([rewards[0]]);
  f.request({rewardID:'capture-10',cost:5000});
  await f.spend();
  assert.equal(f.app.apiExports.config.purchases.length,0,'an in-flight shop purchase waits for its response');
  await f.finish();
  assert.equal(f.app.apiExports.config.purchases.length,1);
  assert.equal(f.app.apiExports.config.purchases[0].hours,10);
});

test('failed and unconfirmed shop responses cannot turn a deferred drop into a boost',async()=>{
  for(const reply of [
    {data:{redeemCustomReward:{redemption:null}}},
    {errors:[{message:'failed'}],data:{redeemCustomReward:{redemption:{id:'bad'}}}},
    {data:{redeemCustomReward:{error:{code:'failed'},redemption:{id:'bad'}}}},
  ]){
    const f=await fixture([rewards[0]]);f.response(reply);
    f.request({rewardID:'capture-10',cost:5000});await f.spend();await f.finish();
    assert.equal(f.app.apiExports.config.purchases.length,0);
    await f.spend();assert.equal(f.app.apiExports.config.purchases.length,1,'a later independent external purchase remains detectable');
  }
});

test('network failure and timeout release an in-flight redemption',async()=>{
  for(const timedOut of [false,true]){
    const f=await fixture([rewards[0]]);f.request({rewardID:'capture-10',cost:5000});
    if(timedOut)await f.app.fireTimers(60000);else f.fail();
    await f.spend();assert.equal(f.app.apiExports.config.purchases.length,1);
  }
});

test('replaying a confirmed redemption ID cannot add another boost or consume a later purchase',async()=>{
  const f=await fixture([rewards[0]]);
  f.request({rewardID:'capture-10',cost:5000});await f.finish();await f.spend();
  f.request({rewardID:'capture-10',cost:5000},'retry');await f.finish('retry');
  assert.equal(f.app.apiExports.config.purchases.length,1);
  await f.spend();assert.equal(f.app.apiExports.config.purchases.length,2);
});

for (const [title, kind, hours] of [
  ['XP Boost', 'xp', 1],
  ['Capture XP Boost', 'capture', 1],
  ['XP Boost (3 h)', 'xp', 3],
  ['+15% Capture XP Boost (10 h)', 'capture', 10],
]) {
  test(`the official shop redemption of ${title} starts the correct bonus counter`, async () => {
    const f = await fixture([{id:'actual-boost',title,cost:5000,isEnabled:true}]);
    f.request({rewardID:'actual-boost',cost:5000});
    await f.finish();
    const state = f.app.apiExports.snapshot();
    assert.equal(state.purchases.length,1,'a successful shop redemption must enter history');
    assert.equal(state.purchases[0].kind,kind);
    assert.equal(state.purchases[0].hours,hours);
    const bonus = state.bonuses.find(b=>b.kind===kind);
    assert.ok(bonus.endsAt > Date.now()+hours*3600000-5000,'the purchased duration is added to its own counter');
    await f.spend();
    assert.equal(f.app.apiExports.config.purchases.length,1,'the subsequent balance drop must not add the boost twice');
  });
}
