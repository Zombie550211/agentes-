// Stub de auth-check para evitar 404/MIME errors.
// Valida sesión de manera no intrusiva usando /api/auth/verify-server si existe.
(function(){
  try{
    fetch('/api/auth/verify-server', { method:'GET', credentials:'include' })
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if(!data || !data.user){
          console.warn('[auth-check] Usuario no verificado (stub).');
        } else {
          console.log('[auth-check] Usuario verificado:', data.user?.username);
          // Guardar información del usuario en localStorage
          localStorage.setItem('userName', data.user?.username || 'Usuario');
          localStorage.setItem('userRole', data.user?.role || 'usuario');
          localStorage.setItem('userTeam', data.user?.team || 'Sin equipo');
          document.dispatchEvent(new CustomEvent('user:authenticated', { detail: data.user }));
        }
      })
      .catch(()=>console.warn('[auth-check] No se pudo verificar (stub).'));
  }catch(e){ console.warn('[auth-check] error stub:', e?.message); }
})();
