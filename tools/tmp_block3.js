function rebuildStickyHead(){ try {
const wrapper = document.createElement('div');
wrapper.className = 'sticky-head-wrapper';
const headTable = document.createElement('table');
headTable.className = 'costumer-table';
const clonedHead = head.cloneNode(true);
headTable.appendChild(clonedHead);
wrapper.appendChild(headTable);
// insert before scrollable wrap
container.insertBefore(wrapper, wrap);
// match column widths
const origTh = Array.from(head.querySelectorAll('th'));
const cloneTh = Array.from(clonedHead.querySelectorAll('th'));
const widths = origTh.map(th => th.getBoundingClientRect().width);
cloneTh.forEach((th,i)=>{ const w = widths[i]||160; th.style.minWidth = w+'px'; th.style.maxWidth = w+'px'; th.style.width = w+'px'; });
// ajustar ancho visible del wrapper al del contenedor con scroll
const adjustWrapper = ()=>{ wrapper.style.width = wrap.clientWidth + 'px'; };
adjustWrapper();
// sync horizontal scroll con transform para evitar saltos
const sync = ()=>{ headTable.style.transform = 'translateX(' + (-wrap.scrollLeft) + 'px)'; };
sync();
wrap.removeEventListener('scroll', sync); // prevent duplicates
wrap.addEventListener('scroll', sync, { passive:true });
window.addEventListener('resize', adjustWrapper, { passive:true });
}catch(e){ console.warn('[StickyHead] error:', e?.message); }
}
// expose globally to re-run after rendering
window.rebuildStickyHead = rebuildStickyHead;

// Edición por clave local cuando el lead no tiene _id/id (por ejemplo, datos inyectados temporalmente)
window.editarLeadKey = function(key) {
  try {
    if (!key) { alert('Error: No se proporcionó clave local'); return null; }
    const map = (window.__leadKeyMap instanceof Map) ? window.__leadKeyMap : null;
    if (!map) { console.warn('editarLeadKey: no hay mapa de leads locales'); return null; }
    const lead = map.get(key);
    if (!lead) { alert('Error: No se encontró el registro local'); return null; }
    // Intentar abrir modal de edición si la función existe
    if (typeof abrirModalEdicion === 'function') {
      try { abrirModalEdicion(lead); } catch (e) { console.warn('abrirModalEdicion error', e); }
    } else {
      console.log('editarLeadKey: abrirModalEdicion no disponible, mostrando en consola:', lead);
    }
    return lead;
  } catch (e) {
    console.warn('editarLeadKey error:', e);
    return null;
  }
};
document.body.classList.add('auto-hide-sidebar');

// Insertar zona de hover si no existe
if (!document.querySelector('.sidebar-hover-zone')) {
  const zone = document.createElement('div');
  zone.className = 'sidebar-hover-zone';
  document.body.appendChild(zone);
}

const zone = document.querySelector('.sidebar-hover-zone');
