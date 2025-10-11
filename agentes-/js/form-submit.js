/**
 * Función para manejar el envío del formulario
 * @param {Event} e - Evento de envío del formulario
 */
async function handleFormSubmit(e) {
  e.preventDefault();
  console.log('=== INICIANDO ENVÍO DE FORMULARIO ===');
  
  // Mostrar indicador de carga
  const submitBtn = document.getElementById('submit-btn');
  const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
  }

  try {
    // Obtener referencias a los elementos del formulario
    const form = e.target;
    const formData = new FormData(form);
    
    // Convertir FormData a objeto
    const formValues = Object.fromEntries(formData.entries());
    // Normalizar 'sistema' y no forzar valor por defecto
    const sistemaValue = (formValues['sistema'] || '').toString().trim();
    
    // Preparar datos del lead
    const leadData = {
      nombre_cliente: formValues['nombre-cliente'] || '',
      telefono_principal: formValues['telefono-principal'] || '',
      // usar el id correcto del input
      telefono_alterno: formValues['telefono-alterno'] || '',
      // enviar numero de cuenta si existe en el formulario
      numero_cuenta: formValues['numero-cuenta'] || '',
      // enviar autopago para poblar la columna correspondiente
      autopago: formValues['autopago'] || '',
      email: formValues['email'] || '',
      direccion: formValues['direccion'] || '',
      ciudad: formValues['ciudad'] || '',
      estado: formValues['estado'] || '',
      zip_code: formValues['zip-code'] || '',
      // alinear con la tabla que espera tipo_servicios (plural)
      tipo_servicios: formValues['tipo-servicio'] || 'INTERNET',
      producto: formValues['producto'] || '',
      // incluir servicios seleccionados si aplica
      servicios: formValues['servicios'] || '',
      sistema: sistemaValue ? sistemaValue.toUpperCase() : '',
      riesgo: (formValues['riesgo'] || '').toString().toUpperCase(),
      supervisor: formValues['supervisor'] || '',
      agente: formValues['agente'] || '',
      mercado: formValues['mercado'] || 'residencial',
      puntaje: parseFloat(formValues['puntaje'] || '0'),
      status: formValues['status'] || 'PENDING',
      comentario: formValues['comentario'] || '',
      motivo_llamada: formValues['motivo-llamada'] || '',
      dia_venta: formValues['dia-venta'] || new Date().toISOString().split('T')[0],
      // usar el id correcto del input
      dia_instalacion: formValues['dia-instalacion'] || '',
      creadoEn: new Date().toISOString(),
      actualizadoEn: new Date().toISOString()
    };

    console.log('Datos del formulario preparados:', leadData);

    // Validar campos requeridos
    // validar con claves alineadas a renderizado (incluye tipo_servicios y autopago)
    const requiredFields = ['nombre_cliente', 'telefono_principal', 'direccion', 'tipo_servicios', 'sistema', 'autopago'];
    const missingFields = requiredFields.filter(field => !leadData[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Faltan campos requeridos: ${missingFields.join(', ')}`);
    }

    // Enviar datos al servidor
    console.log('Enviando datos al servidor...');
    // Construir URL base dinámica
    const envBase = (typeof window !== 'undefined' && (window.API_BASE_URL || window.__API_BASE_URL__))
      || (typeof localStorage !== 'undefined' && (localStorage.getItem('API_BASE_URL') || localStorage.getItem('api_base_url')))
      || '';
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const base = envBase || origin || '';
    const apiUrl = `${base}/api/leads`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(leadData),
      credentials: 'include' // Importante para cookies de sesión si se usan
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Error en la petición: ${response.status}`);
    }

    const result = await response.json();
    console.log('Respuesta del servidor:', result);

    // Mostrar mensaje de éxito
    showNotification('¡Datos guardados exitosamente!', 'success');
    
    // Reiniciar el formulario
    form.reset();
    
    // Actualizar gráficas
    try {
      console.log('Actualizando gráficas...');
      if (typeof actualizarGraficas === 'function') {
        await actualizarGraficas();
      }
    } catch (error) {
      console.error('Error al actualizar gráficas:', error);
    }
    
  } catch (error) {
    console.error('Error al enviar el formulario:', error);
    showNotification(`Error: ${error.message}`, 'error');
  } finally {
    // Restaurar el botón
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  }
}

/**
 * Función para mostrar notificaciones
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo de notificación (success, error, warning, info)
 */
function showNotification(message, type = 'success') {
  const container = document.getElementById('notification-container');
  if (!container) return;
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  
  // Crear el ícono según el tipo de notificación
  const icon = document.createElement('i');
  icon.className = {
    'success': 'fas fa-check-circle',
    'error': 'fas fa-exclamation-circle',
    'warning': 'fas fa-exclamation-triangle',
    'info': 'fas fa-info-circle'
  }[type] || 'fas fa-info-circle';
  
  // Crear el mensaje
  const messageEl = document.createElement('span');
  messageEl.textContent = message;
  
  // Agregar elementos al contenedor de notificación
  notification.appendChild(icon);
  notification.appendChild(messageEl);
  
  // Agregar la notificación al contenedor
  container.appendChild(notification);
  
  // Mostrar la notificación
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  // Eliminar la notificación después de 5 segundos
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      container.removeChild(notification);
    }, 300);
  }, 5000);
}

// Inicializar el manejador de envío del formulario
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('crmForm');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
    console.log('Manejador de envío de formulario inicializado');
  }
});
