/**
 * Acciones de la tabla de clientes
 * Funciones para editar, eliminar y ver comentarios
 */

(function() {
  console.log('[COSTUMER ACTIONS] Inicializando acciones...');

  /**
   * Ver comentarios de un cliente
   */
  window.verComentarios = function(clienteId) {
    console.log('[COSTUMER] Ver comentarios del cliente:', clienteId);
    
    // Abrir modal de comentarios
    if (typeof window.abrirComentarios === 'function') {
      window.abrirComentarios(clienteId);
    } else {
      alert('Sistema de comentarios en desarrollo');
    }
  };

  /**
   * Editar cliente
   */
  window.editarCliente = function(clienteId) {
    console.log('[COSTUMER] Editar cliente:', clienteId);
    
    // Buscar el cliente en los datos
    const customers = window.ultimaListaLeads || [];
    const customer = customers.find(c => (c._id || c.id) === clienteId);
    
    if (!customer) {
      alert('Cliente no encontrado');
      return;
    }
    
    // Abrir modal
    const modal = document.getElementById('editarModal');
    if (!modal) {
      console.error('[COSTUMER] Modal de edición no encontrado');
      return;
    }
    
    // Guardar ID del cliente actual
    window.currentEditClienteId = clienteId;
    
    // Actualizar título del modal con ID del lead
    const leadIdDisplay = document.getElementById('edit-lead-id-display');
    if (leadIdDisplay) {
      leadIdDisplay.textContent = String(clienteId);
    }
    
    // Helper para normalizar fechas a formato yyyy-MM-dd (sin conversión UTC)
    const normalizarFecha = (fecha) => {
      if (!fecha) return '';
      try {
        const fechaStr = String(fecha).trim();
        
        // Si ya viene en formato yyyy-MM-dd, devolverlo tal cual
        if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
          return fechaStr;
        }
        
        // Si viene en formato ISO completo (2025-10-20T00:00:00.000Z)
        // Extraer solo la parte de la fecha sin conversión de timezone
        const match = fechaStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          return `${match[1]}-${match[2]}-${match[3]}`;
        }
        
        // Fallback: intentar parsear como fecha
        const f = new Date(fecha);
        if (isNaN(f.getTime())) return '';
        
        // Usar UTC para evitar problemas de timezone
        const year = f.getUTCFullYear();
        const month = String(f.getUTCMonth() + 1).padStart(2, '0');
        const day = String(f.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      } catch {
        return '';
      }
    };
    
    // Cargar datos en el formulario con validación
    const setFieldValue = (id, value) => {
      const field = document.getElementById(id);
      if (field) field.value = value || '';
    };
    
    setFieldValue('edit-id', clienteId);
    setFieldValue('edit-telefono', customer.telefono_principal);
    setFieldValue('edit-telefono-alt', customer.telefono_alterno);
    (function(){
      const full = (customer.nombre_cliente || '').toString().trim();
      let nombres = (customer.nombres || '').toString().trim();
      let apellidos = (customer.apellidos || '').toString().trim();
      if (!nombres && !apellidos && full) {
        const parts = full.split(/\s+/);
        if (parts.length >= 2) {
          apellidos = parts.pop();
          nombres = parts.join(' ');
        } else {
          nombres = full;
        }
      }
      setFieldValue('edit-nombres', nombres);
      setFieldValue('edit-apellidos', apellidos);
    })();
    setFieldValue('edit-direccion', customer.direccion);
    setFieldValue('edit-zip-code', customer.zip_code);
    setFieldValue('edit-tipo-servicios', customer.tipo_servicios || customer.servicios);
    setFieldValue('edit-numero-cuenta', customer.numero_cuenta);
    setFieldValue('edit-dia-venta', normalizarFecha(customer.dia_venta || customer.fecha_contratacion || customer.fecha));
    setFieldValue('edit-dia-instalacion', normalizarFecha(customer.dia_instalacion));
    setFieldValue('edit-supervisor', customer.supervisor);
    setFieldValue('edit-mercado', customer.mercado);
    setFieldValue('edit-email', customer.email);
    setFieldValue('edit-documento', customer.documento || customer.identificacion);
    setFieldValue('edit-idioma', customer.idioma);
    setFieldValue('edit-representante', customer.representante || customer.agente || customer.agenteNombre);
    
    // Campos TV (si existen en el customer)
    setFieldValue('edit-tv1', customer.tv1 || '');
    setFieldValue('edit-tv2', customer.tv2 || '');
    setFieldValue('edit-tv3', customer.tv3 || '');
    setFieldValue('edit-tv4', customer.tv4 || '');
    
    // Autopago - manejar checkbox o select
    const autopagoField = document.getElementById('edit-autopago');
    if (autopagoField) {
      const autopago = customer.autopago === true || customer.autopago === 'Sí' || customer.autopago === 'SI';
      if (autopagoField.tagName === 'SELECT') {
        autopagoField.value = autopago ? 'Sí' : 'No';
      } else if (autopagoField.type === 'checkbox') {
        autopagoField.checked = autopago;
      }
    }
    
    // Cargar notas/historial del cliente
    cargarNotasCliente(clienteId);
    
    // Mostrar modal
    modal.style.display = 'block';
    
    console.log('[COSTUMER] Modal de edición abierto para cliente:', clienteId);
  };

  /**
   * Eliminar cliente
   */
  window.eliminarCliente = async function(clienteId) {
    console.log('[COSTUMER] Eliminar cliente:', clienteId);
    
    if (!confirm('¿Estás seguro de que deseas eliminar este cliente?')) {
      return;
    }
    
    try {
      // Llamar al endpoint de eliminación
      const response = await fetch(`/api/leads/${clienteId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        alert('Cliente eliminado correctamente');
        
        // Recargar tabla
        if (window.CostumerPage && window.CostumerPage.loadCustomers) {
          await window.CostumerPage.loadCustomers();
        }
      } else {
        const error = await response.json();
        alert('Error al eliminar: ' + (error.message || 'Error desconocido'));
      }
    } catch (error) {
      console.error('[COSTUMER] Error eliminando cliente:', error);
      alert('Error al eliminar el cliente: ' + error.message);
    }
  };

  /**
   * Abrir modal de comentarios
   */
  window.abrirComentarios = function(clienteId) {
    console.log('[COSTUMER] Abrir comentarios para cliente:', clienteId);
    
    const modal = document.getElementById('comentariosModal');
    if (!modal) {
      console.error('[COSTUMER] Modal de comentarios no encontrado');
      return;
    }
    
    // Guardar ID del cliente actual
    window.currentClienteId = clienteId;
    
    // Mostrar modal
    modal.style.display = 'block';
    
    // Cargar comentarios
    cargarComentarios(clienteId);
  };

  /**
   * Cerrar modal de comentarios
   */
  window.cerrarComentarios = function() {
    const modal = document.getElementById('comentariosModal');
    if (modal) {
      modal.style.display = 'none';
    }
    
    window.currentClienteId = null;
  };

  /**
   * Cargar comentarios de un cliente
   */
  async function cargarComentarios(clienteId) {
    const container = document.getElementById('comentariosContainer');
    if (!container) return;
    
    container.innerHTML = '<p style="text-align: center; color: #64748b;">Cargando comentarios...</p>';
    
    try {
      // Intentar cargar desde el servidor
      const response = await fetch(`/api/leads/${clienteId}/comentarios`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        const comentarios = data.comentarios || data.data || [];
        
        renderComentarios(comentarios);
      } else {
        // Mostrar mensaje de que no hay comentarios
        container.innerHTML = '<p style="text-align: center; color: #64748b;">No hay comentarios para este cliente</p>';
      }
    } catch (error) {
      console.error('[COSTUMER] Error cargando comentarios:', error);
      container.innerHTML = '<p style="text-align: center; color: #64748b;">No hay comentarios disponibles</p>';
    }
  }

  /**
   * Renderizar comentarios
   */
  function renderComentarios(comentarios) {
    const container = document.getElementById('comentariosContainer');
    if (!container) return;
    
    if (!comentarios || comentarios.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #64748b;">No hay comentarios para este cliente</p>';
      return;
    }
    
    let html = '';
    comentarios.forEach(comentario => {
      const fecha = new Date(comentario.fecha || comentario.createdAt);
      const fechaStr = fecha.toLocaleString('es-ES');
      
      html += `
        <div style="background: #f8fafc; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; margin-bottom: 8px;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #0ea5e9; color: white; display: flex; align-items: center; justify-content: center; margin-right: 8px; font-weight: 600;">
              ${(comentario.usuario || 'U')[0].toUpperCase()}
            </div>
            <div>
              <div style="font-weight: 600; color: #1e293b;">${comentario.usuario || 'Usuario'}</div>
              <div style="font-size: 0.75rem; color: #64748b;">${fechaStr}</div>
            </div>
          </div>
          <div style="color: #475569;">${comentario.texto || comentario.comentario || ''}</div>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }

  /**
   * Agregar nuevo comentario
   */
  window.agregarComentario = async function() {
    const textarea = document.getElementById('nuevoComentario');
    if (!textarea) return;
    
    const texto = textarea.value.trim();
    if (!texto) {
      alert('Por favor escribe un comentario');
      return;
    }
    
    const clienteId = window.currentClienteId;
    if (!clienteId) {
      alert('No hay cliente seleccionado');
      return;
    }
    
    try {
      const user = window.getCurrentUser ? window.getCurrentUser() : { username: 'Usuario' };
      
      const response = await fetch(`/api/leads/${clienteId}/comentarios`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          texto: texto,
          usuario: user.username || 'Usuario'
        })
      });
      
      if (response.ok) {
        // Limpiar textarea
        textarea.value = '';
        
        // Recargar comentarios
        await cargarComentarios(clienteId);
      } else {
        alert('Error al agregar comentario');
      }
    } catch (error) {
      console.error('[COSTUMER] Error agregando comentario:', error);
      alert('Error al agregar comentario: ' + error.message);
    }
  };

  /**
   * Toggle emoji picker
   */
  window.toggleEmojiPicker = function(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const picker = document.getElementById('emojiPicker');
    if (picker) {
      picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    }
  };

  /**
   * Insertar emoji
   */
  window.insertEmoji = function(emoji) {
    const textarea = document.getElementById('nuevoComentario');
    if (textarea) {
      textarea.value += emoji;
      textarea.focus();
    }
    
    // Cerrar picker
    const picker = document.getElementById('emojiPicker');
    if (picker) {
      picker.style.display = 'none';
    }
  };

  // Cerrar modal al hacer clic fuera
  document.addEventListener('click', function(e) {
    const modal = document.getElementById('comentariosModal');
    if (modal && e.target === modal) {
      window.cerrarComentarios();
    }
    
    // Cerrar emoji picker al hacer clic fuera
    const picker = document.getElementById('emojiPicker');
    const emojiBtn = document.getElementById('emojiToggleBtn');
    if (picker && picker.style.display === 'block' && 
        !picker.contains(e.target) && e.target !== emojiBtn) {
      picker.style.display = 'none';
    }
  });

  /**
   * Cerrar modal de edición
   */
  window.cerrarModalEdicion = function() {
    const modal = document.getElementById('editarModal');
    if (modal) {
      modal.style.display = 'none';
    }
    window.currentEditClienteId = null;
  };

  /**
   * Guardar cambios del lead/cliente
   */
  window.guardarCambiosLead = async function() {
    const clienteId = window.currentEditClienteId;
    if (!clienteId) {
      alert('No hay cliente seleccionado');
      return;
    }

    // Helper para obtener valor de campo
    const getFieldValue = (id) => {
      const field = document.getElementById(id);
      return field ? field.value.trim() : '';
    };

    // Recopilar datos del formulario
    const __nombres = (getFieldValue('edit-nombres') || '').trim();
    const __apellidos = (getFieldValue('edit-apellidos') || '').trim();
    const datosActualizados = {
      telefono_principal: getFieldValue('edit-telefono'),
      telefono_alterno: getFieldValue('edit-telefono-alt'),
      nombre_cliente: [__nombres, __apellidos].filter(Boolean).join(' ').trim(),
      direccion: getFieldValue('edit-direccion'),
      zip_code: getFieldValue('edit-zip-code'),
      tipo_servicios: getFieldValue('edit-tipo-servicios'),
      numero_cuenta: getFieldValue('edit-numero-cuenta'),
      dia_venta: getFieldValue('edit-dia-venta'),
      dia_instalacion: getFieldValue('edit-dia-instalacion'),
      supervisor: getFieldValue('edit-supervisor'),
      mercado: getFieldValue('edit-mercado'),
      email: getFieldValue('edit-email'),
      documento: getFieldValue('edit-documento'),
      idioma: getFieldValue('edit-idioma'),
      representante: getFieldValue('edit-representante')
    };

    // Campos TV
    const tv1 = getFieldValue('edit-tv1');
    const tv2 = getFieldValue('edit-tv2');
    const tv3 = getFieldValue('edit-tv3');
    const tv4 = getFieldValue('edit-tv4');
    if (tv1) datosActualizados.tv1 = tv1;
    if (tv2) datosActualizados.tv2 = tv2;
    if (tv3) datosActualizados.tv3 = tv3;
    if (tv4) datosActualizados.tv4 = tv4;

    // Autopago
    const autopagoField = document.getElementById('edit-autopago');
    if (autopagoField) {
      if (autopagoField.tagName === 'SELECT') {
        datosActualizados.autopago = autopagoField.value === 'Sí';
      } else if (autopagoField.type === 'checkbox') {
        datosActualizados.autopago = autopagoField.checked;
      }
    }
    
    // Limpiar campos vacíos para no sobrescribir datos existentes
    Object.keys(datosActualizados).forEach(key => {
      if (datosActualizados[key] === '' || datosActualizados[key] === null || datosActualizados[key] === undefined) {
        delete datosActualizados[key];
      }
    });

    console.log('[COSTUMER] Guardando cambios para cliente:', clienteId, datosActualizados);

    try {
      const response = await fetch(`/api/leads/${clienteId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(datosActualizados)
      });

      if (response.ok) {
        alert('Cliente actualizado correctamente');
        
        // Cerrar modal
        window.cerrarModalEdicion();
        
        let updated = false;
        try {
          if (Array.isArray(window.ultimaListaLeads)) {
            const id = String(clienteId);
            const match = (l) => {
              const sid = (l && (l._id?.toString?.() || l._id || l.id || l.ID || l.id_cliente)) || '';
              return String(sid) === id;
            };
            const idx = window.ultimaListaLeads.findIndex(match);
            if (idx >= 0) {
              window.ultimaListaLeads[idx] = { ...window.ultimaListaLeads[idx], ...datosActualizados };
              if (typeof window.renderCostumerTable === 'function') {
                window.renderCostumerTable(window.ultimaListaLeads);
                updated = true;
              }
            }
          }
        } catch {}
        if (!updated) {
          if (window.CostumerPage && window.CostumerPage.loadCustomers) {
            await window.CostumerPage.loadCustomers();
          } else {
            window.location.reload();
          }
        }
      } else {
        let msg = 'Error desconocido';
        try {
          const raw = await response.text();
          try {
            const json = JSON.parse(raw);
            msg = json.message || raw;
          } catch {
            msg = raw;
          }
        } catch {}
        alert('Error al actualizar: ' + msg);
      }
    } catch (error) {
      console.error('[COSTUMER] Error guardando cambios:', error);
      alert('Error al guardar los cambios: ' + error.message);
    }
  };

  /**
   * Cargar notas/historial del cliente
   */
  async function cargarNotasCliente(clienteId) {
    console.log('[COSTUMER] Cargando notas del cliente:', clienteId);
    
    try {
      // Intentar cargar desde el servidor
      const response = await fetch(`/api/leads/${clienteId}/notas`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        // Intentar parsear como JSON
        try {
          const data = await response.json();
          const notas = data.notas || data.data || data.comentarios || [];
          
          console.log('[COSTUMER] ✓ Notas cargadas:', notas.length);
          renderNotasCliente(notas);
        } catch (parseError) {
          // Respuesta no es JSON válido
          console.log('[COSTUMER] Respuesta no es JSON, asumiendo sin notas');
          renderNotasCliente([]);
        }
      } else if (response.status === 404) {
        // Endpoint no existe aún - esto es normal hasta que se implemente
        renderNotasCliente([]);
      } else {
        // Otro error del servidor
        renderNotasCliente([]);
      }
    } catch (error) {
      // Error de red o CORS - también es normal si el endpoint no existe
      renderNotasCliente([]);
    }
  }

  /**
   * Renderizar notas del cliente en el modal
   */
  function renderNotasCliente(notas) {
    // Buscar el contenedor de notas
    const notasContainer = document.getElementById('edit-notas-container');
    if (!notasContainer) {
      console.warn('[COSTUMER] Contenedor de notas no encontrado');
      return;
    }
    
    // Limpiar contenido actual
    notasContainer.innerHTML = '';
    
    if (!notas || notas.length === 0) {
      // Mostrar mensaje de que no hay notas
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; text-align: center; color: #6b7280; font-size: 13px;';
      emptyMsg.innerHTML = '<i class="fas fa-sticky-note" style="font-size: 32px; margin-bottom: 10px; display: block; opacity: 0.3;"></i>No hay notas para este cliente';
      notasContainer.appendChild(emptyMsg);
      return;
    }
    
    // Renderizar cada nota con formato: Usuario DD/MM/YYYY HH:MM:SS
    notas.forEach((nota, index) => {
      const notaWrapper = document.createElement('div');
      notaWrapper.style.cssText = 'margin-bottom: 15px;';
      
      // Formatear fecha y hora completa
      let fechaHoraStr = '';
      const usuario = nota.usuario || nota.autor || 'Usuario';
      
      if (nota.fecha || nota.createdAt) {
        const fecha = new Date(nota.fecha || nota.createdAt);
        const dia = String(fecha.getDate()).padStart(2, '0');
        const mes = String(fecha.getMonth() + 1).padStart(2, '0');
        const anio = fecha.getFullYear();
        const horas = String(fecha.getHours()).padStart(2, '0');
        const minutos = String(fecha.getMinutes()).padStart(2, '0');
        const segundos = String(fecha.getSeconds()).padStart(2, '0');
        fechaHoraStr = `${dia}/${mes}/${anio} ${horas}:${minutos}:${segundos}`;
      }
      
      // Título de la nota con usuario y fecha/hora
      const titulo = document.createElement('h4');
      titulo.style.cssText = 'margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #111;';
      titulo.textContent = `${usuario} ${fechaHoraStr}`;
      
      // Contenido de la nota
      const contenido = document.createElement('div');
      contenido.style.cssText = 'background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; font-size: 12px; line-height: 1.6; color: #374151; white-space: pre-wrap;';
      const texto = nota.texto || nota.comentario || nota.contenido || '';
      contenido.textContent = texto;
      
      notaWrapper.appendChild(titulo);
      notaWrapper.appendChild(contenido);
      notasContainer.appendChild(notaWrapper);
    });
  }

  /**
   * Escapar HTML para prevenir XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Agregar nota al cliente
   */
  window.agregarNotaCliente = async function() {
    const textarea = document.getElementById('edit-nueva-nota');
    if (!textarea) return;

    const texto = textarea.value.trim();
    if (!texto) {
      alert('Por favor escribe una nota');
      return;
    }

    const clienteId = window.currentEditClienteId;
    if (!clienteId) {
      alert('No hay cliente seleccionado');
      return;
    }

    try {
      const user = window.getCurrentUser ? window.getCurrentUser() : { username: 'Usuario' };
      
      const response = await fetch(`/api/leads/${clienteId}/notas`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          texto: texto,
          usuario: user.username || user.name || 'Usuario',
          fecha: new Date().toISOString()
        })
      });

      if (response.ok) {
        // Limpiar textarea
        textarea.value = '';
        
        alert('Nota agregada correctamente');
        
        // Recargar notas dinámicamente
        await cargarNotasCliente(clienteId);
      } else if (response.status === 404) {
        alert('El endpoint de notas no está disponible en el servidor.\n\nPor favor, implementa el endpoint:\nPOST /api/leads/{id}/notas');
      } else {
        const errorMsg = await response.text().catch(() => 'Error desconocido');
        alert('Error al agregar nota: ' + errorMsg);
      }
    } catch (error) {
      console.error('[COSTUMER] Error agregando nota:', error);
      alert('No se pudo conectar con el servidor.\nVerifica que el backend esté funcionando.');
    }
  };

  // Cerrar modal al hacer clic fuera (agregar también para modal de edición)
  document.addEventListener('click', function(e) {
    const editModal = document.getElementById('editarModal');
    if (editModal && e.target === editModal) {
      window.cerrarModalEdicion();
    }
  });

  console.log('[COSTUMER ACTIONS] Acciones inicializadas correctamente');
})();
