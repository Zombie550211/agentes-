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
    'TEAM RANDAL MARTINEZ': {
      name: 'TEAM RANDAL MARTINEZ',
      supervisor: 'randal.martinez',
      supervisorName: 'Randal Martínez',
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
    getTeamStats
  };

  console.log('[TEAMS] Sistema inicializado correctamente');
  console.log('[TEAMS] Equipos disponibles:', Object.keys(TEAMS).length);
})();
