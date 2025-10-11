/**
 * Sistema de Rankings
 * Gestión de rankings y clasificaciones
 */

(function() {
  console.log('[RANKING] Inicializando sistema de rankings...');

  /**
   * Calcular ranking de agentes
   */
  function calculateAgentRanking(leads) {
    if (!Array.isArray(leads)) return [];
    
    const agentStats = {};
    
    leads.forEach(lead => {
      const agente = lead.agenteNombre || lead.agente || lead.ownerName || 'Sin asignar';
      
      if (!agentStats[agente]) {
        agentStats[agente] = {
          nombre: agente,
          ventas: 0,
          puntos: 0,
          cancelados: 0
        };
      }
      
      agentStats[agente].ventas++;
      agentStats[agente].puntos += lead.puntaje || 0;
      
      const status = (lead.status || '').toLowerCase();
      if (status === 'cancelado' || status === 'cancelled') {
        agentStats[agente].cancelados++;
      }
    });
    
    // Convertir a array y ordenar
    const ranking = Object.values(agentStats)
      .sort((a, b) => b.puntos - a.puntos)
      .map((agent, index) => ({
        ...agent,
        posicion: index + 1
      }));
    
    return ranking;
  }

  /**
   * Calcular ranking de equipos
   */
  function calculateTeamRanking(leads) {
    if (!Array.isArray(leads) || !window.TeamsAPI) return [];
    
    const teamStats = {};
    
    leads.forEach(lead => {
      const team = lead.team || lead.equipo || 'Sin equipo';
      
      if (!teamStats[team]) {
        teamStats[team] = {
          nombre: team,
          ventas: 0,
          puntos: 0,
          agentes: new Set()
        };
      }
      
      teamStats[team].ventas++;
      teamStats[team].puntos += lead.puntaje || 0;
      
      const agente = lead.agenteNombre || lead.agente;
      if (agente) {
        teamStats[team].agentes.add(agente);
      }
    });
    
    // Convertir a array y ordenar
    const ranking = Object.values(teamStats)
      .map(team => ({
        ...team,
        agentes: team.agentes.size,
        promedioPorAgente: team.agentes.size > 0 ? Math.round(team.ventas / team.agentes.size) : 0
      }))
      .sort((a, b) => b.puntos - a.puntos)
      .map((team, index) => ({
        ...team,
        posicion: index + 1
      }));
    
    return ranking;
  }

  /**
   * Obtener top performers
   */
  function getTopPerformers(leads, limit = 5) {
    const ranking = calculateAgentRanking(leads);
    return ranking.slice(0, limit);
  }

  /**
   * Obtener medalla según posición
   */
  function getMedal(position) {
    switch(position) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${position}`;
    }
  }

  /**
   * Renderizar ranking en tabla
   */
  function renderRankingTable(ranking, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    let html = '<table class="ranking-table">';
    html += '<thead><tr><th>Posición</th><th>Nombre</th><th>Ventas</th><th>Puntos</th></tr></thead>';
    html += '<tbody>';
    
    ranking.forEach(item => {
      html += `<tr>
        <td>${getMedal(item.posicion)}</td>
        <td>${item.nombre}</td>
        <td>${item.ventas}</td>
        <td>${item.puntos}</td>
      </tr>`;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // Exponer API globalmente
  window.Ranking = {
    calculateAgentRanking,
    calculateTeamRanking,
    getTopPerformers,
    getMedal,
    renderRankingTable
  };

  console.log('[RANKING] Sistema inicializado correctamente');
})();
