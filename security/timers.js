'use strict';

function createTimers(clock=globalThis) {
  let stopped=false;
  const callbacks=new Set(),intervals=new Set(),operations=new Set();
  function cancel(timer) {
    if(intervals.delete(timer))clock.clearInterval(timer);
    else {callbacks.delete(timer);clock.clearTimeout(timer);}
  }
  function after(callback,ms) {
    if(stopped)return null;
    const timer=clock.setTimeout(()=>{
      if(!callbacks.delete(timer)||stopped)return;
      return callback();
    },ms);
    callbacks.add(timer);return timer;
  }
  function every(callback,ms) {
    if(stopped)return null;
    const timer=clock.setInterval(()=>{if(!stopped&&intervals.has(timer))return callback();},ms);
    intervals.add(timer);return timer;
  }
  function wait(promise,ms,sleep=false) {
    if(stopped)return Promise.reject(new Error('Session changed'));
    return new Promise((resolve,reject)=>{
      let done=false,timer;
      const finish=(error,value)=>{
        if(done)return;
        done=true;clock.clearTimeout(timer);operations.delete(abort);
        if(error)reject(error);else resolve(value);
      };
      const abort=()=>finish(new Error('Session changed'));
      operations.add(abort);
      timer=clock.setTimeout(()=>finish(sleep?null:new Error('timeout')),ms);
      if(!sleep)Promise.resolve(promise).then(value=>finish(null,value),error=>finish(error));
    });
  }
  function stop() {
    stopped=true;
    for(const timer of callbacks)clock.clearTimeout(timer);
    for(const timer of intervals)clock.clearInterval(timer);
    callbacks.clear();intervals.clear();
    for(const abort of [...operations])abort();
  }
  return {after,every,cancel,withTimeout:(promise,ms)=>wait(promise,ms),sleep:ms=>wait(null,ms,true),stop};
}
module.exports={createTimers};
