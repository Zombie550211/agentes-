# Sistema de Gestión de Inactividad - CRM

## 📋 Descripción

El Sistema de Gestión de Inactividad es una funcionalidad de seguridad que cierra automáticamente las sesiones de usuario después de un período de inactividad, protegiendo el CRM contra accesos no autorizados.

## 🚀 Características

- ✅ **Detección automática de inactividad** - Monitorea actividad del mouse, teclado, scroll y touch
- ✅ **Advertencia previa** - Muestra un modal 1 minuto antes del cierre
- ✅ **Configuración flexible** - Tiempos personalizables desde un archivo central
- ✅ **Exclusión de páginas** - Páginas como login no tienen el sistema activo
- ✅ **Limpieza automática** - Elimina tokens y datos de sesión al cerrar
- ✅ **Interfaz intuitiva** - Modales elegantes con opciones claras
- ✅ **Logging detallado** - Registros para debugging y monitoreo

## ⚙️ Configuración

### Configuración Principal (`js/crm-config.js`)

```javascript
inactivity: {
    timeoutMinutes: 5,        // Tiempo total de inactividad (minutos)
    warningMinutes: 1,        // Tiempo de advertencia (minutos)
    checkIntervalSeconds: 30, // Intervalo de verificación (segundos)
    enabled: true,            // Habilitar/deshabilitar sistema
    
    // Páginas excluidas
    excludedPages: [
        'login.html',
        'register.html', 
        'reset-password.html',
        '404.html'
    ]
}
```

### Personalización de Mensajes

```javascript
messages: {
    warningTitle: 'Sesión por Expirar',
    warningText: 'Tu sesión expirará en {seconds} segundos debido a inactividad.',
    warningQuestion: '¿Deseas continuar trabajando?',
    logoutTitle: 'Sesión Cerrada',
    logoutText: 'Tu sesión ha sido cerrada por inactividad.',
    redirectText: 'Redirigiendo al login...'
}
```

## 📁 Archivos del Sistema

1. **`js/crm-config.js`** - Configuración centralizada
2. **`js/inactivity-manager.js`** - Lógica principal del sistema
3. **`js/crm-init.js`** - Inicializador universal

## 🔧 Instalación

### 1. Incluir Scripts en HTML

```html
<!-- Sistema de Inactividad -->
<script src="js/crm-config.js"></script>
<script src="js/inactivity-manager.js"></script>
<script src="js/crm-init.js"></script>
```

### 2. El sistema se inicializa automáticamente

No requiere configuración adicional. Se activa automáticamente en páginas con sesión válida.

## 🎯 Uso Programático

### Controlar el Sistema

```javascript
// Pausar temporalmente (útil para modales importantes)
CRM.pauseInactivity();

// Reanudar el sistema
CRM.resumeInactivity();

// Reiniciar timer manualmente
CRM.resetInactivityTimer();

// Verificar si hay sesión válida
if (CRM.hasValidSession()) {
    console.log('Usuario autenticado');
}
```

### Actualizar Configuración Dinámicamente

```javascript
// Cambiar tiempo de inactividad a 10 minutos
CRM_CONFIG.updateInactivityConfig({
    timeoutMinutes: 10,
    warningMinutes: 2
});
```

## 🔍 Eventos Detectados

El sistema considera actividad del usuario cuando detecta:

- `mousedown`, `mousemove` - Movimiento del mouse
- `keypress`, `keydown` - Pulsaciones de teclado  
- `scroll` - Desplazamiento de página
- `touchstart` - Toques en pantalla táctil
- `click` - Clics del mouse
- `resize` - Cambio de tamaño de ventana
- `focus` - Enfoque en la ventana

## 📊 Flujo de Funcionamiento

1. **Inicio** - Sistema se activa al cargar página con sesión válida
2. **Monitoreo** - Detecta eventos de actividad del usuario
3. **Timer Reset** - Cada actividad reinicia el contador
4. **Advertencia** - A 1 minuto del cierre muestra modal de advertencia
5. **Countdown** - Cuenta regresiva de 60 segundos
6. **Opciones** - Usuario puede continuar o cerrar sesión
7. **Cierre** - Si no hay respuesta, cierra sesión automáticamente
8. **Limpieza** - Elimina datos de sesión y redirige al login

## 🛡️ Seguridad

- **Limpieza completa** - Elimina tokens de localStorage y sessionStorage
- **Redirección forzada** - Usa `window.location.replace()` para evitar historial
- **Verificación periódica** - Chequeos adicionales cada 30 segundos
- **Detección de blur** - Monitorea cuando la ventana pierde el foco

## 🐛 Debugging

### Logs del Sistema

```javascript
// Habilitar logs detallados
CRM_CONFIG.logging.level = 'debug';

// Ver configuración actual
console.log(CRM_CONFIG.getInactivityConfig());

// Verificar estado del sistema
console.log(window.crmInactivityManager);
```

### Mensajes de Consola

- `[INACTIVITY] Sistema iniciado`
- `[INACTIVITY] Mostrando advertencia`
- `[INACTIVITY] Cerrando sesión por inactividad`
- `[CRM-INIT] Sistema inicializado correctamente`

## ⚠️ Consideraciones

1. **Páginas Excluidas** - Login, registro y páginas públicas no tienen el sistema
2. **Sesión Requerida** - Solo funciona si hay token de autenticación válido
3. **Compatibilidad** - Funciona en todos los navegadores modernos
4. **Performance** - Impacto mínimo, usa eventos nativos del DOM
5. **Personalización** - Todos los tiempos y mensajes son configurables

## 🔄 Actualizaciones Futuras

- [ ] Integración con API para validar sesiones en servidor
- [ ] Notificaciones push antes del cierre
- [ ] Configuración por rol de usuario
- [ ] Métricas de uso y análisis
- [ ] Modo "trabajo remoto" con tiempos extendidos

## 📞 Soporte

Para modificar la configuración, edita el archivo `js/crm-config.js` y reinicia el navegador. Los cambios se aplicarán automáticamente en todas las páginas del CRM.

---

**Última actualización**: Octubre 2025  
**Versión**: 1.0.0  
**Compatibilidad**: Todos los navegadores modernos
