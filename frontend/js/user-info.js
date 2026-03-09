/**
 * User Info - Actualiza la información del usuario en el sidebar
 */

(function() {
  'use strict';

  // Función para cargar estadísticas del usuario
  let __userCache = { at: 0, data: null };
  let __userPending = null;

  function authHeaders(){
    const h = { 'Accept': 'application/json' };
    const t = localStorage.getItem('token') || sessionStorage.getItem('token');
    if(t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  async function getUserCached(){
    const now = Date.now();
    if(__userCache.data && (now - __userCache.at) < 60000){
      return __userCache.data;
    }
    if(__userPending) return __userPending;
    __userPending = (async ()=>{
      let r = await fetch('/api/auth/verify-server', { method:'GET', credentials: 'include', headers: authHeaders() });
      if(r.status === 429){ await new Promise(rs=>setTimeout(rs, 600)); r = await fetch('/api/auth/verify-server', { method:'GET', credentials:'include', headers: authHeaders() }); }
      if(!r.ok) throw new Error('Error obteniendo información del usuario');
      const j = await r.json();
      __userCache = { at: Date.now(), data: j };
      __userPending = null;
      return j;
    })();
    try { return await __userPending; } finally { __userPending = null; }
  }

  async function loadUserStats() {
    try {
      // Obtener información del usuario usando cookies (mismo método que sidebar)
      const userData = await getUserCached();
      const user = userData.user || userData;

      try {
        const displayName = (user?.name || user?.fullName || user?.displayName || user?.username || '').toString().trim() || 'Usuario';
        const roleText = (user?.role || user?.rol || '').toString().trim() || 'Rol';
        const roleMap = {
          admin: 'Administrador',
          administrador: 'Administrador',
          administradora: 'Administrador',
          supervisor: 'Supervisor',
          agente: 'Agente',
          agent: 'Agente',
          backoffice: 'Backoffice',
          bo: 'Backoffice'
        };
        const roleLabel = roleMap[roleText.toLowerCase()] || roleText;

        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText('user-name', displayName);
        setText('topbar-user-name', displayName);
        setText('hero-name', displayName);
        setText('user-role', roleLabel);
        setText('topbar-user-role', roleLabel);

        const initials = displayName.split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase() || 'U';
        const avatarEl = document.querySelector('.user-avatar');
        if (avatarEl && avatarEl.tagName !== 'IMG') {
          avatarEl.textContent = initials;
        }
      } catch (_) {}

      // Obtener ventas del mes actual
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      
      const leadsResponse = await fetch(`/api/leads?month=${month}&year=${year}`, { method: 'GET', credentials: 'include', headers: authHeaders() });

      if (leadsResponse.ok) {
        const leadsData = await leadsResponse.json();
        // Manejar diferentes estructuras de respuesta
        let leads = [];
        if (Array.isArray(leadsData)) {
          leads = leadsData;
        } else if (Array.isArray(leadsData.leads)) {
          leads = leadsData.leads;
        } else if (Array.isArray(leadsData.data)) {
          leads = leadsData.data;
        }

        // Filtrar ventas del usuario actual
        const userLeads = leads.filter(lead => 
          lead.agenteNombre === user.username || lead.agente === user.username
        );

        // Calcular puntos totales
        const totalPoints = userLeads.reduce((sum, lead) => {
          const points = parseFloat(lead.puntaje || lead.puntos || 0);
          return sum + points;
        }, 0);

        // Actualizar elementos del DOM
        const salesElement = document.getElementById('sidebar-user-sales');
        const pointsElement = document.getElementById('sidebar-user-points');

        if (salesElement) {
          salesElement.textContent = userLeads.length;
        }

        if (pointsElement) {
          pointsElement.textContent = totalPoints.toFixed(1);
        }

        console.log(`✅ Estadísticas actualizadas: ${userLeads.length} ventas, ${totalPoints.toFixed(1)} puntos`);
      }
    } catch (error) {
      console.error('Error cargando estadísticas del usuario:', error);
    }
  }

  // Inicializar cuando el sidebar se cargue
  document.addEventListener('sidebar:loaded', () => {
    setTimeout(loadUserStats, 500);
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadUserStats, 150);
  });

  // Exportar función para uso externo
  window.loadUserStats = loadUserStats;

})();
