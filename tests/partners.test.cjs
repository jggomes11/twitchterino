'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPartnersClient}=require('../security/partners');
test('four slots share one public request but receive independent channel arrays',async()=>{
  const requests=[];let now=0;
  const client=createPartnersClient({platform:'twitch',now:()=>now,fetch:async(url,options)=>{
    requests.push({url,options});return new Response(JSON.stringify({channels:['Alpha','beta','alpha',null,'bad/slug']}));
  }});
  const lists=await Promise.all([client.get(),client.get(),client.get(),client.get()]);
  assert.equal(requests.length,1);assert.deepEqual(lists[0],['alpha','beta']);
  lists[0].push('local');assert.deepEqual(lists[1],['alpha','beta']);
  assert.equal(requests[0].url,'https://viinnisantoos.github.io/twitchterino/parceiros.json');
  assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.redirect,'error');
  assert.deepEqual(requests[0].options.headers,{});
  now=6*3600000;await client.get();assert.equal(requests.length,2,'the six-hour scheduled refresh must not be hidden by cache');
});
test('public fetch failures are bounded, coalesced and can recover',async()=>{
  let calls=0,now=0;
  const client=createPartnersClient({platform:'twitch',now:()=>now,fetch:async()=>{calls++;return calls===1?new Response('{}',{status:503}):new Response('{"channels":["alpha"]}');}});
  await Promise.all([assert.rejects(client.get()),assert.rejects(client.get())]);
  await assert.rejects(client.get());assert.equal(calls,1);
  now=61000;assert.deepEqual(await client.get(),['alpha']);assert.equal(calls,2);
});
test('invalid catalog bodies and redirects cannot create partners',async()=>{
  for(const response of [()=>new Response('{"channels":"wrong"}'),()=>new Response('{}',{status:302}),()=>new Response('{}',{headers:{'content-length':String(3*1024*1024)}})]) {
    const client=createPartnersClient({platform:'twitch',fetch:async()=>response()});await assert.rejects(client.get());
  }
});
test('stopping a public request aborts it and prevents subsequent fetches',async()=>{
  let signal,calls=0;
  const client=createPartnersClient({platform:'kick',fetch:async(_url,options)=>{calls++;signal=options.signal;return new Promise(()=>{});}});
  const check=assert.rejects(client.get());await Promise.resolve();await Promise.resolve();client.stop();await check;
  assert(signal.aborted);await assert.rejects(client.get());assert.equal(calls,1);
});
