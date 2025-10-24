/**
 * SISTEMA DE PUNTACIÓN AUTOMÁTICA
 * 
 * Este módulo calcula automáticamente el puntaje de una venta
 * basándose en el servicio seleccionado y el nivel de riesgo.
 * 
 * IMPORTANTE: Esta tabla debe mantenerse actualizada con los puntajes reales.
 * Cualquier cambio en los puntajes debe reflejarse aquí.
 */

(function(window) {
  'use strict';

  /**
   * Tabla de puntajes por servicio
   * 
   * Estructura:
   * {
   *   'service-key': {
   *     base: número,           // Puntaje base (si no depende de riesgo)
   *     byRisk: {              // Puntajes por nivel de riesgo (si aplica)
   *       low: número,
   *       medium: número,
   *       high: número,
   *       na: número
   *     }
   *   }
   * }
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
      base: 0.35  // Mismo puntaje para todos los riesgos
    },

    // ========== AT&T INTERNET ==========
    'att-18-25-mb': {
      base: 0.25
    },
    'att-50-100-mb': {
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
      base: 0.75
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
      base: 1.0  // EARTHLINK 300 MB y 100 MB
    },

    // ========== ZIPLY FIBER ==========
    'internet-ziply-fiber': {
      base: 0.35  // Puede variar según velocidad, pero por defecto 0.35
    },

    // ========== WINDSTREAM ==========
    'internet-windstream': {
      base: 1.25
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
    'internet-consolidate': {
      base: 1.0
    },
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
   * @param {string} serviceKey - Clave del servicio (value del select)
   * @param {string} riskLevel - Nivel de riesgo: 'low', 'medium', 'high', 'na'
   * @returns {number} - Puntaje calculado
   */
  function calculateScore(serviceKey, riskLevel) {
    // Validar parámetros
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
   * Obtiene todos los servicios que dependen del riesgo
   * 
   * @returns {array} - Array de service keys que dependen del riesgo
   */
  function getRiskDependentServices() {
    return Object.keys(SCORING_TABLE).filter(key => 
      SCORING_TABLE[key].byRisk !== undefined
    );
  }

  // Exponer API pública
  window.ScoringSystem = {
    calculateScore: calculateScore,
    getScoreInfo: getScoreInfo,
    validateScore: validateScore,
    getRiskDependentServices: getRiskDependentServices,
    SCORING_TABLE: SCORING_TABLE // Para debugging/inspección
  };

  console.log('[SCORING] Sistema de puntación cargado correctamente');

})(window);
