// Check the public HTML only. Never cache account data or reload an active call.
export function entryScript(html){return html.match(/\bsrc=["'](\/assets\/index-[^"']+\.js)["']/)?.[1]||null;}
export function watchSiteUpdate(onUpdate){
  const current=Array.from(document.scripts).map(s=>s.getAttribute('src')).find(s=>/^\/assets\/index-.+\.js$/.test(s||''));
  if(!current)return ()=>{}; // Vite development mode has no production fingerprint.
  let stopped=false,checking=false,found=false;
  const check=async()=>{
    if(stopped||checking||found||document.visibilityState==='hidden')return;
    checking=true;
    try{const response=await fetch('/',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)});
      if(response.ok){const latest=entryScript(await response.text());if(!stopped&&latest&&latest!==current){found=true;onUpdate();}}
    }catch{}finally{checking=false;}
  };
  const timer=setInterval(check,60000);document.addEventListener('visibilitychange',check);void check();
  return ()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',check);};
}
