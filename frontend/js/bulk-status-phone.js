// Script para cambio masivo de status por números telefónicos
(function() {
  console.log('[BULK STATUS PHONE] Script cargado correctamente');
  
  // Normalizar número telefónico (eliminar todo excepto dígitos)
  function normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  // Abrir modal
  window.openBulkStatusPhoneModal = function() {
    console.log('[BULK STATUS PHONE] Intentando abrir modal');
    const modal = document.getElementById('bulkStatusPhoneModal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'flex';
      document.getElementById('bulkPhoneNumbers').value = '';
      document.getElementById('bulkNewStatus').value = '';
      document.getElementById('phoneCount').textContent = '0';
      document.getElementById('bulkStatusPreview').style.display = 'none';
      document.getElementById('btnExecuteBulkStatus').disabled = true;
    }
  };

  // Cerrar modal
  window.closeBulkStatusPhoneModal = function() {
    const modal = document.getElementById('bulkStatusPhoneModal');
    if (modal) {
      modal.setAttribute('aria-hidden', 'true');
      modal.style.display = 'none';
    }
  };

  // Detectar y contar números telefónicos
  function updatePhoneCount() {
    const textarea = document.getElementById('bulkPhoneNumbers');
    const text = textarea.value;
    const lines = text.split('\n').filter(l => l.trim());
    const phones = lines.map(normalizePhone).filter(p => p.length >= 10);
    const uniquePhones = [...new Set(phones)];
    
    document.getElementById('phoneCount').textContent = uniquePhones.length;
    
    const status = document.getElementById('bulkNewStatus').value;
    const btn = document.getElementById('btnExecuteBulkStatus');
    
    if (uniquePhones.length > 0 && status) {
      btn.disabled = false;
      showPreview(uniquePhones, status);
    } else {
      btn.disabled = true;
      document.getElementById('bulkStatusPreview').style.display = 'none';
    }
  }

  // Mostrar vista previa
  function showPreview(phones, status) {
    const preview = document.getElementById('bulkStatusPreview');
    const content = document.getElementById('bulkStatusPreviewContent');
    
    content.innerHTML = `
      Se actualizará el status a <strong>${status}</strong> para <strong>${phones.length}</strong> número(s) telefónico(s).
      <br><br>
      <div style="font-size:.68rem;color:var(--ink-3);max-height:100px;overflow-y:auto;">
        ${phones.slice(0, 10).join(', ')}${phones.length > 10 ? ` y ${phones.length - 10} más...` : ''}
      </div>
    `;
    preview.style.display = 'block';
  }

  // Ejecutar cambio masivo
  window.executeBulkStatusByPhone = async function() {
    const textarea = document.getElementById('bulkPhoneNumbers');
    const statusSelect = document.getElementById('bulkNewStatus');
    const btn = document.getElementById('btnExecuteBulkStatus');
    
    const text = textarea.value;
    const lines = text.split('\n').filter(l => l.trim());
    const phones = lines.map(normalizePhone).filter(p => p.length >= 10);
    const uniquePhones = [...new Set(phones)];
    const newStatus = statusSelect.value;
    
    if (uniquePhones.length === 0) {
      alert('No se detectaron números telefónicos válidos');
      return;
    }
    
    if (!newStatus) {
      alert('Selecciona un status');
      return;
    }
    
    const confirm = window.confirm(
      `¿Estás seguro de actualizar el status a "${newStatus}" para ${uniquePhones.length} número(s) telefónico(s)?`
    );
    
    if (!confirm) return;
    
    btn.disabled = true;
    btn.textContent = '⏳ Procesando...';
    
    try {
      const response = await fetch('/api/leads/bulk-status-by-phone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phones: uniquePhones,
          newStatus: newStatus
        })
      });
      
      const data = await response.json();
      
      // DEBUG: Verificar qué datos recibimos
      console.log('[BULK STATUS PHONE] Respuesta del servidor:', data);
      console.log('[BULK STATUS PHONE] foundPhones:', data.foundPhones);
      console.log('[BULK STATUS PHONE] notFoundPhones:', data.notFoundPhones);
      
      if (data.success) {
        // Mostrar resultado dentro del modal
        showResultInModal(data);
        
        // Refrescar tabla
        if (typeof loadCostumers === 'function') {
          loadCostumers();
        }
      } else {
        // Mostrar error dentro del modal
        showErrorInModal(data.message || 'No se pudo actualizar');
      }
    } catch (error) {
      console.error('Error al actualizar status masivo:', error);
      alert('❌ Error de conexión: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Actualizar status';
    }
  };

  // Mostrar resultado exitoso dentro del modal
  function showResultInModal(data) {
    const preview = document.getElementById('bulkStatusPreview');
    const content = document.getElementById('bulkStatusPreviewContent');
    
    let html = `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
        <span style="font-size: 1.2rem;">✅</span>
        <span style="font-size: 0.9rem; font-weight: 700; color: var(--go);">Status actualizado exitosamente</span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div style="padding: 12px; background: var(--go-bg); border-radius: var(--r2); text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--go);">${data.updated || 0}</div>
          <div style="font-size: 0.7rem; color: var(--ink-3);">Leads actualizados</div>
        </div>
        <div style="padding: 12px; background: var(--stop-bg); border-radius: var(--r2); text-align: center;">
          <div style="font-size: 1.5rem; font-weight: 700; color: var(--stop);">${data.notFound || 0}</div>
          <div style="font-size: 0.7rem; color: var(--ink-3);">No encontrados</div>
        </div>
      </div>
    `;
    
    // Agregar lista de números que SÍ se encontraron y actualizaron
    if (data.foundPhones && data.foundPhones.length > 0) {
      html += `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--go); margin-bottom: 8px;">
            ✅ Números actualizados (${data.foundPhones.length}):
          </div>
          <div style="background: var(--go-bg); border: 1px solid var(--go-ln); border-radius: var(--r2); padding: 12px; max-height: 120px; overflow-y: auto;">
            ${data.foundPhones.map(phone => {
              // Formatear el número para mejor legibilidad
              if (phone.length === 10) {
                return `<div style="font-family: var(--f-mono); font-size: 0.75rem; color: var(--go); padding: 2px 0;">✓ (${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6)}</div>`;
              }
              return `<div style="font-family: var(--f-mono); font-size: 0.75rem; color: var(--go); padding: 2px 0;">✓ ${phone}</div>`;
            }).join('')}
          </div>
        </div>
      `;
    }
    
    // Agregar lista de números que NO se encontraron
    if (data.notFoundPhones && data.notFoundPhones.length > 0) {
      html += `
        <div>
          <div style="font-size: 0.8rem; font-weight: 600; color: var(--stop); margin-bottom: 8px;">
            ❌ Números no encontrados (${data.notFoundPhones.length}):
          </div>
          <div style="background: var(--stop-bg); border: 1px solid var(--stop-ln); border-radius: var(--r2); padding: 12px; max-height: 120px; overflow-y: auto;">
            ${data.notFoundPhones.map(phone => {
              // Formatear el número para mejor legibilidad
              if (phone.length === 10) {
                return `<div style="font-family: var(--f-mono); font-size: 0.75rem; color: var(--stop); padding: 2px 0;">✗ (${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6)}</div>`;
              }
              return `<div style="font-family: var(--f-mono); font-size: 0.75rem; color: var(--stop); padding: 2px 0;">✗ ${phone}</div>`;
            }).join('')}
          </div>
        </div>
      `;
    }
    
    // Cambiar el botón principal a "Cerrar"
    const btn = document.getElementById('btnExecuteBulkStatus');
    btn.textContent = '✓ Cerrar';
    btn.onclick = closeBulkStatusPhoneModal;
    btn.disabled = false;
    
    content.innerHTML = html;
    preview.style.display = 'block';
    preview.style.background = 'none';
    preview.style.border = 'none';
    preview.style.padding = '0';
  }

  // Mostrar error dentro del modal
  function showErrorInModal(message) {
    const preview = document.getElementById('bulkStatusPreview');
    const content = document.getElementById('bulkStatusPreviewContent');
    
    const html = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.2rem;">❌</span>
        <span style="font-size: 0.9rem; font-weight: 700; color: var(--stop);">Error</span>
      </div>
      <div style="margin-top: 8px; font-size: 0.8rem; color: var(--ink-2);">${message}</div>
    `;
    
    // Cambiar el botón principal a "Cerrar"
    const btn = document.getElementById('btnExecuteBulkStatus');
    btn.textContent = '✗ Cerrar';
    btn.onclick = closeBulkStatusPhoneModal;
    btn.disabled = false;
    
    content.innerHTML = html;
    preview.style.display = 'block';
    preview.style.background = 'none';
    preview.style.border = 'none';
    preview.style.padding = '0';
  }

  // Event listeners
  document.addEventListener('DOMContentLoaded', function() {
    console.log('[BULK STATUS PHONE] DOMContentLoaded - Registrando event listeners');
    const btnOpen = document.getElementById('btn-bulk-status-phone');
    console.log('[BULK STATUS PHONE] Botón encontrado:', btnOpen);
    if (btnOpen) {
      btnOpen.addEventListener('click', function() {
        console.log('[BULK STATUS PHONE] Click en botón detectado');
        window.openBulkStatusPhoneModal();
      });
      console.log('[BULK STATUS PHONE] Event listener registrado correctamente');
    } else {
      console.error('[BULK STATUS PHONE] ERROR: Botón btn-bulk-status-phone no encontrado');
    }
    
    const phoneTextarea = document.getElementById('bulkPhoneNumbers');
    if (phoneTextarea) {
      phoneTextarea.addEventListener('input', updatePhoneCount);
    }
    
    const statusSelect = document.getElementById('bulkNewStatus');
    if (statusSelect) {
      statusSelect.addEventListener('change', updatePhoneCount);
    }
  });
})();
