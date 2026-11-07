'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {assertAccountReady,quitApplication}=require('../scripts/account-fixture.cjs');
const ready={accountId:'account-1',loggedIn:false,watchAll:false,maxWatchers:2,rotation:true,farming:true,autoChest:true,
 accounts:[1,2,3,4].map(n=>({id:'account-'+n})),channels:[{slug:'tester',live:true,rewardsLoaded:true,error:null}]};
test('native account fixture rejects placeholder metadata and changed collection defaults',()=>{
 assert.doesNotThrow(()=>assertAccountReady(ready,'account-1'));
 for(const value of [{...ready,channels:[{live:false,rewardsLoaded:false}]},{...ready,farming:false},{...ready,autoChest:false},{...ready,accountId:'account-2'},{...ready,accounts:ready.accounts.slice(0,3)}]) assert.throws(()=>assertAccountReady(value,'account-1'));
});
test('native account fixture requires natural exit after a failed quit command',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 try {await assert.rejects(quitApplication({child,ui:{call:async()=>{throw Error('quit failed');}}},25),/graceful|quit/); assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);}
 finally {child.kill();}
});

test('closing a debugged page accepts its expected target disconnection but preserves other failures',async()=>{
 const {closePage}=require('../scripts/cdp-client.cjs');
 await closePage({call:async(method)=>{assert.equal(method,'Page.close');throw Error('Debug connection closed');}});
 await assert.rejects(closePage({call:async()=>{throw Error('Protocol failure');}}),/Protocol failure/);
 await assert.rejects(closePage({call:async()=>{throw Error('Debug command timed out: Page.close');}}),/timed out/);
});
