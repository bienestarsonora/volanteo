(function(){
  const cfg = window.VOLANTEO_CONFIG || {};
  const url = String(cfg.SUPABASE_URL || '').trim();
  const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY || '').trim();
  const enabled = Boolean(url && key);
  let client = null;
  let initPromise = null;
  let createClientFn = null;

  function timeout(promise, ms, label='La operación'){
    let timer;
    const limit = new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(`${label} tardó demasiado. Revisa tu conexión y vuelve a intentar.`)),ms);
    });
    return Promise.race([promise,limit]).finally(()=>clearTimeout(timer));
  }

  function loadScript(src,timeoutMs=5000){
    return new Promise((resolve,reject)=>{
      if(window.supabase?.createClient) return resolve(window.supabase.createClient);
      let done=false;
      const s=document.createElement('script');
      const finish=(ok,err)=>{
        if(done)return;done=true;clearTimeout(timer);
        if(!ok)s.remove();
        ok?resolve(window.supabase.createClient):reject(err||new Error('No se pudo cargar Supabase JS'));
      };
      s.src=src;s.async=true;s.crossOrigin='anonymous';
      s.onload=()=>finish(Boolean(window.supabase?.createClient),new Error('Supabase JS cargó, pero createClient no quedó disponible.'));
      s.onerror=()=>finish(false,new Error('No se pudo cargar '+src));
      const timer=setTimeout(()=>finish(false,new Error('Tiempo de espera agotado al cargar '+src)),timeoutMs);
      document.head.appendChild(s);
    });
  }

  async function ensureSupabaseLibrary(){
    if(createClientFn)return createClientFn;
    if(window.supabase?.createClient){createClientFn=window.supabase.createClient;return createClientFn;}

    // v33: SDK moderno compatible con publishable keys. Primero ESM; después UMD.
    const moduleSources=[
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/+esm'
    ];
    const scriptSources=[
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.0/dist/umd/supabase.min.js',
      'https://unpkg.com/@supabase/supabase-js@2.112.0/dist/umd/supabase.min.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
    ];
    let lastError=null;
    for(const src of moduleSources){
      try{
        const mod=await timeout(import(src),6000,'La carga del cliente Supabase');
        if(typeof mod?.createClient==='function'){createClientFn=mod.createClient;return createClientFn;}
      }catch(err){lastError=err;console.warn('Falló Supabase ESM',src,err)}
    }
    for(const src of scriptSources){
      try{createClientFn=await loadScript(src,5000);if(createClientFn)return createClientFn}
      catch(err){lastError=err;console.warn('Falló Supabase UMD',src,err)}
    }
    throw lastError||new Error('No se pudo cargar Supabase JS desde ningún proveedor.');
  }

  async function init(){
    if(!enabled) return null;
    if(client) return client;
    if(!initPromise) initPromise=(async()=>{
      const createClient=await ensureSupabaseLibrary();
      client=createClient(url,key,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
        global:{headers:{'x-application-name':'volanteo-bienestar-sonora'}}
      });
      return client;
    })().catch(err=>{initPromise=null;throw err});
    return timeout(initPromise,12000,'La conexión con Supabase');
  }

  async function getSession(){
    const c=await init();if(!c)return null;
    const {data,error}=await timeout(c.auth.getSession(),7000,'La verificación de sesión');
    if(error)throw error;return data.session;
  }
  async function adminSignIn(email,password){
    const c=await init();
    const {data,error}=await timeout(c.auth.signInWithPassword({email,password}),12000,'El inicio de sesión');
    if(error)throw error;return data.session;
  }
  async function adminSignOut(){const c=await init();if(c)await timeout(c.auth.signOut(),7000,'El cierre de sesión')}
  async function isAdmin(){
    const c=await init();
    const {data,error}=await timeout(c.rpc('is_admin'),9000,'La validación del rol administrador');
    if(error)throw error;return Boolean(data);
  }

  function findRoute(state,routeId){
    for(const j of state?.journeys||[])for(const e of j.exercises||[])for(const r of e.routes||[])if(String(r.id)===String(routeId))return r;
    return null;
  }
  async function hydrateRuntime(state){
    const c=await init();if(!c||!state)return state;
    const [{data:runtime,error:rerr},{data:reports,error:perr}] = await timeout(Promise.all([
      c.from('route_runtime').select('*'),
      c.from('route_reports').select('*').order('reported_at',{ascending:true})
    ]),12000,'La carga del seguimiento');
    if(rerr) throw rerr;if(perr) throw perr;
    const reportMap=new Map();
    for(const rep of reports||[]){const arr=reportMap.get(rep.route_id)||[];arr.push({id:rep.id,number:rep.block_number,reportedAt:rep.reported_at,reportedBy:rep.reported_by||'',brigadistaId:rep.brigadista_id,lat:rep.lat,lng:rep.lng});reportMap.set(rep.route_id,arr)}
    for(const rt of runtime||[]){
      const r=findRoute(state,rt.route_id);if(!r)continue;
      r.status=rt.status||r.status||'pending';r.progress=Number(rt.progress||0);r.completedBlocks=Number(rt.completed_blocks||0);r.completedUnits=Number(rt.completed_units ?? r.completedBlocks ?? 0);
      r.startedAt=rt.started_at||r.startedAt;r.finishedAt=rt.finished_at||r.finishedAt;r.lastPosition=rt.last_position||null;r.lastPositionAt=rt.last_position_at||null;r.lastProgressAt=rt.last_progress_at||null;
      r.blockReports=reportMap.get(rt.route_id)||[];
    }
    return state;
  }
  async function adminLoadState(){
    const c=await init();
    const {data,error}=await timeout(c.from('app_state').select('state').eq('id','main').maybeSingle(),10000,'La carga de la planeación');
    if(error)throw error;return data?.state ? hydrateRuntime(data.state) : null;
  }
  async function adminSaveState(state){
    const c=await init();
    const {error}=await timeout(c.from('app_state').upsert({id:'main',state,updated_at:new Date().toISOString()},{onConflict:'id'}),12000,'El guardado de la planeación');
    if(error)throw error;
    const {error:syncError}=await timeout(c.rpc('admin_sync_brigadistas',{p_people:state?.brigadistas||[]}),12000,'La sincronización de brigadistas');
    if(syncError)throw syncError;return true;
  }
  async function subscribeAdmin(onChange){
    const c=await init();
    const channel=c.channel('volanteo-admin-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'app_state'},()=>onChange('state'))
      .on('postgres_changes',{event:'*',schema:'public',table:'route_runtime'},()=>onChange('runtime'))
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'route_reports'},()=>onChange('report'))
      .subscribe();
    return channel;
  }
  async function fieldListBrigadistas(){const c=await init();const {data,error}=await timeout(c.rpc('field_list_brigadistas'),10000,'La carga de brigadistas');if(error)throw error;return data||[]}
  async function fieldGetAssignment(brigadistaId,pin){const c=await init();const {data,error}=await timeout(c.rpc('field_get_assignment',{p_brigadista_id:brigadistaId,p_pin:String(pin||'')}),10000,'La carga de la asignación');if(error)throw error;return data}
  async function fieldStart(brigadistaId,pin,routeId){const c=await init();const {data,error}=await timeout(c.rpc('field_start_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId}),10000,'El inicio del recorrido');if(error)throw error;return data}
  async function fieldReportBlock(brigadistaId,pin,routeId,position){const c=await init();const {data,error}=await timeout(c.rpc('field_report_block',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position?.lat??null,p_lng:position?.lng??null}),10000,'El reporte de cuadra');if(error)throw error;return data}
  async function fieldReportProgress(brigadistaId,pin,routeId){const c=await init();const {data,error}=await timeout(c.rpc('field_report_progress',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId}),10000,'El reporte de avance');if(error)throw error;return data}
  async function fieldLocation(brigadistaId,pin,routeId,position){const c=await init();const {data,error}=await timeout(c.rpc('field_update_location',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position.lat,p_lng:position.lng,p_accuracy_m:position.accuracy??null}),10000,'La actualización GPS');if(error)throw error;return data}
  async function fieldFinish(brigadistaId,pin,routeId){const c=await init();const {data,error}=await timeout(c.rpc('field_finish_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId}),10000,'El cierre del recorrido');if(error)throw error;return data}

  window.VolanteoCloud={enabled,init,getSession,adminSignIn,adminSignOut,isAdmin,adminLoadState,adminSaveState,subscribeAdmin,fieldListBrigadistas,fieldGetAssignment,fieldStart,fieldReportBlock,fieldReportProgress,fieldLocation,fieldFinish};
})();
