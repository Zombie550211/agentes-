/**
 * Definición de equipos, supervisores y agentes
 * Sistema de gestión de teams del CRM
 */

(function() {
  console.log('[TEAMS] Inicializando sistema de equipos...');

  // Definición de equipos con sus supervisores
  const TEAMS = {
    'TEAM IRANIA': {
      name: 'TEAM IRANIA',
      supervisor: 'irania.serrano',
      supervisorName: 'Irania Serrano',
      color: '#667eea',
      agents: []
    },
    'TEAM BRYAN PLEITEZ': {
      name: 'TEAM BRYAN PLEITEZ',
      supervisor: 'bryan.pleitez',
      supervisorName: 'Bryan Pleitez',
      color: '#764ba2',
      agents: []
    },
    'TEAM MARISOL BELTRAN': {
      name: 'TEAM MARISOL BELTRAN',
      supervisor: 'marisol.beltran',
      supervisorName: 'Marisol Beltrán',
      color: '#f093fb',
      agents: []
    },
    'TEAM ROBERTO VELASQUEZ': {
      name: 'TEAM ROBERTO VELASQUEZ',
      supervisor: 'roberto.velasquez',
      supervisorName: 'Roberto Velásquez',
      color: '#4facfe',
      agents: []
    },
    'TEAM JOHANA': {
      name: 'TEAM JOHANA',
      supervisor: 'johana.supervisor',
      supervisorName: 'Johana',
      color: '#00f2fe',
      agents: []
    },
    'TEAM LINEAS': {
      name: 'TEAM LÍNEAS',
      supervisor: 'jonathan.figueroa',
      supervisorName: 'Jonathan Figueroa',
      color: '#43e97b',
      agents: []
    },
    'Backoffice': {
      name: 'Backoffice',
      supervisor: null,
      supervisorName: 'Sin supervisor específico',
      color: '#fa709a',
      agents: []
    },
    'Administración': {
      name: 'Administración',
      supervisor: null,
      supervisorName: 'Sin supervisor específico',
      color: '#fee140',
      agents: []
    }
  };

  // Roles del sistema
  const ROLES = {
    ADMIN: 'Administrador',
    SUPERVISOR: 'Supervisor',
    BACKOFFICE: 'Backoffice',
    AGENT: 'Agente',
    TEAM_LINEAS: 'Team Líneas'
  };

  /**
   * Obtener información de un equipo
   */
  function getTeam(teamName) {
    return TEAMS[teamName] || null;
  }

  /**
   * Obtener todos los equipos
   */
  function getAllTeams() {
    return Object.values(TEAMS);
  }

  /**
   * Obtener equipos como array para select
   */
  function getTeamsForSelect() {
    return Object.keys(TEAMS).map(key => ({
      value: key,
      label: TEAMS[key].name,
      supervisor: TEAMS[key].supervisor,
      supervisorName: TEAMS[key].supervisorName
    }));
  }

  /**
   * Obtener supervisor de un equipo
   */
  function getSupervisor(teamName) {
    const team = TEAMS[teamName];
    return team ? {
      username: team.supervisor,
      name: team.supervisorName
    } : null;
  }

  /**
   * Verificar si un usuario es supervisor
   */
  function isSupervisor(username) {
    return Object.values(TEAMS).some(team => team.supervisor === username);
  }

  /**
   * Obtener equipo de un supervisor
   */
  function getTeamBySupervisor(username) {
    const teamEntry = Object.entries(TEAMS).find(([_, team]) => team.supervisor === username);
    return teamEntry ? teamEntry[1] : null;
  }

  /**
   * Verificar si un usuario pertenece a un equipo
   */
  function isInTeam(username, teamName) {
    const team = TEAMS[teamName];
    if (!team) return false;
    
    return team.agents.includes(username) || team.supervisor === username;
  }

  /**
   * Obtener color de un equipo
   */
  function getTeamColor(teamName) {
    const team = TEAMS[teamName];
    return team ? team.color : '#94a3b8';
  }

  /**
   * Agregar agente a un equipo
   */
  function addAgentToTeam(username, teamName) {
    const team = TEAMS[teamName];
    if (team && !team.agents.includes(username)) {
      team.agents.push(username);
      console.log(`[TEAMS] Agente ${username} agregado a ${teamName}`);
      return true;
    }
    return false;
  }

  /**
   * Remover agente de un equipo
   */
  function removeAgentFromTeam(username, teamName) {
    const team = TEAMS[teamName];
    if (team) {
      const index = team.agents.indexOf(username);
      if (index > -1) {
        team.agents.splice(index, 1);
        console.log(`[TEAMS] Agente ${username} removido de ${teamName}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Obtener estadísticas de un equipo
   */
  function getTeamStats(teamName, leads) {
    const team = TEAMS[teamName];
    if (!team || !Array.isArray(leads)) return null;

    const teamLeads = leads.filter(lead => {
      const agente = lead.agenteNombre || lead.agente || lead.ownerName;
      return team.agents.includes(agente) || agente === team.supervisor;
    });

    return {
      team: teamName,
      totalLeads: teamLeads.length,
      supervisor: team.supervisorName,
      agents: team.agents.length,
      color: team.color
    };
  }

  /**
   * Obtener todos los agentes de un equipo (incluyendo supervisor)
   */
  function getAgentsByTeam(teamName) {
    const team = TEAMS[teamName];
    return team ? [...team.agents, team.supervisor].filter(Boolean) : [];
  }

  /**
   * Validar si una venta pertenece al mes actual
   */
  function isCurrentMonthSale(sale) {
    if (!sale.dia_venta) return false;
    
    const saleDate = new Date(sale.dia_venta);
    const now = new Date();
    
    return saleDate.getMonth() === now.getMonth() && 
           saleDate.getFullYear() === now.getFullYear();
  }

  /**
   * Validar y normalizar formato de fecha
   */
  function normalizeSaleDate(dateStr) {
    if (!dateStr) return null;
    
    // Intentar parsear como Date directamente
    if (typeof dateStr === 'string' && dateStr.match(/\d{4}-\d{2}-\d{2}/)) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) return date;
    }
    
    // Formato DD/MM/YYYY
    if (typeof dateStr === 'string' && dateStr.match(/\d{2}\/\d{2}\/\d{4}/)) {
      const [day, month, year] = dateStr.split('/');
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) return date;
    }
    
    // Formato MM/DD/YYYY
    if (typeof dateStr === 'string' && dateStr.match(/\d{2}\/\d{2}\/\d{4}/)) {
      const [month, day, year] = dateStr.split('/');
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) return date;
    }
    
    console.warn('Formato de fecha no reconocido:', dateStr);
    return null;
  }

  /**
   * Validar consistencia entre fechas de venta y creación
   */
  function validateSaleDates(sale) {
    if (!sale.dia_venta || !sale.createdAt) return false;
    
    const saleDate = normalizeSaleDate(sale.dia_venta);
    const createDate = new Date(sale.createdAt);
    
    // Máxima diferencia permitida: 30 días
    const diffTime = Math.abs(createDate - saleDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays <= 30;
  }

  /**
   * Limpiar datos históricos inconsistentes
   */
  function cleanHistoricalData(sales) {
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    return sales.map(sale => {
      const saleDate = normalizeSaleDate(sale.dia_venta);
      
      // Corregir mes si es histórico
      if (saleDate && (saleDate.getMonth() !== currentMonth || saleDate.getFullYear() !== currentYear)) {
        return {
          ...sale,
          dia_venta: new Date(currentYear, currentMonth, saleDate.getDate()).toISOString()
        };
      }
      return sale;
    });
  }

  // Exponer API globalmente
  window.TeamsAPI = {
    TEAMS,
    ROLES,
    getTeam,
    getAllTeams,
    getTeamsForSelect,
    getSupervisor,
    isSupervisor,
    getTeamBySupervisor,
    isInTeam,
    getTeamColor,
    addAgentToTeam,
    removeAgentFromTeam,
    getTeamStats,
    getAgentsByTeam,
    isCurrentMonthSale,
    normalizeSaleDate,
    validateSaleDates,
    cleanHistoricalData
  };

  console.log('[TEAMS] Sistema inicializado correctamente');
  console.log('[TEAMS] Equipos disponibles:', Object.keys(TEAMS).length);
})();
