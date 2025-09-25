(function(){
  // Normalizador seguro de nombres (quita acentos, espacios extra y pasa a lower)
  const norm = (s) => {
    try {
      return String(s || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}+/gu, '')
        .trim()
        .toLowerCase()
        // eliminar signos de puntuación y separadores no alfanuméricos (conservar espacios)
        .replace(/[^a-z0-9 ]+/g, '')
        .replace(/\s+/g, ' ');
    } catch { return ''; }
  };

  // Alias conocidos para canonización (variantes históricas -> canónico actual)
  const ALIASES = {
    'eduardor': 'eduardo rivas'
  };

  // Overrides de nombres para visualización en UI
  const DISPLAY_NAME_OVERRIDES = {
    // Compatibilidad con nombre previo
    'eduardor': 'Eduardo R.',
    // Nombre nuevo solicitado: Eduardo Rivas
    'eduardo rivas': 'Eduardo Rivas'
  };

  // Definición inicial de equipos (seed). Expandir aquí según crezcan los equipos.
  // Nota: guardar nombres en formato canónico: todo minúsculas, sin acentos
  const TEAMS = {
    'team irania': {
      displayName: 'TEAM IRANIA',
      supervisor: 'irania serrano',
      agents: [
        'josue renderos',
        'tatiana ayala',
        'giselle diaz',
        'miguel nunez',
        'roxana martinez',
        'irania serrano'
      ]
    },
    // TEAM BRYAN PLEITEZ
    'team bryan pleitez': {
      displayName: 'TEAM BRYAN PLEITEZ',
      supervisor: 'bryan pleitez',
      agents: [
        'abigail galdamez',
        'alexander rivera',
        'diego mejia',
        'evelin garcia',
        'fabricio panameno',
        'luis chavarria',
        'steven varela'
      ]
    },
    // TEAM MARISOL BELTRAN
    'team marisol beltran': {
      displayName: 'TEAM MARISOL BELTRAN',
      supervisor: 'marisol beltran',
      agents: [
        'fernanda castillo',
        'jonathan morales',
        'katerine gomez',
        'kimberly iglesias',
        'stefani martinez',
        // Agente actualizado: Eduardo Rivas
        'eduardo rivas'
      ]
    },
    // TEAM ROBERTO VELASQUEZ
    'team roberto velasquez': {
      displayName: 'TEAM ROBERTO VELASQUEZ',
      supervisor: 'roberto velasquez',
      agents: [
        'cindy flores',
        'daniela bonilla',
        'francisco aguilar',
        'levy ceren',
        'lisbeth cortez',
        'lucia ferman',
        'nelson ceren'
      ]
    },
    // TEAM RANDAL MARTINEZ
    'team randal martinez': {
      displayName: 'TEAM RANDAL MARTINEZ',
      supervisor: 'randal martinez',
      agents: [
        'anderson guzman',
        'carlos grande',
        'guadalupe santana',
        'julio chavez',
        'priscila hernandez',
        'riquelmi torres'
      ]
    },
    // EQUIPO LINEAS UNIFICADO
    'team lineas': {
      displayName: 'TEAM LINEAS',
      // Mantenemos ambos supervisores
      supervisor: 'jonathan figueroa',
      // Segundo supervisor se manejará internamente
      additionalSupervisors: ['luis gutierrez'],
      // Lista completa de agentes
      agents: [
        'lineas-carlos',
        'lineas-cristian r',
        'lineas-edward',
        'lineas-jocelyn',
        'lineas-oscar r',
        'lineas-daniel',
        'lineas-karla',
        'lineas-sandy',
        'lineas-angie',
        'luis gutierrez'  // Añadido como agente también para mantener la jerarquía
      ]
    }
  };

  // Índices derivados para búsquedas rápidas
  const agentToTeam = new Map();
  const supervisorToTeam = new Map();
  const canonicalNames = new Set();

  const registerTeam = (teamKey, def) => {
    const key = norm(teamKey);
    if (!key || !def) return;
    const sup = norm(def.supervisor);
    const agents = (def.agents || []).map(norm).filter(Boolean);
    TEAMS[key] = {
      displayName: def.displayName || teamKey,
      supervisor: sup,
      agents
    };
  };

  // Construir índices
  Object.entries(TEAMS).forEach(([k, def]) => {
    const key = norm(k);
    const sup = norm(def.supervisor);
    supervisorToTeam.set(sup, key);
    (def.agents || []).forEach(a => {
      const ca = norm(a);
      if (ca) {
        agentToTeam.set(ca, key);
        canonicalNames.add(ca);
      }
    });
    if (sup) canonicalNames.add(sup);
    if (def.additionalSupervisors) {
      def.additionalSupervisors.forEach(sup => {
        const supNorm = norm(sup);
        canonicalNames.add(supNorm);
      });
    }
  });

  // Canoniza un nombre a uno de los canónicos conocidos (por tokens incluidos)
  const canonicalFromName = (name) => {
    const n = norm(name);
    if (!n) return '';
    if (ALIASES[n]) return ALIASES[n];
    const nCollapsed = n.replace(/\s+/g, '');
    if (canonicalNames.has(n)) return n;
    // Igualdad por forma "colapsada" (sin espacios)
    for (const c of canonicalNames) {
      const cCollapsed = c.replace(/\s+/g, '');
      if (nCollapsed === cCollapsed) return c;
    }
    // Inclusión por tokens (todas las palabras del canónico presentes en n)
    for (const c of canonicalNames) {
      const toks = c.split(' ');
      if (toks.every(t => n.includes(t))) return c;
    }
    // Inclusión por forma colapsada (p.ej. "eduardor" dentro de "eduardor")
    for (const c of canonicalNames) {
      const cCollapsed = c.replace(/\s+/g, '');
      if (nCollapsed.includes(cCollapsed)) return c;
    }
    return '';
  };

  const getAllTeams = () => Object.keys(TEAMS);
  const getTeamDef = (teamKey) => TEAMS[norm(teamKey)] || null;
  const getTeamByAgent = (agentName) => agentToTeam.get(canonicalFromName(agentName)) || '';
  const getTeamBySupervisor = (supName) => supervisorToTeam.get(canonicalFromName(supName)) || '';
  const isSupervisor = (name) => {
    const normName = canonicalFromName(name);
    // Verificar si es supervisor principal
    if (supervisorToTeam.get(normName)) return true;
    
    // Verificar si es supervisor adicional en algún equipo
    for (const team of Object.values(TEAMS)) {
      if (team.additionalSupervisors && 
          team.additionalSupervisors.some(sup => canonicalFromName(sup) === normName)) {
        return true;
      }
    }
    return false;
  };
  const getAgentsByTeam = (teamKey) => (getTeamDef(teamKey)?.agents || []).slice();
  const getAgentsBySupervisor = (supName) => {
    const team = getTeamBySupervisor(supName);
    return team ? getAgentsByTeam(team) : [];
  };
  const getSupervisorByAgent = (agentName) => {
    const normAgent = canonicalFromName(agentName);
    const teamKey = getTeamByAgent(normAgent);
    const team = getTeamDef(teamKey);
    
    if (!team) return '';
    
    // Si el agente es un supervisor adicional, devolverlo a sí mismo
    if (team.additionalSupervisors && 
        team.additionalSupervisors.some(sup => canonicalFromName(sup) === normAgent)) {
      return normAgent;
    }
    
    // Si no, devolver el supervisor principal del equipo
    return team.supervisor || '';
  };

  // Convierte a Title Case simple
  const toTitle = (s) => String(s || '')
    .split(' ')
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : '')
    .join(' ');

  // Obtiene nombre para mostrar en UI con overrides
  const getDisplayName = (name) => {
    const c = canonicalFromName(name);
    if (!c) return toTitle(name || '');
    if (DISPLAY_NAME_OVERRIDES[c]) return DISPLAY_NAME_OVERRIDES[c];
    return toTitle(c);
  };

  // Lista de agentes de un team con nombres listos para UI
  const getAgentsDisplayByTeam = (teamKey) => {
    const def = getTeamDef(teamKey);
    const list = (def?.agents || []);
    return list.map(a => getDisplayName(a));
  };

  // Deducción de team por usuario actual (si hay objeto usuario)
  const getTeamForUser = (user) => {
    try {
      const name = user?.name || user?.nombre || user?.username || user?.email || '';
      const cn = canonicalFromName(name);
      // Si es supervisor
      const tSup = getTeamBySupervisor(cn);
      if (tSup) return tSup;
      // Si es agente
      const tAg = getTeamByAgent(cn);
      if (tAg) return tAg;
      return '';
    } catch { return ''; }
  };

  // Exponer API pública en window
  window.Teams = {
    norm,
    TEAMS, // referencia (no congelada) por si se quiere extender dinámicamente
    registerTeam,
    canonicalFromName,
    getAllTeams,
    getTeamDef,
    getTeamByAgent,
    getTeamBySupervisor,
    isSupervisor,
    getAgentsByTeam,
    getAgentsBySupervisor,
    getSupervisorByAgent,
    getTeamForUser,
    getDisplayName,
    getAgentsDisplayByTeam
  };
})();
