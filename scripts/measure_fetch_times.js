/*
  Measure Fetch Times
  - Envuelve window.fetch para registrar duración, status y url
  - Guarda resultados en window.__fetchTimings y expone getFetchTimings()
  - Loguea automáticamente llamadas a /api/leads y /api/auth/verify-server
*/
(function(){
  try{
    const origFetch = window.fetch.bind(window);
    window.__fetchTimings = window.__fetchTimings || [];

    function record(entry){
      try{ window.__fetchTimings.push(entry); }catch(_){}
      try{
        // Log de endpoints críticos
        if (/\/api\/leads|\/api\/auth\/verify-server|\/api\/customers/.test(entry.url)) console.log('[FetchTiming]', entry);
      }catch(_){}
    }

    window.fetch = async function(input, init){
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const start = (performance && performance.now) ? performance.now() : Date.now();
      try{
        const res = await origFetch(input, init);
        const end = (performance && performance.now) ? performance.now() : Date.now();
        const entry = { url: String(url||''), status: res && res.status, durationMs: Math.round((end-start)*100)/100, time: (new Date()).toISOString() };
        record(entry);
        return res;
      }catch(err){
        const end = (performance && performance.now) ? performance.now() : Date.now();
        const entry = { url: String(url||''), error: String(err||''), durationMs: Math.round((end-start)*100)/100, time: (new Date()).toISOString() };
        record(entry);
        throw err;
      }
    };

    window.getFetchTimings = function(){ return Array.isArray(window.__fetchTimings) ? window.__fetchTimings.slice(0) : []; };

    // Helper: cuando el DOM esté listo, exponer un mensaje en consola
    document.addEventListener('DOMContentLoaded', () => {
      try{
        console.log('[FetchTiming] Monitor activo. Usa getFetchTimings() para ver resultados.');
      }catch(e){}
    });
  }catch(e){ console.warn('[FetchTiming] no se pudo instalar wrapper:', e); }
})();
