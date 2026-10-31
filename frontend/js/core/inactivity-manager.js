/**
 * Cierre de sesión por inactividad: DESACTIVADO desde el 31-oct-2026.
 *
 * Decisión de operación: la sesión queda abierta hasta que la persona pulse «Cerrar
 * sesión». El servidor emite tokens de 30 días que se renuevan solos con el uso
 * (CRM_PYTHON/deps.py, JWT_EXPIRES), así que una pestaña abierta no caduca.
 *
 * El archivo se queda (varias páginas lo cargan con su propia etiqueta) y solo borra la
 * marca de actividad que usaba la versión anterior.
 */
(function () {
  'use strict';
  try { localStorage.removeItem('crm_ultima_actividad'); } catch (_) {}
})();
