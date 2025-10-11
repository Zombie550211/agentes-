/**
 * Script principal del core
 * Funciones comunes y utilidades globales
 */

(function() {
  console.log('[CORE SCRIPT] Inicializando...');

  // Utilidades de formato
  const Utils = {
    /**
     * Formatear número como moneda
     */
    formatCurrency(amount) {
      return new Intl.NumberFormat('es-US', {
        style: 'currency',
        currency: 'USD'
      }).format(amount || 0);
    },

    /**
     * Formatear fecha
     */
    formatDate(date) {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    },

    /**
     * Formatear fecha y hora
     */
    formatDateTime(date) {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },

    /**
     * Capitalizar primera letra
     */
    capitalize(str) {
      if (!str) return '';
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    },

    /**
     * Truncar texto
     */
    truncate(str, length = 50) {
      if (!str) return '';
      return str.length > length ? str.substring(0, length) + '...' : str;
    },

    /**
     * Validar email
     */
    isValidEmail(email) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return re.test(email);
    },

    /**
     * Validar teléfono
     */
    isValidPhone(phone) {
      const re = /^\d{10}$/;
      return re.test(phone?.replace(/\D/g, ''));
    },

    /**
     * Generar ID único
     */
    generateId() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    /**
     * Debounce function
     */
    debounce(func, wait = 300) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    },

    /**
     * Mostrar notificación
     */
    showNotification(message, type = 'info') {
      console.log(`[${type.toUpperCase()}] ${message}`);
      
      // Aquí puedes agregar lógica para mostrar notificaciones visuales
      // Por ejemplo, usando toast notifications
    },

    /**
     * Copiar al portapapeles
     */
    async copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        this.showNotification('Copiado al portapapeles', 'success');
        return true;
      } catch (err) {
        console.error('Error al copiar:', err);
        return false;
      }
    }
  };

  // Exponer utilidades globalmente
  window.Utils = Utils;

  console.log('[CORE SCRIPT] Inicializado correctamente');
})();
