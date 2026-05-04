// Server-side teams utility (Node.js safe)
// Minimal canonical teams data and helpers for server endpoints
const TEAMS = {
  // ── Equipo Jonathan Figueroa ──────────────────────────────
  'TEAM LINEAS': {
    name: 'TEAM LÍNEAS',
    supervisor: 'jonathan.figueroa',
    supervisorKey: 'JONATHAN F',
    supervisorName: 'Jonathan Figueroa',
    agents: ['VICTOR HURTADO','EDWARD RAMIREZ','CRISTIAN RIVERA','ANDREA ARDON','OSCAR RIVERA','MELANIE HURTADO','DENNIS VASQUEZ']
  },
  // ── Equipo Luis G ─────────────────────────────────────────
  'TEAM LUIS G': {
    name: 'TEAM LUIS G',
    supervisor: 'luis.g',
    supervisorKey: 'LUIS G',
    supervisorName: 'Luis G',
    agents: ['DANIEL DEL CID','FERNANDO BELTRAN','KARLA RODRIGUEZ','JOCELYN REYES','JONATHAN GARCIA','NANCY LOPEZ','TATIANA GIRON','CESAR CLAROS','KARLA PONCE','MANUEL FLORES']
  },
  // ── Equipo Irania Serrano ─────────────────────────────────
  'TEAM IRANIA S': {
    name: 'TEAM IRANIA S',
    supervisor: 'irania.serrano',
    supervisorKey: 'IRANIA S',
    supervisorName: 'Irania Serrano',
    agents: ['JOSUE RENDEROS','TATIANA AYALA','GISELLE DIAZ','MIGUEL NUNEZ','ROXANA MARTINEZ']
  },
  // ── Equipo Bryan Pleitez ──────────────────────────────────
  'TEAM BRYAN P': {
    name: 'TEAM BRYAN P',
    supervisor: 'bryan.pleitez',
    supervisorKey: 'BRYAN P',
    supervisorName: 'Bryan Pleitez',
    agents: ['ABIGAIL GALDAMEZ','ALEXANDER RIVERA','DIEGO MEJIA','EVELIN GARCIA','FABRICIO PANAMENO','LUIS CHAVARRIA','STEVEN VARELA']
  },
  // ── Equipo Roberto Velasquez ──────────────────────────────
  'TEAM ROBERTO V': {
    name: 'TEAM ROBERTO V',
    supervisor: 'roberto.velasquez',
    supervisorKey: 'ROBERTO V',
    supervisorName: 'Roberto Velasquez',
    agents: ['CINDY FLORES','DANIELA BONILLA','FRANCISCO AGUILAR','LEVY CEREN','LISBETH CORTEZ','LUCIA FERMAN','NELSON CEREN']
  },
  // ── Equipo Johana ─────────────────────────────────────────
  'TEAM JOHANA': {
    name: 'TEAM JOHANA',
    supervisor: 'johana',
    supervisorKey: 'JOHANA',
    supervisorName: 'Johana',
    agents: ['ANDERSON GUZMAN','CARLOS GRANDE','GUADALUPE SANTANA','JULIO CHAVEZ','PRISCILA HERNANDEZ','RIQUELMI TORRES']
  },
  // ── Sin supervisor ────────────────────────────────────────
  'Backoffice':    { name: 'Backoffice',    supervisor: null, supervisorKey: null, supervisorName: null },
  'Administración':{ name: 'Administración',supervisor: null, supervisorKey: null, supervisorName: null }
};

// Lista de supervisores activos (todos los conocidos del sistema)
const SUPERVISORS = [
  { key: 'JONATHAN F',     name: 'Jonathan Figueroa',  username: 'jonathan.figueroa' },
  { key: 'LUIS G',         name: 'Luis G',             username: 'luis.g' },
  { key: 'IRANIA S',       name: 'Irania Serrano',     username: 'irania.serrano' },
  { key: 'BRYAN P',        name: 'Bryan Pleitez',      username: 'bryan.pleitez' },
  { key: 'ROBERTO V',      name: 'Roberto Velasquez',  username: 'roberto.velasquez' },
  { key: 'JOHANA',         name: 'Johana',             username: 'johana' }
];

function getTeamsForSelect() {
  return Object.keys(TEAMS).map(key => ({
    value: key,
    label: TEAMS[key].name,
    supervisor: TEAMS[key].supervisor || null,
    supervisorKey: TEAMS[key].supervisorKey || null,
    supervisorName: TEAMS[key].supervisorName || null
  }));
}

function getSupervisors() {
  return SUPERVISORS;
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

module.exports = { getTeamsForSelect, getSupervisors, isSupervisor, getAgentsByTeam, TEAMS, SUPERVISORS };
