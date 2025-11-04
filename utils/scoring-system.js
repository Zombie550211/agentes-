/**
 * SISTEMA DE PUNTACIÓN AUTOMÁTICA - BACKEND
 * 
 * Este módulo calcula y valida puntajes de ventas en el servidor.
 * Debe mantenerse sincronizado con js/scoring-system.js (frontend)
 */

/**
 * Tabla de puntajes por servicio
 */
const SCORING_TABLE = {
  // ========== VIDEO ==========
  'video-directv-internet': {
    byRisk: {
      low: 1.0,
      medium: 0.35,
      high: 0.35,
      na: 1.0
    }
  },
  'video-directv-satelite': {
    base: 1.0
  },
  'video-select-spectrum': {
    base: 1.0
  },

  // ========== AT&T AIR ==========
  'att-air': {
    base: 0.35
  },

  // ========== AT&T INTERNET ==========
  'att-18-25-mb': {
    base: 0.25
  },
  'att-50-100-mb': {
    base: 0.35
  },
  'att-100-fibra': {
    base: 0.70
  },
  'att-300-500-mb': {
    base: 1.25
  },
  'att-1g-plus': {
    base: 1.5
  },

  // ========== XFINITY ==========
  'xfinity-100-299': {
    base: 0.35
  },
  'xfinity-300': {
    base: 0.35
  },
  'xfinity-500-plus': {
    base: 0.75
  },
  'xfinity-double-play': {
    base: 0.95
  },
  'xfinity-ultimate-tv': {
    base: 0.75
  },
  'xfinity-unlimited-voip': {
    base: 0.75
  },

  // ========== FRONTIER ==========
  'frontier-200-mb': {
    base: 1.0
  },
  'frontier-500-mb': {
    base: 1.0
  },
  'frontier-1g': {
    base: 1.25
  },
  'frontier-2g-plus': {
    base: 1.5
  },
   
  // ========== EARTHLINK ==========
  'internet-earthlink': {
    base: 1.0
  },

  // ========== ZIPLY FIBER ==========
  'internet-ziply-fiber': {
    base: 0.35
  },

  // ========== WINDSTREAM ==========
  'internet-windstream': {
    base: 1.0
  },

  // ========== BRIGHTSPEED ==========
  'brightspeed-10-100': {
    base: 0.35
  },
  'brightspeed-100-900': {
    base: 1.0
  },

  // ========== SPECTRUM ==========
  'spectrum-500': {
    base: 0.75
  },
  'spectrum-1g': {
    base: 1.0
  },
  'spectrum-2g': {
    base: 1.25
  },
  'double-play-spectrum': {
    base: 1.0
  },

  // ========== MOBILITY ==========
  'mobility-spectrum': {
    base: 0.5
  },
  'sim-spectrum': {
    base: 0.5
  },

  // ========== OTROS SERVICIOS ==========
  'internet-wow': {
    base: 1.0
  },
  'internet-altafiber': {
    base: 1.0
  },
  'internet-hughesnet': {
    base: 0.75
  },
  'internet-viasat': {
    base: 0.75
  },
  // Consolidated Communications / Fidium (por velocidad)
  'internet-consolidate-2g': { base: 1.25 },
  'internet-consolidate-1g': { base: 1.25 },
  'internet-consolidate-300m': { base: 0.35 },
  'internet-consolidate-100m': { base: 0.35 },
  // Compatibilidad genérica si no se detecta velocidad
  'internet-consolidate': { base: 0.35 },
  'internet-centurylink': {
    base: 1.0
  },
  'internet-metronet': {
    base: 1.0
  },
  'internet-hawaiian': {
    base: 1.0
  },
  'internet-optimum': {
    base: 1.0
  }
};

/**
 * Calcula el puntaje para un servicio y riesgo dados
 * 
 * @param {string} serviceKey - Clave del servicio
 * @param {string} riskLevel - Nivel de riesgo: 'low', 'medium', 'high', 'na'
 * @returns {number} - Puntaje calculado
 */
function calculateScore(serviceKey, riskLevel) {
  if (!serviceKey) {
    console.warn('[SCORING] No se proporcionó servicio');
    return 0;
  }

  // Normalizar riskLevel
  const normalizedRisk = (riskLevel || 'na').toLowerCase();

  // Buscar el servicio en la tabla
  const serviceConfig = SCORING_TABLE[serviceKey];

  if (!serviceConfig) {
    console.warn(`[SCORING] Servicio no encontrado en tabla de puntajes: ${serviceKey}`);
    return 0;
  }

  // Si el servicio tiene puntaje base (no depende de riesgo)
  if (serviceConfig.base !== undefined) {
    return serviceConfig.base;
  }

  // Si el servicio tiene puntajes por riesgo
  if (serviceConfig.byRisk) {
    const score = serviceConfig.byRisk[normalizedRisk];
    
    if (score === undefined) {
      console.warn(`[SCORING] Nivel de riesgo no encontrado para ${serviceKey}: ${normalizedRisk}`);
      // Fallback a 'low' si no se encuentra el riesgo
      return serviceConfig.byRisk.low || 0;
    }

    return score;
  }

  console.warn(`[SCORING] Configuración inválida para servicio: ${serviceKey}`);
  return 0;
}

/**
 * Valida si un puntaje es correcto para un servicio y riesgo dados
 * 
 * @param {number} score - Puntaje a validar
 * @param {string} serviceKey - Clave del servicio
 * @param {string} riskLevel - Nivel de riesgo
 * @returns {boolean} - true si el puntaje es correcto
 */
function validateScore(score, serviceKey, riskLevel) {
  const expectedScore = calculateScore(serviceKey, riskLevel);
  return Math.abs(score - expectedScore) < 0.01; // Tolerancia para decimales
}

/**
 * Obtiene información detallada del puntaje
 * 
 * @param {string} serviceKey - Clave del servicio
 * @param {string} riskLevel - Nivel de riesgo
 * @returns {object} - Objeto con score, dependsOnRisk, y detalles
 */
function getScoreInfo(serviceKey, riskLevel) {
  const score = calculateScore(serviceKey, riskLevel);
  const serviceConfig = SCORING_TABLE[serviceKey];

  return {
    score: score,
    dependsOnRisk: serviceConfig && serviceConfig.byRisk !== undefined,
    serviceKey: serviceKey,
    riskLevel: riskLevel,
    hasService: !!serviceConfig
  };
}

/**
 * Obtiene todos los servicios que dependen del riesgo
 * 
 * @returns {array} - Array de service keys que dependen del riesgo
 */
function getRiskDependentServices() {
  return Object.keys(SCORING_TABLE).filter(key => 
    SCORING_TABLE[key].byRisk !== undefined
  );
}

module.exports = {
  calculateScore,
  validateScore,
  getScoreInfo,
  getRiskDependentServices,
  SCORING_TABLE
};
