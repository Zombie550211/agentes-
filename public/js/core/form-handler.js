/**
 * Manejador del formulario de leads
 * Incluye funcionalidad para el botón de cierre y validación
 */

document.addEventListener('DOMContentLoaded', function() {
  // Elementos del DOM
  const closeFormBtn = document.getElementById('close-form-btn');
  const formPanel = document.getElementById('form-panel');
  const leadForm = document.getElementById('lead-form');
  const submitBtn = leadForm ? leadForm.querySelector('.crm-form-submit-btn') : null;

  // Función para cerrar el formulario
  function closeForm() {
    if (formPanel) {
      formPanel.style.display = 'none';
      // Mostrar mensaje de retroalimentación
      mostrarMensaje('El formulario ha sido cerrado', 'info');
      
      // Desplazarse al inicio de la página
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Evento para el botón de cierre
  if (closeFormBtn) {
    closeFormBtn.addEventListener('click', closeForm);
  }

  // Validación del formulario
  if (leadForm) {
    // Validar campos requeridos al perder el foco
    const requiredFields = leadForm.querySelectorAll('[required]');
    
    requiredFields.forEach(field => {
      field.addEventListener('blur', function() {
        validateField(this);
      });
    });

    // COMENTADO: Event listener eliminado para evitar duplicación
    // Solo script.js debe manejar el envío del formulario
    /*
    leadForm.addEventListener('submit', function(e) {
      let isValid = true;
      
      // Validar todos los campos requeridos
      requiredFields.forEach(field => {
        if (!validateField(field)) {
          isValid = false;
        }
      });

      if (!isValid) {
        e.preventDefault();
        mostrarMensaje('Por favor, complete todos los campos requeridos correctamente.', 'error');
      } else if (submitBtn) {
        // Mostrar estado de carga
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;
        
        // Aquí podrías agregar lógica adicional antes de enviar el formulario
        // Por ejemplo, mostrar un mensaje de "Guardando..."
        console.log('Enviando formulario...');
      }
    });
    */
  }

  // Función para validar un campo individual
  function validateField(field) {
    const formGroup = field.closest('.crm-form-group');
    if (!formGroup) return true;

    let isValid = true;
    let errorMessage = '';
    
    // Validar campo requerido
    if (field.required && !field.value.trim()) {
      isValid = false;
      errorMessage = 'Este campo es obligatorio';
    }
    
    // Validar formato de email si es necesario
    if (field.type === 'email' && field.value) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(field.value)) {
        isValid = false;
        errorMessage = 'Ingrese un correo electrónico válido';
      }
    }
    
    // Validar número de teléfono si es necesario
    if ((field.name.includes('telefono') || field.name.includes('phone')) && field.value) {
      const phoneRegex = /^[0-9\-\+\(\)\s]+$/;
      if (!phoneRegex.test(field.value)) {
        isValid = false;
        errorMessage = 'Ingrese un número de teléfono válido';
      }
    }
    
    // Actualizar estado visual del campo
    if (isValid) {
      formGroup.classList.remove('error');
      // Eliminar mensaje de error si existe
      const existingError = formGroup.querySelector('.validation-message');
      if (existingError) {
        existingError.remove();
      }
    } else {
      formGroup.classList.add('error');
      
      // Mostrar mensaje de error
      let errorElement = formGroup.querySelector('.validation-message');
      if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.className = 'validation-message';
        formGroup.appendChild(errorElement);
      }
      errorElement.textContent = errorMessage;
    }
    
    return isValid;
  }
});

// Función para mostrar mensajes en la interfaz
function mostrarMensaje(mensaje, tipo = 'info') {
  // Verificar si ya existe un contenedor de mensajes
  let mensajeContainer = document.getElementById('mensaje-flotante');
  
  // Si no existe, crearlo
  if (!mensajeContainer) {
    mensajeContainer = document.createElement('div');
    mensajeContainer.id = 'mensaje-flotante';
    document.body.appendChild(mensajeContainer);
    
    // Estilos para el contenedor de mensajes
    Object.assign(mensajeContainer.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '1000',
      maxWidth: '350px',
      width: '90%',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      pointerEvents: 'none'
    });
  }
  
  // Crear el mensaje
  const mensajeElement = document.createElement('div');
  
  // Estilos base del mensaje
  const estilosBase = {
    padding: '12px 16px',
    marginBottom: '10px',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    animation: 'slideIn 0.3s ease-out forwards',
    pointerEvents: 'auto',
    cursor: 'pointer',
    fontSize: '0.9rem',
    lineHeight: '1.4',
    opacity: '0',
    transform: 'translateX(20px)'
  };
  
  // Estilos según el tipo de mensaje
  const estilosPorTipo = {
    success: {
      backgroundColor: '#10B981',
      borderLeft: '4px solid #059669'
    },
    error: {
      backgroundColor: '#EF4444',
      borderLeft: '4px solid #DC2626'
    },
    warning: {
      backgroundColor: '#F59E0B',
      borderLeft: '4px solid #D97706',
      color: '#1F2937'
    },
    info: {
      backgroundColor: '#3B82F6',
      borderLeft: '4px solid #2563EB'
    }
  };
  
  // Aplicar estilos
  Object.assign(mensajeElement.style, estilosBase, estilosPorTipo[tipo] || estilosPorTipo.info);
  
  // Icono según el tipo de mensaje
  const iconos = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'i'
  };
  
  mensajeElement.innerHTML = `
    <span style="font-weight: bold; font-size: 1.1em;">${iconos[tipo] || 'i'}</span>
    <span>${mensaje}</span>
  `;
  
  // Agregar el mensaje al contenedor
  mensajeContainer.appendChild(mensajeElement);
  
  // Forzar reflow para que la animación funcione
  void mensajeElement.offsetWidth;
  
  // Mostrar el mensaje con animación
  mensajeElement.style.opacity = '1';
  mensajeElement.style.transform = 'translateX(0)';
  
  // Eliminar el mensaje después de 5 segundos
  setTimeout(() => {
    mensajeElement.style.opacity = '0';
    mensajeElement.style.transform = 'translateX(20px)';
    
    // Eliminar el elemento después de la animación
    setTimeout(() => {
      mensajeElement.remove();
      
      // Si no hay más mensajes, eliminar el contenedor
      if (mensajeContainer && mensajeContainer.children.length === 0) {
        mensajeContainer.remove();
      }
    }, 300);
  }, 5000);
  
  // Cerrar el mensaje al hacer clic
  mensajeElement.addEventListener('click', () => {
    mensajeElement.style.opacity = '0';
    mensajeElement.style.transform = 'translateX(20px)';
    
    setTimeout(() => {
      mensajeElement.remove();
      
      // Si no hay más mensajes, eliminar el contenedor
      if (mensajeContainer && mensajeContainer.children.length === 0) {
        mensajeContainer.remove();
      }
    }, 300);
  });
  
  // Agregar animación al CSS si no existe
  if (!document.getElementById('animacion-mensajes')) {
    const style = document.createElement('style');
    style.id = 'animacion-mensajes';
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// Hacer la función accesible globalmente
window.mostrarMensaje = mostrarMensaje;
