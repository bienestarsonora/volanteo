(function(){
  const cssUrls=[
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
  ];
  const jsUrls=[
    'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  ];
  let promise=null;
  let cssInjected=false;

  function injectCss(){
    if(cssInjected)return;
    cssInjected=true;
    cssUrls.forEach((href,i)=>{
      if(document.querySelector(`link[data-leaflet-fallback="${i}"]`))return;
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href=href;
      link.dataset.leafletFallback=String(i);
      document.head.appendChild(link);
    });
  }

  function tryScript(src,timeoutMs=3500){
    return new Promise(resolve=>{
      let settled=false;
      const script=document.createElement('script');
      const finish=(ok,reason)=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        if(!ok)script.remove();
        resolve({ok,src,reason});
      };
      script.src=src;
      script.async=true;
      script.crossOrigin='anonymous';
      script.onload=()=>finish(Boolean(window.L),window.L?'loaded':'loaded-without-L');
      script.onerror=()=>finish(false,'network-error');
      const timer=setTimeout(()=>finish(false,'timeout'),timeoutMs);
      document.head.appendChild(script);
    });
  }

  async function ensureLeaflet(){
    if(window.L)return {ok:true,source:'already-loaded'};
    if(promise)return promise;
    promise=(async()=>{
      injectCss();
      const attempts=[];
      for(const src of jsUrls){
        if(window.L)return {ok:true,source:src,attempts};
        const result=await tryScript(src);
        attempts.push(result);
        if(window.L)return {ok:true,source:src,attempts};
      }
      return {ok:false,source:null,attempts};
    })();
    const result=await promise;
    window.MapRuntime.lastResult=result;
    return result;
  }

  window.MapRuntime={ensureLeaflet,lastResult:null};
})();
