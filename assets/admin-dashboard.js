const STORAGE_KEY='bienestar_volanteo_v10';
const ROUTE_COLORS=['#c41467','#7856d8','#ef8a15','#239b73','#2287c7','#16a0a0','#9f0b55','#e2567c','#6b8d45','#b068c7','#e1a10d','#4476b7'];
const DEFAULT_PEOPLE=['Ana López','Carlos Ruiz','María Torres','José García','Laura Méndez','Pedro Soto','Daniela Cruz','Miguel Ríos','Sofía Herrera','Jorge Valdez'];
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const LIVE_CHANNEL_NAME='bienestar_volanteo_live_v30';
const liveChannel=('BroadcastChannel' in window)?new BroadcastChannel(LIVE_CHANNEL_NAME):null;
const cloudMode=Boolean(window.VolanteoCloud?.enabled);
let adminReady=false,cloudSaveTimer=null,cloudApplying=false,cloudSubscription=null;
let cloudSaveInFlight=null,cloudPendingWrite=null,cloudSaveSeq=0,cloudLastMutationAt=0;
let map=null,draftLayer=null,draftVertexLayer=null,roadLayer=null,drawing=false,draft=[],mode='volanteo',coverageMode='zone',goalType='calles',mapFilter='exercise',editingRouteId=null,roadAnalysis=null,manualGoalOverride=null,drawSessionId=0,analysisRunId=0,lastAcceptedAnalysis=null,lastAcceptedPolygonKey='';

function isoDate(d){return d.toISOString().slice(0,10)}
function addDays(dateStr,n){const d=new Date(dateStr+'T12:00:00');d.setDate(d.getDate()+n);return isoDate(d)}
function fmtDate(dateStr){if(!dateStr)return '';return new Intl.DateTimeFormat('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(dateStr+'T12:00:00'))}
function fmtShort(dateStr){if(!dateStr)return '';return new Intl.DateTimeFormat('es-MX',{weekday:'short',day:'numeric',month:'short'}).format(new Date(dateStr+'T12:00:00'))}
function initials(n){return String(n||'').split(' ').filter(Boolean).map(x=>x[0]).slice(0,2).join('').toUpperCase()}
function uid(prefix){return prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)}
function normalizeName(n){return String(n||'').trim().replace(/\s+/g,' ')}
function makeRoster(names=DEFAULT_PEOPLE){return names.map((name,i)=>({id:`person-${i+1}`,name,active:true,pin:'1234',createdAt:Date.now()+i}))}

function buildExercises(journeyDate){
 const d=new Date(journeyDate+'T12:00:00'), day=d.getDay();
 let specs=[];
 if(day===2) specs=[[-1,'Mañana','08:30'],[-1,'Tarde','16:00'],[0,'Mañana','08:30']];
 else if(day===5) specs=[[-2,'Tarde','16:00'],[-1,'Mañana','08:30'],[-1,'Tarde','16:00'],[0,'Mañana','08:30']];
 else specs=[[-1,'Mañana','08:30'],[-1,'Tarde','16:00']];
 return specs.map((s,i)=>({id:uid('ex'),date:addDays(journeyDate,s[0]),shift:s[1],time:s[2],status:'scheduled',routes:[],order:i+1}));
}

function defaultState(){
 const nextTuesday=(()=>{const d=new Date();d.setHours(12,0,0,0);let delta=(2-d.getDay()+7)%7;if(delta===0)delta=7;d.setDate(d.getDate()+delta);return isoDate(d)})();
 const brigadistas=makeRoster();
 const idFor=name=>brigadistas.find(p=>p.name===name)?.id;
 const j={id:'j-demo',venue:'Los Pinos',date:nextTuesday,time:'17:00',archived:false,createdAt:Date.now(),exercises:[]};
 j.exercises=buildExercises(j.date);
 const e1=j.exercises[0], e2=j.exercises[1];
 e1.routes=[
  {id:'r1',name:'Ruta 01',type:'volanteo',memberIds:[idFor('Ana López'),idFor('Carlos Ruiz')],members:['Ana López','Carlos Ruiz'],color:ROUTE_COLORS[0],coverageMode:'zone',goalType:'calles',goal:5,status:'done',progress:100,pts:[[29.086,-110.967],[29.087,-110.963],[29.084,-110.961],[29.082,-110.965],[29.086,-110.967]]},
  {id:'r2',name:'Ruta 02',type:'volanteo',memberIds:[idFor('María Torres'),idFor('José García')],members:['María Torres','José García'],color:ROUTE_COLORS[1],coverageMode:'zone',goalType:'cuadras',goal:4,status:'done',progress:100,pts:[[29.0805,-110.9688],[29.0818,-110.964],[29.0784,-110.9622],[29.0767,-110.967],[29.0805,-110.9688]]}
 ];
 if(e2)e2.routes=[{id:'r3',name:'Ruta 03',type:'volanteo',memberIds:[idFor('Ana López'),idFor('Laura Méndez'),idFor('Pedro Soto')],members:['Ana López','Laura Méndez','Pedro Soto'],color:ROUTE_COLORS[2],coverageMode:'zone',goalType:'calles',goal:4,status:'pending',progress:0,pts:[[29.0878,-110.9585],[29.0892,-110.9535],[29.0858,-110.9518],[29.0842,-110.9565],[29.0878,-110.9585]]}];
 return {version:18,brigadistas,journeys:[j],activeJourneyId:j.id,activeExerciseId:e2?.id||e1.id};
}

function migrateState(s){
 if(!s||!Array.isArray(s.journeys))return defaultState();
 const previousVersion=Number(s.version||10);
 if(!Array.isArray(s.brigadistas)){
  const names=[...new Set([...DEFAULT_PEOPLE,...s.journeys.flatMap(j=>(j.exercises||[]).flatMap(e=>(e.routes||[]).flatMap(r=>r.members||[])))])];
  s.brigadistas=makeRoster(names);
 }
 s.brigadistas.forEach(p=>{if(!p.pin)p.pin='1234';});
 const byName=new Map(s.brigadistas.map(p=>[p.name,p]));
 for(const j of s.journeys||[]){
  for(const e of j.exercises||[]){
   for(const r of e.routes||[]){
    if(!Array.isArray(r.memberIds))r.memberIds=(r.members||[]).map(n=>byName.get(n)?.id).filter(Boolean);
    // Normaliza el snapshot para que nunca conserve integrantes que ya no están
    // realmente asignados a memberIds.
    r.members=r.memberIds.map(id=>s.brigadistas.find(p=>p.id===id)?.name).filter(Boolean);
    if(!Array.isArray(r.blockReports))r.blockReports=[];if(!Number.isFinite(Number(r.completedBlocks)))r.completedBlocks=r.blockReports.length||((r.goalType==='cuadras'&&Number.isFinite(Number(r.completedUnits)))?Number(r.completedUnits):0);if(!Array.isArray(r.trackPoints))r.trackPoints=[];
    if(!r.coverageMode){
     const closed=Array.isArray(r.pts)&&r.pts.length>=4&&Math.abs(r.pts[0][0]-r.pts[r.pts.length-1][0])<0.000001&&Math.abs(r.pts[0][1]-r.pts[r.pts.length-1][1])<0.000001;
     r.coverageMode=r.type==='perifoneo'?'line':closed?'zone':'line';
    }
   }
  }
 }
 if(previousVersion<12){let colorIndex=0;for(const j of s.journeys||[])for(const e of j.exercises||[])for(const r of e.routes||[]){r.color=ROUTE_COLORS[colorIndex%ROUTE_COLORS.length];colorIndex++}}
 s.version=Math.max(Number(s.version||0),30);
 return s;
}
function loadState(){
 try{
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw){
   const migrated=migrateState(JSON.parse(raw));
   localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
   return migrated;
  }
 }catch(e){console.warn('No se pudo restaurar el estado local',e)}
 // IMPORTANTE: durante la primera carga `state` todavía no ha sido inicializado.
 // No llamar saveState() aquí, porque saveState compara contra `state` y produciría
 // un ReferenceError (TDZ), deteniendo todo el JS antes de enlazar el formulario de login.
 const initial=defaultState();
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(initial))}catch(e){}
 return initial;
}
function cloneState(value){
 try{return structuredClone(value)}catch(_e){return JSON.parse(JSON.stringify(value))}
}
function cloudWritePending(){
 return Boolean(cloudSaveTimer||cloudSaveInFlight||cloudPendingWrite||(Date.now()-cloudLastMutationAt<900));
}
async function flushCloudSave(){
 if(!cloudMode||!adminReady||!cloudPendingWrite)return false;
 // Si una lectura o escritura remota ya está en curso, espera a que termine. El
 // snapshot pendiente permanece intacto y tiene prioridad sobre cualquier poll.
 if(cloudApplying){
  await new Promise(resolve=>setTimeout(resolve,90));
  return flushCloudSave();
 }
 if(cloudSaveInFlight){
  try{await cloudSaveInFlight}catch(_e){}
  return cloudPendingWrite?flushCloudSave():true;
 }
 const entry=cloudPendingWrite;
 cloudPendingWrite=null;
 if(cloudSaveTimer){clearTimeout(cloudSaveTimer);cloudSaveTimer=null}
 cloudSaveInFlight=(async()=>{
  let succeeded=false;
  try{
   await window.VolanteoCloud.adminSaveState(entry.snapshot);
   succeeded=true;
   setCloudStatus('En línea',true);
   return true;
  }catch(err){
   console.error('No se pudo guardar en Supabase',err);
   setCloudStatus('Error al guardar',false);
   // Si no hubo una edición posterior, conserva este snapshot, pero no reintenta
   // en bucle: una nueva acción del usuario o un guardado posterior lo enviará.
   if(!cloudPendingWrite||cloudPendingWrite.seq<entry.seq)cloudPendingWrite=entry;
   throw err;
  }finally{
   cloudSaveInFlight=null;
   // Solo encadena automáticamente si apareció una edición MÁS NUEVA mientras
   // esta escritura estaba en curso. Un fallo no provoca reintentos infinitos.
   if(cloudPendingWrite&&!cloudApplying&&cloudPendingWrite.seq>entry.seq){
    cloudSaveTimer=setTimeout(()=>{cloudSaveTimer=null;flushCloudSave().catch(()=>{})},150);
   }else if(succeeded&&cloudPendingWrite?.seq===entry.seq){
    cloudPendingWrite=null;
   }
  }
 })();
 return cloudSaveInFlight;
}
function queueCloudSave(snapshot=state,{immediate=false}={}){
 if(!cloudMode||!adminReady||cloudApplying)return Promise.resolve(false);
 const entry={seq:++cloudSaveSeq,snapshot:cloneState(snapshot)};
 cloudPendingWrite=entry;
 cloudLastMutationAt=Date.now();
 if(cloudSaveTimer){clearTimeout(cloudSaveTimer);cloudSaveTimer=null}
 if(immediate)return flushCloudSave();
 cloudSaveTimer=setTimeout(()=>{cloudSaveTimer=null;flushCloudSave().catch(()=>{})},350);
 return Promise.resolve(true);
}
function saveState(s=state,options={}){
 if(s===state)syncRouteSnapshots();
 const payload=JSON.stringify(s);
 localStorage.setItem(STORAGE_KEY,payload);
 try{window.dispatchEvent(new StorageEvent('storage',{key:STORAGE_KEY,newValue:payload}))}catch(e){}
 try{liveChannel?.postMessage({type:'state',at:Date.now()})}catch(e){}
 return queueCloudSave(s,options);
}
let state=loadState();

function setDrawingUI(active){
 drawing=Boolean(active);
 document.body.classList.toggle('route-planning-active',drawing);
 const btn=$('#startDrawBtn'),hint=$('#mapDrawHint');
 if(btn){
  if(mode==='perifoneo'||coverageMode==='line')btn.textContent=drawing?'Trazado activo · marca el recorrido':'↝ Trazar ruta lineal';
  else btn.textContent=drawing?(draft.length>=3?'✓ Cerrar zona y calcular':'Zona activa · marca sus límites'):'▱ Delimitar zona';
 }
 if(hint){
  if(drawing)hint.textContent=coverageMode==='zone'&&mode==='volanteo'?'Marca los límites del sector. Con 3 o más puntos podrás cerrar la zona y calcular sus calles interiores.':'Haz clic sobre el mapa para marcar cada cambio de dirección.';
  else hint.textContent=coverageMode==='zone'&&mode==='volanteo'?'Delimita un sector completo; la app analizará la red vial contenida en él.':'Configura la ruta y traza el recorrido sobre el mapa.';
 }
}
function updateDrawingHint(){
 const hint=$('#mapDrawHint');if(!hint||!drawing)return;
 if(coverageMode==='zone'&&mode==='volanteo')hint.textContent=draft.length<3?`${draft.length} ${draft.length===1?'punto marcado':'puntos marcados'} · necesitas al menos 3 para formar una zona.`:`${draft.length} puntos delimitan el sector · pulsa “Cerrar zona y calcular”.`;
 else{const segments=Math.max(0,draft.length-1);hint.textContent=draft.length<2?`${draft.length} punto marcado · agrega otro para formar el primer tramo.`:`${draft.length} puntos · ${segments} ${segments===1?'tramo':'tramos'} trazados. Continúa o guarda la ruta.`}
 setDrawingUI(true);
}

function getJourney(){return state.journeys.find(j=>j.id===state.activeJourneyId)||state.journeys.find(j=>!j.archived)||state.journeys[0]}
function getExercise(){const j=getJourney();return j?.exercises.find(e=>e.id===state.activeExerciseId)||j?.exercises[0]}
function allRoutes(j=getJourney()){return (j?.exercises||[]).flatMap(e=>e.routes||[])}
function nextRouteColor(){const j=getJourney();return ROUTE_COLORS[allRoutes(j).length%ROUTE_COLORS.length]}
function activeRoster(){return (state.brigadistas||[]).filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name,'es'))}
function personById(id){return (state.brigadistas||[]).find(p=>p.id===id)}
function routeMemberNames(r){
 // Las asignaciones por ID son la fuente de verdad. No mezclar con snapshots
 // antiguos porque eso puede reintroducir brigadistas ya retirados de la ruta.
 if(Array.isArray(r.memberIds))return r.memberIds.map(id=>personById(id)?.name).filter(Boolean);
 return Array.isArray(r.members)?r.members:[];
}
function routeOperationalStats(r){
 if(r.type==='perifoneo')return{goal:Number(r.goal||0),unit:'km',done:null};
 if(r.coverageMode==='zone'){
  const goal=Number(r.blockCount||0)>0?Number(r.blockCount):((r.goalType==='cuadras'&&Number(r.goal)>0)?Number(r.goal):Number(r.goal||0));
  const done=Math.max(0,Number(r.completedBlocks||r.blockReports?.length||0));
  return{goal,unit:'cuadras',done};
 }
 return{goal:Number(r.goal||0),unit:'tramos',done:Number(r.completedUnits||0)};
}
function timeShort(ts){if(!ts)return'';try{return new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date(ts))}catch(e){return''}}
function syncRouteSnapshots(){
 for(const j of state.journeys||[])for(const e of j.exercises||[])for(const r of e.routes||[])if((r.memberIds||[]).length){const names=(r.memberIds||[]).map(id=>personById(id)?.name).filter(Boolean);if(names.length)r.members=names}
}

function renderJourneys(){
 const active=state.journeys.filter(j=>!j.archived);
 const select=$('#journeySelect');select.innerHTML=active.map(j=>`<option value="${j.id}" ${j.id===state.activeJourneyId?'selected':''}>${j.venue} · ${fmtShort(j.date)}</option>`).join('');
 const j=getJourney();if(!j)return;
 $('#heroVenue').textContent=j.venue;$('#heroDate').textContent=`${fmtDate(j.date)} · ${j.time} h`;
 $('#archiveJourneyBtn').disabled=j.archived;
 renderRosterSummary();renderTimeline();renderMetrics();renderExerciseContext();renderTracking();renderJourneyRoutes();renderHistory();renderDashboardExtras();drawMap();
}
function renderRosterSummary(){
 const active=activeRoster(), inactive=(state.brigadistas||[]).filter(p=>!p.active);
 $('#rosterActiveCount').textContent=active.length;
 $('#rosterInactiveCount').textContent=inactive.length;
 $('#rosterPreview').innerHTML=active.length?active.slice(0,8).map(p=>`<span class="roster-chip"><span class="avatar">${initials(p.name)}</span>${p.name}</span>`).join(''):'<span class="small muted">No hay brigadistas activos. Agrega personas al catálogo.</span>';
 renderMemberPicker('#memberPicker');
}
function renderTimeline(){const j=getJourney();const el=$('#exerciseTimeline');el.innerHTML=(j.exercises||[]).map((e,i)=>{const routes=e.routes||[];const done=routes.length&&routes.every(r=>r.status==='done');const live=routes.some(r=>r.status==='live');const cls=done?'done':live?'live':'';const stateTxt=done?'Finalizado':live?'En campo':'Programado';return `<article class="exercise-card ${e.id===state.activeExerciseId?'active':''}" data-exercise="${e.id}"><div class="exercise-top"><div><strong>Difusión ${String(i+1).padStart(2,'0')} · ${e.shift}</strong><small>${fmtShort(e.date)} · ${e.time} h</small></div><span class="exercise-state ${cls}">${stateTxt}</span></div><div class="exercise-meta">${routes.length} ${routes.length===1?'ruta':'rutas'} · ${routes.filter(r=>r.type==='perifoneo').length} perifoneo</div></article>`}).join('')+`<article class="exercise-card" id="addExerciseCard"><div class="exercise-top"><div><strong>+ Agregar ejercicio</strong><small>Turno extraordinario o adicional</small></div></div><div class="exercise-meta">Personaliza fecha y horario</div></article>`;
 $$('.exercise-card[data-exercise]').forEach(c=>c.addEventListener('click',()=>{state.activeExerciseId=c.dataset.exercise;saveState();renderJourneys()}));
 $('#addExerciseCard')?.addEventListener('click',addCustomExercise);
}
function renderMetrics(){const j=getJourney(), routes=allRoutes(j), unique=new Set(routes.flatMap(r=>r.memberIds||[]));const avg=routes.length?Math.round(routes.reduce((a,r)=>a+(r.progress||0),0)/routes.length):0;$('#mExercises').textContent=j.exercises.length;$('#mRoutes').textContent=routes.length;$('#mPeople').textContent=unique.size;$('#mCoverage').textContent=avg+'%'}
function renderExerciseContext(){const e=getExercise();if(!e)return;$('#exerciseTitle').textContent=`${fmtShort(e.date)} · ${e.shift}`;$('#exerciseSub').textContent=`Ejercicio de difusión ${e.time} h · ${(e.routes||[]).length} rutas guardadas`;$('#exerciseState').textContent=(e.routes||[]).some(r=>r.status==='live')?'En campo':(e.routes||[]).length&&e.routes.every(r=>r.status==='done')?'Finalizado':'Programado'}


function renderDashboardExtras(){
 const j=getJourney(),e=getExercise();if(!j||!e)return;
 const currentDate=$('#currentDateLabel');if(currentDate)currentDate.textContent=`${fmtShort(j.date)} · ${j.time} h`;
 const routes=e.routes||[];
 const today=$('#todayOps');if(today){
  const finished=routes.filter(r=>r.status==='done').length,live=routes.filter(r=>r.status==='live').length,pending=routes.filter(r=>r.status!=='done'&&r.status!=='live').length;
  today.innerHTML=`<div class="today-op"><div><strong>${fmtShort(e.date)} · ${e.shift}</strong><small>${e.time} h · Difusión territorial</small></div><span class="status-badge">${live?'En campo':finished&&finished===routes.length?'Finalizado':'Programado'}</span></div><div class="today-op"><div><strong>${routes.length} rutas en el ejercicio</strong><small>${live} en recorrido · ${pending} pendientes</small></div><span>${finished}/${routes.length||0}</span></div>`;
 }
 const side=$('#sideRouteList');if(side){side.innerHTML=routes.length?routes.slice(0,6).map(r=>`<div class="mini-route"><div class="mini-route-main"><i class="mini-route-color" style="background:${r.color}"></i><div><strong>${r.name}</strong><small>${r.type==='perifoneo'?'Perifoneo':'Volanteo'} · ${routeMemberNames(r).length} brig.</small></div></div><div class="mini-route-meta">${r.progress||0}%</div></div>`).join(''):'<div class="notice">Aún no hay rutas en este ejercicio.</div>'}
 const quick=$('#quickRoster');if(quick){const active=activeRoster();quick.innerHTML=active.slice(0,6).map(p=>{const assigned=allRoutes(j).filter(r=>(r.memberIds||[]).includes(p.id)).length;return `<div class="quick-person"><div class="quick-person-main"><span class="avatar">${initials(p.name)}</span><div><strong>${p.name}</strong><small>${assigned} ${assigned===1?'ruta':'rutas'} en esta jornada</small></div></div><span class="person-status">Activo</span></div>`}).join('')}
 renderMapLegend();
}
function renderMapLegend(){
 const legend=$('#mapLegend');if(!legend)return;const j=getJourney(),e=getExercise();if(!j||!e)return;const routes=mapFilter==='journey'?allRoutes(j):(e.routes||[]);legend.innerHTML=`<strong>${mapFilter==='journey'?'Rutas de la jornada':'Rutas del ejercicio'}</strong><div class="legend-items">${routes.length?routes.map(r=>`<div class="legend-row"><i style="background:${r.color}"></i><span>${r.name}</span></div>`).join(''):'Sin rutas guardadas'}</div>`;
}

function renderMemberPicker(containerId,selectedIds=[]){
 const el=$(containerId);if(!el)return;
 const selectedPeople=selectedIds.map(personById).filter(Boolean);
 const pool=[...activeRoster()];
 for(const p of selectedPeople)if(!pool.some(x=>x.id===p.id))pool.push(p);
 el.innerHTML=pool.map(p=>`<label class="member-option ${selectedIds.includes(p.id)?'selected':''} ${p.active?'':'inactive-option'}"><input type="checkbox" value="${p.id}" ${selectedIds.includes(p.id)?'checked':''}><span class="avatar">${initials(p.name)}</span><span>${p.name}${p.active?'':' <small>(inactivo)</small>'}</span></label>`).join('') || '<div class="notice">No hay brigadistas activos. Administra el catálogo antes de asignar una ruta.</div>';
 el.querySelectorAll('input').forEach(i=>i.addEventListener('change',()=>i.closest('.member-option').classList.toggle('selected',i.checked)));
}
function selectedMemberIds(containerId='#memberPicker'){return [...document.querySelectorAll(`${containerId} input:checked`)].map(i=>i.value)}

function renderTracking(){const e=getExercise(), el=$('#trackingList');const routes=e?.routes||[];el.innerHTML=routes.length?routes.map(r=>routeCard(r,true)).join(''):'<div class="notice">Este ejercicio todavía no tiene rutas. Diseña la primera desde el panel de planeación.</div>';bindRouteActions(el)}
function renderJourneyRoutes(){const j=getJourney(), el=$('#journeyRouteList');const groups=j.exercises.map((e,i)=>({e,i,routes:e.routes||[]})).filter(x=>x.routes.length);el.innerHTML=groups.length?groups.map(g=>`<div class="route-card"><div class="route-head"><div><strong>Difusión ${String(g.i+1).padStart(2,'0')} · ${g.e.shift}</strong><small>${fmtShort(g.e.date)} · ${g.routes.length} rutas</small></div><span class="pill">${Math.round(g.routes.reduce((a,r)=>a+(r.progress||0),0)/g.routes.length)}%</span></div><div class="member-chips">${g.routes.map(r=>`<span class="member-chip" style="border-left:4px solid ${r.color}">${r.name}</span>`).join('')}</div></div>`).join(''):'<div class="notice">Aún no hay cobertura registrada para esta Jornada.</div>'}
function routeCard(r,actions){const status=r.status==='done'?'Finalizada':r.status==='live'?'En recorrido':'Pendiente';const cls=r.status==='done'?'done':r.status==='live'?'live':'';const names=routeMemberNames(r),op=routeOperationalStats(r);const goalText=r.type==='perifoneo'?`${Number(op.goal).toFixed(1)} km`:`${op.goal} ${op.unit}`;const reportText=r.coverageMode==='zone'&&r.type!=='perifoneo'?`<div class="live-route-meta"><span><strong>${op.done}/${op.goal}</strong> cuadras reportadas</span>${r.lastProgressAt?`<span>Última · ${timeShort(r.lastProgressAt)}</span>`:''}${r.lastPositionAt?`<span class="live-gps-dot">GPS ${timeShort(r.lastPositionAt)}</span>`:''}</div>`:'';return `<article class="tracking-card" style="--route-color:${r.color}"><div class="tracking-head"><div><div class="tracking-title"><span class="swatch"></span><strong>${r.name}</strong><span class="pill">${r.type==='perifoneo'?'Perifoneo':'Volanteo'}</span></div><small>${names.length} ${names.length===1?'brigadista':'brigadistas'} · ${goalText}</small></div><span class="badge ${cls}">${status}</span></div><div class="member-chips">${names.map(n=>`<span class="member-chip">${n}</span>`).join('')}</div>${reportText}<div class="progress"><span style="width:${r.progress||0}%"></span></div><div style="display:flex;justify-content:space-between;margin-top:6px"><small>Avance en vivo</small><strong>${r.progress||0}%</strong></div>${actions?`<div class="card-actions"><button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button><button class="btn btn-secondary btn-sm" data-duplicate="${r.id}">Duplicar</button><button class="btn btn-danger btn-sm" data-delete="${r.id}">Borrar</button></div>`:''}</article>`}
function bindRouteActions(scope=document){scope.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openEditRoute(b.dataset.edit)));scope.querySelectorAll('[data-duplicate]').forEach(b=>b.addEventListener('click',()=>duplicateRoute(b.dataset.duplicate)));scope.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>deleteRoute(b.dataset.delete)))}

function renderHistory(){const el=$('#historyList');const archived=state.journeys.filter(j=>j.archived);el.innerHTML=archived.length?archived.map(j=>{const rs=allRoutes(j),avg=rs.length?Math.round(rs.reduce((a,r)=>a+(r.progress||0),0)/rs.length):0;return `<article class="history-card" data-history="${j.id}"><div class="history-top"><div><strong>Jornada del Bienestar · ${j.venue}</strong><small>${fmtDate(j.date)} · ${j.time} h</small></div><span class="pill">Archivada</span></div><div class="history-stats"><div><strong>${j.exercises.length}</strong><small>ejercicios</small></div><div><strong>${rs.length}</strong><small>rutas</small></div><div><strong>${avg}%</strong><small>cobertura</small></div></div><div class="card-actions"><button class="btn btn-secondary btn-sm" data-restore="${j.id}">Restaurar</button><button class="btn btn-danger btn-sm" data-deletejourney="${j.id}">Eliminar</button></div></article>`}).join(''):'<div class="notice">Las jornadas que archives aparecerán aquí para conservar su memoria operativa.</div>';
 el.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();const j=state.journeys.find(x=>x.id===b.dataset.restore);j.archived=false;state.activeJourneyId=j.id;state.activeExerciseId=j.exercises[0]?.id;saveState();renderJourneys()}));
 el.querySelectorAll('[data-deletejourney]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();if(!confirm('¿Eliminar definitivamente esta jornada y todas sus rutas?'))return;state.journeys=state.journeys.filter(x=>x.id!==b.dataset.deletejourney);saveState();renderJourneys()}));
}

function renderBrigadistaManager(){
 const el=$('#brigadistaManagerList');if(!el)return;
 const roster=[...(state.brigadistas||[])].sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name,'es'));
 el.innerHTML=roster.length?roster.map(p=>`<article class="brigadista-row ${p.active?'':'is-inactive'}" data-person="${p.id}"><div class="brigadista-identity"><span class="avatar avatar-lg">${initials(p.name)}</span><div><strong>${p.name}</strong><small>${p.active?'Disponible para nuevas rutas':'Inactivo · no aparece en nuevas asignaciones'}</small><span class="brigadista-pin">PIN <strong>${p.pin||'1234'}</strong></span></div></div><div class="brigadista-actions"><button class="btn btn-secondary btn-sm" data-person-edit="${p.id}">Editar</button><button class="btn btn-secondary btn-sm" data-person-toggle="${p.id}">${p.active?'Desactivar':'Activar'}</button><button class="btn btn-danger btn-sm" data-person-delete="${p.id}">Eliminar</button></div></article>`).join(''):'<div class="notice">Todavía no hay brigadistas registrados.</div>';
 el.querySelectorAll('[data-person-edit]').forEach(b=>b.addEventListener('click',()=>editBrigadista(b.dataset.personEdit)));
 el.querySelectorAll('[data-person-toggle]').forEach(b=>b.addEventListener('click',()=>toggleBrigadista(b.dataset.personToggle)));
 el.querySelectorAll('[data-person-delete]').forEach(b=>b.addEventListener('click',()=>deleteBrigadista(b.dataset.personDelete)));
}
function addBrigadista(){
 const input=$('#newBrigadistaName'),pinInput=$('#newBrigadistaPin'),name=normalizeName(input.value);if(!name)return;
 if((state.brigadistas||[]).some(p=>p.name.toLowerCase()===name.toLowerCase()))return alert('Ese nombre ya existe en el catálogo.');
 const pin=String(pinInput?.value||Math.floor(1000+Math.random()*9000)).replace(/\D/g,'').slice(0,6);
 if(pin.length<4)return alert('El PIN debe tener al menos 4 dígitos.');
 state.brigadistas.push({id:uid('person'),name,active:true,pin,createdAt:Date.now()});input.value='';if(pinInput)pinInput.value='';saveState();renderBrigadistaManager();renderJourneys();
}
function editBrigadista(id){
 const p=personById(id);if(!p)return;const next=normalizeName(prompt('Nombre del brigadista:',p.name));if(!next)return;
 if((state.brigadistas||[]).some(x=>x.id!==id&&x.name.toLowerCase()===next.toLowerCase()))return alert('Ya existe otro brigadista con ese nombre.');
 const nextPin=String(prompt('PIN de acceso (4 a 6 dígitos):',p.pin||'1234')||'').replace(/\D/g,'').slice(0,6);if(nextPin.length<4)return alert('El PIN debe tener al menos 4 dígitos.');
 p.name=next;p.pin=nextPin;syncRouteSnapshots();saveState();renderBrigadistaManager();renderJourneys();
}
function toggleBrigadista(id){
 const p=personById(id);if(!p)return;
 if(p.active){
  const current=[];
  for(const j of state.journeys.filter(j=>!j.archived))for(const e of j.exercises||[])for(const r of e.routes||[]){
   if(r.status!=='done'&&Array.isArray(r.memberIds)&&r.memberIds.includes(id))current.push({j,e,r});
  }
  if(current.length){
   const ok=confirm(`${p.name} está asignad@ a ${current.length} ruta(s) vigente(s). Al desactivarlo se retirará de esas asignaciones actuales. El historial de rutas finalizadas no se modifica. ¿Continuar?`);
   if(!ok)return;
   current.forEach(({r})=>{r.memberIds=r.memberIds.filter(x=>x!==id);r.members=r.memberIds.map(pid=>personById(pid)?.name).filter(Boolean)});
  }
  p.active=false;
 }else p.active=true;
 saveState();renderBrigadistaManager();renderJourneys();
}
function deleteBrigadista(id){
 const p=personById(id);if(!p)return;
 const currentAssignments=state.journeys.filter(j=>!j.archived).flatMap(j=>j.exercises||[]).flatMap(e=>e.routes||[]).filter(r=>(r.memberIds||[]).includes(id));
 const msg=currentAssignments.length?`${p.name} está asignad@ a ${currentAssignments.length} ruta(s) de jornadas vigentes. Al eliminarlo del catálogo se retirará de esas asignaciones. Su participación en jornadas archivadas se conservará en el historial. ¿Continuar?`:`¿Eliminar a ${p.name} del catálogo de brigadistas? El historial de jornadas anteriores no se borrará.`;
 if(!confirm(msg))return;
 for(const j of state.journeys.filter(j=>!j.archived))for(const e of j.exercises||[])for(const r of e.routes||[]){if((r.memberIds||[]).includes(id)){r.memberIds=r.memberIds.filter(x=>x!==id);r.members=routeMemberNames(r).filter(n=>n!==p.name)}}
 state.brigadistas=state.brigadistas.filter(x=>x.id!==id);saveState();renderBrigadistaManager();renderJourneys();
}

function pointOnSegment(p,a,b,eps=1e-9){
 const [py,px]=p,[ay,ax]=a,[by,bx]=b;
 const cross=(px-ax)*(by-ay)-(py-ay)*(bx-ax);
 if(Math.abs(cross)>eps)return false;
 const dot=(px-ax)*(bx-ax)+(py-ay)*(by-ay);
 if(dot<-eps)return false;
 const len2=(bx-ax)*(bx-ax)+(by-ay)*(by-ay);
 return dot<=len2+eps;
}
function pointInPolygon(point,poly){
 for(let i=0,j=poly.length-1;i<poly.length;j=i++)if(pointOnSegment(point,poly[j],poly[i],1e-8))return true;
 const y=point[0],x=point[1];let inside=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const yi=poly[i][0],xi=poly[i][1],yj=poly[j][0],xj=poly[j][1];
  const hit=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi);
  if(hit)inside=!inside;
 }
 return inside;
}
function interpolatePoint(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}
function segmentIntersection(a,b,c,d){
 const x1=a[1],y1=a[0],x2=b[1],y2=b[0],x3=c[1],y3=c[0],x4=d[1],y4=d[0];
 const den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);
 if(Math.abs(den)<1e-12)return null;
 const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den;
 const u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/den;
 if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9)return{t:Math.max(0,Math.min(1,t)),u:Math.max(0,Math.min(1,u)),point:interpolatePoint(a,b,Math.max(0,Math.min(1,t)))};
 return null;
}
function clipSegmentToPolygon(a,b,poly){
 const ts=[0,1];
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const hit=segmentIntersection(a,b,poly[j],poly[i]);
  if(hit)ts.push(hit.t);
 }
 ts.sort((x,y)=>x-y);
 const uniq=ts.filter((t,i)=>!i||Math.abs(t-ts[i-1])>1e-8),out=[];
 for(let i=1;i<uniq.length;i++){
  const t0=uniq[i-1],t1=uniq[i];if(t1-t0<1e-8)continue;
  const mid=interpolatePoint(a,b,(t0+t1)/2);
  if(pointInPolygon(mid,poly))out.push([interpolatePoint(a,b,t0),interpolatePoint(a,b,t1)]);
 }
 return out;
}
function samePoint(a,b,eps=1e-7){return Math.abs(a[0]-b[0])<eps&&Math.abs(a[1]-b[1])<eps}
function clipWayGeometry(geometry,poly){
 const lines=[];let current=null;
 for(let i=1;i<geometry.length;i++){
  const a=[geometry[i-1].lat,geometry[i-1].lon],b=[geometry[i].lat,geometry[i].lon];
  for(const piece of clipSegmentToPolygon(a,b,poly)){
   if(current&&samePoint(current[current.length-1],piece[0]))current.push(piece[1]);
   else{if(current&&current.length>1)lines.push(current);current=[piece[0],piece[1]]}
  }
 }
 if(current&&current.length>1)lines.push(current);
 return lines;
}
function polylineMeters(line){let m=0;for(let i=1;i<line.length;i++)m+=hav(line[i-1],line[i])*1000;return m}
function normalizeStreetName(v){
 return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es-MX')
  .replace(/[.,#]/g,' ').replace(/\bavenida\b|\bav\b/g,'av').replace(/\bcalle\b/g,'')
  .replace(/\bboulevard\b|\bblvd\b/g,'blvd').replace(/\bcarretera\b/g,'carretera')
  .replace(/\s+/g,' ').trim();
}
function allowedRoad(el){
 const h=el.tags?.highway||'';
 // Para volanteo casa por casa no contamos accesos internos, estacionamientos ni calles de servicio.
 const allowed=new Set(['residential','living_street','unclassified','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link','road']);
 if(!allowed.has(h)||el.tags?.access==='private')return false;
 if(el.tags?.service)return false;
 return Array.isArray(el.geometry)&&el.geometry.length>1;
}
function lineOrientation(line){
 if(!line||line.length<2)return 0;
 const a=line[0],b=line[line.length-1];
 let ang=Math.atan2((b[0]-a[0]),(b[1]-a[1]))*180/Math.PI;
 ang=((ang%180)+180)%180;
 return ang;
}
function angleDiff(a,b){const d=Math.abs(a-b)%180;return Math.min(d,180-d)}
function endpointDistance(a,b){return hav(a,b)*1000}
function linesCanContinue(a,b){
 const endsA=[a[0],a[a.length-1]],endsB=[b[0],b[b.length-1]];
 const near=endsA.some(x=>endsB.some(y=>endpointDistance(x,y)<=18));
 return near&&angleDiff(lineOrientation(a),lineOrientation(b))<=28;
}
function graphBlockEstimate(lines,poly){
 // v29: estima cuadras como caras de una red planar dentro de la zona.
 // La frontera que dibuja el estratega TAMBIÉN cierra las cuadras del borde; antes
 // solo analizábamos las calles y por eso una cuadrícula abierta podía devolver 0.
 if(!Array.isArray(lines)||!lines.length||!Array.isArray(poly)||poly.length<3)return 0;
 const raw=[];
 const addSeg=(a,b,kind='road')=>{if(polylineMeters([a,b])>2)raw.push({a:[Number(a[0]),Number(a[1])],b:[Number(b[0]),Number(b[1])],ts:[0,1],kind})};
 for(const line of lines)for(let i=1;i<line.length;i++)addSeg(line[i-1],line[i],'road');
 // Cerramos explícitamente el perímetro de la zona para que las calles interiores
 // dividan el sector en celdas/manzanas, incluso si OSM no modela ese borde como un way continuo.
 for(let i=0;i<poly.length;i++)addSeg(poly[i],poly[(i+1)%poly.length],'boundary');
 if(!raw.length)return 0;
 // Partimos todos los segmentos en cada intersección real.
 for(let i=0;i<raw.length;i++)for(let j=i+1;j<raw.length;j++){
  const hit=segmentIntersection(raw[i].a,raw[i].b,raw[j].a,raw[j].b);if(!hit)continue;
  if(hit.t>1e-7&&hit.t<1-1e-7)raw[i].ts.push(hit.t);
  if(hit.u>1e-7&&hit.u<1-1e-7)raw[j].ts.push(hit.u);
 }
 // OSM puede dejar micro-diferencias de pocos metros en nodos que visualmente son
 // la misma intersección. Agrupamos esos puntos con una tolerancia de 6 m.
 const refLat=(poly.reduce((s,p)=>s+Number(p[0]),0)/poly.length)*Math.PI/180;
 const M_PER_DEG_LAT=111320, M_PER_DEG_LON=111320*Math.cos(refLat), SNAP=6;
 const buckets=new Map(),pts=[],parent=[];
 const metric=p=>[Number(p[1])*M_PER_DEG_LON,Number(p[0])*M_PER_DEG_LAT];
 const hash=(x,y)=>`${Math.floor(x/SNAP)},${Math.floor(y/SNAP)}`;
 const nodeId=p=>{
  const [x,y]=metric(p),cx=Math.floor(x/SNAP),cy=Math.floor(y/SNAP);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
   const arr=buckets.get(`${cx+dx},${cy+dy}`)||[];
   for(const id of arr){const q=pts[id];if(Math.hypot(q.x-x,q.y-y)<=SNAP)return id}
  }
  const id=pts.length;pts.push({x,y,p});parent[id]=id;const k=hash(x,y);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(id);return id;
 };
 const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x]}return x};
 const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
 const edges=new Set();
 for(const seg of raw){
  seg.ts.sort((a,b)=>a-b);const ts=seg.ts.filter((t,i)=>!i||Math.abs(t-seg.ts[i-1])>1e-7);
  for(let i=1;i<ts.length;i++){
   const p=interpolatePoint(seg.a,seg.b,ts[i-1]),q=interpolatePoint(seg.a,seg.b,ts[i]);
   if(polylineMeters([p,q])<3)continue;
   const u=nodeId(p),v=nodeId(q);if(u===v)continue;
   const key=u<v?`${u}-${v}`:`${v}-${u}`;if(edges.has(key))continue;edges.add(key);union(u,v);
  }
 }
 const used=new Set();for(const key of edges){const [a,b]=key.split('-').map(Number);used.add(a);used.add(b)}
 if(!used.size)return 0;
 const comps=new Set([...used].map(find)).size;
 // Para un grafo planar con la frontera incluida, E - V + C es el número de
 // caras cerradas dentro de la zona. Es justo la estimación operativa de cuadras.
 return Math.max(0,edges.size-used.size+comps);
}
function clusterUnnamedStreets(items){
 const n=items.length,parent=Array.from({length:n},(_,i)=>i);
 const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x]}return x};
 const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
  if(items[i].lines.some(a=>items[j].lines.some(b=>linesCanContinue(a,b))))union(i,j);
 }
 const groups=new Map();
 items.forEach((it,i)=>{const r=find(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(it)});
 let idx=1;
 return [...groups.values()].map(group=>{
  const lines=group.flatMap(x=>x.lines),length=lines.reduce((s,l)=>s+polylineMeters(l),0);
  return{id:`unnamed-${idx}`,label:`Calle sin nombre ${idx++}`,kind:'unnamed',length,lines};
 }).filter(x=>x.length>=45);
}
function chunkRoadWays(elements,poly){
 const ways=(elements||[]).filter(allowedRoad),named=new Map(),unnamed=[];
 for(const w of ways){
  const clipped=clipWayGeometry(w.geometry||[],poly).filter(line=>polylineMeters(line)>=10);
  if(!clipped.length)continue;
  const total=clipped.reduce((s,line)=>s+polylineMeters(line),0);if(total<22)continue;
  const raw=(w.tags?.name||w.tags?.official_name||w.tags?.short_name||'').trim();
  if(raw){
   const key=normalizeStreetName(raw);if(!key)continue;
   if(!named.has(key))named.set(key,{id:`named-${key}`,label:raw,kind:'named',length:0,lines:[]});
   const item=named.get(key);item.length+=total;item.lines.push(...clipped);
  }else{
   // Un way sin nombre no es automáticamente una calle. Lo agrupamos con sus continuaciones geométricas.
   unnamed.push({id:`way-${w.id}`,label:'',kind:'unnamed',length:total,lines:clipped});
  }
 }
 const namedItems=[...named.values()].filter(x=>x.length>=22);
 const unnamedItems=clusterUnnamedStreets(unnamed);
 const streetItems=[...namedItems,...unnamedItems]
  .sort((a,b)=>a.label.localeCompare(b.label,'es',{sensitivity:'base'}))
  .map((x,i)=>({...x,id:`street-${i+1}`}));
 const allChunks=streetItems.flatMap(x=>x.lines);
 const selectedStreetIds=streetItems.map(x=>x.id);
 const streetNames=streetItems.map(x=>x.label);
 const blockCount=graphBlockEstimate(allChunks,poly);
 return{streetCount:streetItems.length,blockCount,streetNames,chunks:allChunks,allChunks,selectedChunks:allChunks,streetItems,selectedStreetIds};
}
function selectedStreetItems(){
 if(!roadAnalysis?.streetItems?.length)return[];
 const ids=new Set(roadAnalysis.selectedStreetIds||roadAnalysis.streetItems.map(x=>x.id));
 return roadAnalysis.streetItems.filter(x=>ids.has(x.id));
}
function syncStreetSelection(){
 if(!roadAnalysis?.streetItems?.length)return;
 const selected=selectedStreetItems();
 roadAnalysis.streetCount=selected.length;
 roadAnalysis.streetNames=selected.map(x=>x.label);
 roadAnalysis.selectedChunks=selected.flatMap(x=>x.lines||[]);
 if(goalType==='calles')roadAnalysis.chunks=roadAnalysis.selectedChunks;
 else roadAnalysis.chunks=roadAnalysis.allChunks||roadAnalysis.streetItems.flatMap(x=>x.lines||[]);
 refreshDraft();updateGoal();renderStreetReview();
}
function renderStreetReview(){
 const box=$('#streetReview');if(!box)return;
 if(!roadAnalysis?.streetItems?.length||goalType!=='calles'){box.hidden=true;box.innerHTML='';return}
 const ids=new Set(roadAnalysis.selectedStreetIds||[]);
 box.hidden=false;
 box.innerHTML=`<div class="street-review-head"><div><strong>Calles consideradas</strong><small>${ids.size} seleccionadas · puedes quitar vialidades que no formen parte del volanteo</small></div></div><div class="street-review-list">${roadAnalysis.streetItems.map(it=>`<label class="street-review-item"><input type="checkbox" data-street-id="${esc(it.id)}" ${ids.has(it.id)?'checked':''}><span>${esc(it.label)}</span><small>${Math.round(it.length)} m</small></label>`).join('')}</div>`;
 box.querySelectorAll('input[data-street-id]').forEach(input=>input.addEventListener('change',()=>{
  const set=new Set(roadAnalysis.selectedStreetIds||[]);if(input.checked)set.add(input.dataset.streetId);else set.delete(input.dataset.streetId);roadAnalysis.selectedStreetIds=[...set];syncStreetSelection();
 }));
}
function zoneBBox(pts){
 const lats=pts.map(p=>Number(p[0])),lngs=pts.map(p=>Number(p[1]));
 const pad=.00035;
 return {south:Math.min(...lats)-pad,west:Math.min(...lngs)-pad,north:Math.max(...lats)+pad,east:Math.max(...lngs)+pad};
}
function overpassEndpoints(){
 const cfg=window.VOLANTEO_CONFIG||{};
 const configured=Array.isArray(cfg.OVERPASS_ENDPOINTS)&&cfg.OVERPASS_ENDPOINTS.length?cfg.OVERPASS_ENDPOINTS:[cfg.OVERPASS_ENDPOINT,'https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'].filter(Boolean);
 const eps=[...configured];
 return [...new Set(eps.map(x=>String(x||'').replace(/\/$/,'')))];
}
function analysisCacheKey(pts){return 'volanteo_roads_v32_'+pts.map(([a,b])=>`${Number(a).toFixed(4)},${Number(b).toFixed(4)}`).join('|')}
function readAnalysisCache(pts){try{const raw=sessionStorage.getItem(analysisCacheKey(pts));if(!raw)return null;const parsed=JSON.parse(raw);if(Date.now()-(parsed.savedAt||0)>6*60*60*1000)return null;return parsed.data||null}catch(e){return null}}
function writeAnalysisCache(pts,data){try{sessionStorage.setItem(analysisCacheKey(pts),JSON.stringify({savedAt:Date.now(),data}))}catch(e){}}
async function fetchOverpassRoads(query,endpoint,timeoutMs){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
 try{
  // POST form-urlencoded evita URLs largas y sigue siendo una petición CORS simple.
  const body=new URLSearchParams({data:query});
  const res=await fetch(endpoint,{method:'POST',body,headers:{'Accept':'application/json'},signal:ctrl.signal,cache:'no-store',credentials:'omit'});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const text=await res.text();
  let data;try{data=JSON.parse(text)}catch(e){throw new Error('Respuesta no JSON')}
  if(!data||!Array.isArray(data.elements))throw new Error('Respuesta inválida');
  return data;
 }finally{clearTimeout(timer)}
}
async function fetchOsmMapFallback(box,timeoutMs=12000){
 const width=box.east-box.west,height=box.north-box.south;
 if(width*height>0.01)throw new Error('Zona demasiado amplia para respaldo OSM');
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
 try{
  const url=`https://api.openstreetmap.org/api/0.6/map?bbox=${box.west.toFixed(6)},${box.south.toFixed(6)},${box.east.toFixed(6)},${box.north.toFixed(6)}`;
  const res=await fetch(url,{method:'GET',signal:ctrl.signal,cache:'no-store',credentials:'omit'});
  if(!res.ok)throw new Error(`OSM HTTP ${res.status}`);
  const xml=await res.text(),doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('XML OSM inválido');
  const nodeMap=new Map([...doc.querySelectorAll('node')].map(n=>[n.getAttribute('id'),{lat:Number(n.getAttribute('lat')),lon:Number(n.getAttribute('lon'))}]));
  const elements=[...doc.querySelectorAll('way')].map(w=>{
   const tags={};w.querySelectorAll(':scope > tag').forEach(t=>tags[t.getAttribute('k')]=t.getAttribute('v'));
   const nodes=[...w.querySelectorAll(':scope > nd')].map(n=>n.getAttribute('ref'));
   const geometry=nodes.map(id=>nodeMap.get(id)).filter(Boolean);
   return {type:'way',id:Number(w.getAttribute('id')),tags,nodes,geometry};
  });
  return {elements};
 }finally{clearTimeout(timer)}
}
function manualGoalValue(){const v=Number($('#manualGoalInput')?.value||manualGoalOverride||0);return Number.isFinite(v)&&v>0?Math.round(v):0}
function showManualGoalFallback(show=true){const el=$('#manualGoalFallback');if(el)el.hidden=!show}
function applyManualGoal(){const v=manualGoalValue();if(!v)return alert('Captura una meta mayor a cero.');manualGoalOverride=v;const status=$('#coverageAnalysis');if(status){status.className='coverage-analysis manual';status.textContent=`Meta provisional activa: ${v} ${goalType}. Puedes guardarla ahora o reintentar el análisis automático después.`}updateGoal()}
async function analyzeZone(pts,{silent=false,force=false}={}){
 if(mode!=='volanteo'||coverageMode!=='zone')return null;
 const polygon=Array.isArray(pts)?pts.map(p=>[Number(p[0]),Number(p[1])]):[];
 if(polygon.length<3){if(!silent)alert('Marca al menos 3 puntos para delimitar una zona.');return null}
 // Cada análisis pertenece a una sesión concreta de dibujo. Si el usuario reinicia
 // o comienza otra zona mientras una consulta está pendiente, su respuesta se descarta.
 const sessionAtStart=drawSessionId,runId=++analysisRunId;
 const stillCurrent=()=>runId===analysisRunId&&sessionAtStart===drawSessionId;
 const status=$('#coverageAnalysis'),retry=$('#retryAnalysisBtn');
 // Regla v27: una consulta nueva NUNCA destruye un análisis que ya era válido.
 // Esto es especialmente importante al pulsar "Reintentar": si la red falla,
 // conservamos la última meta útil y solo mostramos una advertencia.
 const cachedBeforeRun=readAnalysisCache(polygon);
 const previousValid=(roadAnalysis&&(roadAnalysis.streetCount||roadAnalysis.blockCount))?roadAnalysis:((cachedBeforeRun?.streetCount||cachedBeforeRun?.blockCount)?cachedBeforeRun:null);
 manualGoalOverride=null;showManualGoalFallback(false);
 if($('#manualGoalInput'))$('#manualGoalInput').value='';
 if(retry){retry.hidden=true;retry.disabled=true}
 if(!force&&cachedBeforeRun){if(!stillCurrent())return null;roadAnalysis=cachedBeforeRun;if(status){status.className='coverage-analysis success';status.textContent=`Detectamos ${roadAnalysis.streetCount} ${roadAnalysis.streetCount===1?'calle operativa':'calles operativas'} y ${roadAnalysis.blockCount} ${roadAnalysis.blockCount===1?'cuadra estimada':'cuadras estimadas'} dentro de la zona.`}refreshDraft();updateGoal();renderStreetReview();if(retry)retry.disabled=false;return roadAnalysis}
 if(status){status.className='coverage-analysis loading';status.textContent='Consultando la red vial del sector…'}
 const box=zoneBBox(polygon);
 const query=`[out:json][timeout:18];way["highway"~"^(residential|living_street|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|service|road)$"](${box.south.toFixed(6)},${box.west.toFixed(6)},${box.north.toFixed(6)},${box.east.toFixed(6)});out body geom;`;
 const endpoints=overpassEndpoints(),errors=[];
 for(let i=0;i<endpoints.length;i++){
  const endpoint=endpoints[i];
  try{
   if(status){status.className='coverage-analysis loading';status.textContent=`Analizando calles del sector… fuente ${i+1} de ${endpoints.length+1}.`}
   const data=await fetchOverpassRoads(query,endpoint,Number((window.VOLANTEO_CONFIG||{}).OVERPASS_TIMEOUT_MS||12000));
   const analysis=chunkRoadWays(data.elements||[],polygon);
   if(!analysis.streetCount&&!analysis.blockCount)throw new Error('La respuesta no contiene vialidades utilizables');
   if(!stillCurrent())return null;
   // IMPORTANTE v27: desde este punto el análisis ya fue aceptado.
   // Ningún error de renderizado posterior debe hacer que probemos otra fuente
   // ni que se pierda la meta correcta que acabamos de calcular.
   roadAnalysis=analysis;
   lastAcceptedAnalysis=analysis;lastAcceptedPolygonKey=analysisCacheKey(polygon);
   writeAnalysisCache(polygon,analysis);
   const acceptedAnalysis=roadAnalysis;
   try{
    if(status){status.className='coverage-analysis success';status.textContent=`Detectamos ${acceptedAnalysis.streetCount} ${acceptedAnalysis.streetCount===1?'calle operativa':'calles operativas'} y ${acceptedAnalysis.blockCount} ${acceptedAnalysis.blockCount===1?'cuadra estimada':'cuadras estimadas'} dentro de la zona.`}
    if(retry){retry.hidden=true;retry.disabled=false}
    showManualGoalFallback(false);
    refreshDraft();updateGoal();renderStreetReview();
   }catch(uiErr){
    console.warn('El análisis vial quedó guardado, pero falló una actualización visual no crítica:',uiErr);
    try{updateGoal()}catch(_e){}
   }
   return acceptedAnalysis;
  }catch(err){errors.push(`${endpoint}: ${err?.name==='AbortError'?'tiempo agotado':err?.message||'error'}`)}
 }
 // Respaldo independiente: API principal de OSM para sectores pequeños.
 try{
  if(status){status.className='coverage-analysis loading';status.textContent='Intentando una fuente cartográfica de respaldo…'}
  const data=await fetchOsmMapFallback(box,Number((window.VOLANTEO_CONFIG||{}).OVERPASS_TIMEOUT_MS||12000));
  const analysis=chunkRoadWays(data.elements||[],polygon);
  if(!analysis.streetCount&&!analysis.blockCount)throw new Error('El respaldo no contiene vialidades utilizables');
  if(!stillCurrent())return null;
  // Respaldo aceptado: desde aquí el valor queda bloqueado aunque falle el render.
  roadAnalysis=analysis;
  lastAcceptedAnalysis=analysis;lastAcceptedPolygonKey=analysisCacheKey(polygon);
  writeAnalysisCache(polygon,analysis);
  const acceptedAnalysis=roadAnalysis;
  try{
   if(status){status.className='coverage-analysis success';status.textContent=`Detectamos ${acceptedAnalysis.streetCount} ${acceptedAnalysis.streetCount===1?'calle operativa':'calles operativas'} y ${acceptedAnalysis.blockCount} ${acceptedAnalysis.blockCount===1?'cuadra estimada':'cuadras estimadas'} dentro de la zona.`}
   if(retry){retry.hidden=true;retry.disabled=false}
   showManualGoalFallback(false);
   refreshDraft();updateGoal();renderStreetReview();
  }catch(uiErr){
   console.warn('El análisis vial de respaldo quedó guardado, pero falló una actualización visual no crítica:',uiErr);
   try{updateGoal()}catch(_e){}
  }
  return acceptedAnalysis;
 }catch(err){errors.push(`OSM respaldo: ${err?.name==='AbortError'?'tiempo agotado':err?.message||'error'}`)}
 // Si alguna fuente alcanzó a producir un resultado válido antes de que otra tarea
 // fallara, ese resultado actual tiene prioridad sobre el snapshot de inicio.
 const validAtEnd=(roadAnalysis&&(Number(roadAnalysis.streetCount)>0||Number(roadAnalysis.blockCount)>0))?roadAnalysis:previousValid;
 if(validAtEnd){
  roadAnalysis=validAtEnd;
  if(status){
   status.className='coverage-analysis warning';
   const unitText=goalType==='cuadras'?`${roadAnalysis.blockCount} ${roadAnalysis.blockCount===1?'cuadra estimada':'cuadras estimadas'}`:`${roadAnalysis.streetCount} ${roadAnalysis.streetCount===1?'calle operativa':'calles operativas'}`;
   status.textContent=`No pudimos actualizar la red vial en este intento. Conservamos el último análisis válido: ${unitText}. Puedes guardar la ruta o reintentar después.`;
  }
  if(retry){retry.hidden=false;retry.disabled=false}
  showManualGoalFallback(false);
  refreshDraft();updateGoal();renderStreetReview();
  if(!silent)console.warn('Falló la actualización vial; se conserva el último análisis válido:',errors);
  return roadAnalysis;
 }
 const lockedSamePolygon=lastAcceptedAnalysis&&lastAcceptedPolygonKey===analysisCacheKey(polygon)&&
   (Number(lastAcceptedAnalysis.streetCount)>0||Number(lastAcceptedAnalysis.blockCount)>0);
 if(lockedSamePolygon){
  roadAnalysis=lastAcceptedAnalysis;
  if(status){
   status.className='coverage-analysis warning';
   const unitText=goalType==='cuadras'?`${roadAnalysis.blockCount} ${roadAnalysis.blockCount===1?'cuadra estimada':'cuadras estimadas'}`:`${roadAnalysis.streetCount} ${roadAnalysis.streetCount===1?'calle operativa':'calles operativas'}`;
   status.textContent=`La actualización externa no terminó correctamente, pero conservamos el análisis válido: ${unitText}. Puedes guardar la ruta.`;
  }
  if(retry){retry.hidden=false;retry.disabled=false}
  showManualGoalFallback(false);
  try{refreshDraft();updateGoal();renderStreetReview()}catch(_e){try{updateGoal()}catch(__e){}}
  return roadAnalysis;
 }
 roadAnalysis=null;
 if(status){
  status.className='coverage-analysis error';
  if(location.protocol==='file:') status.textContent='Abre la app desde GitHub Pages o un servidor web; el modo file:// puede bloquear consultas cartográficas.';
  else status.textContent='No pudimos consultar la red vial en este momento. La zona sigue guardada: reintenta sin volver a dibujar.';
 }
 if(retry){retry.hidden=false;retry.disabled=false}
 showManualGoalFallback(true);
 if(!silent)console.warn('Falló el análisis vial en todas las fuentes:',errors);
 updateGoal();return null;
}
function clearRoadAnalysis(){
 roadAnalysis=null;lastAcceptedAnalysis=null;lastAcceptedPolygonKey='';manualGoalOverride=null;
 if($('#manualGoalInput'))$('#manualGoalInput').value='';showManualGoalFallback(false);const sr=$('#streetReview');if(sr){sr.hidden=true;sr.innerHTML='';}
 if(roadLayer&&map&&map.hasLayer(roadLayer))map.removeLayer(roadLayer);
 roadLayer=null;
 const retry=$('#retryAnalysisBtn');
 if(retry){retry.hidden=true;retry.disabled=false}
}
function renderRoadSegments(segments,color,opacity=.55,weight=3){if(!map||!segments?.length)return null;const group=L.layerGroup();segments.forEach(seg=>L.polyline(seg,{color,weight,opacity,className:'street-analysis-line'}).addTo(group));group.addTo(map);return group}
function addRouteToMap(r,opacity=.82){if(!map||!r.pts?.length)return;if(r.type==='volanteo'&&r.coverageMode==='zone'){L.polygon(r.pts,{color:r.color,weight:4,opacity,fillColor:r.color,fillOpacity:.05*opacity}).addTo(map).bindTooltip(`${r.name} · ${routeMemberNames(r).join(', ')||'Sin equipo'}`);if(r.streetSegments?.length)renderRoadSegments(r.streetSegments,r.color,Math.min(.8,opacity),3);(r.blockReports||[]).filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng))).forEach(rep=>L.circleMarker([Number(rep.lat),Number(rep.lng)],{radius:5,color:'#fff',weight:2,fillColor:'#239b73',fillOpacity:1}).addTo(map).bindTooltip(`Cuadra ${rep.number} reportada`))}else L.polyline(r.pts,{color:r.color,weight:6,opacity}).addTo(map).bindTooltip(`${r.name} · ${routeMemberNames(r).join(', ')||'Sin equipo'}`);if(r.status==='live'&&r.lastPosition&&Number.isFinite(Number(r.lastPosition.lat))&&Number.isFinite(Number(r.lastPosition.lng)))L.circleMarker([Number(r.lastPosition.lat),Number(r.lastPosition.lng)],{radius:8,color:'#fff',weight:3,fillColor:r.color,fillOpacity:1}).addTo(map).bindTooltip(`${r.name} · ubicación en vivo`)}
function initMap(){if(!window.L){$('#adminMap').innerHTML='<div class="map-fallback">El mapa no pudo cargar. La administración y los formularios siguen disponibles.</div>';return}map=L.map('adminMap').setView((window.VOLANTEO_CONFIG||{}).DEFAULT_CENTER||[29.0729,-110.9559],14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);map.on('click',e=>{if(!drawing)return;const point=[Number(e.latlng.lat),Number(e.latlng.lng)];draft=[...draft,point];clearRoadAnalysis();refreshDraft();updateGoal();updateDrawingHint()});drawMap();/* No recalculamos rutas antiguas en segundo plano: antes reutilizaba el borrador global y podía contaminar un trazado nuevo. */}
function drawMap(){if(!map)return;map.eachLayer(l=>{if(!(l instanceof L.TileLayer))map.removeLayer(l)});draftLayer=null;draftVertexLayer=null;roadLayer=null;const j=getJourney(),e=getExercise();if(!j||!e)return;const visible=mapFilter==='journey'?allRoutes(j):e.routes||[];if(mapFilter==='exercise')j.exercises.filter(x=>x.id!==e.id).flatMap(x=>x.routes||[]).forEach(r=>addRouteToMap(r,.14));visible.forEach(r=>addRouteToMap(r,.82));refreshDraft();const all=[...visible.flatMap(r=>r.pts||[]),...draft];if(all.length)map.fitBounds(all,{padding:[35,35],maxZoom:16})}
function refreshDraft(){if(!map)return;if(draftLayer&&map.hasLayer(draftLayer))map.removeLayer(draftLayer);if(draftVertexLayer&&map.hasLayer(draftVertexLayer))map.removeLayer(draftVertexLayer);if(roadLayer&&map.hasLayer(roadLayer))map.removeLayer(roadLayer);draftLayer=null;draftVertexLayer=null;roadLayer=null;if(draft.length){const color=nextRouteColor();const exactDraft=draft.map(p=>[Number(p[0]),Number(p[1])]);draftLayer=(mode==='volanteo'&&coverageMode==='zone'?L.polygon(exactDraft,{color,weight:5,dashArray:'10 8',fillColor:color,fillOpacity:.06,smoothFactor:0,noClip:false}):L.polyline(exactDraft,{color,weight:6,dashArray:'10 8',smoothFactor:0,noClip:false})).addTo(map);draftVertexLayer=L.layerGroup();exactDraft.forEach((p,i)=>L.circleMarker(p,{radius:7,color:'#ffffff',weight:3,fillColor:color,fillOpacity:1,pane:'markerPane'}).bindTooltip(String(i+1),{permanent:true,direction:'center',className:'draft-vertex-label'}).addTo(draftVertexLayer));draftVertexLayer.addTo(map);if(roadAnalysis?.chunks?.length)roadLayer=renderRoadSegments(roadAnalysis.chunks,color,.72,3)}}
function hav(a,b){const R=6371,dLat=(b[0]-a[0])*Math.PI/180,dLon=(b[1]-a[1])*Math.PI/180,la1=a[0]*Math.PI/180,la2=b[0]*Math.PI/180,q=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))}
function draftKm(){let d=0;for(let i=1;i<draft.length;i++)d+=hav(draft[i-1],draft[i]);return d}
function updateGoal(){const segments=Math.max(0,draft.length-1),el=$('#coverageAnalysis');if(mode==='perifoneo'){$('#goalLabel').textContent='Kilómetros programados';$('#goalValue').textContent=draftKm().toFixed(1);$('#goalUnit').textContent='km';$('#goalSelector').hidden=true;if(el){el.className='coverage-analysis';el.textContent='El perifoneo se mide por kilómetros del recorrido trazado.'}}else{$('#goalSelector').hidden=false;if(coverageMode==='zone'){const manual=manualGoalValue();$('#goalLabel').textContent=goalType==='calles'?'Calles detectadas':'Cuadras estimadas';$('#goalValue').textContent=roadAnalysis?(goalType==='calles'?roadAnalysis.streetCount:roadAnalysis.blockCount):(manual||'—');$('#goalUnit').textContent=goalType}else{$('#goalLabel').textContent=goalType==='calles'?'Tramos de calle':'Cuadras del recorrido';$('#goalValue').textContent=segments;$('#goalUnit').textContent=goalType;if(el){el.className='coverage-analysis';el.textContent='En ruta lineal, cada tramo marcado se toma como una unidad de avance.'}}}}

async function saveRoute(){const e=getExercise();if(!e)return;if(mode==='volanteo'&&coverageMode==='zone'&&draft.length<3)return alert('Delimita al menos tres puntos para formar una zona de cobertura.');if((mode==='perifoneo'||coverageMode==='line')&&draft.length<2)return alert('Dibuja al menos un tramo.');let manual=manualGoalValue();if(mode==='volanteo'&&coverageMode==='zone'&&!roadAnalysis&&!manual){const a=await analyzeZone(draft);manual=manualGoalValue();if(!a&&!manual)return alert('El análisis automático no respondió. Puedes reintentar o capturar una meta provisional sin volver a dibujar la zona.')}const memberIds=selectedMemberIds();if(!memberIds.length)return alert('Selecciona al menos un brigadista.');const members=memberIds.map(id=>personById(id)?.name).filter(Boolean);const goal=mode==='perifoneo'?Number(draftKm().toFixed(1)):coverageMode==='zone'?(roadAnalysis?(goalType==='calles'?roadAnalysis.streetCount:roadAnalysis.blockCount):manual):Math.max(0,draft.length-1);const r={id:uid('route'),name:$('#routeName').value.trim()||`Ruta ${(e.routes.length+1).toString().padStart(2,'0')}`,type:mode,coverageMode:mode==='perifoneo'?'line':coverageMode,memberIds,members,color:nextRouteColor(),goalType:mode==='perifoneo'?'km':goalType,goal,status:'pending',progress:0,pts:draft.map(p=>[Number(p[0]),Number(p[1])]),streetSegments:roadAnalysis?(goalType==='calles'?(roadAnalysis.selectedChunks||roadAnalysis.chunks||[]):(roadAnalysis.allChunks||roadAnalysis.chunks||[])):[],streetNames:roadAnalysis?.streetNames||[],streetCount:roadAnalysis?.streetCount||null,blockCount:roadAnalysis?.blockCount||null,analysisVersion:mode==='volanteo'&&coverageMode==='zone'?(roadAnalysis?5:'manual'):null,analysisSource:mode==='volanteo'&&coverageMode==='zone'?(roadAnalysis?'osm':'manual'):null,completedBlocks:0,blockReports:[],trackPoints:[],createdAt:Date.now()};e.routes.push(r);drawSessionId++;analysisRunId++;draft=[];clearRoadAnalysis();setDrawingUI(false);saveState();$('#drawNotice').className='notice success';$('#drawNotice').textContent=`${r.name} guardada con meta de ${r.type==='perifoneo'?Number(r.goal).toFixed(1)+' km':r.goal+' '+r.goalType}${r.analysisSource==='manual'?' (provisional)':''}. Ya aparece en Seguimiento.`;$('#routeName').value=`Ruta ${(e.routes.length+1).toString().padStart(2,'0')}`;renderJourneys();updateGoal()}
async function refreshLegacyZoneGoals(){const e=getExercise();if(!e)return;const list=(e.routes||[]).filter(r=>r.type==='volanteo'&&r.coverageMode==='zone'&&Number(r.analysisVersion||0)<5&&r.pts?.length>=3);for(const r of list.slice(0,4)){const prevMode=mode,prevCoverage=coverageMode,prevGoal=goalType,prevDraft=draft,prevAnalysis=roadAnalysis;mode='volanteo';coverageMode='zone';goalType=r.goalType||'calles';draft=[...r.pts];const a=await analyzeZone(draft,{silent:true});if(a){r.streetSegments=a.chunks;r.streetNames=a.streetNames;r.streetCount=a.streetCount;r.blockCount=a.blockCount;r.goal=r.goalType==='cuadras'?a.blockCount:a.streetCount;r.analysisVersion=5;r.analysisSource='osm-v29';if(r.status==='live'&&r.goal)r.progress=Math.min(100,Math.round((r.completedUnits||0)/r.goal*100))}mode=prevMode;coverageMode=prevCoverage;goalType=prevGoal;draft=prevDraft;roadAnalysis=prevAnalysis}if(list.length){saveState();renderJourneys();clearRoadAnalysis();updateGoal()}}
async function deleteRoute(id){
 if(!confirm('¿Borrar esta ruta? Se eliminará del operativo y del seguimiento.'))return;
 const e=getExercise();if(!e)return;
 const route=e.routes.find(r=>String(r.id)===String(id));if(!route)return;
 e.routes=e.routes.filter(r=>String(r.id)!==String(id));
 renderJourneys();
 setCloudStatus(cloudMode?'Guardando eliminación…':'Actualizado',true);
 try{
  // La eliminación es una mutación crítica: persistir de inmediato antes de permitir
  // que el refresco remoto vuelva a consultar app_state.
  await saveState(state,{immediate:true});
  if(cloudMode&&window.VolanteoCloud?.adminDeleteRouteData){
   await window.VolanteoCloud.adminDeleteRouteData(id);
  }
  setCloudStatus('En línea',true);
 }catch(err){
  console.error('No se pudo completar la eliminación de la ruta',err);
  // No resucitar silenciosamente: conserva la vista local y permite reintentar guardado.
  setCloudStatus('Eliminación pendiente de sincronizar',false);
  alert('La ruta se quitó de la pantalla, pero Supabase no confirmó la eliminación. Revisa tu conexión y vuelve a intentar antes de recargar.');
 }
}
function duplicateRoute(id){const e=getExercise(),r=e.routes.find(x=>x.id===id);if(!r)return;const copy=JSON.parse(JSON.stringify(r));copy.id=uid('route');copy.name=r.name+' copia';copy.color=nextRouteColor();copy.status='pending';copy.progress=0;copy.completedUnits=0;copy.completedBlocks=0;copy.blockReports=[];copy.trackPoints=[];copy.lastPosition=null;copy.lastPositionAt=null;copy.lastProgressAt=null;delete copy.startedAt;delete copy.finishedAt;e.routes.push(copy);saveState();renderJourneys()}
function openEditRoute(id){const e=getExercise(),r=e.routes.find(x=>x.id===id);if(!r)return;editingRouteId=id;$('#editRouteName').value=r.name;renderMemberPicker('#editMemberPicker',r.memberIds||[]);$('#editRouteModal').hidden=false}
function saveEditRoute(){const e=getExercise(),r=e.routes.find(x=>x.id===editingRouteId);if(!r)return;r.name=$('#editRouteName').value.trim()||r.name;r.memberIds=selectedMemberIds('#editMemberPicker');if(!r.memberIds.length)return alert('Selecciona al menos un brigadista.');r.members=r.memberIds.map(id=>personById(id)?.name).filter(Boolean);saveState();$('#editRouteModal').hidden=true;renderJourneys()}

function addCustomExercise(){const j=getJourney();const date=prompt('Fecha del ejercicio (AAAA-MM-DD):',j.date);if(!date)return;const shift=prompt('Turno o nombre del ejercicio:','Tarde')||'Adicional';const time=prompt('Hora (HH:MM):','16:00')||'16:00';const e={id:uid('ex'),date,shift,time,status:'scheduled',routes:[],order:j.exercises.length+1};j.exercises.push(e);j.exercises.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));state.activeExerciseId=e.id;saveState();renderJourneys()}
function createJourney(){const venue=$('#newVenue').value.trim(),date=$('#newDate').value,time=$('#newTime').value||'17:00';if(!venue||!date)return alert('Captura sede y fecha.');const j={id:uid('journey'),venue,date,time,archived:false,createdAt:Date.now(),exercises:buildExercises(date)};state.journeys.push(j);state.activeJourneyId=j.id;state.activeExerciseId=j.exercises[0]?.id;saveState();$('#journeyModal').hidden=true;renderJourneys()}
function archiveJourney(){const j=getJourney();if(!j)return;if(!confirm(`¿Archivar la Jornada ${j.venue}? Sus rutas se conservarán en el historial.`))return;j.archived=true;const next=state.journeys.find(x=>!x.archived&&x.id!==j.id);if(next){state.activeJourneyId=next.id;state.activeExerciseId=next.exercises[0]?.id}saveState();renderJourneys()}

function bind(){
 renderMemberPicker('#memberPicker');
 $('#journeySelect').addEventListener('change',e=>{state.activeJourneyId=e.target.value;state.activeExerciseId=getJourney()?.exercises[0]?.id;saveState();renderJourneys()});
 $('#newJourneyBtn').addEventListener('click',()=>{$('#journeyModal').hidden=false});$('#createJourneyBtn').addEventListener('click',createJourney);$('#archiveJourneyBtn').addEventListener('click',archiveJourney);
 $('#manageBrigadistasBtn').addEventListener('click',()=>{renderBrigadistaManager();$('#brigadistaModal').hidden=false});
 $('#addBrigadistaBtn').addEventListener('click',addBrigadista);$('#newBrigadistaName').addEventListener('keydown',e=>{if(e.key==='Enter')addBrigadista()});$('#newBrigadistaPin')?.addEventListener('keydown',e=>{if(e.key==='Enter')addBrigadista()});
 $$('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).hidden=true));
 $$('.tab-btn').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.mode;$$('.tab-btn').forEach(x=>x.classList.toggle('active',x===b));drawSessionId++;analysisRunId++;if(mode==='perifoneo'){coverageMode='line';$('#coverageModeStep').hidden=true}else{$('#coverageModeStep').hidden=false;coverageMode=$('.seg-btn[data-coverage].active')?.dataset.coverage||'zone'}draft=[];clearRoadAnalysis();setDrawingUI(false);refreshDraft();updateGoal()}));
 $$('.seg-btn[data-goal]').forEach(b=>b.addEventListener('click',()=>{goalType=b.dataset.goal;$$('.seg-btn[data-goal]').forEach(x=>x.classList.toggle('active',x===b));manualGoalOverride=null;if($('#manualGoalInput'))$('#manualGoalInput').value='';if(roadAnalysis){roadAnalysis.chunks=goalType==='calles'?(roadAnalysis.selectedChunks||roadAnalysis.allChunks||roadAnalysis.chunks):(roadAnalysis.allChunks||roadAnalysis.chunks);refreshDraft();}updateGoal();renderStreetReview()}));
 $$('.seg-btn[data-coverage]').forEach(b=>b.addEventListener('click',()=>{drawSessionId++;analysisRunId++;coverageMode=b.dataset.coverage;$$('.seg-btn[data-coverage]').forEach(x=>x.classList.toggle('active',x===b));draft=[];clearRoadAnalysis();setDrawingUI(false);refreshDraft();updateGoal();$('#coverageModeHelp').textContent=coverageMode==='zone'?'Delimita el sector completo. La app detectará las vialidades interiores, no solo el perímetro.':'Dibuja un recorrido específico calle por calle, útil cuando ya conoces el orden exacto.'}));
 $$('.seg-btn[data-mapfilter]').forEach(b=>b.addEventListener('click',()=>{mapFilter=b.dataset.mapfilter;$$('.seg-btn[data-mapfilter]').forEach(x=>x.classList.toggle('active',x===b));renderMapLegend();drawMap()}));
 $('#startDrawBtn').addEventListener('click',async()=>{if(drawing&&mode==='volanteo'&&coverageMode==='zone'&&draft.length>=3){setDrawingUI(false);await analyzeZone(draft);$('#drawNotice').className=roadAnalysis?'notice success':'notice';$('#drawNotice').textContent=roadAnalysis?`Zona analizada: ${roadAnalysis.streetCount} calles operativas y ${roadAnalysis.blockCount} cuadras estimadas.`:'No pudimos analizar las calles todavía. Puedes reintentar sin volver a dibujar.';return}if(!drawing){drawSessionId++;analysisRunId++;draft=[];clearRoadAnalysis();setDrawingUI(true);refreshDraft();updateGoal();updateDrawingHint();$('#drawNotice').className='notice success';$('#drawNotice').textContent=coverageMode==='zone'&&mode==='volanteo'?'Delimitación activa. Marca los límites del sector y después cierra la zona.':'Trazado activo. El mapa está listo para recibir puntos.';if(window.innerWidth<1020)$('#adminMap')?.scrollIntoView({behavior:'smooth',block:'center'})}});
 $('#undoBtn').addEventListener('click',()=>{draft=draft.slice(0,-1);analysisRunId++;clearRoadAnalysis();refreshDraft();updateGoal();updateDrawingHint()});$('#clearBtn').addEventListener('click',()=>{drawSessionId++;analysisRunId++;draft=[];clearRoadAnalysis();setDrawingUI(false);refreshDraft();updateGoal();$('#drawNotice').className='notice';$('#drawNotice').textContent='Trazado reiniciado. Puedes comenzar de nuevo cuando quieras.'});$('#saveRouteBtn').addEventListener('click',saveRoute);$('#saveEditRouteBtn').addEventListener('click',saveEditRoute);
 $('#retryAnalysisBtn')?.addEventListener('click',async()=>{if(draft.length<3)return alert('La zona ya no tiene suficientes puntos. Delimítala de nuevo.');const btn=$('#retryAnalysisBtn');btn.disabled=true;await analyzeZone(draft,{force:true});btn.disabled=false;});
 $('#applyManualGoalBtn')?.addEventListener('click',applyManualGoal);$('#manualGoalInput')?.addEventListener('input',()=>{manualGoalOverride=null;updateGoal()});
 $('#addExerciseQuickBtn')?.addEventListener('click',addCustomExercise);
 $('#sidebarToggle')?.addEventListener('click',()=>$('#appSidebar')?.classList.toggle('open'));
 $$('[data-scroll]').forEach(el=>el.addEventListener('click',ev=>{const id=el.dataset.scroll,target=document.getElementById(id);if(target){ev.preventDefault();target.scrollIntoView({behavior:'smooth',block:'start'});$$('.nav-item').forEach(n=>n.classList.toggle('active',n===el));$('#appSidebar')?.classList.remove('open')}}));
}


function setCloudStatus(text,ok=true){
 const el=$('#cloudStatus');if(!el)return;el.innerHTML=`<i></i> ${text}`;el.classList.toggle('is-error',!ok);
}
async function cloudRefresh(){
 if(!cloudMode||!adminReady||cloudApplying||cloudWritePending())return;
 try{
  cloudApplying=true;
  const remote=await window.VolanteoCloud.adminLoadState();
  // Nunca aplicar una lectura remota vieja mientras existe una mutación local pendiente.
  if(remote&&!cloudWritePending()){
   state=migrateState(remote);
   localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
   renderJourneys();
  }
  setCloudStatus('En línea',true);
 }catch(err){console.error('Error de sincronización Supabase',err);setCloudStatus('Sin conexión',false)}finally{cloudApplying=false}
}
function refreshRealtimeFromSharedState(){
 if(cloudMode){cloudRefresh();return}
 try{
  const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return;
  state=migrateState(JSON.parse(raw));
  renderMetrics();renderExerciseContext();renderTracking();renderJourneyRoutes();renderDashboardExtras();renderMapLegend();drawMap();
 }catch(e){console.warn('No se pudo refrescar el seguimiento en vivo',e)}
}
window.addEventListener('storage',e=>{if(cloudMode)return;if(e.key&&e.key!==STORAGE_KEY)return;refreshRealtimeFromSharedState()});
if(liveChannel)liveChannel.onmessage=()=>{if(!cloudMode)refreshRealtimeFromSharedState()};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshRealtimeFromSharedState()});

async function initAdminMapRuntime(force=false){
 const target=$('#adminMap');
 if(target)target.innerHTML='<div class="map-fallback">Preparando mapa…</div>';
 const result=window.MapRuntime?.ensureLeaflet ? await window.MapRuntime.ensureLeaflet({force}) : {ok:Boolean(window.L)};
 if(!result.ok){
  if(target){
   target.innerHTML='<div class="map-fallback map-error"><strong>No pudimos cargar el motor del mapa.</strong><span>Tu información está segura. Puedes reintentar la carga sin recargar todo el panel.</span><button class="btn btn-soft" id="retryMapBtn" type="button">Reintentar mapa</button></div>';
   $('#retryMapBtn')?.addEventListener('click',()=>initAdminMapRuntime(true));
  }
  console.error('Leaflet no disponible',result);
  return;
 }
 try{initMap();setTimeout(()=>map?.invalidateSize?.(),80)}catch(err){
  console.error('Error inicializando mapa administrativo',err);
  if(target){target.innerHTML='<div class="map-fallback map-error"><strong>El motor del mapa cargó, pero no pudo inicializarse.</strong><span>Reintenta; las rutas y formularios no se perderán.</span><button class="btn btn-soft" id="retryMapBtn" type="button">Reintentar mapa</button></div>';$('#retryMapBtn')?.addEventListener('click',()=>initAdminMapRuntime(true))}
 }
}

function revealAdminApp(){
  const gate=$('#cloudLogin'),app=$('#adminApp');
  if(gate)gate.hidden=true;
  if(app)app.hidden=false;
}
async function finishAdminBoot(){
  revealAdminApp();
  bind();renderJourneys();setDrawingUI(false);updateGoal();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  await initAdminMapRuntime();
}
async function startAdminDashboard(session){
  if(adminReady)return;
  if(cloudMode&&!window.VolanteoCloud?.enabled)throw new Error('Supabase no está configurado.');
  adminReady=true;
  const logout=$('#logoutBtn');if(logout)logout.hidden=false;
  const identity=$('#adminIdentity');if(identity)identity.textContent=session?.user?.email||'Administración';
  try{
    if(cloudMode){
      cloudApplying=true;
      const remote=await window.VolanteoCloud.adminLoadState();
      if(remote)state=migrateState(remote);
      else{state=migrateState(defaultState());await window.VolanteoCloud.adminSaveState(state)}
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      setCloudStatus('En línea',true);
    }else{
      setCloudStatus('Modo local',true);
    }
    await finishAdminBoot();
    if(cloudMode)cloudSubscription=await window.VolanteoCloud.subscribeAdmin(()=>cloudRefresh());
  }catch(err){
    adminReady=false;
    setCloudStatus('Error de conexión',false);
    throw err;
  }finally{
    cloudApplying=false;
  }
}
window.VolanteoAdminDashboard={start:startAdminDashboard};
