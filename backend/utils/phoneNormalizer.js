/**
 * Phone Number Normalizer Utility
 * 
 * Este script normaliza números de teléfono a un formato estándar de 10 dígitos
 * sin importar cómo se ingresen (con paréntesis, guiones, espacios, etc.)
 * 
 * Ejemplos de entrada aceptados:
 * - (848) 299-7246
 * - 848-299-7246
 * - 848.299.7246
 * - 848 299 7246
 * - 8482997246
 * 
 * Salida: 8482997246
 */

/**
 * Normaliza un número de teléfono eliminando todos los caracteres no numéricos
 * @param {string|number} phone - El número de teléfono a normalizar
 * @returns {string} - El número de teléfono normalizado (solo dígitos)
 */
function normalizePhone(phone) {
  // Si el valor es null, undefined o vacío, retornar string vacío
  if (phone == null || phone === '') {
    return '';
  }
  
  // Convertir a string y eliminar todos los caracteres que no sean dígitos
  const normalized = String(phone).replace(/\D+/g, '');
  
  return normalized;
}

/**
 * Normaliza un número de teléfono y valida que tenga exactamente 10 dígitos
 * @param {string|number} phone - El número de teléfono a normalizar
 * @returns {string} - El número de teléfono normalizado (solo dígitos)
 * @throws {Error} - Si el número no tiene exactamente 10 dígitos después de normalizar
 */
function normalizePhoneStrict(phone) {
  const normalized = normalizePhone(phone);
  
  if (normalized.length !== 10) {
    throw new Error(`Número de teléfono inválido: debe tener 10 dígitos. Recibido: ${phone} (${normalized.length} dígitos)`);
  }
  
  return normalized;
}

/**
 * Normaliza un número de teléfono y retorna null si no es válido
 * @param {string|number} phone - El número de teléfono a normalizar
 * @returns {string|null} - El número normalizado o null si no es válido
 */
function normalizePhoneSafe(phone) {
  try {
    const normalized = normalizePhone(phone);
    return normalized.length === 10 ? normalized : null;
  } catch (error) {
    return null;
  }
}

/**
 * Formatea un número de teléfono normalizado a formato legible
 * @param {string} phone - El número de teléfono normalizado (10 dígitos)
 * @param {string} format - El formato deseado ('parenthesis', 'dash', 'dot', 'space')
 * @returns {string} - El número formateado
 */
function formatPhone(phone, format = 'parenthesis') {
  const normalized = normalizePhone(phone);
  
  if (normalized.length !== 10) {
    return phone; // Retornar el original si no es válido
  }
  
  const areaCode = normalized.substring(0, 3);
  const prefix = normalized.substring(3, 6);
  const lineNumber = normalized.substring(6, 10);
  
  switch (format) {
    case 'parenthesis':
      return `(${areaCode}) ${prefix}-${lineNumber}`;
    case 'dash':
      return `${areaCode}-${prefix}-${lineNumber}`;
    case 'dot':
      return `${areaCode}.${prefix}.${lineNumber}`;
    case 'space':
      return `${areaCode} ${prefix} ${lineNumber}`;
    default:
      return normalized;
  }
}

/**
 * Normaliza múltiples números de teléfono
 * @param {Array<string|number>} phones - Array de números de teléfono
 * @returns {Array<string>} - Array de números normalizados
 */
function normalizePhones(phones) {
  if (!Array.isArray(phones)) {
    return [];
  }
  
  return phones
    .map(phone => normalizePhone(phone))
    .filter(phone => phone.length > 0);
}

/**
 * Valida si un número de teléfono es válido (10 dígitos después de normalizar)
 * @param {string|number} phone - El número de teléfono a validar
 * @returns {boolean} - true si es válido, false en caso contrario
 */
function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized.length === 10;
}

// Exportar las funciones
module.exports = {
  normalizePhone,
  normalizePhoneStrict,
  normalizePhoneSafe,
  formatPhone,
  normalizePhones,
  isValidPhone
};

// Si se ejecuta directamente desde la línea de comandos
if (require.main === module) {
  console.log('=== Phone Normalizer Utility ===\n');
  
  // Ejemplos de uso
  const testPhones = [
    '(848) 299-7246',
    '848-299-7246',
    '848.299.7246',
    '848 299 7246',
    '8482997246',
    '1-848-299-7246',
    'abc848def299ghi7246',
    '123', // Inválido
    ''
  ];
  
  console.log('Ejemplos de normalización:\n');
  testPhones.forEach(phone => {
    const normalized = normalizePhone(phone);
    const isValid = isValidPhone(phone);
    const formatted = isValid ? formatPhone(normalized) : 'N/A';
    
    console.log(`Input:      "${phone}"`);
    console.log(`Normalized: "${normalized}"`);
    console.log(`Valid:      ${isValid}`);
    console.log(`Formatted:  ${formatted}`);
    console.log('---');
  });
}
