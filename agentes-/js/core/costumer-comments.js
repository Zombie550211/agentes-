// Módulo de comentarios para la tabla Costumer
// Maneja: mostrar resumen, expandir panel, historial, añadir, guardar con usuario/fecha

// --- Lógica para editar y borrar comentarios en la tabla de clientes ---
window.iniciarEdicionComentario = function(idx, cidx) {
  document.getElementById('comentario-texto-' + idx + '-' + cidx).style.display = 'none';
  document.getElementById('comentario-edicion-' + idx + '-' + cidx).style.display = '';
};

window.cancelarEdicionComentario = function(idx, cidx) {
  document.getElementById('comentario-edicion-' + idx + '-' + cidx).style.display = 'none';
  document.getElementById('comentario-texto-' + idx + '-' + cidx).style.display = '';
};

window.guardarEdicionComentario = async function(idx, cidx) {
  try {
    const textarea = document.getElementById('editar-comentario-textarea-' + idx + '-' + cidx);
    const nuevoTexto = textarea.value.trim();
    if (!nuevoTexto) {
      alert('El comentario no puede estar vacío.');
      return;
    }
    // Obtener leadId y comentarioId
    const leadId = window.ultimaListaLeads[idx]._id;
    const comentario = window.ultimaListaLeads[idx].comentarios_venta[cidx];
    const comentarioId = comentario._id;
    const resp = await fetch(`/api/leads/${leadId}/comentarios/${comentarioId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ texto: nuevoTexto })
    });
    if (resp.ok) {
      window.cargarDatosDesdeServidor();
    } else {
      alert('No se pudo editar el comentario.');
    }
  } catch (e) {
    alert('Error al editar comentario.');
  }
};

window.confirmarBorrarComentario = async function(idx, cidx) {
  if (!confirm('¿Seguro que deseas borrar este comentario?')) return;
  try {
    const leadId = window.ultimaListaLeads[idx]._id;
    const comentario = window.ultimaListaLeads[idx].comentarios_venta[cidx];
    const comentarioId = comentario._id;
    const resp = await fetch(`/api/leads/${leadId}/comentarios/${comentarioId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    if (resp.ok) {
      window.cargarDatosDesdeServidor();
    } else {
      alert('No se pudo borrar el comentario.');
    }
  } catch (e) {
    alert('Error al borrar comentario.');
  }
};

window.toggleComentariosPanel = function(idx) {
  const panel = document.getElementById('comentarios-panel-' + idx);
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  }
};

window.enviarNuevoComentario = async function(idx, leadId) {
  const textarea = document.getElementById('nuevo-comentario-textarea-' + idx);
  const texto = textarea.value.trim();
  if (!texto) return;
  const usuario = window.usuario_actual ? window.usuario_actual.nombre : 'Desconocido';
  const fecha = new Date();
  const fechaStr = fecha.toLocaleDateString('es-MX') + ' ' + fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
  const comentarioObj = { autor: usuario, fecha: fechaStr, texto };
  // Guardar en backend
  await fetch(`/api/leads/${leadId}/comentarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify(comentarioObj)
  });
  textarea.value = '';
  window.cargarDatosDesdeServidor();
};

// Función para mostrar el modal de comentarios de un cliente
window.mostrarComentariosCostumer = async function(leadId, event) {
  // Prevenir el comportamiento por defecto del evento
  if (event) event.stopPropagation();
  
  try {
    // Obtener los datos del lead
    const response = await fetch(`/api/leads/${leadId}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Error al cargar los datos del cliente');
    }
    
    const lead = await response.json();
    const comentarios = lead.comentarios_venta || [];
    
    // Crear el contenido del modal
    let modalContent = `
      <div class="modal-header">
        <h5 class="modal-title">Comentarios - ${lead.nombre_cliente || 'Cliente'}</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
      </div>
      <div class="modal-body">
        <div class="comentarios-lista mb-3" style="max-height: 300px; overflow-y: auto;">
    `;
    
    if (comentarios.length === 0) {
      modalContent += `
        <div class="text-muted text-center py-3">
          No hay comentarios para este cliente.
        </div>
      `;
    } else {
      comentarios.forEach((comentario, index) => {
        const fecha = new Date(comentario.fecha).toLocaleString();
        modalContent += `
          <div class="card mb-2">
            <div class="card-body p-2">
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <strong>${comentario.autor || 'Sistema'}</strong>
                  <small class="text-muted ms-2">${fecha}</small>
                </div>
                <div>
                  <button class="btn btn-sm btn-outline-secondary" 
                          onclick="iniciarEdicionComentario('${leadId}', '${index}')">
                    <i class="fas fa-edit"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger ms-1" 
                          onclick="confirmarBorrarComentario('${leadId}', '${index}')">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
              </div>
              <p class="mb-0 mt-1">${comentario.texto}</p>
              <div id="comentario-edicion-${leadId}-${index}" style="display: none;" class="mt-2">
                <textarea id="editar-comentario-textarea-${leadId}-${index}" 
                          class="form-control mb-2" rows="2">${comentario.texto}</textarea>
                <div class="d-flex justify-content-end gap-2">
                  <button class="btn btn-sm btn-secondary" 
                          onclick="cancelarEdicionComentario('${leadId}', '${index}')">
                    Cancelar
                  </button>
                  <button class="btn btn-sm btn-primary" 
                          onclick="guardarEdicionComentario('${leadId}', '${index}')">
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }
    
    modalContent += `
        </div>
        <div class="nuevo-comentario mt-3">
          <textarea id="nuevo-comentario-textarea-${leadId}" class="form-control mb-2" 
                    placeholder="Escribe un nuevo comentario..." rows="3"></textarea>
          <div class="d-flex justify-content-end">
            <button class="btn btn-primary" 
                    onclick="enviarNuevoComentario('${leadId}', '${lead._id}')">
              <i class="fas fa-paper-plane me-1"></i> Enviar
            </button>
          </div>
        </div>
      </div>
    `;
    
    // Mostrar el modal
    let modalElement = document.getElementById('comentariosModal');
    if (!modalElement) {
      // Crear el modal si no existe
      modalElement = document.createElement('div');
      modalElement.id = 'comentariosModal';
      modalElement.className = 'modal fade';
      modalElement.tabIndex = '-1';
      modalElement.innerHTML = `
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            ${modalContent}
          </div>
        </div>
      `;
      document.body.appendChild(modalElement);
    } else {
      // Actualizar el contenido del modal existente
      const modalBody = modalElement.querySelector('.modal-content');
      if (modalBody) {
        modalBody.innerHTML = modalContent;
      }
    }
    
    // Inicializar el modal de Bootstrap
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
    
  } catch (error) {
    console.error('Error al cargar comentarios:', error);
    alert('Error al cargar los comentarios del cliente');
  }
};
