/**
 * MEJORAS MODERNAS PARA EL FORMULARIO LEAD
 * Funcionalidades adicionales para una mejor experiencia de usuario
 */

document.addEventListener('DOMContentLoaded', function() {
    initializeModernLeadForm();
});

function initializeModernLeadForm() {
    const form = document.getElementById('lead-form');
    if (!form) return;

    // Inicializar todas las funcionalidades
    initFormProgress();
    initRealTimeValidation();
    initFormAnimations();
    initSubmitButtonEnhancements();
    initTooltips();
    initAutoSave();
}

/**
 * INDICADOR DE PROGRESO DEL FORMULARIO
 */
function initFormProgress() {
    const form = document.getElementById('lead-form');
    const formContainer = document.querySelector('.crm-form-section');
    
    // Crear barra de progreso
    const progressBar = document.createElement('div');
    progressBar.className = 'form-progress';
    progressBar.style.width = '0%';
    formContainer.insertBefore(progressBar, formContainer.firstChild);

    // Calcular progreso basado en campos completados
    function updateProgress() {
        const requiredFields = form.querySelectorAll('[required]');
        const completedFields = Array.from(requiredFields).filter(field => {
            if (field.type === 'radio') {
                return form.querySelector(`input[name="${field.name}"]:checked`);
            }
            return field.value.trim() !== '';
        });
        
        const progress = (completedFields.length / requiredFields.length) * 100;
        progressBar.style.width = progress + '%';
        
        // Cambiar color según el progreso
        if (progress < 30) {
            progressBar.style.background = 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)';
        } else if (progress < 70) {
            progressBar.style.background = 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)';
        } else {
            progressBar.style.background = 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
        }
    }

    // Actualizar progreso en cada cambio
    form.addEventListener('input', updateProgress);
    form.addEventListener('change', updateProgress);
    
    // Actualización inicial
    updateProgress();
}

/**
 * VALIDACIÓN EN TIEMPO REAL
 */
function initRealTimeValidation() {
    const form = document.getElementById('lead-form');
    const inputs = form.querySelectorAll('.crm-form-input, .crm-form-select');

    inputs.forEach(input => {
        const formGroup = input.closest('.crm-form-group');
        
        input.addEventListener('blur', function() {
            validateField(this, formGroup);
        });

        input.addEventListener('input', function() {
            if (formGroup.classList.contains('error')) {
                validateField(this, formGroup);
            }
        });
    });
}

function validateField(field, formGroup) {
    const isValid = field.checkValidity() && field.value.trim() !== '';
    
    // Remover clases previas
    formGroup.classList.remove('error', 'success');
    
    // Remover mensaje de error previo
    const existingError = formGroup.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }

    if (!isValid && field.value.trim() !== '') {
        formGroup.classList.add('error');
        
        // Agregar mensaje de error
        const errorMsg = document.createElement('div');
        errorMsg.className = 'error-message';
        errorMsg.innerHTML = '<i class="fas fa-exclamation-circle"></i> Este campo es requerido';
        formGroup.appendChild(errorMsg);
    } else if (isValid) {
        formGroup.classList.add('success');
    }
}

/**
 * ANIMACIONES DEL FORMULARIO
 */
function initFormAnimations() {
    const formGroups = document.querySelectorAll('.crm-form-group');
    
    // Observer para animaciones al hacer scroll
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    formGroups.forEach((group, index) => {
        group.style.opacity = '0';
        group.style.transform = 'translateY(30px)';
        group.style.transition = `all 0.6s ease ${index * 0.1}s`;
        observer.observe(group);
    });
}

/**
 * MEJORAS DEL BOTÓN DE ENVÍO
 */
function initSubmitButtonEnhancements() {
    const form = document.getElementById('lead-form');
    const submitBtn = form.querySelector('.crm-form-submit-btn');
    
    if (!submitBtn) return;

    form.addEventListener('submit', function(e) {
        // Agregar estado de carga
        submitBtn.classList.add('loading');
        submitBtn.textContent = 'Guardando...';
        
        // Simular proceso de envío (esto se maneja en script.js)
        setTimeout(() => {
            submitBtn.classList.remove('loading');
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Guardar Lead';
        }, 3000);
    });

    // Efecto de ripple al hacer click
    submitBtn.addEventListener('click', function(e) {
        const ripple = document.createElement('div');
        const rect = this.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        
        ripple.style.cssText = `
            position: absolute;
            width: ${size}px;
            height: ${size}px;
            left: ${x}px;
            top: ${y}px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            transform: scale(0);
            animation: ripple 0.6s ease-out;
            pointer-events: none;
        `;
        
        this.appendChild(ripple);
        
        setTimeout(() => {
            ripple.remove();
        }, 600);
    });
}

/**
 * TOOLTIPS INFORMATIVOS
 */
function initTooltips() {
    const labels = document.querySelectorAll('.crm-form-label');
    
    const tooltipData = {
        'nombre_cliente': 'Ingresa el nombre completo del cliente',
        'telefono_principal': 'Número de teléfono principal para contacto',
        'numero_cuenta': 'Número de cuenta del cliente en el sistema',
        'autopago': 'Indica si el cliente tiene configurado el autopago',
        'direccion': 'Dirección completa del cliente',
        'tipo_servicios': 'Selecciona el tipo de servicio contratado',
        'sistema': 'Sistema utilizado para el registro',
        'riesgo': 'Nivel de riesgo asociado al cliente',
        'puntaje': 'Puntaje asignado según criterios de evaluación'
    };

    labels.forEach(label => {
        const fieldName = label.closest('.crm-form-group').dataset.field;
        if (tooltipData[fieldName]) {
            const tooltip = document.createElement('i');
            tooltip.className = 'fas fa-info-circle form-tooltip';
            tooltip.setAttribute('data-tooltip', tooltipData[fieldName]);
            label.appendChild(tooltip);
        }
    });
}

/**
 * AUTOGUARDADO LOCAL
 */
function initAutoSave() {
    const form = document.getElementById('lead-form');
    const STORAGE_KEY = 'lead-form-draft';
    
    // Cargar datos guardados
    function loadDraft() {
        const draft = localStorage.getItem(STORAGE_KEY);
        if (draft) {
            try {
                const data = JSON.parse(draft);
                Object.keys(data).forEach(key => {
                    const field = form.querySelector(`[name="${key}"]`);
                    if (field) {
                        if (field.type === 'radio') {
                            const radio = form.querySelector(`[name="${key}"][value="${data[key]}"]`);
                            if (radio) radio.checked = true;
                        } else {
                            field.value = data[key];
                        }
                    }
                });
                
                // Mostrar notificación de borrador cargado
                showNotification('Borrador cargado automáticamente', 'info');
            } catch (e) {
                console.warn('Error al cargar borrador:', e);
            }
        }
    }

    // Guardar borrador
    function saveDraft() {
        const formData = new FormData(form);
        const data = {};
        
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    // Limpiar borrador al enviar exitosamente
    function clearDraft() {
        localStorage.removeItem(STORAGE_KEY);
    }

    // Eventos
    form.addEventListener('input', debounce(saveDraft, 1000));
    form.addEventListener('change', saveDraft);
    
    // Limpiar borrador al enviar
    form.addEventListener('submit', clearDraft);
    
    // Cargar borrador al inicializar
    loadDraft();
}

/**
 * UTILIDADES
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `form-notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        ${message}
    `;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Animar entrada
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remover después de 3 segundos
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Agregar estilos para las animaciones de ripple
const rippleStyles = document.createElement('style');
rippleStyles.textContent = `
    @keyframes ripple {
        to {
            transform: scale(2);
            opacity: 0;
        }
    }
`;
document.head.appendChild(rippleStyles);
