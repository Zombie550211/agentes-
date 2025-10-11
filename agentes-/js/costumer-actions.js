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
    
    // Por ahora, mostrar información
    alert(`Editar Cliente\n\nID: ${clienteId}\nNombre: ${customer.nombre_cliente || 'N/A'}\n\nFuncionalidad de edición en desarrollo`);
    
    // TODO: Abrir modal de edición
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

  console.log('[COSTUMER ACTIONS] Acciones inicializadas correctamente');
})();
