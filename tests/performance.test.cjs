'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/app.cjs');

test('one aggregate snapshot reads app metrics once without constructing hidden-account channels',()=>{
  const app=loadApp();
  const calls=[0,0,0,0];
  app.runtimes.forEach((r,index)=>{const original=r.snapshot;r.snapshot=(...args)=>{calls[index]++;return original(...args);};});
  app.state.metricsReads=0;
  const state=app.manager.snapshot();
  assert.deepEqual(calls,[1,0,0,0]);
  assert.equal(app.state.metricsReads,1);
  assert.equal(state.accounts.length,4);
  assert.equal(state.accountId,'account-1');
  assert.equal(state.channels.length,17);
});

test('account summaries do not read system metrics or autostart registry',()=>{
  const app=loadApp();const queries=app.state.loginQueries.length;
  const summaries=app.manager.summaries();
  assert.equal(summaries.length,4);
  assert.equal(app.state.metricsReads,0);
  assert.equal(app.state.loginQueries.length,queries);
  assert(summaries.every(s=>s.watching===0&&!s.loggedIn));
});

test('a status burst sends one aggregate for the current selection',async()=>{
  const app=loadApp();await app.start();
  await new Promise(resolve=>setImmediate(resolve));
  const sent=[];app.state.metricsReads=0;
  app.state.windows.find(w=>w.options.webPreferences?.preload).webContents.send=(...args)=>sent.push(args);
  const statusIntervals=app.state.intervals.filter(t=>t.delay===15000&&!t.cancelled);
  assert.equal(statusIntervals.length,1,'the shell owns the periodic UI update');
  for(let i=0;i<4;i++)statusIntervals[0].callback();
  app.manager.select('account-2');app.manager.select('account-1');
  app.state.metricsReads=0;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,1);
  assert.equal(sent[0][0],'status');assert.equal(sent[0][1].accountId,'account-1');
  assert.equal(app.state.metricsReads,1);
});

test('unchanged bonus ticks do not rebuild the tray or read process metrics',async()=>{
  const app=loadApp();await app.start();await new Promise(resolve=>setImmediate(resolve));
  const menuCount=app.state.trayMenus.length;const tipCount=app.state.trayTips.length;
  app.state.metricsReads=0;
  for(const timer of app.state.intervals.filter(t=>t.delay===30000))timer.callback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.state.trayMenus.length,menuCount);
  assert.equal(app.state.trayTips.length,tipCount);
  assert.equal(app.state.metricsReads,0);
});

test('one public partner refresh updates all four configurations independently',async()=>{
  const app=loadApp();app.state.partnerChannels=['new_partner'];await app.start();
  await app.fireTimers(30000);
  assert.equal(app.state.partnerRequests.length,1);
  for(const r of app.runtimes)assert(r.__test.config.channels.includes('new_partner'));
  app.runtimes[0].__test.config.channels.pop();
  assert(app.runtimes[1].__test.config.channels.includes('new_partner'));
  app.app.emit('before-quit');
  for(const timer of app.state.timers)await timer.callback();
  assert.equal(app.state.partnerRequests.length,1);
});
