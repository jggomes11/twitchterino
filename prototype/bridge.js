'use strict';
(function(root){
  function createBridge(invoke,listen){
    let selected='account-1',epoch=0,initialized=false;
    const valid=id=>/^account-[1-4]$/.test(id);
    const call=async(command,...args)=>{
      const id=selected,ticket=epoch;
      const reply=await invoke('account_command',{id,command,args});
      if(ticket!==epoch || id!==selected)return null;
      const result=reply?.result;
      return result && typeof result==='object'?{...result,accountId:id}:result;
    };
    const event=(name,callback)=>{void listen(name,e=>{
      const m=e.payload;if(!m||m.accountId!==selected)return;
      callback(name==='status'?m:m.payload,m.accountId);
    });};
    const unsupported=()=>Promise.reject(new Error('Função fora do escopo deste protótipo.'));
    return Object.freeze({
      selectAccount:async id=>{if(!valid(id))throw new Error('Conta inválida');initialized=true;selected=id;epoch++;return invoke('select_account',{id});},
      getState:async()=>{const state=await invoke('snapshot');if(!initialized&&valid(state.accountId)){selected=state.accountId;initialized=true;}return state;},
      addChannel:slug=>call('channels:add',slug),removeChannel:slug=>call('channels:remove',slug),
      setFarming:on=>call('farming:set',on),setMaxWatchers:n=>call('maxWatchers:set',n),
      setRotation:on=>call('rotation:set',on),setBonusTarget:kind=>call('bonusTarget:set',kind),
      setLowQuality:on=>call('lowQuality:set',on),setAutoChest:on=>call('autoChest:set',on),
      toggleFavorite:slug=>call('favorite:toggle',slug),refresh:()=>call('refresh'),
      showLogin:()=>call('login:show'),logout:()=>call('logout'),
      showChannel:slug=>call('channel:show',slug),openStore:slug=>call('store:open',slug),
      sendChat:(chatroomId,content)=>call('chat:send',{chatroomId,content}),
      quit:()=>call('app:quit'),introDone:()=>Promise.resolve({ok:true}),
      setWatchAll:unsupported,setAutostart:unsupported,setNotifyBonus:unsupported,setNotifyChest:unsupported,
      setNotifyChat:unsupported,setSleepMode:unsupported,startLimitTest:unsupported,stopLimitTest:unsupported,
      addPurchase:unsupported,removePurchase:unsupported,openStoreSequence:unsupported,cancelStoreSequence:unsupported,
      getReport:unsupported,saveReport:unsupported,
      onStatus:cb=>event('status',cb),onChat:cb=>event('chat',cb),onToast:cb=>event('toast',cb),
      onSelect:cb=>event('select',cb),onAccountSelect:cb=>{void listen('account:activate',e=>cb(e.payload));},
    });
  }
  if(typeof module==='object'&&module.exports)module.exports={createBridge};
  else{
    const bridge=createBridge(root.__TAURI__.core.invoke,root.__TAURI__.event.listen);
    root[root.TERINO_PLATFORM==='kick'?'kick':'tt']=bridge;
    addEventListener('unhandledrejection',e=>{
      e.preventDefault();const container=document.querySelector('#toasts');if(!container)return;
      const node=document.createElement('div');node.className='toast';node.textContent=e.reason?.message||String(e.reason||'Operação indisponível');container.append(node);setTimeout(()=>node.remove(),7000);
    });
    document.addEventListener('DOMContentLoaded',()=>{
      for(const id of ['watch-all','autostart','notify-bonus','notify-chest','notify-chat','sleep-mode','btn-limit','btn-report']){
        const node=document.getElementById(id);if(node){node.disabled=true;node.title='Fora do escopo do protótipo';node.closest('label')?.classList.add('prototype-disabled');}
      }
      const max=document.querySelector('#max-watchers');if(max){max.max='2';max.title='Teste com até duas lives por conta';}
      const quit=document.querySelector('#btn-quit');if(quit)quit.hidden=false;
      const brand=document.querySelector('.brand-name');if(brand){const badge=document.createElement('small');badge.className='prototype-badge';badge.textContent='Protótipo';brand.append(badge);}
    });
  }
})(typeof window==='object'?window:globalThis);
