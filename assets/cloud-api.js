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
  function gpsDistanceMeters(a,b){
    if(!a||!b)return 0;
    const lat1=Number(a.lat),lng1=Number(a.lng),lat2=Number(b.lat),lng2=Number(b.lng);
    if(![lat1,lng1,lat2,lng2].every(Number.isFinite))return 0;
    const R=6371000,toRad=v=>v*Math.PI/180,dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
    const q=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    const d=2*R*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
    return d>=3&&d<=500?d:0;
  }
  function hydrateGpsTracks(state,locations){
    for(const j of state?.journeys||[])for(const e of j.exercises||[])for(const r of e.routes||[]){
      Object.defineProperties(r,{
        gpsTracks:{value:[],writable:true,configurable:true,enumerable:false},
        gpsPointCount:{value:0,writable:true,configurable:true,enumerable:false},
        gpsDistanceKm:{value:0,writable:true,configurable:true,enumerable:false},
        gpsFirstAt:{value:null,writable:true,configurable:true,enumerable:false},
        gpsLastAt:{value:null,writable:true,configurable:true,enumerable:false}
      });
    }
    const grouped=new Map();
    for(const loc of locations||[]){
      const routeId=String(loc.route_id||''),personId=String(loc.brigadista_id||'');if(!routeId||!personId)continue;
      const routeMap=grouped.get(routeId)||new Map(),pts=routeMap.get(personId)||[];
      pts.push({lat:Number(loc.lat),lng:Number(loc.lng),accuracy:Number(loc.accuracy_m||0),at:loc.recorded_at,brigadistaId:personId});routeMap.set(personId,pts);grouped.set(routeId,routeMap);
    }
    const names=new Map((state?.brigadistas||[]).map(p=>[String(p.id),p.name]));
    for(const [routeId,routeMap] of grouped){
      const r=findRoute(state,routeId);if(!r)continue;
      const tracks=[...routeMap.entries()].map(([brigadistaId,points])=>{
        points.sort((a,b)=>new Date(a.at)-new Date(b.at));
        let distanceM=0;for(let i=1;i<points.length;i++)distanceM+=gpsDistanceMeters(points[i-1],points[i]);
        return{brigadistaId,name:names.get(brigadistaId)||'Brigadista',points,distanceM};
      });
      const pointCount=tracks.reduce((n,t)=>n+t.points.length,0),distanceKm=tracks.reduce((n,t)=>n+t.distanceM,0)/1000;
      const all=tracks.flatMap(t=>t.points).sort((a,b)=>new Date(a.at)-new Date(b.at));
      // La huella GPS es un dato operativo derivado de route_locations; no debe volver a
      // guardarse dentro de app_state ni inflar el JSON de planeación.
      Object.defineProperties(r,{
        gpsTracks:{value:tracks,writable:true,configurable:true,enumerable:false},
        gpsPointCount:{value:pointCount,writable:true,configurable:true,enumerable:false},
        gpsDistanceKm:{value:distanceKm,writable:true,configurable:true,enumerable:false},
        gpsFirstAt:{value:all[0]?.at||null,writable:true,configurable:true,enumerable:false},
        gpsLastAt:{value:all.at(-1)?.at||null,writable:true,configurable:true,enumerable:false}
      });
    }
  }
  async function hydrateRuntime(state){
    if(!state)return state;
    const [runtime,reports,locations]=await Promise.all([
      request('/rest/v1/route_runtime?select=*',{admin:true}),
      request('/rest/v1/route_reports?select=*&order=reported_at.asc',{admin:true}),
      request('/rest/v1/route_locations?select=id,route_id,brigadista_id,lat,lng,accuracy_m,recorded_at&order=recorded_at.desc&limit=10000',{admin:true,timeoutMs:12000}).catch(err=>{console.warn('No se pudo cargar la huella GPS',err);return[]})
    ]);
    const reportMap=new Map();
    for(const rep of reports||[]){const arr=reportMap.get(rep.route_id)||[];arr.push({id:rep.id,number:rep.block_number,reportedAt:rep.reported_at,reportedBy:rep.reported_by||'',brigadistaId:rep.brigadista_id,lat:rep.lat,lng:rep.lng,validationStatus:rep.validation_status||'review',validationReason:rep.validation_reason||'',gpsPoints:Number(rep.gps_points_since_last||0),movementM:Number(rep.movement_m||0),accuracyM:rep.accuracy_m==null?null:Number(rep.accuracy_m),inZone:rep.in_zone,elapsedSeconds:Number(rep.elapsed_seconds||0)});reportMap.set(rep.route_id,arr)}
    for(const rt of runtime||[]){const r=findRoute(state,rt.route_id);if(!r)continue;r.status=rt.status||r.status||'pending';r.progress=Number(rt.progress||0);r.completedBlocks=Number(rt.completed_blocks||0);r.completedUnits=Number(rt.completed_units??r.completedBlocks??0);r.startedAt=rt.started_at||r.startedAt;r.finishedAt=rt.finished_at||r.finishedAt;r.lastPosition=rt.last_position||null;r.lastPositionAt=rt.last_position_at||null;r.lastProgressAt=rt.last_progress_at||null;r.blockReports=reportMap.get(rt.route_id)||[]}
    hydrateGpsTracks(state,locations);
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
  async function adminDeleteRouteData(routeId){
    const rid=encodeURIComponent(String(routeId||''));
    if(!rid)return false;
    // Limpia solamente datos operativos de la ruta borrada. app_state se persiste aparte.
    await request(`/rest/v1/route_reports?route_id=eq.${rid}`,{method:'DELETE',admin:true,headers:{'Prefer':'return=minimal'}});
    await request(`/rest/v1/route_locations?route_id=eq.${rid}`,{method:'DELETE',admin:true,headers:{'Prefer':'return=minimal'}});
    await request(`/rest/v1/route_runtime?route_id=eq.${rid}`,{method:'DELETE',admin:true,headers:{'Prefer':'return=minimal'}});
    return true;
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
  async function fieldGetAssignments(brigadistaId,pin){
    const args={p_brigadista_id:brigadistaId,p_pin:String(pin||'')};
    try{
      const data=await rpc('field_get_assignments',args,false);
      if(Array.isArray(data?.assignments))return data;
      if(Array.isArray(data))return {assignments:data};
      return {assignments:[]};
    }catch(err){
      const msg=String(err?.message||'');
      const missing=err?.status===404||/field_get_assignments|PGRST202|schema cache|Could not find the function/i.test(msg);
      if(!missing)throw err;
      const one=await fieldGetAssignment(brigadistaId,pin);
      return {assignments:one?.route?[one]:[],legacy:true};
    }
  }
  async function fieldStart(brigadistaId,pin,routeId){return rpc('field_start_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId},false)}
  async function fieldReportBlock(brigadistaId,pin,routeId,position){return rpc('field_report_block',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position?.lat??null,p_lng:position?.lng??null},false)}
  async function fieldReportProgress(brigadistaId,pin,routeId){return rpc('field_report_progress',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId},false)}
  async function fieldLocation(brigadistaId,pin,routeId,position){return rpc('field_update_location',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId,p_lat:position.lat,p_lng:position.lng,p_accuracy_m:position.accuracy??null},false)}
  async function fieldFinish(brigadistaId,pin,routeId){return rpc('field_finish_route',{p_brigadista_id:brigadistaId,p_pin:String(pin||''),p_route_id:routeId},false)}

  window.VolanteoCloud={enabled,init,getSession,adminSignIn,adminSignOut,isAdmin,adminLoadState,adminSaveState,adminDeleteRouteData,subscribeAdmin,fieldListBrigadistas,fieldGetAssignment,fieldGetAssignments,fieldStart,fieldReportBlock,fieldReportProgress,fieldLocation,fieldFinish};
})();
