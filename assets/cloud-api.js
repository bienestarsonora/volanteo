(function(){
  const cfg=window.VOLANTEO_CONFIG||{};
  const base=String(cfg.SUPABASE_URL||'').trim().replace(/\/$/,'');
  const key=String(cfg.SUPABASE_PUBLISHABLE_KEY||cfg.SUPABASE_ANON_KEY||'').trim();
  const enabled=Boolean(base&&key);
  const SESSION_KEY='volanteo_supabase_admin_session';
  let pollHandles=new Set();

  function withTimeout(promise,ms,label='La operación'){
    let timer;
    const limit=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} tardó demasiado. Intenta de nuevo.`)),ms)});
    return Promise.race([promise,limit]).finally(()=>clearTimeout(timer));
  }
  async function parseResponse(res){
    const text=await res.text();
    if(!text)return null;
    try{return JSON.parse(text)}catch(_e){return text}
  }
  function apiError(data,res){
    const msg=(data&&typeof data==='object'&&(data.msg||data.message||data.error_description||data.error||data.hint))||
      (typeof data==='string'&&data)||`Error ${res.status}`;
    const err=new Error(String(msg));err.status=res.status;err.payload=data;return err;
  }
  function readStoredSession(){
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch(_e){return null}
  }
  function storeSession(session){
    if(!session){localStorage.removeItem(SESSION_KEY);return}
    const expiresAt=session.expires_at||Math.floor(Date.now()/1000)+Number(session.expires_in||3600);
    localStorage.setItem(SESSION_KEY,JSON.stringify({...session,expires_at:expiresAt}));
  }
  async function authFetch(path,{method='GET',body=null,token=null,timeoutMs=10000}={}){
    const headers={'apikey':key,'Content-Type':'application/json'};
    if(token)headers.Authorization=`Bearer ${token}`;
    const req=fetch(`${base}${path}`,{method,headers,body:body==null?undefined:JSON.stringify(body),cache:'no-store',mode:'cors',credentials:'omit'});
    let res;try{res=await withTimeout(req,timeoutMs,'La conexión con Supabase')}catch(err){if(err instanceof TypeError)throw new Error('No fue posible conectar con Supabase desde el navegador. Revisa tu conexión o bloqueadores y vuelve a intentar.');throw err}
    const data=await parseResponse(res);
    if(!res.ok)throw apiError(data,res);
    return data;
  }
  async function refreshSession(session){
    if(!session?.refresh_token)return null;
    const data=await authFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},timeoutMs:10000});
    storeSession(data);return readStoredSession();
  }
  async function getValidSession({verify=true}={}){
    let session=readStoredSession();
    if(!session?.access_token)return null;
    const now=Math.floor(Date.now()/1000);
    if(Number(session.expires_at||0)<=now+30){
      try{session=await refreshSession(session)}catch(err){storeSession(null);throw err}
    }
    if(!verify)return session;
    try{
      const user=await authFetch('/auth/v1/user',{token:session.access_token,timeoutMs:7000});
      session.user=user;storeSession(session);return session;
    }catch(err){
      if(err.status===401){storeSession(null);return null}
      throw err;
    }
  }
  async function init(){if(!enabled)return null;return {native:true,url:base}}
  async function getSession(){if(!enabled)return null;return getValidSession({verify:true})}
  async function adminSignIn(email,password){
    if(!enabled)throw new Error('Supabase no está configurado.');
    const data=await authFetch('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},timeoutMs:12000});
    storeSession(data);return readStoredSession();
  }
  async function adminSignOut(){
    const session=readStoredSession();
    try{if(session?.access_token)await authFetch('/auth/v1/logout',{method:'POST',token:session.access_token,timeoutMs:5000})}catch(_e){}
    storeSession(null);
  }
  async function request(path,{method='GET',body=null,admin=false,headers={},timeoutMs=12000,retry=true}={}){
    let session=admin?await getValidSession({verify:false}):null;
    const h={'apikey':key,'Accept':'application/json',...headers};
    if(body!=null)h['Content-Type']='application/json';
    if(session?.access_token)h.Authorization=`Bearer ${session.access_token}`;
    const doFetch=async()=>{
      const res=await withTimeout(fetch(`${base}${path}`,{method,headers:h,body:body==null?undefined:JSON.stringify(body),cache:'no-store'}),timeoutMs,'La operación con Supabase');
      const data=await parseResponse(res);
      if(!res.ok)throw apiError(data,res);return data;
    };
    try{return await doFetch()}catch(err){
      if(admin&&retry&&err.status===401&&session?.refresh_token){
        session=await refreshSession(session);h.Authorization=`Bearer ${session.access_token}`;return doFetch();
      }
      throw err;
    }
  }
  async function rpc(name,args={},admin=false){return request(`/rest/v1/rpc/${encodeURIComponent(name)}`,{method:'POST',body:args,admin,timeoutMs:12000})}
  async function isAdmin(){return Boolean(await rpc('is_admin',{},true))}

  function findRoute(state,routeId){for(const j of state?.journeys||[])for(const e of j.exercises||[])for(const r of e.routes||[])if(String(r.id)===String(routeId))return r;return null}
  async function hydrateRuntime(state){
    if(!state)return state;
    const [runtime,reports]=await Promise.all([
      request('/rest/v1/route_runtime?select=*',{admin:true}),
      request('/rest/v1/route_reports?select=*&order=reported_at.asc',{admin:true})
    ]);
    const reportMap=new Map();
    for(const rep of reports||[]){const arr=reportMap.get(rep.route_id)||[];arr.push({id:rep.id,number:rep.block_number,reportedAt:rep.reported_at,reportedBy:rep.reported_by||'',brigadistaId:rep.brigadista_id,lat:rep.lat,lng:rep.lng});reportMap.set(rep.route_id,arr)}
    for(const rt of runtime||[]){const r=findRoute(state,rt.route_id);if(!r)continue;r.status=rt.status||r.status||'pending';r.progress=Number(rt.progress||0);r.completedBlocks=Number(rt.completed_blocks||0);r.completedUnits=Number(rt.completed_units??r.completedBlocks??0);r.startedAt=rt.started_at||r.startedAt;r.finishedAt=rt.finished_at||r.finishedAt;r.lastPosition=rt.last_position||null;r.lastPositionAt=rt.last_position_at||null;r.lastProgressAt=rt.last_progress_at||null;r.blockReports=reportMap.get(rt.route_id)||[]}
    return state;
  }
  async function adminLoadState(){
    const rows=await request('/rest/v1/app_state?id=eq.main&select=state',{admin:true,timeoutMs:10000});
    return rows?.[0]?.state?hydrateRuntime(rows[0].state):null;
  }
  async function adminSaveState(state){
    await request('/rest/v1/app_state?on_conflict=id',{method:'POST',admin:true,body:{id:'main',state,updated_at:new Date().toISOString()},headers:{'Prefer':'resolution=merge-duplicates,return=minimal'}});
    await rpc('admin_sync_brigadistas',{p_people:state?.brigadistas||[]},true);return true;
  }
  async function subscribeAdmin(onChange){
    // Sin dependencias externas: refresco casi inmediato y estable en GitHub Pages.
    let busy=false;
    const id=setInterval(async()=>{if(document.hidden||busy)return;busy=true;try{await onChange('poll')}finally{busy=false}},2500);
    pollHandles.add(id);
    return {unsubscribe(){clearInterval(id);pollHandles.delete(id)}};
  }

  async function fieldListBrigadistas(){return (await rpc('field_list_brigadistas',{},false))||[]}
  async function fieldGetAssignment(brigadistaId,pin){return rpc('field_get_assignment',{p_brigadista_id:brigadistaId,p_pin:String(pin||'')},false)}
  async function fieldStart(brigadistaId,pin,routeId){return rpc('field_start_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId},false)}
  async function fieldReportBlock(brigadistaId,pin,routeId,position){return rpc('field_report_block',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position?.lat??null,p_lng:position?.lng??null},false)}
  async function fieldReportProgress(brigadistaId,pin,routeId){return rpc('field_report_progress',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId},false)}
  async function fieldLocation(brigadistaId,pin,routeId,position){return rpc('field_update_location',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position.lat,p_lng:position.lng,p_accuracy_m:position.accuracy??null},false)}
  async function fieldFinish(brigadistaId,pin,routeId){return rpc('field_finish_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId},false)}

  window.VolanteoCloud={enabled,init,getSession,adminSignIn,adminSignOut,isAdmin,adminLoadState,adminSaveState,subscribeAdmin,fieldListBrigadistas,fieldGetAssignment,fieldStart,fieldReportBlock,fieldReportProgress,fieldLocation,fieldFinish};
})();
