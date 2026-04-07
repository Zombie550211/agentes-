// Server-side teams utility (Node.js safe)
// Minimal canonical teams data and helpers for server endpoints
const TEAMS = {
  'TEAM IRANIA': { name: 'TEAM IRANIA', supervisor: 'irania.serrano', supervisorName: 'Irania Serrano' },
  'TEAM BRYAN PLEITEZ': { name: 'TEAM BRYAN PLEITEZ', supervisor: 'bryan.pleitez', supervisorName: 'Bryan Pleitez' },
  'TEAM MARISOL BELTRAN': { name: 'TEAM MARISOL BELTRAN', supervisor: 'marisol.beltran', supervisorName: 'Marisol Beltrán' },
  'TEAM ROBERTO VELASQUEZ': { name: 'TEAM ROBERTO VELASQUEZ', supervisor: 'roberto.velasquez', supervisorName: 'Roberto Velásquez' },
  'TEAM JOHANA': { name: 'TEAM JOHANA', supervisor: 'johana.supervisor', supervisorName: 'Guadalupe Santana' },
  'TEAM LINEAS': { name: 'TEAM LÍNEAS', supervisor: 'jonathan.figueroa', supervisorName: 'Jonathan Figueroa', agents: ['VICTOR HURTADO','EDWARD RAMIREZ','CRISTIAN RIVERA','ANDREA ARDON'] },
  'Backoffice': { name: 'Backoffice', supervisor: null, supervisorName: 'Sin supervisor específico' },
  'Administración': { name: 'Administración', supervisor: null, supervisorName: 'Sin supervisor específico' }
};

function getTeamsForSelect() {
  return Object.keys(TEAMS).map(key => ({ value: key, label: TEAMS[key].name, supervisor: TEAMS[key].supervisor || null, supervisorName: TEAMS[key].supervisorName || null }));
}

function isSupervisor(username) {
  if (!username) return false;
  const u = String(username).toLowerCase();
  return Object.values(TEAMS).some(t => (t.supervisor||'').toLowerCase() === u);
}

function getAgentsByTeam(teamName) {
  const t = TEAMS[teamName];
  if (!t) return [];
  const agents = Array.isArray(t.agents) ? t.agents.slice() : [];
  if (t.supervisor) agents.push(t.supervisor);
  return agents.filter(Boolean);
}

module.exports = { getTeamsForSelect, isSupervisor, getAgentsByTeam, TEAMS };
