(function(){
  const $=s=>document.querySelector(s);
  let busy=false;

  function setNotice(message,type='normal'){
    const n=$('#adminLoginNotice');
    if(!n)return;
    n.hidden=!message;
    n.className=type==='success'?'notice success-note':'notice';
    n.textContent=message||'';
  }
  function showLogin(){
    const gate=$('#cloudLogin'),app=$('#adminApp'),checking=$('#authChecking'),form=$('#adminLoginForm');
    if(gate)gate.hidden=false;
    if(app)app.hidden=true;
    if(checking)checking.hidden=true;
    if(form)form.hidden=false;
  }
  function setBusy(on,text='Ingresar al panel'){
    busy=on;
    const btn=$('#adminLoginBtn');
    if(btn){btn.disabled=on;btn.textContent=on?'Validando acceso…':text}
  }
  async function openDashboard(session){
    const allowed=await window.VolanteoCloud.isAdmin();
    if(!allowed){
      await window.VolanteoCloud.adminSignOut();
      throw new Error('La cuenta existe, pero no tiene permisos de administrador.');
    }
    setNotice('Acceso correcto. Cargando panel…','success');
    await window.VolanteoAdminDashboard.start(session);
  }
  async function login(event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if(busy)return false;
    const email=$('#adminEmail')?.value.trim()||'';
    const password=$('#adminPassword')?.value||'';
    if(!email||!password){setNotice('Captura correo y contraseña.');return false}
    if(!window.VolanteoCloud?.enabled){setNotice('La conexión con Supabase no está configurada.');return false}
    setBusy(true);setNotice('Conectando con Supabase…');
    try{
      await window.VolanteoCloud.init();
      const session=await window.VolanteoCloud.adminSignIn(email,password);
      if(!session?.access_token)throw new Error('Supabase no devolvió una sesión válida.');
      setNotice('Cuenta verificada. Comprobando permisos…');
      await openDashboard(session);
    }catch(err){
      console.error('Login administrativo',err);
      setNotice(err?.message||'No fue posible iniciar sesión.');
    }finally{
      setBusy(false);
    }
    return false;
  }
  async function restore(){
    showLogin();
    if(!window.VolanteoCloud?.enabled){setNotice('La conexión con Supabase no está configurada.');return}
    try{
      await window.VolanteoCloud.init();
      const session=await window.VolanteoCloud.getSession();
      if(!session)return;
      setNotice('Restaurando sesión…');
      await openDashboard(session);
    }catch(err){
      console.warn('No se pudo restaurar sesión',err);
      setNotice('No se pudo restaurar la sesión anterior. Puedes iniciar sesión nuevamente.');
    }
  }
  function attach(){
    showLogin();
    const form=$('#adminLoginForm'),btn=$('#adminLoginBtn'),pwd=$('#adminPassword'),retry=$('#adminRetryBtn'),logout=$('#logoutBtn');
    form?.addEventListener('submit',login);
    btn?.addEventListener('click',login);
    pwd?.addEventListener('keydown',e=>{if(e.key==='Enter')login(e)});
    retry?.addEventListener('click',restore);
    logout?.addEventListener('click',async()=>{try{await window.VolanteoCloud.adminSignOut()}finally{location.replace(location.pathname)}});
    restore();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});else attach();
})();
