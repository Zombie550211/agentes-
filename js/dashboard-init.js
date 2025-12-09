/**
 * DASHBOARD INIT SYSTEM
 * Sistema de carga optimizado con init-dashboard + WebSocket updates
 * 
 * Flujo:
 * 1. Login ejecuta initDashboard()
 * 2. Una sola petición trae todos los datos
 * 3. Datos se guardan en sessionStorage
 * 4. WebSocket se conecta para actualizaciones en vivo
 */

class DashboardInitManager {
  constructor() {
    this.data = null;
    this.ws = null;
    this.wsUrl = this.getWebSocketURL();
    this.listeners = new Map(); // Para observer pattern
  }

  /**
   * Obtener URL de WebSocket correcta según el ambiente
   */
  getWebSocketURL() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}`;
  }

  /**
   * PASO 1: Cargar todos los datos del dashboard en UNA sola petición
   */
  async initDashboard() {
    try {
      console.log('🚀 [INIT] Iniciando carga de dashboard...');
      
      // 1. Petición al nuevo endpoint /api/init-dashboard
      const response = await fetch('/api/init-dashboard', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.message || 'Error desconocido');
      }

      this.data = data;

      // 2. Guardar en sessionStorage para acceso rápido
      sessionStorage.setItem('dashboardData', JSON.stringify(data));
      sessionStorage.setItem('dashboardTimestamp', new Date().toISOString());
      
      console.log('✅ [INIT] Datos del dashboard cargados y guardados en sessionStorage');
      console.log('📊 [INIT] Datos:', data);

      // 3. Emitir evento para que las vistas puedan reaccionar
      this.emit('dashboardInitialized', data);

      // 4. Conectar WebSocket para actualizaciones en vivo
      this.connectWebSocket();

      return data;

    } catch (error) {
      console.error('❌ [INIT] Error inicializando dashboard:', error);
      // Fallback: intentar cargar desde sessionStorage
      const cached = sessionStorage.getItem('dashboardData');
      if (cached) {
        try {
          this.data = JSON.parse(cached);
          console.warn('⚠️  [INIT] Usando datos en caché desde sessionStorage');
          return this.data;
        } catch (e) {
          console.error('❌ [INIT] No se pudo parsear datos en caché');
        }
      }
      throw error;
    }
  }

  /**
   * PASO 2: Conectar WebSocket para actualizaciones en vivo
   */
  connectWebSocket() {
    try {
      console.log('🔌 [WS] Conectando WebSocket para actualizaciones en vivo...');

      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log('✅ [WS] WebSocket conectado');
        // Enviar mensaje de registro como usuario del dashboard
        const msg = {
          type: 'subscribe',
          channel: 'dashboard',
          user: this.data?.user?.username
        };
        this.ws.send(JSON.stringify(msg));
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('📨 [WS] Mensaje recibido:', message);

          if (message.type === 'dashboard-update') {
            this.handleDashboardUpdate(message.data);
          }
        } catch (e) {
          console.warn('⚠️  [WS] Error parseando mensaje:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ [WS] Error en WebSocket:', error);
      };

      this.ws.onclose = () => {
        console.warn('⚠️  [WS] WebSocket desconectado');
        // Intentar reconectar después de 5 segundos
        setTimeout(() => this.connectWebSocket(), 5000);
      };

    } catch (error) {
      console.error('❌ [WS] Error al conectar WebSocket:', error);
    }
  }

  /**
   * PASO 3: Manejar actualizaciones en vivo del servidor
   */
  handleDashboardUpdate(updateData) {
    try {
      console.log('🔄 [UPDATE] Actualizando datos del dashboard:', updateData);

      // Fusionar datos nuevos con los existentes
      if (this.data) {
        this.data = {
          ...this.data,
          ...updateData,
          kpis: { ...this.data.kpis, ...updateData.kpis },
          userStats: { ...this.data.userStats, ...updateData.userStats }
        };
      }

      // Guardar en sessionStorage
      sessionStorage.setItem('dashboardData', JSON.stringify(this.data));
      sessionStorage.setItem('dashboardUpdateTime', new Date().toISOString());

      // Emitir evento para que las vistas se actualicen en vivo
      this.emit('dashboardUpdated', updateData);

      console.log('✅ [UPDATE] Dashboard actualizado');
    } catch (error) {
      console.error('❌ [UPDATE] Error actualizando dashboard:', error);
    }
  }

  /**
   * Obtener datos del dashboard desde sessionStorage
   */
  getDisplayData() {
    if (this.data) return this.data;

    const cached = sessionStorage.getItem('dashboardData');
    if (cached) {
      try {
        this.data = JSON.parse(cached);
        return this.data;
      } catch (e) {
        console.error('❌ Error al parsear datos en caché:', e);
      }
    }

    return null;
  }

  /**
   * Pattern de observador - Permitir que las vistas se suscriban a cambios
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error en listener para evento ${event}:`, e);
        }
      });
    }
  }

  /**
   * Limpiar datos al logout
   */
  cleanup() {
    sessionStorage.removeItem('dashboardData');
    sessionStorage.removeItem('dashboardTimestamp');
    sessionStorage.removeItem('dashboardUpdateTime');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.data = null;
    this.listeners.clear();
    console.log('🧹 [CLEANUP] Dashboard limpiado');
  }
}

// Crear instancia global
window.dashboardManager = new DashboardInitManager();
