// Test script para verificar sintaxis
document.addEventListener('click', function(e) {
  try {
    const btn = e.target.closest && e.target.closest('.date-filter-btn');
    if (!btn) return;
    e.preventDefault(); 
    e.stopPropagation();
    const field = btn.getAttribute('data-field');
    const lsKey = btn.getAttribute('data-lskey');
    if (typeof window.openDateFilterPopup === 'function') {
      window.openDateFilterPopup({ 
        field: field, 
        lsKey: lsKey, 
        trigger: btn, 
        label: btn.title || '' 
      });
    } else {
      console.log('openDateFilterPopup no está disponible todavía');
    }
  } catch(err) { 
    console.error('date-filter delegated click error', err); 
  }
});
