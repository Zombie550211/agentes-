/**
 * Middleware que normaliza todas las fechas en la respuesta JSON
 * Convierte cualquier fecha a formato YYYY-MM-DD
 */

const { normalizeDateToString } = require('../utils/dateNormalizer');

/**
 * Normaliza recursivamente todas las fechas en un objeto
 * @param {any} obj - Objeto a normalizar
 * @returns {any} - Objeto con fechas normalizadas
 */
function normalizeDatesInObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Si es un array, normalizar cada elemento
  if (Array.isArray(obj)) {
    return obj.map(item => normalizeDatesInObject(item));
  }

  // Si es un objeto
  if (typeof obj === 'object') {
    const normalized = {};
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        
        // Detectar campos de fecha por nombre
        const isDateField = /^(dia|date|fecha|instalacion|venta|creado|actualizado|creadoEn|actualizadoEn)/.test(key.toLowerCase());
        
        if (isDateField && (value instanceof Date || typeof value === 'string' || typeof value === 'number')) {
          // Intentar normalizar la fecha
          const normalizedDate = normalizeDateToString(value);
          normalized[key] = normalizedDate || value;
        } else if (value instanceof Date) {
          // Si es un Date object directo, normalizarlo
          const dateStr = normalizeDateToString(value);
          normalized[key] = dateStr || value.toISOString();
        } else if (typeof value === 'object') {
          // Recursivamente normalizar objetos anidados
          normalized[key] = normalizeDatesInObject(value);
        } else {
          normalized[key] = value;
        }
      }
    }
    
    return normalized;
  }

  // Para otros tipos, retornar como está
  return obj;
}

/**
 * Middleware Express que normaliza fechas en la respuesta
 */
function dateFormatterMiddleware(req, res, next) {
  // Guardar el método original de json()
  const originalJson = res.json.bind(res);

  // Sobrescribir json() para normalizar fechas
  res.json = function(data) {
    const normalized = normalizeDatesInObject(data);
    return originalJson(normalized);
  };

  next();
}

module.exports = dateFormatterMiddleware;
