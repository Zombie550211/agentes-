// Variable para almacenar el lead actual
let leadComentarioActual = null;

// Función para mostrar el panel de comentarios
window.mostrarComentariosCostumer = async function(leadId, event = null) {
    // Validar que se proporcione un ID de lead
    if (!leadId) {
        console.error('No se proporcionó un ID de lead');
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Error: No se pudo identificar el lead', 'error');
        }
        return;
    }
    
    console.log('Mostrando comentarios para el lead:', leadId);
    
    // Detener la propagación del evento para evitar cierres inesperados
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // Almacenar el ID del lead actual en la variable global
    leadComentarioActual = leadId;
    
    // Almacenar también en el dataset del modal para referencia
    const modal = document.getElementById('modal-comentarios');
    if (modal) {
        modal.dataset.leadId = leadId;
    }

    try {
        // Mostrar el modal de comentarios
        mostrarModalComentarios(leadId);
        
        // Cargar los comentarios existentes
        await cargarComentarios(leadId);
        
    } catch (error) {
        console.error('Error al cargar los comentarios:', error);
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Error al cargar los comentarios: ' + (error.message || 'Error desconocido'), 'error');
        }
    }
};

// Función para mostrar el modal de comentarios
function mostrarModalComentarios(leadId) {
    // Ocultar el encabezado de la tabla Costumer
    const thead = document.querySelector('.costumer-table thead');
    if (thead) {
        thead.style.opacity = '0';
        thead.style.height = '0';
        thead.style.overflow = 'hidden';
        thead.style.transition = 'all 0.3s ease';
        thead.style.position = 'absolute';
        thead.style.visibility = 'hidden';
    }
    // Crear el HTML del modal si no existe
    if (!document.getElementById('modal-comentarios')) {
        const modalHTML = `
        <style>
            .comentario-modal .modal-content {
                border: none;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
                overflow: hidden;
            }
            .comentario-modal .modal-header {
                background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%);
                color: white;
                border-bottom: none;
                padding: 1.2rem 1.5rem;
                position: relative;
            }
            .comentario-modal .modal-title {
                font-weight: 600;
                font-size: 1.3rem;
                display: flex;
                align-items: center;
                margin: 0;
            }
            .comentario-modal .modal-title i {
                margin-right: 10px;
                font-size: 1.5rem;
            }
            .comentario-modal .close {
                color: rgba(255, 255, 255, 0.8);
                text-shadow: none;
                opacity: 1;
                font-size: 1.5rem;
                transition: all 0.2s;
            }
            .comentario-modal .close:hover {
                color: white;
                transform: scale(1.1);
            }
            .comentario-modal .modal-body {
                padding: 1.5rem;
                background-color: #f8f9fc;
                max-height: 60vh;
                overflow-y: auto;
            }
            .comentario-modal .comentario-item {
                background: white;
                border-radius: 10px;
                padding: 15px;
                margin-bottom: 15px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
                border-left: 4px solid #4361ee;
                transition: all 0.2s;
            }
            .comentario-modal .comentario-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            }
            .comentario-modal .comentario-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid #eee;
            }
            .comentario-modal .comentario-usuario {
                font-weight: 600;
                color: #2c3e50;
                margin: 0;
                font-size: 0.95rem;
            }
            .comentario-modal .comentario-fecha {
                color: #7f8c8d;
                font-size: 0.8rem;
                margin: 0;
            }
            .comentario-modal .comentario-texto {
                color: #34495e;
                margin: 0;
                line-height: 1.5;
                font-size: 0.9rem;
            }
            .comentario-modal .comentario-vacio {
                text-align: center;
                color: #7f8c8d;
                padding: 30px 0;
            }
            .comentario-modal .comentario-vacio i {
                font-size: 2.5rem;
                margin-bottom: 15px;
                color: #bdc3c7;
                display: block;
            }
            .comentario-modal .comentario-form {
                margin-top: 20px;
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
            }
            .comentario-modal .form-group {
                margin-bottom: 15px;
            }
            .comentario-modal .form-control {
                border-radius: 8px;
                border: 1px solid #e0e0e0;
                padding: 12px 15px;
                font-size: 0.9rem;
                transition: all 0.3s;
                resize: none;
                height: 100px;
            }
            .comentario-modal .form-control:focus {
                border-color: #4361ee;
                box-shadow: 0 0 0 0.2rem rgba(67, 97, 238, 0.25);
            }
            #btn-guardar-comentario {
                border-radius: 8px;
                padding: 0.6rem 1.5rem;
                font-weight: 500;
                font-size: 0.9rem;
                background: linear-gradient(135deg, #4361ee 0%, #3a0ca3 100%);
                border: none;
                color: white;
                transition: all 0.3s;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            #btn-guardar-comentario:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(67, 97, 238, 0.3);
            }
            #btn-guardar-comentario:disabled {
                background: #95a5a6;
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }
            #btn-guardar-comentario i {
                margin-right: 8px;
            }
            .spinner-border {
                margin-right: 8px;
            }
            #lista-comentarios {
                margin-bottom: 20px;
            }
            .comentario-loading {
                text-align: center;
                padding: 20px;
                color: #7f8c8d;
            }
            .comentario-loading .spinner-border {
                width: 1.5rem;
                height: 1.5rem;
                border-width: 0.2em;
            }
        </style>
        <div class="modal fade comentario-modal" id="modal-comentarios" tabindex="-1" role="dialog" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-comments"></i> Comentarios</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Cerrar">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div id="lista-comentarios">
                            <div class="comentario-loading">
                                <div class="spinner-border text-primary" role="status">
                                    <span class="sr-only">Cargando...</span>
                                </div>
                                <p>Cargando comentarios...</p>
                            </div>
                        </div>
                        <div class="comentario-form">
                            <div class="form-group">
                                <label for="nuevo-comentario" class="form-label">Nuevo comentario</label>
                                <textarea class="form-control" id="nuevo-comentario" rows="3" 
                                          placeholder="Escribe tu comentario aquí..." required></textarea>
                            </div>
                            <button type="button" id="btn-guardar-comentario" class="btn btn-primary" 
                                    onclick="guardarComentario()">
                                <i class="fas fa-paper-plane mr-1"></i> Enviar
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Inicializar los eventos del modal después de crearlo
        setTimeout(() => {
            inicializarEventosModal();
        }, 100);
    }
    
    // Mostrar el modal
    $('#modal-comentarios').modal('show');
}

// Función para cargar los comentarios de un lead
async function cargarComentarios(leadId) {
    // Validar que se proporcione un ID de lead
    if (!leadId) {
        console.error('No se proporcionó un ID de lead para cargar comentarios');
        // Intentar obtener el ID del dataset del modal como respaldo
        const modal = document.getElementById('modal-comentarios');
        if (modal && modal.dataset.leadId) {
            leadId = modal.dataset.leadId;
            console.log('ID de lead obtenido del dataset del modal:', leadId);
        } else {
            console.error('No se pudo obtener el ID del lead para cargar comentarios');
            if (window.mostrarMensaje) {
                window.mostrarMensaje('Error: No se pudo cargar los comentarios (ID de lead no válido)', 'error');
            }
            return;
        }
    }
    
    console.log('Cargando comentarios para el lead:', leadId);
    
    try {
        // Mostrar indicador de carga
        const listaComentarios = document.getElementById('lista-comentarios');
        if (listaComentarios) {
            listaComentarios.innerHTML = `
                <div class="comentario-loading">
                    <div class="spinner-border text-primary" role="status">
                        <span class="sr-only">Cargando...</span>
                    </div>
                    <p>Cargando comentarios...</p>
                </div>`;
        }
        
        // Obtener el token de autenticación
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('No se encontró el token de autenticación');
        }
        
        // Construir la URL con el ID del lead codificado
        const url = `/api/costumers/${encodeURIComponent(leadId)}/comentarios`;
        console.log('URL de la API de comentarios:', url);
        
        // Realizar la petición a la API
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error en la respuesta de la API:', response.status, errorText);
            throw new Error(`Error al cargar los comentarios: ${response.status} ${response.statusText}`);
        }
        
        const comentarios = await response.json();
        console.log('Comentarios recibidos:', comentarios);
        
        // Mostrar los comentarios
        mostrarComentarios(comentarios);
        
    } catch (error) {
        console.error('Error al cargar los comentarios:', error);
        
        // Mostrar mensaje de error en la interfaz
        const listaComentarios = document.getElementById('lista-comentarios');
        if (listaComentarios) {
            listaComentarios.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle"></i> 
                    Error al cargar los comentarios: ${error.message || 'Error desconocido'}
                </div>`;
        }
        
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Error al cargar los comentarios: ' + (error.message || 'Error desconocido'), 'error');
        }
    }
}

// Función para mostrar los comentarios en la lista
function mostrarComentarios(comentarios) {
    const listaComentarios = document.getElementById('lista-comentarios');
    if (!listaComentarios) return;
    
    if (!comentarios || !Array.isArray(comentarios) || comentarios.length === 0) {
        listaComentarios.innerHTML = `
            <div class="comentario-vacio">
                <i class="far fa-comment-dots"></i>
                <p>No hay comentarios aún. ¡Sé el primero en comentar!</p>
            </div>`;
        return;
    }
    
    // Ordenar comentarios por fecha (más recientes primero)
    comentarios.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    // Generar el HTML de los comentarios
    const comentariosHTML = comentarios.map(comentario => `
        <div class="comentario-item">
            <div class="comentario-header">
                <p class="comentario-usuario">
                    <i class="fas fa-user-circle mr-2"></i>
                    ${comentario.usuario || 'Usuario desconocido'}
                </p>
                <p class="comentario-fecha">
                    <i class="far fa-clock mr-1"></i>
                    ${formatearFecha(comentario.fecha || new Date().toISOString())}
                </p>
            </div>
            <p class="comentario-texto">${comentario.texto || ''}</p>
        </div>
    `).join('');
    
    listaComentarios.innerHTML = comentariosHTML;
    
    // Hacer scroll al final de la lista de comentarios
    listaComentarios.scrollTop = listaComentarios.scrollHeight;
}

// Función para formatear la fecha
function formatearFecha(fechaISO) {
    if (!fechaISO) return '';
    
    const opciones = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    
    return new Date(fechaISO).toLocaleDateString('es-ES', opciones);
}

// Función para inicializar los eventos del modal
function inicializarEventosModal() {
    console.log('Inicializando eventos del modal de comentarios');
    
    // Evento para el botón de guardar comentario
    const btnGuardar = document.getElementById('btn-guardar-comentario');
    if (btnGuardar) {
        btnGuardar.addEventListener('click', guardarComentario);
    }
    
    // Evento para el textarea (permite enviar con Ctrl+Enter o Cmd+Enter)
    const textarea = document.getElementById('nuevo-comentario');
    if (textarea) {
        textarea.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                guardarComentario();
            }
        });
    }
    
    // Evento para limpiar el textarea cuando se cierra el modal
    const modal = document.getElementById('modal-comentarios');
    if (modal) {
        modal.addEventListener('hidden.bs.modal', function() {
            const textarea = document.getElementById('nuevo-comentario');
            if (textarea) {
                textarea.value = '';
            }
        });
    }
    
    console.log('Eventos del modal de comentarios inicializados');
}

// Función para guardar un nuevo comentario
async function guardarComentario() {
    // Obtener el ID del lead actual
    let leadId = leadComentarioActual;
    
    // Si no hay un ID de lead, intentar obtenerlo del dataset del modal
    if (!leadId) {
        const modal = document.getElementById('modal-comentarios');
        if (modal && modal.dataset.leadId) {
            leadId = modal.dataset.leadId;
            console.log('ID de lead obtenido del dataset del modal:', leadId);
        } else {
            console.error('No se pudo obtener el ID del lead para guardar el comentario');
            if (window.mostrarMensaje) {
                window.mostrarMensaje('Error: No se pudo identificar el lead para el comentario', 'error');
            }
            return;
        }
    }
    
    // Obtener el texto del comentario
    const textarea = document.getElementById('nuevo-comentario');
    const texto = textarea ? textarea.value.trim() : '';
    
    // Validar que haya texto
    if (!texto) {
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Por favor, escribe un comentario antes de enviar', 'warning');
        }
        textarea.focus();
        return;
    }
    
    try {
        // Mostrar indicador de carga
        const botonGuardar = document.getElementById('btn-guardar-comentario');
        if (botonGuardar) {
            botonGuardar.disabled = true;
            botonGuardar.innerHTML = `
                <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                Guardando...`;
        }
        
        // Obtener el token de autenticación
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('No se encontró el token de autenticación');
        }
        
        console.log('Enviando comentario para el lead:', leadId);
        
        // Realizar la petición a la API
        const response = await fetch(`/api/costumers/${encodeURIComponent(leadId)}/comentarios`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ texto })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error en la respuesta de la API:', response.status, errorText);
            throw new Error(`Error al guardar el comentario: ${response.status} ${response.statusText}`);
        }
        
        const comentarioGuardado = await response.json();
        console.log('Comentario guardado:', comentarioGuardado);
        
        // Limpiar el textarea
        if (textarea) {
            textarea.value = '';
        }
        
        // Mostrar mensaje de éxito
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Comentario guardado correctamente', 'success');
        }
        
        // Recargar los comentarios
        await cargarComentarios(leadId);
        
    } catch (error) {
        console.error('Error al guardar el comentario:', error);
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Error al guardar el comentario: ' + (error.message || 'Error desconocido'), 'error');
        }
    } finally {
        // Restaurar el botón
        const botonGuardar = document.getElementById('btn-guardar-comentario');
        if (botonGuardar) {
            botonGuardar.disabled = false;
            botonGuardar.innerHTML = '<i class="fas fa-paper-plane mr-1"></i> Enviar';
        }
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    console.log('Módulo de comentarios cargado');
    // Inicializar los eventos del modal si ya existe en el DOM
    if (document.getElementById('modal-comentarios')) {
        inicializarEventosModal();
    }
});
