/**
 * Utilidades para manejo de fechas
 * 
 * IMPORTANTE: Este módulo existe para prevenir el bug de parseo UTC
 * que causa que las fechas se muestren en el mes anterior.
 * 
 * PROBLEMA:
 * - new Date("2025-10-01") parsea como UTC 00:00
 * - En zona horaria UTC-6 (México), esto se convierte a 2025-09-30 18:00
 * - Resultado: fechas de octubre aparecen en septiembre
 * 
 * SOLUCIÓN:
 * - Usar parseLocalDate() para parsear strings YYYY-MM-DD como fechas locales
 * - Esto crea new Date(2025, 9, 1) en vez de new Date("2025-10-01")
 */

/**
 * Parsea un string de fecha en formato YYYY-MM-DD como fecha LOCAL (no UTC)
 * 
 * @param {string|Date} dateValue - Fecha en formato YYYY-MM-DD o objeto Date
 * @returns {Date|null} - Objeto Date en zona horaria local, o null si es inválido
 * 
 * @example
 * // ❌ MAL - Parsea como UTC
 * const bad = new Date("2025-10-01"); // UTC 00:00 → En México: 2025-09-30 18:00
 * 
 * // ✅ BIEN - Parsea como local
 * const good = parseLocalDate("2025-10-01"); // Local 2025-10-01 00:00
 */
function parseLocalDate(dateValue) {
  if (!dateValue) return null;
  
  // Si ya es un Date válido, devolverlo
  if (dateValue instanceof Date) {
    return isNaN(dateValue.getTime()) ? null : dateValue;
  }
  
  // Si es string en formato YYYY-MM-DD, parsear como LOCAL
  if (typeof dateValue === 'string') {
    const trimmed = dateValue.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    
    if (match) {
      const [_, year, month, day] = match;
      // CRÍTICO: Usar new Date(year, month-1, day) para parseo LOCAL
      const date = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1, // Los meses en JS van de 0-11
        parseInt(day, 10)
      );
      
      // Validar que la fecha sea válida
      if (!isNaN(date.getTime()) && date.getFullYear() > 1900) {
        return date;
      }
    }
    
    // Fallback para otros formatos (DD/MM/YYYY, etc.)
    const date = new Date(dateValue);
    return isNaN(date.getTime()) ? null : date;
  }
  
  return null;
}

/**
 * Convierte una fecha a string YYYY-MM-DD sin conversión de zona horaria
 * 
 * @param {Date|string} dateValue - Fecha a convertir
 * @returns {string} - String en formato YYYY-MM-DD o cadena vacía
 * 
 * @example
 * const date = new Date(2025, 9, 1); // 1 de octubre 2025
 * formatLocalDate(date); // "2025-10-01"
 */
function formatLocalDate(dateValue) {
  const date = parseLocalDate(dateValue);
  if (!date) return '';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Obtiene el mes y año de una fecha como string "YYYY-MM"
 * 
 * @param {Date|string} dateValue - Fecha
 * @returns {string} - String en formato "YYYY-MM" o cadena vacía
 */
function getMonthKey(dateValue) {
  const date = parseLocalDate(dateValue);
  if (!date) return '';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  
  return `${year}-${month}`;
}

/**
 * Obtiene el nombre del mes en español
 * 
 * @param {Date|string} dateValue - Fecha
 * @returns {string} - Nombre del mes en español o cadena vacía
 */
function getMonthName(dateValue) {
  const date = parseLocalDate(dateValue);
  if (!date) return '';
  
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  
  return monthNames[date.getMonth()];
}

/**
 * Formatea una fecha como "día_semana día" (ej: "mié 13")
 * 
 * @param {Date|string} dateValue - Fecha
 * @returns {string} - String formateado o "N/A"
 */
function formatShortDate(dateValue) {
  const date = parseLocalDate(dateValue);
  if (!date) return 'N/A';
  
  const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dayOfWeek = dayNames[date.getDay()];
  const dayOfMonth = date.getDate();
  
  return `${dayOfWeek} ${dayOfMonth}`;
}

// Exportar funciones para uso global
if (typeof window !== 'undefined') {
  window.DateUtils = {
    parseLocalDate,
    formatLocalDate,
    getMonthKey,
    getMonthName,
    formatShortDate
  };
}

// Exportar para Node.js (si se usa en backend)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseLocalDate,
    formatLocalDate,
    getMonthKey,
    getMonthName,
    formatShortDate
  };
}
