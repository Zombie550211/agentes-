// Variable para almacenar el lead actual
let leadComentarioActual = null;

// Función para mostrar el panel de comentarios
window.mostrarComentariosCostumer = async function(leadId, event = null) {
    console.log('Mostrando comentarios para el lead:', leadId);
    
    // Detener la propagación del evento para evitar cierres inesperados
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // Almacenar el ID del lead actual
    leadComentarioActual = leadId;

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
            }
            .comentario-modal .modal-footer {
                border-top: 1px solid #e9ecef;
                padding: 1rem 1.5rem;
                background-color: #fff;
            }
            #lista-comentarios {
                max-height: 400px;
                overflow-y: auto;
                padding-right: 8px;
                scrollbar-width: thin;
                scrollbar-color: #c1c1c1 #f1f1f1;
            }
            #lista-comentarios::-webkit-scrollbar {
                width: 6px;
            }
            #lista-comentarios::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 10px;
            }
            #lista-comentarios::-webkit-scrollbar-thumb {
                background: #c1c1c1;
                border-radius: 10px;
            }
            #lista-comentarios::-webkit-scrollbar-thumb:hover {
                background: #a8a8a8;
            }
            .comentario-item {
                background: white;
                border: 1px solid #e9ecef;
                border-radius: 10px;
                padding: 1rem;
                margin-bottom: 1rem;
                transition: all 0.3s ease;
                box-shadow: 0 2px 5px rgba(0,0,0,0.03);
            }
            .comentario-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.05);
            }
            .comentario-item strong {
                color: #3a0ca3;
                font-weight: 600;
            }
            .comentario-item small {
                color: #6c757d;
                font-size: 0.8rem;
            }
            .comentario-item p {
                margin: 0.5rem 0 0;
                color: #495057;
                line-height: 1.5;
            }
            .comentario-nuevo {
                background: #ffffff;
                padding: 1.5rem;
                border-radius: 12px;
                border: 1px solid #eef2f7;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
                margin-top: 1.5rem;
            }
            .comentario-nuevo .form-group {
                margin-bottom: 0;
            }
            #nuevo-comentario {
                border-radius: 10px;
                border: 1px solid #e0e6ed;
                resize: none;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                padding: 14px 16px;
                font-size: 0.95rem;
                line-height: 1.5;
                color: #2d3748;
                background-color: #f9fafc;
                width: 100%;
                min-height: 100px;
                box-sizing: border-box;
                font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            }
            #nuevo-comentario:focus {
                border-color: #4f46e5;
                box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
                outline: none;
                background-color: #ffffff;
            }
            #nuevo-comentario::placeholder {
                color: #a0aec0;
                opacity: 1;
            }
            .comentario-nuevo-footer {
                display: flex;
                justify-content: flex-end;
                margin-top: 1rem;
                gap: 0.75rem;
            }
            #btn-guardar-comentario {
                border-radius: 8px;
                padding: 0.6rem 1.5rem;
                font-weight: 500;
                font-size: 0.9rem;
                background: #4f46e5;
                color: white;
                border: none;
                transition: all 0.2s ease;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 1px 2px 0 rgba(16, 24, 40, 0.05);
            }
            #btn-guardar-comentario:hover {
                background: #4338ca;
                transform: translateY(-1px);
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            }
            #btn-guardar-comentario:active {
                transform: translateY(0);
                box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            }
            #btn-guardar-comentario:focus {
                outline: none;
                box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.3);
            }
            #btn-guardar-comentario .btn-icon {
                margin-right: 8px;
                font-size: 0.9em;
            }
            .empty-state {
                background: #f8f9fc;
                border: 2px dashed #dee2e6;
                border-radius: 10px;
                padding: 2rem 1rem;
                text-align: center;
                color: #6c757d;
            }
            .empty-state i {
                font-size: 2.5rem;
                color: #adb5bd;
                margin-bottom: 1rem;
                display: block;
            }
            @media (max-width: 768px) {
                .comentario-modal .modal-dialog {
                    margin: 0.5rem;
                }
                .comentario-modal .modal-content {
                    border-radius: 12px 12px 0 0;
                }
                .comentario-modal .modal-body {
                    padding: 1rem;
                }
            }
        </style>
        <div class="modal fade comentario-modal" id="modal-comentarios" tabindex="-1" role="dialog" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"><i class="fas fa-comments"></i> Comentarios sobre la venta</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Cerrar">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body p-0">
                        <div class="comentarios-container">
                            <div id="lista-comentarios" class="px-4 py-3">
                                <div class="empty-state">
                                    <i class="far fa-comment-dots"></i>
                                    <h5>No hay comentarios aún</h5>
                                    <p class="mb-0">Sé el primero en comentar sobre esta venta</p>
                                </div>
                            </div>
                            <div class="comentario-nuevo">
                                <div class="form-group">
                                    <textarea id="nuevo-comentario" class="form-control" rows="4" 
                                              placeholder="Escribe un comentario detallado sobre la venta..."></textarea>
                                </div>
                                <div class="comentario-nuevo-footer">
                                    <small class="text-muted mr-auto" style="font-size: 0.8rem; color: #718096 !important;">
                                        <i class="fas fa-keyboard"></i> Presiona <kbd>Enter</kbd> para enviar
                                    </small>
                                    <button id="btn-guardar-comentario" class="btn-primary">
                                        <i class="fas fa-paper-plane btn-icon"></i> Enviar comentario
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="border-top: 1px solid #edf2f7; padding: 1rem 1.5rem;">
                        <button type="button" class="btn btn-outline-secondary" data-dismiss="modal" 
                                style="border-color: #e2e8f0; color: #4a5568; padding: 0.5rem 1.25rem; border-radius: 8px; font-weight: 500; transition: all 0.2s ease;">
                            <i class="fas fa-times mr-2"></i> Cerrar
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    
        // Agregar el modal al final del body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Inicializar eventos del modal
        inicializarEventosModal();
        
        // Configurar evento para cuando se cierre el modal
        $('#modal-comentarios').on('hidden.bs.modal', function() {
            // Mostrar nuevamente el encabezado de la tabla
            const thead = document.querySelector('#costumerTable thead');
            if (thead) {
                thead.style.display = '';
            }
        });
    }
    
    // Mostrar el modal
    $('#modal-comentarios').modal('show');
}

// Función para cargar los comentarios de un lead
async function cargarComentarios(leadId) {
    try {
        // Mostrar indicador de carga
        const listaComentarios = document.getElementById('lista-comentarios');
        listaComentarios.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status">
                    <span class="sr-only">Cargando...</span>
                </div>
                <p class="mt-3 text-muted">Cargando comentarios...</p>
            </div>`;
        
        // Aquí iría la llamada a la API para obtener los comentarios
        // Por ahora simulamos una respuesta después de 500ms
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Simulamos datos de comentarios (en producción, esto vendría de la API)
        const comentarios = [
            {
                id: 1,
                texto: 'El cliente mostró interés en el paquete premium.',
                fecha: '2023-11-15T14:30:00Z',
                usuario: 'Agente 1'
            },
            {
                id: 2,
                texto: 'Se programó visita para el próximo lunes a las 10:00 AM.',
                fecha: '2023-11-16T09:15:00Z',
                usuario: 'Agente 2'
            }
        ];
        
        // Mostrar los comentarios
        mostrarComentarios(comentarios);
        
    } catch (error) {
        console.error('Error al cargar comentarios:', error);
        throw error;
    }
}

// Función para mostrar los comentarios en la lista
function mostrarComentarios(comentarios) {
    const listaComentarios = document.getElementById('lista-comentarios');
    
    if (!comentarios || comentarios.length === 0) {
        listaComentarios.innerHTML = `
            <div class="empty-state">
                <i class="far fa-comment-dots"></i>
                <h5>No hay comentarios aún</h5>
                <p class="mb-0">Sé el primero en comentar sobre esta venta</p>
            </div>`;
        return;
    }
    
    // Ordenar comentarios por fecha (más recientes primero)
    comentarios.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    
    // Generar HTML de los comentarios
    const comentariosHTML = comentarios.map(comentario => `
        <div class="comentario-item">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center">
                    <div class="user-avatar bg-primary text-white rounded-circle d-flex align-items-center justify-content-center" 
                         style="width: 36px; height: 36px; margin-right: 10px; font-size: 0.9rem; font-weight: 600;">
                        ${(comentario.usuario || 'US').substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <strong>${comentario.usuario || 'Usuario'}</strong>
                        <small class="d-block text-muted">${formatearFecha(comentario.fecha)}</small>
                    </div>
                </div>
                <i class="fas fa-ellipsis-v text-muted" style="cursor: pointer; opacity: 0.7;"></i>
            </div>
            <p class="mb-0">${comentario.texto}</p>
        </div>
    `).join('');
    
    listaComentarios.innerHTML = comentariosHTML;
    
    // Hacer scroll al final de la lista de comentarios
    listaComentarios.scrollTop = listaComentarios.scrollHeight;
}

// Función para formatear la fecha
function formatearFecha(fechaISO) {
    const opciones = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
    };
    return new Date(fechaISO).toLocaleString('es-ES', opciones);
}

// Función para inicializar los eventos del modal
function inicializarEventosModal() {
    // Evento para el botón de guardar comentario
    document.getElementById('btn-guardar-comentario').addEventListener('click', guardarComentario);
    
    // Evento para la tecla Enter en el textarea
    document.getElementById('nuevo-comentario').addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            guardarComentario();
        }
    });
    
    // Evento cuando se cierra el modal
    $('#modal-comentarios').on('hidden.bs.modal', function() {
        // Limpiar el textarea
        document.getElementById('nuevo-comentario').value = '';
        
        // Mostrar nuevamente el encabezado de la tabla Costumer
        const thead = document.querySelector('.costumer-table thead');
        if (thead) {
            thead.style.opacity = '1';
            thead.style.height = '';
            thead.style.overflow = '';
            thead.style.position = '';
            thead.style.visibility = '';
        }
    });
}

// Función para guardar un nuevo comentario
async function guardarComentario() {
    const textarea = document.getElementById('nuevo-comentario');
    const texto = textarea.value.trim();
    
    if (!texto) {
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Por favor escribe un comentario', 'warning');
        }
        textarea.focus();
        return;
    }
    
    try {
        // Mostrar indicador de carga
        const botonGuardar = document.getElementById('btn-guardar-comentario');
        const textoOriginal = botonGuardar.innerHTML;
        botonGuardar.disabled = true;
        botonGuardar.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Guardando...';
        
        // Aquí iría la llamada a la API para guardar el comentario
        // Por ahora simulamos una respuesta después de 500ms
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Simulamos un nuevo comentario (en producción, esto vendría de la API)
        const nuevoComentario = {
            id: Date.now(),
            texto: texto,
            fecha: new Date().toISOString(),
            usuario: 'Usuario Actual' // Esto debería venir del sistema de autenticación
        };
        
        // Limpiar el textarea
        textarea.value = '';
        
        // Mostrar mensaje de éxito
        if (window.mostrarMensaje) {
            window.mostrarMensaje('Comentario guardado correctamente', 'success');
        }
        
        // Recargar los comentarios
        await cargarComentarios(leadComentarioActual);
        
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
});
