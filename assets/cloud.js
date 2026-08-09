(function(){
  const cfg = window.VOLANTEO_CONFIG || {};
  const url = String(cfg.SUPABASE_URL || '').trim();
  const key = String(cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY || '').trim();
  const enabled = Boolean(url && key);
  let client = null;
  let initPromise = null;

  function loadScript(src,timeoutMs=6000){
    return new Promise((resolve,reject)=>{
      if(window.supabase?.createClient) return resolve(src);
      let done=false;
      const s=document.createElement('script');
      const finish=(ok,err)=>{if(done)return;done=true;clearTimeout(timer);if(!ok)s.remove();ok?resolve(src):reject(err||new Error('No se pudo cargar Supabase JS'))};
      s.src=src;s.async=true;s.crossOrigin='anonymous';s.onload=()=>finish(Boolean(window.supabase?.createClient),new Error('Supabase JS cargó sin exponer createClient'));s.onerror=()=>finish(false,new Error('No se pudo cargar '+src));
      const timer=setTimeout(()=>finish(false,new Error('Tiempo de espera agotado al cargar '+src)),timeoutMs);
      document.head.appendChild(s);
    });
  }
  async function ensureSupabaseLibrary(){
    if(window.supabase?.createClient)return true;
    const sources=[
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js',
      'https://unpkg.com/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js'
    ];
    let lastError=null;
    for(const src of sources){try{await loadScript(src);if(window.supabase?.createClient)return true}catch(err){lastError=err}}
    throw lastError||new Error('No se pudo cargar Supabase JS');
  }
  async function init(){
    if(!enabled) return null;
    if(client) return client;
    if(!initPromise) initPromise=(async()=>{
      await ensureSupabaseLibrary();
      client=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      return client;
    })().catch(err=>{initPromise=null;throw err});
    return initPromise;
  }
  async function getSession(){const c=await init();if(!c)return null;const {data,error}=await c.auth.getSession();if(error)throw error;return data.session}
  async function adminSignIn(email,password){const c=await init();const {data,error}=await c.auth.signInWithPassword({email,password});if(error)throw error;return data.session}
  async function adminSignOut(){const c=await init();if(c)await c.auth.signOut()}
  async function isAdmin(){const c=await init();const {data,error}=await c.rpc('is_admin');if(error)throw error;return Boolean(data)}

  function findRoute(state,routeId){
    for(const j of state?.journeys||[])for(const e of j.exercises||[])for(const r of e.routes||[])if(String(r.id)===String(routeId))return r;
    return null;
  }
  async function hydrateRuntime(state){
    const c=await init();if(!c||!state)return state;
    const [{data:runtime,error:rerr},{data:reports,error:perr}] = await Promise.all([
      c.from('route_runtime').select('*'),
      c.from('route_reports').select('*').order('reported_at',{ascending:true})
    ]);
    if(rerr) throw rerr;if(perr) throw perr;
    const reportMap=new Map();
    for(const rep of reports||[]){const arr=reportMap.get(rep.route_id)||[];arr.push({id:rep.id,number:rep.block_number,reportedAt:rep.reported_at,reportedBy:rep.reported_by||'',brigadistaId:rep.brigadista_id,lat:rep.lat,lng:rep.lng});reportMap.set(rep.route_id,arr)}
    for(const rt of runtime||[]){
      const r=findRoute(state,rt.route_id);if(!r)continue;
      r.status=rt.status||r.status||'pending';r.progress=Number(rt.progress||0);r.completedBlocks=Number(rt.completed_blocks||0);r.completedUnits=Number(rt.completed_units ?? r.completedBlocks ?? 0);
      r.startedAt=rt.started_at||r.startedAt;r.finishedAt=rt.finished_at||r.finishedAt;r.lastPosition=rt.last_position||null;r.lastPositionAt=rt.last_position_at||null;r.lastProgressAt=rt.last_progress_at||null;
      r.blockReports=reportMap.get(rt.route_id)||[];
    }
    // Rutas sin runtime todavía siguen con snapshot de planeación.
    return state;
  }
  async function adminLoadState(){
    const c=await init();const {data,error}=await c.from('app_state').select('state').eq('id','main').maybeSingle();if(error)throw error;
    return data?.state ? hydrateRuntime(data.state) : null;
  }
  async function adminSaveState(state){
    const c=await init();
    const {error}=await c.from('app_state').upsert({id:'main',state,updated_at:new Date().toISOString()},{onConflict:'id'});if(error)throw error;
    const {error:syncError}=await c.rpc('admin_sync_brigadistas',{p_people:state?.brigadistas||[]});if(syncError)throw syncError;
    return true;
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
  async function fieldListBrigadistas(){const c=await init();const {data,error}=await c.rpc('field_list_brigadistas');if(error)throw error;return data||[]}
  async function fieldGetAssignment(brigadistaId,pin){const c=await init();const {data,error}=await c.rpc('field_get_assignment',{p_brigadista_id:brigadistaId,p_pin:String(pin||'')});if(error)throw error;return data}
  async function fieldStart(brigadistaId,pin,routeId){const c=await init();const {data,error}=await c.rpc('field_start_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId});if(error)throw error;return data}
  async function fieldReportBlock(brigadistaId,pin,routeId,position){const c=await init();const {data,error}=await c.rpc('field_report_block',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position?.lat??null,p_lng:position?.lng??null});if(error)throw error;return data}
  async function fieldReportProgress(brigadistaId,pin,routeId){const c=await init();const {data,error}=await c.rpc('field_report_progress',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId});if(error)throw error;return data}
  async function fieldLocation(brigadistaId,pin,routeId,position){const c=await init();const {data,error}=await c.rpc('field_update_location',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position.lat,p_lng:position.lng,p_accuracy_m:position.accuracy??null});if(error)throw error;return data}
  async function fieldFinish(brigadistaId,pin,routeId){const c=await init();const {data,error}=await c.rpc('field_finish_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId});if(error)throw error;return data}

  window.VolanteoCloud={enabled,init,getSession,adminSignIn,adminSignOut,isAdmin,adminLoadState,adminSaveState,subscribeAdmin,fieldListBrigadistas,fieldGetAssignment,fieldStart,fieldReportBlock,fieldReportProgress,fieldLocation,fieldFinish};
})();
