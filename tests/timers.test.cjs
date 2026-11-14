'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTimers}=require('../security/timers');
function clock(){
  let next=0;const pending=new Map();
  return {pending,setTimeout(fn){const id=++next;pending.set(id,fn);return id;},clearTimeout(id){pending.delete(id);},
    setInterval(fn){const id=++next;pending.set(id,fn);return id;},clearInterval(id){pending.delete(id);}};
}
test('settled operations release their timeout on success and failure',async()=>{
  const c=clock(),t=createTimers(c);
  assert.equal(await t.withTimeout(Promise.resolve(42),1000),42);assert.equal(c.pending.size,0);
  await assert.rejects(t.withTimeout(Promise.reject(Error('failed')),1000),/failed/);assert.equal(c.pending.size,0);
});
test('a timeout rejects once and releases its resources',async()=>{
  const c=clock(),t=createTimers(c);
  const pending=t.withTimeout(new Promise(()=>{}),1000);
  const check=assert.rejects(pending,/timeout/);
  [...c.pending.values()][0]();await check;assert.equal(c.pending.size,0);
});
test('stopping cancels callbacks and rejects outstanding operations and sleeps',async()=>{
  const c=clock(),t=createTimers(c);let calls=0;
  t.after(()=>calls++,1000);t.every(()=>calls++,2000);
  const operation=assert.rejects(t.withTimeout(new Promise(()=>{}),3000),/Session changed/);
  const sleeping=assert.rejects(t.sleep(500),/Session changed/);
  const callbacks=[...c.pending.values()];t.stop();
  await Promise.all([operation,sleeping]);callbacks.forEach(fn=>fn());
  assert.equal(calls,0);assert.equal(c.pending.size,0);
  t.after(()=>calls++,100);t.every(()=>calls++,100);assert.equal(c.pending.size,0);
  await assert.rejects(t.withTimeout(Promise.resolve(1),100),/Session changed/);
});
test('a completed sleep resolves and a canceled retry cannot run later',async()=>{
  const c=clock(),t=createTimers(c);let calls=0;
  const sleeping=t.sleep(100);[...c.pending.values()][0]();await sleeping;
  assert.equal(c.pending.size,0);
  const retry=t.after(()=>calls++,100);const callback=c.pending.get(retry);t.cancel(retry);callback();
  assert.equal(calls,0);assert.equal(c.pending.size,0);
});
