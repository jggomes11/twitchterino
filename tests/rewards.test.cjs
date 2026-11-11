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
    ? { body: JSON.stringify({ data: { redeemCustomReward: { redemption: { id: 'redemption' } } } }) } : {};
  app.apiExports.watchRedemptions(slug, { debugger: dbg, isDestroyed: () => false });
  return { app, async spend() { points -= 5000; await app.apiExports.poll(); },
    request(input) { dbg.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'redeem', request: {
      url: 'https://gql.twitch.tv/gql', postData: JSON.stringify({ operationName: 'RedeemCustomReward', variables: { input } }),
    } }); },
    async finish() { dbg.emit('message', {}, 'Network.loadingFinished', { requestId: 'redeem' }); await new Promise(resolve => setImmediate(resolve)); },
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
