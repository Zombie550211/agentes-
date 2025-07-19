/**
 * Muestra un panel lateral para gestionar los comentarios de un cliente
 * @param {string} idCostumer - ID del cliente/lead
 * @param {Event} event - Evento de clic (opcional)
 */
window.mostrarComentariosCostumer = function(idCostumer, event = null) {
  // Prevenir comportamiento por defecto del evento si se proporciona
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  // Cerrar panel si ya está abierto para este cliente
  const existingPanel = document.getElementById('comentarios-panel');
  if (existingPanel && existingPanel.dataset.customerId === idCostumer) {
    existingPanel.remove();
    document.body.style.overflow = '';
    return;
  }
  
  // Cerrar cualquier otro panel abierto
  if (existingPanel) {
    existingPanel.remove();
  }

  // Buscar el cliente en la caché de leads
  let leads = [];
  try {
    leads = JSON.parse(localStorage.getItem('leads_cache') || '[]');
  } catch(e) {
    console.error('Error al cargar la caché de leads:', e);
  }
  
  const venta = leads.find(l => l._id === idCostumer || l.id === idCostumer);
  if (!venta) {
    mostrarMensaje('No se encontró la información del cliente', 'error');
    return;
  }
  
  // Inicializar comentarios si no existen
  if (!venta.comentarios_venta || !Array.isArray(venta.comentarios_venta)) {
    venta.comentarios_venta = [];
  }

  // Crear el panel de comentarios
  const panel = document.createElement('div');
  panel.id = 'comentarios-panel';
  panel.dataset.customerId = idCostumer;
  
  // Estilos del panel
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    height: 100vh;
    background: #fff;
    box-shadow: -2px 0 20px rgba(0,0,0,0.1);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.3s ease-in-out;
    overflow: hidden;
  `;
  
  // Crear el overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 999;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    pointer-events: none;
  `;
  
  // Mostrar overlay cuando el panel está visible
  setTimeout(() => {
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
  }, 10);
  
  // Cerrar al hacer clic fuera del panel
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      panel.style.transform = 'translateX(100%)';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      
      setTimeout(() => {
        panel.remove();
        overlay.remove();
        document.body.style.overflow = '';
      }, 300);
    }
  });
  
  // Cerrar con tecla ESC
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      panel.style.transform = 'translateX(100%)';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      
      setTimeout(() => {
        panel.remove();
        overlay.remove();
        document.body.style.overflow = '';
        document.removeEventListener('keydown', handleKeyDown);
      }, 300);
    }
  };
  
  document.addEventListener('keydown', handleKeyDown);
  
  // Agregar el overlay al body
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 18px 24px;
    background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    position: relative;
    z-index: 5;
  `;
  
  // Añadir efecto sutil al header
  header.innerHTML += `
    <div style="
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #4fc3f7 0%, #2979ff 50%, #651fff 100%);
    "></div>
  `;
  
  const title = document.createElement('h3');
  title.textContent = 'Gestión de Comentarios';
  title.style.margin = '0';
  title.style.fontSize = '1.25em';
  title.style.fontWeight = '500';
  title.style.letterSpacing = '0.3px';
  title.style.color = 'white';
  title.style.display = 'flex';
  title.style.alignItems = 'center';
  title.style.gap = '10px';
  title.innerHTML = `
    <i class="fas fa-comments" style="font-size: 1.1em; opacity: 0.9;"></i>
    <span>Gestión de Comentarios</span>
  `;
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.style.cssText = `
    background: rgba(255, 255, 255, 0.15);
    border: none;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: white;
    font-size: 1.1em;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    padding: 0;
    margin: 0;
    outline: none;
  `;
  
  // Efectos hover y focus
  closeBtn.onmouseover = () => {
    closeBtn.style.background = 'rgba(255, 255, 255, 0.25)';
    closeBtn.style.transform = 'rotate(90deg)';
  };
  closeBtn.onmouseout = () => {
    closeBtn.style.background = 'rgba(255, 255, 255, 0.15)';
    closeBtn.style.transform = 'rotate(0deg)';
  };
  
  // Efecto al hacer clic
  closeBtn.onmousedown = () => {
    closeBtn.style.transform = 'scale(0.9)';
  };
  closeBtn.onmouseup = () => {
    closeBtn.style.transform = 'scale(1)';
  };
  closeBtn.onclick = () => {
    panel.style.transform = 'translateX(100%)';
    setTimeout(() => panel.remove(), 300);
    document.body.style.overflow = '';
  };
  
  header.appendChild(title);
  header.appendChild(closeBtn);

  // Crear el contenedor de comentarios
  const comentariosContainer = document.createElement('div');
  comentariosContainer.id = 'comentarios-lista';
  comentariosContainer.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    background: #fff;
  `;
  
  // Crear el formulario para nuevos comentarios
  const contenedorFormulario = document.createElement('div');
  contenedorFormulario.style.cssText = `
    padding: 16px 20px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  `;
  
  const formularioComentario = document.createElement('form');
  formularioComentario.id = 'nuevo-comentario-form';
  formularioComentario.style.display = 'flex';
  formularioComentario.style.gap = '10px';
  
  const campoTexto = document.createElement('input');
  campoTexto.type = 'text';
  campoTexto.placeholder = 'Escribe un comentario...';
  campoTexto.required = true;
  campoTexto.style.cssText = `
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 0.95em;
    transition: all 0.2s ease;
  `;
  campoTexto.addEventListener('focus', () => {
    campoTexto.style.borderColor = '#93c5fd';
    campoTexto.style.boxShadow = '0 0 0 2px rgba(147, 197, 253, 0.5)';
  });
  campoTexto.addEventListener('blur', () => {
    campoTexto.style.borderColor = '#e2e8f0';
    campoTexto.style.boxShadow = 'none';
  });
  
  // Crear botón de envío mejorado
  const botonEnviar = document.createElement('button');
  botonEnviar.type = 'submit';
  botonEnviar.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
  botonEnviar.style.cssText = `
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0 20px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.95em;
    letter-spacing: 0.3px;
    gap: 8px;
    box-shadow: 0 2px 5px rgba(37, 99, 235, 0.3);
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  `;
  
  // Efecto hover
  botonEnviar.onmouseover = () => {
    botonEnviar.style.background = 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)';
    botonEnviar.style.boxShadow = '0 4px 8px rgba(37, 99, 235, 0.4)';
    botonEnviar.style.transform = 'translateY(-1px)';
  };
  
  // Efecto al soltar
  botonEnviar.onmouseout = () => {
    botonEnviar.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
    botonEnviar.style.boxShadow = '0 2px 5px rgba(37, 99, 235, 0.3)';
    botonEnviar.style.transform = 'translateY(0)';
  };
  
  // Efecto al hacer clic
  botonEnviar.onmousedown = () => {
    botonEnviar.style.transform = 'translateY(1px)';
    botonEnviar.style.boxShadow = '0 1px 2px rgba(37, 99, 235, 0.3)';
  };
  
  // Efecto ripple
  botonEnviar.addEventListener('click', function(e) {
    const rect = this.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const ripple = document.createElement('span');
    ripple.style.cssText = `
      position: absolute;
      width: 100px;
      height: 100px;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 50%;
      transform: scale(0);
      animation: ripple 0.6s linear;
      top: ${y - 50}px;
      left: ${x - 50}px;
      pointer-events: none;
    `;
    
    this.appendChild(ripple);
    
    // Eliminar el elemento después de la animación
    setTimeout(() => {
      ripple.remove();
    }, 600);
  });
  
  // Animación ripple
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ripple {
      to {
        transform: scale(4);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
  
  form.appendChild(input);
  form.appendChild(submitBtn);
  formContainer.appendChild(form);

  // Agregar elementos al panel
  panel.appendChild(header);
  panel.appendChild(commentsContainer);
  panel.appendChild(formContainer);

  // Agregar el panel al body
  document.body.appendChild(panel);
  document.body.style.overflow = 'hidden';

  // Mostrar con animación
  setTimeout(() => panel.style.transform = 'translateX(0)', 10);

  // Agregar estilos al panel si es nuevo
  if (!document.getElementById('comentarios-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'comentarios-panel-styles';
    style.textContent = `
      /* Estilos del panel de comentarios */
      #comentarios-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 400px;
        height: 100vh;
        background: #fff;
        box-shadow: -2px 0 20px rgba(0,0,0,0.1);
        z-index: 1000;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.3s ease-in-out;
      }
      
      /* Estilos para el encabezado */
      #comentarios-panel .panel-header {
        padding: 16px 20px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      #comentarios-panel .panel-title {
        margin: 0;
        font-size: 1.1em;
        color: #1e293b;
        font-weight: 600;
      }
      
      #comentarios-panel .close-btn {
        background: none;
        border: none;
        font-size: 1.2em;
        cursor: pointer;
        color: #64748b;
        padding: 5px 10px;
        border-radius: 4px;
        transition: all 0.15s ease;
      }
      
      #comentarios-panel .close-btn:hover {
        color: #dc2626;
        background: #fee2e2;
      }
      
      /* Estilos para la lista de comentarios */
      #comentarios-lista {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        background: #fff;
      }
      
      .comentario-item {
        padding: 16px;
        margin-bottom: 12px;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
      }
      
      .comentario-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 0.9em;
        color: #64748b;
      }
      
      .comentario-usuario {
        font-weight: 600;
        color: #1e40af;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .comentario-usuario i {
        color: #3b82f6;
      }
      
      .comentario-fecha {
        font-size: 0.85em;
        color: #94a3b8;
      }
      
      .comentario-texto {
        color: #1e293b;
        line-height: 1.5;
        margin-bottom: 8px;
        white-space: pre-line;
      }
      
      .comentario-acciones {
        display: flex;
        gap: 12px;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px dashed #e2e8f0;
      }
      
      .comentario-acciones {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px dashed #e2e8f0;
      }
      
      .comentario-acciones button {
        background: none;
        border: 1px solid transparent;
        font-size: 0.8em;
        font-weight: 500;
        cursor: pointer;
        padding: 6px 12px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        letter-spacing: 0.3px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      
      .comentario-acciones .editar { 
        color: #2563eb;
        background-color: #ffffff;
        border-color: #dbeafe;
      }
      
      .comentario-acciones .editar i { 
        color: #3b82f6;
        font-size: 0.9em;
      }
      
      .comentario-acciones .editar:hover { 
        background: #eff6ff;
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1);
      }
      
      .comentario-acciones .editar:active { 
        transform: translateY(0);
        box-shadow: none;
      }
      
      .comentario-acciones .eliminar { 
        color: #dc2626;
        background-color: #ffffff;
        border-color: #fee2e2;
      }
      
      .comentario-acciones .eliminar i { 
        color: #ef4444;
        font-size: 0.9em;
      }
      
      .comentario-acciones .eliminar:hover { 
        background: #fef2f2;
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(239, 68, 68, 0.1);
      }
      
      .comentario-acciones .eliminar:active { 
        transform: translateY(0);
        box-shadow: none;
      }
      
      .sin-comentarios {
        color: #94a3b8;
        text-align: center;
        padding: 40px 0;
        font-style: italic;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      
      .sin-comentarios i {
        font-size: 2em;
        color: #cbd5e1;
      }
      
      /* Estilos para el formulario */
      #nuevo-comentario-form {
        display: flex;
        gap: 10px;
        padding: 16px 20px;
        background: #fff;
        border-top: 1px solid #e2e8f0;
      }
      
      #nuevo-comentario-form input {
        flex: 1;
        padding: 10px 14px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        font-size: 0.95em;
        transition: all 0.2s ease;
      }
      
      #nuevo-comentario-form input:focus {
        outline: none;
        border-color: #93c5fd;
        box-shadow: 0 0 0 2px rgba(147, 197, 253, 0.5);
      }
      
      #nuevo-comentario-form button[type="submit"] {
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 8px;
        width: 42px;
        height: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      #nuevo-comentario-form button[type="submit"]:hover {
        background: #2563eb;
      }
      
      /* Animaciones */
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .comentario-item {
        animation: fadeIn 0.3s ease-out;
      }
      
      /* Scrollbar personalizada */
      #comentarios-lista::-webkit-scrollbar {
        width: 6px;
      }
      
      #comentarios-lista::-webkit-scrollbar-track {
        background: #f1f5f9;
      }
      
      #comentarios-lista::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 3px;
      }
      
      #comentarios-lista::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }
    `;
    document.head.appendChild(style);
  }

  // Lista de comentarios
  const comentarios = Array.isArray(venta.comentarios_venta) ? [...venta.comentarios_venta] : [];
  
  // Función para renderizar la lista de comentarios
  function renderComentarios() {
    const listaComentarios = document.getElementById('comentarios-lista');
    if (!listaComentarios) return;
    
    listaComentarios.innerHTML = '';
    
    if (comentarios.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'sin-comentarios';
      emptyState.innerHTML = `
        <i class="fas fa-comment-slash" style="font-size: 2.5em; margin-bottom: 10px; opacity: 0.5; display: block;"></i>
        <p>No hay comentarios aún</p>
        <p style="font-size: 0.9em; margin-top: 8px;">Sé el primero en comentar</p>
      `;
      listaComentarios.appendChild(emptyState);
      return;
    }
    
    // Ordenar comentarios por fecha (más recientes primero)
    comentarios.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    
    comentarios.forEach((comentario, idx) => {
      const comentarioEl = document.createElement('div');
      comentarioEl.className = 'comentario-item';
      comentarioEl.style.cssText = `
        margin-bottom: 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid #f0f4f8;
        position: relative;
      `;
      
      // Si es el último comentario, quitar el borde inferior
      if (idx === comentarios.length - 1) {
        comentarioEl.style.borderBottom = 'none';
      }
      
      // Cabecera del comentario (usuario y fecha)
      const header = document.createElement('div');
      header.className = 'comentario-header';
      header.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 8px;';
      
      const userInfo = document.createElement('div');
      userInfo.className = 'comentario-usuario';
      userInfo.style.cssText = 'display: flex; align-items: center;';
      
      // Avatar del usuario (iniciales o ícono)
      const avatar = document.createElement('div');
      avatar.style.cssText = `
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #4299e1;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 14px;
        margin-right: 10px;
        flex-shrink: 0;
      `;
      
      // Obtener iniciales del nombre de usuario o usar un ícono por defecto
      const userName = comentario.usuario || 'Anónimo';
      const userInitials = userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      
      if (userInitials) {
        avatar.textContent = userInitials;
      } else {
        avatar.innerHTML = '<i class="fas fa-user"></i>';
      }
      
      // Información del usuario y fecha
      const userDetails = document.createElement('div');
      userDetails.innerHTML = `
        <div style="font-weight: 600; color: #2d3748;">${userName}</div>
        <div style="font-size: 0.8em; color: #a0aec0;">
          ${formatearFecha(comentario.fecha || new Date().toISOString())}
        </div>
      `;
      
      userInfo.appendChild(avatar);
      userInfo.appendChild(userDetails);
      
      // Acciones del comentario (editar, eliminar)
      const actions = document.createElement('div');
      actions.className = 'comentario-acciones';
      actions.style.cssText = 'display: flex; gap: 8px;';
      
      // Botón de editar
      const editBtn = document.createElement('button');
      editBtn.className = 'editar';
      editBtn.innerHTML = '<i class="fas fa-edit"></i>';
      editBtn.title = 'Editar comentario';
      editBtn.style.cssText = `
        background: none;
        border: none;
        color: #718096;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
      `;
      editBtn.onmouseover = () => {
        editBtn.style.background = '#edf2f7';
        editBtn.style.color = '#4299e1';
      };
      editBtn.onmouseout = () => {
        editBtn.style.background = 'none';
        editBtn.style.color = '#718096';
      };
      editBtn.onclick = () => editarComentario(idx);
      
      // Botón de eliminar
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'eliminar';
      deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
      deleteBtn.title = 'Eliminar comentario';
      deleteBtn.style.cssText = `
        background: none;
        border: none;
        color: #e53e3e;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
      `;
      deleteBtn.onmouseover = () => {
        deleteBtn.style.background = '#fff5f5';
      };
      deleteBtn.onmouseout = () => {
        deleteBtn.style.background = 'none';
      };
      deleteBtn.onclick = () => eliminarComentario(idx);
      
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      
      header.appendChild(userInfo);
      header.appendChild(actions);
      
      // Contenido del comentario
      const contenido = document.createElement('div');
      contenido.style.cssText = 'color: #4a5568; line-height: 1.5; padding-left: 42px;';
      contenido.textContent = comentario.texto || comentario;
      
      comentarioEl.appendChild(header);
      comentarioEl.appendChild(contenido);
      
      listaComentarios.appendChild(comentarioEl);
    });
    
    // Desplazarse al final de la lista
    listaComentarios.scrollTop = listaComentarios.scrollHeight;
  }
  
  // Función para formatear fechas
  function formatearFecha(fechaISO) {
    try {
      const opciones = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      };
      return new Date(fechaISO).toLocaleDateString('es-ES', opciones);
    } catch (e) {
      return fechaISO || 'Fecha desconocida';
    }
  }
  
  // Inicializar la lista de comentarios
  renderComentarios();
  
  // Formulario para agregar/editar comentarios
  const formContainer = document.createElement('div');
  formContainer.style.cssText = 'padding: 16px 24px; border-top: 1px solid #eee;';
  
  const form = document.createElement('form');
  form.id = 'form-comentario';
  form.style.cssText = 'display: flex; gap: 10px;';
  
  const textarea = document.createElement('textarea');
  textarea.id = 'comentario-texto';
  textarea.placeholder = 'Escribe un comentario...';
  textarea.required = true;
  textarea.style.cssText = `
    flex: 1;
    min-height: 44px;
    max-height: 150px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 14px;
    font-family: inherit;
    font-size: 14px;
    resize: none;
    transition: all 0.2s;
    outline: none;
  `;
  
  textarea.addEventListener('focus', () => {
    textarea.style.borderColor = '#4299e1';
    textarea.style.boxShadow = '0 0 0 3px rgba(66, 153, 225, 0.2)';
  });
  
  textarea.addEventListener('blur', () => {
    textarea.style.borderColor = '#e2e8f0';
    textarea.style.boxShadow = 'none';
  });
  
  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.id = 'btn-enviar-comentario';
  submitBtn.style.cssText = `
    background: #4299e1;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0 20px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s;
    white-space: nowrap;
  `;
  
  // Estado del formulario (nuevo o edición)
  let editandoIndice = null;
  
  function actualizarBotonEnviar() {
    if (editandoIndice !== null) {
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Guardar';
      submitBtn.title = 'Guardar cambios';
    } else {
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar';
      submitBtn.title = 'Enviar comentario';
    }
  }
  
  actualizarBotonEnviar();
  
  // Función para editar un comentario
  function editarComentario(indice) {
    if (indice < 0 || indice >= comentarios.length) return;
    
    const comentario = comentarios[indice];
    textarea.value = comentario.texto || comentario;
    editandoIndice = indice;
    actualizarBotonEnviar();
    textarea.focus();
    
    // Desplazarse al formulario
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  // Función para eliminar un comentario
  function eliminarComentario(indice) {
    if (indice < 0 || indice >= comentarios.length) return;
    
    if (confirm('¿Estás seguro de que deseas eliminar este comentario? Esta acción no se puede deshacer.')) {
      // Eliminar el comentario del array
      comentarios.splice(indice, 1);
      
      // Si estábamos editando el comentario eliminado, cancelar la edición
      if (editandoIndice === indice) {
        editandoIndice = null;
        textarea.value = '';
        actualizarBotonEnviar();
      } else if (editandoIndice > indice) {
        // Ajustar el índice de edición si es necesario
        editandoIndice--;
      }
      
      // Guardar cambios (aquí deberías implementar la lógica para guardar en el servidor)
      guardarComentarios();
      
      // Volver a renderizar la lista
      renderComentarios();
      
      mostrarMensaje('Comentario eliminado correctamente', 'success');
    }
  }
  
  // Función para guardar los comentarios (debes implementar la lógica de guardado real)
  function guardarComentarios() {
    // Actualizar los comentarios en el objeto venta
    venta.comentarios_venta = comentarios;
    
    // Aquí deberías implementar la lógica para guardar en el servidor
    // Por ejemplo:
    // return fetch(`/api/leads/${venta._id}/comentarios`, {
    //   method: 'PUT',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': 'Bearer ' + (localStorage.getItem('token') || '')
    //   },
    //   body: JSON.stringify({ comentarios_venta: comentarios })
    // });
    
    // Por ahora, solo actualizamos la caché local
    const leadsCache = JSON.parse(localStorage.getItem('leads_cache') || '[]');
    const leadIndex = leadsCache.findIndex(l => l._id === venta._id || l.id === venta.id);
    
    if (leadIndex !== -1) {
      leadsCache[leadIndex].comentarios_venta = comentarios;
      localStorage.setItem('leads_cache', JSON.stringify(leadsCache));
    }
    
    // También actualizamos la interfaz si es necesario
    actualizarContadorComentarios(venta._id, comentarios.length);
    
    return Promise.resolve();
  }
  
  // Función para actualizar el contador de comentarios en la interfaz
  function actualizarContadorComentarios(leadId, cantidad) {
    const botonComentarios = document.querySelector(`button[onclick*="${leadId}"]`);
    if (botonComentarios) {
      const contador = botonComentarios.querySelector('span');
      if (contador) {
        contador.textContent = cantidad || '0';
      }
      
      // Actualizar estilos según si hay comentarios o no
      if (cantidad > 0) {
        botonComentarios.style.background = '#e3f2fd';
        botonComentarios.style.borderColor = '#1976d2';
        botonComentarios.style.color = '#1976d2';
      } else {
        botonComentarios.style.background = '#f5f5f5';
        botonComentarios.style.borderColor = '#ddd';
        botonComentarios.style.color = '#666';
      }
    }
  }
  
  // Manejar el envío del formulario
  form.onsubmit = async function(e) {
    e.preventDefault();
    
    const texto = textarea.value.trim();
    if (!texto) return;
    
    try {
      // Mostrar estado de carga
      const btnText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
      
      if (editandoIndice !== null) {
        // Editar comentario existente
        comentarios[editandoIndice] = {
          ...comentarios[editandoIndice],
          texto: texto,
          fecha: new Date().toISOString(),
          editado: true
        };
      } else {
        // Agregar nuevo comentario
        const nuevoComentario = {
          id: Date.now().toString(),
          texto: texto,
          usuario: 'Usuario Actual', // Aquí deberías obtener el usuario autenticado
          fecha: new Date().toISOString(),
          editado: false
        };
        
        comentarios.unshift(nuevoComentario);
      }
      
      // Guardar los cambios
      await guardarComentarios();
      
      // Limpiar el formulario
      textarea.value = '';
      editandoIndice = null;
      actualizarBotonEnviar();
      
      // Actualizar la lista de comentarios
      renderComentarios();
      
      // Mostrar mensaje de éxito
      mostrarMensaje(
        editandoIndice !== null ? 'Comentario actualizado' : 'Comentario agregado',
        'success'
      );
      
    } catch (error) {
      console.error('Error al guardar el comentario:', error);
      mostrarMensaje('Error al guardar el comentario', 'error');
    } finally {
      // Restaurar el botón
      submitBtn.disabled = false;
      actualizarBotonEnviar();
    }
  };
  
  // Agregar elementos al formulario
  formularioComentario.appendChild(campoTexto);
  formularioComentario.appendChild(botonEnviar);
  contenedorFormulario.appendChild(formularioComentario);
  
  // Agregar todo al modal
  body.appendChild(listaComentarios);
  
  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(formContainer);
  
  // Agregar el modal al overlay
  overlay.appendChild(modal);
  
  // Forzar el repintado para la animación
  setTimeout(() => {
    modal.style.opacity = '1';
    modal.style.transform = 'translateY(0)';
  }, 10);
  
  // Enfocar el área de texto al abrir el modal
  textarea.focus();
  
  // Función para mostrar mensajes de retroalimentación
  function mostrarMensaje(mensaje, tipo = 'info') {
    // Eliminar mensajes anteriores
    const mensajesAnteriores = document.querySelectorAll('.mensaje-flotante');
    mensajesAnteriores.forEach(el => el.remove());
    
    const colores = {
      success: '#48bb78',
      error: '#f56565',
      info: '#4299e1',
      warning: '#ed8936'
    };
    
    const mensajeEl = document.createElement('div');
    mensajeEl.className = 'mensaje-flotante';
    mensajeEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: ${colores[tipo] || colores.info};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10001;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55);
    `;
    
    mensajeEl.innerHTML = `
      <i class="fas ${tipo === 'success' ? 'fa-check-circle' : tipo === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
      <span>${mensaje}</span>
    `;
    
    document.body.appendChild(mensajeEl);
    
    // Forzar repintado para la animación
    setTimeout(() => {
      mensajeEl.style.opacity = '1';
      mensajeEl.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    // Ocultar después de 3 segundos
    setTimeout(() => {
      mensajeEl.style.opacity = '0';
      mensajeEl.style.transform = 'translateX(-50%) translateY(-20px)';
      
      // Eliminar después de la animación
      setTimeout(() => {
        if (mensajeEl.parentNode) {
          mensajeEl.parentNode.removeChild(mensajeEl);
        }
      }, 300);
    }, 3000);
  }
  
  // Retornar el modal para referencia externa si es necesario
  return {
    modal: overlay,
    cerrar: cerrarModal,
    actualizarComentarios: renderComentarios
  };
};

// Al cargar leads, cachearlos para acceso rápido a comentarios
(function(){
  const orig = window.fetchAndRenderLeads;
  window.fetchAndRenderLeads = async function() {
    await orig.apply(this, arguments);
    // Obtener leads de la tabla y guardar en cache
    try {
      const tbody = document.getElementById('costumer-tbody');
      if (!tbody) return;
      
      const leads = [];
      tbody.querySelectorAll('tr').forEach(tr => {
        const celdas = tr.querySelectorAll('td');
        if (celdas.length < 20) return;
        
        // Obtener el ID del data-id si existe
        const rowId = tr.getAttribute('data-id') || 
                     (celdas[0].innerText + celdas[1].innerText + celdas[2].innerText);
        
        leads.push({
          _id: rowId,
          nombre_cliente: celdas[0].innerText,
          telefono_principal: celdas[1].innerText,
          telefono_alterno: celdas[2].innerText,
          // Agregar más campos según sea necesario
        });
      });
      
      localStorage.setItem('leads_cache', JSON.stringify(leads));
    } catch(e) {
      console.error('Error al cachear leads:', e);
    }
  };
})();
