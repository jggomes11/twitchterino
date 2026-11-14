'use strict';
const {createSessionClient}=require('./requests');

function createPartnersClient({platform,fetch,now=Date.now,timeoutMs=20000}) {
  if(!['twitch','kick'].includes(platform))throw new Error('Invalid platform');
  const url=`https://viinnisantoos.github.io/${platform}terino/parceiros.json`;
  const valid=platform==='twitch'?/^[a-z0-9_]{2,25}$/:/^[a-z0-9_-]{2,30}$/;
  const client=createSessionClient({
    getSession:()=>({fetch:(target,options)=>fetch(target,{...options,credentials:'omit',cache:'no-store'})}),
    getHeaders:async()=>({}),resolveUrl:input=>{if(input!=='partners')throw new Error('Invalid request');return url;},timeoutMs,
  });
  let cached=null,until=0,pending=null,retryAt=0,stopped=false;
  async function get() {
    if(stopped)throw new Error('Partner lookup stopped');
    if(cached && now()<until)return [...cached];
    if(now()<retryAt)throw new Error('Partner lookup unavailable');
    if(!pending)pending=(async()=>{
      try {
        const {status,json}=await client.request('partners');
        if(status!==200 || !Array.isArray(json?.channels))throw new Error('Invalid partner catalog');
        cached=Object.freeze([...new Set(json.channels.filter(s=>typeof s==='string').map(s=>s.toLowerCase()).filter(s=>valid.test(s)))].slice(0,60));
        // Coalesce one refresh wave, without skipping the existing six-hour schedule.
        until=now()+60000;retryAt=0;return cached;
      } catch(error){retryAt=now()+60000;throw error;}
      finally{pending=null;}
    })();
    return [...await pending];
  }
  return {get,stop(){stopped=true;client.suspend();cached=null;}};
}
module.exports={createPartnersClient};
