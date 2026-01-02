/**
 * Normalizador universal de fechas
 * Acepta cualquier formato y lo convierte a YYYY-MM-DD
 */

/**
 * Normaliza una fecha a formato YYYY-MM-DD
 * @param {string|Date|number} dateInput - Fecha en cualquier formato
 * @returns {string|null} - Fecha en formato YYYY-MM-DD o null si es inválida
 */
function normalizeDateToString(dateInput) {
  if (!dateInput) return null;

  try {
    let dateObj;

    // Si es un string
    if (typeof dateInput === 'string') {
      const trimmed = dateInput.trim();

      // Formato YYYY-MM-DD (ya está normalizado)
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
      }

      // Formato DD/MM/YYYY
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
        const [d, m, y] = trimmed.split('/').map(Number);
        dateObj = new Date(y, m - 1, d);
      }

      // Formato DD-MM-YYYY
      else if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
        const [d, m, y] = trimmed.split('-').map(Number);
        dateObj = new Date(y, m - 1, d);
      }

      // ISO con timestamp (YYYY-MM-DDTHH:MM:SS.SSSZ)
      else if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
        dateObj = new Date(trimmed);
      }

      // Intenta parsear como cualquier string válido
      else {
        dateObj = new Date(trimmed);
      }
    }

    // Si es un Date object
    else if (dateInput instanceof Date) {
      dateObj = dateInput;
    }

    // Si es un número (timestamp en ms)
    else if (typeof dateInput === 'number') {
      dateObj = new Date(dateInput);
    }

    // Validar que sea una fecha válida
    if (!dateObj || isNaN(dateObj.getTime())) {
      return null;
    }

    // Convertir a YYYY-MM-DD (usando zona horaria local)
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  } catch (e) {
    console.warn('[dateNormalizer] Error normalizando fecha:', dateInput, e.message);
    return null;
  }
}

/**
 * Normaliza una fecha a objeto Date
 * @param {string|Date|number} dateInput - Fecha en cualquier formato
 * @returns {Date|null} - Objeto Date o null si es inválida
 */
function normalizeDateToObject(dateInput) {
  const normalized = normalizeDateToString(dateInput);
  if (!normalized) return null;

  const [y, m, d] = normalized.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Valida si una fecha es válida (en cualquier formato)
 * @param {string|Date|number} dateInput - Fecha en cualquier formato
 * @returns {boolean} - True si es una fecha válida
 */
function isValidDate(dateInput) {
  return normalizeDateToString(dateInput) !== null;
}

/**
 * Compara dos fechas (ignora hora)
 * @param {string|Date|number} date1
 * @param {string|Date|number} date2
 * @returns {number} - -1 si date1 < date2, 0 si son iguales, 1 si date1 > date2
 */
function compareDates(date1, date2) {
  const str1 = normalizeDateToString(date1);
  const str2 = normalizeDateToString(date2);

  if (!str1 || !str2) return 0;

  if (str1 < str2) return -1;
  if (str1 > str2) return 1;
  return 0;
}

/**
 * Obtiene un rango de fechas (inicio y fin del día en UTC)
 * @param {string|Date|number} dateInput - Fecha en cualquier formato
 * @returns {Object} - { startUTC: Date, endUTC: Date }
 */
function getDateRange(dateInput) {
  const normalized = normalizeDateToString(dateInput);
  if (!normalized) return null;

  const [y, m, d] = normalized.split('-').map(Number);

  const startUTC = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const endUTC = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));

  return { startUTC, endUTC };
}

module.exports = {
  normalizeDateToString,
  normalizeDateToObject,
  isValidDate,
  compareDates,
  getDateRange
};
