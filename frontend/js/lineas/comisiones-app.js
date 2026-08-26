/* Comisiones Líneas — GENERADO, no editar a mano.
 * Fuente: CRM_PYTHON/scripts/src/comisiones.jsx
 * Regenerar: node CRM_PYTHON/scripts/build-comisiones.js
 */
const {
  useState,
  useEffect,
  useRef
} = React;

// Nombres de meses en español
const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ComisionesLineas = () => {
  const [agentsLineas, setAgentsLineas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [showAgentModal, setShowAgentModal] = useState(false);

  // Estado para el usuario actual y su rol
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState('');
  const [userSupervisor, setUserSupervisor] = useState('');
  const [isAgentView, setIsAgentView] = useState(false);
  const [ownAgentData, setOwnAgentData] = useState(null);

  // Estado para navegación mensual
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth() + 1);
  const [currentYear, setCurrentYear] = useState(now.getFullYear());

  // Ref para long press
  const longPressTimer = useRef(null);

  // Cargar información del usuario actual
  useEffect(() => {
    const loadUserInfo = () => {
      try {
        // Datos del usuario desde el objeto persistido (la auth es por cookie httpOnly;
        // el JWT ya no se expone a JS, así que no se decodifica aquí).
        const payload = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
        if (payload && (payload.role || payload.username)) {
          const role = (payload.role || '').toLowerCase();
          const name = payload.name || payload.username || '';
          const displayName = (payload.displayName || payload.name || '').toUpperCase();
          setCurrentUser(payload);
          setUserRole(role);

          // Detectar si es admin
          const isAdminUser = role === 'admin' || role === 'backoffice' || role === 'administrador';
          const isSupervisorUser = role.includes('supervisor');

          // Detectar si es supervisor de líneas y determinar su equipo
          // Usar displayName, name y username para detectar
          const userName = (payload.username || '').toUpperCase();
          const fullName = displayName || userName;
          let supervisorTeam = '';
          if (isSupervisorUser && !isAdminUser) {
            // Team del supervisor desde la página de permisos (payload.team).
            // Token = palabra distintiva (JONATHAN/LUIS/VICTOR/…). Sin hardcode.
            const _t = String(payload.team || '').toUpperCase().replace('TEAM LINEAS', '').replace('TEAM', '').trim();
            supervisorTeam = _t.split(/\s+/)[0] || '';
            setUserSupervisor(supervisorTeam);
          }

          // Detectar si es agente (no admin, no supervisor)
          if (!isAdminUser && !isSupervisorUser) {
            setIsAgentView(true);
          }
        }
      } catch (e) {
        console.error('Error cargando info de usuario:', e);
      }
    };
    loadUserInfo();
  }, []);
  useEffect(() => {
    loadAgentsLineas();
  }, [currentMonth, currentYear, currentUser]);
  const loadAgentsLineas = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/comisiones/agentes-lineas?month=${currentMonth}&year=${currentYear}`);
      if (!response.ok) throw new Error('Error cargando agentes');
      const data = await response.json();
      const agentes = data.data || [];
      const procesados = agentes.map((agent, idx) => ({
        id: agent.id || idx,
        name: agent.nombre || agent.name || `Agente ${idx + 1}`,
        sales: agent.ventas || 0,
        lineasWireless: agent.lineasWireless || 0,
        lineasSinWireless: agent.lineasSinWireless || 0,
        commission: agent.comision || 0,
        supervisor: agent.supervisor || '',
        leads: agent.leads || []
      })).sort((a, b) => b.sales - a.sales);
      setAgentsLineas(procesados);

      // Si es agente, buscar sus propios datos
      if (isAgentView && currentUser) {
        const userName = (currentUser.name || currentUser.displayName || currentUser.username || '').toUpperCase();
        const ownData = procesados.find(a => a.name.toUpperCase() === userName || a.name.toUpperCase().includes(userName.split(' ')[0]));
        if (ownData) {
          setOwnAgentData(ownData);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Navegación mensual
  const goToPrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };
  const goToNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Long press handlers - abre modal de vista de agente
  const handleMouseDown = agent => {
    longPressTimer.current = setTimeout(() => {
      setSelectedAgent(agent);
      setShowAgentModal(true);
    }, 500); // 500ms para activar
  };
  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };
  const handleTouchStart = agent => {
    longPressTimer.current = setTimeout(() => {
      setSelectedAgent(agent);
      setShowAgentModal(true);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  // Componente Modal de Vista de Agente (estilo Comisiones.html)
  const AgentViewModal = ({
    agent,
    onClose
  }) => {
    if (!agent) return null;
    const totalLineas = agent.lineasWireless + agent.lineasSinWireless;
    const escala = totalLineas >= 31 ? 'Escala 31+' : totalLineas >= 26 ? 'Escala 26-30' : totalLineas >= 21 ? 'Escala 21-25' : totalLineas >= 17 ? 'Escala 17-20' : 'Sin escala';

    // Calcular progreso de cada escala
    const calcProgress = (min, max) => {
      if (totalLineas >= max) return 100;
      if (totalLineas < min) return 0;
      return Math.round((totalLineas - min) / (max - min) * 100);
    };

    // Escala 17-20: 17,18,19,20 = 4 valores (17 es 25%, 18 es 50%, 19 es 75%, 20 es 100%)
    const progress17_20 = totalLineas >= 20 ? 100 : totalLineas >= 17 ? Math.round((totalLineas - 16) / 4 * 100) : 0;
    // Escala 21-25: 21,22,23,24,25 = 5 valores (21 es 20%, 25 es 100%)
    const progress21_25 = totalLineas >= 25 ? 100 : totalLineas >= 21 ? Math.round((totalLineas - 20) / 5 * 100) : 0;
    // Escala 26-30: 26,27,28,29,30 = 5 valores
    const progress26_30 = totalLineas >= 30 ? 100 : totalLineas >= 26 ? Math.round((totalLineas - 25) / 5 * 100) : 0;
    // Escala 31+
    const progress31 = totalLineas >= 31 ? 100 : 0;
    const progressPercent = Math.min(totalLineas / 31 * 100, 100);
    return /*#__PURE__*/React.createElement("div", {
      className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4",
      onClick: onClose
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-gradient-to-br from-gray-50 to-gray-100 rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-t-3xl p-6 border-b flex justify-between items-start"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
      className: "text-3xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent"
    }, "¡Hola, ", agent.name, "! 👋"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 mt-1"
    }, "Aquí está tu rendimiento actual y tus ganancias"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm mt-2"
    }, MONTH_NAMES[currentMonth - 1], " ", currentYear)), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center gap-3"
    }, /*#__PURE__*/React.createElement("span", {
      className: "bg-indigo-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg"
    }, "ROL: AGENTE"), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      className: "text-gray-400 hover:text-gray-600 text-3xl font-light"
    }, "×"))), /*#__PURE__*/React.createElement("div", {
      className: "p-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-8 border-2 border-amber-400 relative overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute top-0 right-0 w-40 h-40 bg-amber-200 rounded-full opacity-20 -translate-y-1/2 translate-x-1/2"
    }), /*#__PURE__*/React.createElement("div", {
      className: "relative z-10 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 font-semibold uppercase tracking-wider text-sm mb-4"
    }, "COMISIÓN ESTIMADA"), /*#__PURE__*/React.createElement("div", {
      className: "text-5xl mb-4"
    }, "💰"), /*#__PURE__*/React.createElement("p", {
      className: "text-5xl font-black text-amber-500 mb-2"
    }, formatUsd(agent.commission)), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm"
    }, "Basado en tu fórmula de rendimiento"), /*#__PURE__*/React.createElement("div", {
      className: "mt-8"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between text-sm font-semibold mb-2"
    }, /*#__PURE__*/React.createElement("span", null, "Progreso de Meta"), /*#__PURE__*/React.createElement("span", {
      className: "text-amber-600"
    }, escala)), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-3 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: "h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500",
      style: {
        width: `${progressPercent}%`
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "mt-4 space-y-3 text-sm"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 17-20"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 17 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress17_20, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 20 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress17_20}%`
      }
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 21-25"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 21 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress21_25, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 25 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress21_25}%`
      }
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 26-30"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 26 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress26_30, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 30 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress26_30}%`
      }
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 31+"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 31 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress31, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 31 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress31}%`
      }
    }))))))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl p-6 border shadow-lg"
    }, /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-2 gap-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "border-b border-r pb-6 pr-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "📊"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "VENTAS ACTIVAS"), /*#__PURE__*/React.createElement("p", {
      className: "text-4xl font-black text-gray-900"
    }, agent.sales), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Clientes este mes")), /*#__PURE__*/React.createElement("div", {
      className: "border-b pb-6 pl-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "⭐"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "PUNTAJE ACTIVO"), /*#__PURE__*/React.createElement("p", {
      className: "text-4xl font-black text-gray-900"
    }, (totalLineas * 0.5).toFixed(2)), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Nivel: Avanzado")), /*#__PURE__*/React.createElement("div", {
      className: "border-r pt-6 pr-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "✅"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "LÍNEAS WIRELESS"), /*#__PURE__*/React.createElement("p", {
      className: "text-4xl font-black text-gray-900"
    }, agent.lineasWireless), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Líneas activas")), /*#__PURE__*/React.createElement("div", {
      className: "pt-6 pl-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "🎯"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "ESCALA"), /*#__PURE__*/React.createElement("p", {
      className: "text-2xl font-black text-gray-900"
    }, escala), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Escala actual"))))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl p-6 border shadow-lg"
    }, /*#__PURE__*/React.createElement("h3", {
      className: "text-xl font-bold text-gray-900 mb-4"
    }, "📈 Resumen de Líneas"), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-3 gap-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-blue-50 rounded-xl p-4 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-3xl font-black text-blue-600"
    }, totalLineas), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-blue-600 font-semibold"
    }, "Total Líneas")), /*#__PURE__*/React.createElement("div", {
      className: "bg-green-50 rounded-xl p-4 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-3xl font-black text-green-600"
    }, agent.lineasWireless), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-green-600 font-semibold"
    }, "Wireless")), /*#__PURE__*/React.createElement("div", {
      className: "bg-purple-50 rounded-xl p-4 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-3xl font-black text-purple-600"
    }, agent.lineasSinWireless), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-purple-600 font-semibold"
    }, "Sin Wireless")))))));
  };
  const getInitials = name => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };
  const formatUsd = amount => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Filtrar equipos según el rol del usuario
  const isAdmin = userRole === 'admin' || userRole === 'backoffice' || userRole === 'administrador';
  const isSupervisor = userRole.includes('supervisor');

  // Agrupar agentes por su team ACTUAL (lo trae el backend desde permisos).
  // Sin nombres hardcodeados: si se crea un team o se mueve un agente, sale solo.
  const TEAM_COLORS = [{
    bg: 'bg-indigo-100',
    text: 'text-indigo-600'
  }, {
    bg: 'bg-purple-100',
    text: 'text-purple-600'
  }, {
    bg: 'bg-amber-100',
    text: 'text-amber-600'
  }, {
    bg: 'bg-teal-100',
    text: 'text-teal-600'
  }, {
    bg: 'bg-rose-100',
    text: 'text-rose-600'
  }];
  const _groups = {};
  agentsLineas.forEach(a => {
    const label = a.team_label || 'Sin team';
    (_groups[label] = _groups[label] || []).push(a);
  });
  let teamsToRender = Object.keys(_groups).sort().map((label, i) => ({
    label,
    token: _groups[label][0] && _groups[label][0].team_token || '',
    color: TEAM_COLORS[i % TEAM_COLORS.length],
    agents: _groups[label]
  }));
  // Supervisores (no admin) solo ven su propio team (por token de permisos)
  if (isSupervisor && !isAdmin && userSupervisor) {
    const su = String(userSupervisor).toUpperCase();
    teamsToRender = teamsToRender.filter(t => String(t.token).toUpperCase() === su || t.label.toUpperCase().includes(su));
  }
  if (loading) {
    return /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-center min-h-screen"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-xl text-gray-600"
    }, "Cargando..."));
  }

  // Si es agente, mostrar directamente su vista de agente (sin modal, integrada)
  if (isAgentView && ownAgentData) {
    const agent = ownAgentData;
    const totalLineas = agent.lineasWireless + agent.lineasSinWireless;
    const escala = totalLineas >= 31 ? 'Escala 31+' : totalLineas >= 26 ? 'Escala 26-30' : totalLineas >= 21 ? 'Escala 21-25' : totalLineas >= 17 ? 'Escala 17-20' : 'Sin escala';
    const progress17_20 = totalLineas >= 20 ? 100 : totalLineas >= 17 ? Math.round((totalLineas - 16) / 4 * 100) : 0;
    const progress21_25 = totalLineas >= 25 ? 100 : totalLineas >= 21 ? Math.round((totalLineas - 20) / 5 * 100) : 0;
    const progress26_30 = totalLineas >= 30 ? 100 : totalLineas >= 26 ? Math.round((totalLineas - 25) / 5 * 100) : 0;
    const progress31 = totalLineas >= 31 ? 100 : 0;
    const progressPercent = Math.min(totalLineas / 31 * 100, 100);
    return /*#__PURE__*/React.createElement("div", {
      className: "max-w-4xl mx-auto"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-3xl p-6 border mb-6 shadow-lg"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between items-start"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
      className: "text-3xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent"
    }, "¡Hola, ", agent.name, "! 👋"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 mt-1"
    }, "Aquí está tu rendimiento actual y tus ganancias")), /*#__PURE__*/React.createElement("span", {
      className: "bg-indigo-600 text-white px-4 py-2 rounded-full text-sm font-bold shadow-lg"
    }, "ROL: AGENTE")), /*#__PURE__*/React.createElement("div", {
      className: "flex items-center justify-center gap-4 mt-4 bg-gray-50 rounded-xl p-4"
    }, /*#__PURE__*/React.createElement("button", {
      onClick: goToPrevMonth,
      className: "p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-6 h-6 text-gray-600",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M15 19l-7-7 7-7"
    }))), /*#__PURE__*/React.createElement("div", {
      className: "text-center min-w-[200px]"
    }, /*#__PURE__*/React.createElement("span", {
      className: "text-2xl font-bold text-gray-900"
    }, MONTH_NAMES[currentMonth - 1]), /*#__PURE__*/React.createElement("span", {
      className: "text-2xl font-bold text-gray-400 ml-2"
    }, currentYear)), /*#__PURE__*/React.createElement("button", {
      onClick: goToNextMonth,
      className: "p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
    }, /*#__PURE__*/React.createElement("svg", {
      className: "w-6 h-6 text-gray-600",
      fill: "none",
      stroke: "currentColor",
      viewBox: "0 0 24 24"
    }, /*#__PURE__*/React.createElement("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M9 5l7 7-7 7"
    }))))), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-8 border-2 border-amber-400 relative overflow-hidden shadow-lg"
    }, /*#__PURE__*/React.createElement("div", {
      className: "absolute top-0 right-0 w-40 h-40 bg-amber-200 rounded-full opacity-20 -translate-y-1/2 translate-x-1/2"
    }), /*#__PURE__*/React.createElement("div", {
      className: "relative z-10 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 font-semibold uppercase tracking-wider text-sm mb-4"
    }, "COMISIÓN ESTIMADA"), /*#__PURE__*/React.createElement("div", {
      className: "text-5xl mb-4"
    }, "💰"), /*#__PURE__*/React.createElement("p", {
      className: "text-5xl font-black text-amber-500 mb-2"
    }, formatUsd(agent.commission)), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm"
    }, "Basado en tu fórmula de rendimiento"), /*#__PURE__*/React.createElement("div", {
      className: "mt-8"
    }, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between text-sm font-semibold mb-2"
    }, /*#__PURE__*/React.createElement("span", null, "Progreso de Meta"), /*#__PURE__*/React.createElement("span", {
      className: "text-amber-600"
    }, escala)), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-3 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: "h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500",
      style: {
        width: `${progressPercent}%`
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "mt-4 space-y-3 text-sm"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 17-20"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 17 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress17_20, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 20 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress17_20}%`
      }
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 21-25"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 21 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress21_25, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 25 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress21_25}%`
      }
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 26-30"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 26 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress26_30, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 30 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress26_30}%`
      }
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "flex justify-between mb-1"
    }, /*#__PURE__*/React.createElement("span", null, "Escala 31+"), /*#__PURE__*/React.createElement("span", {
      className: totalLineas >= 31 ? 'text-green-600 font-bold' : 'text-gray-400'
    }, progress31, "%")), /*#__PURE__*/React.createElement("div", {
      className: "w-full h-2 bg-gray-200 rounded-full overflow-hidden"
    }, /*#__PURE__*/React.createElement("div", {
      className: `h-full rounded-full transition-all ${totalLineas >= 31 ? 'bg-green-500' : 'bg-amber-400'}`,
      style: {
        width: `${progress31}%`
      }
    }))))))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl p-6 border shadow-lg"
    }, /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-2 gap-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "border-b border-r pb-6 pr-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "📊"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "VENTAS ACTIVAS"), /*#__PURE__*/React.createElement("p", {
      className: "text-4xl font-black text-gray-900"
    }, agent.sales), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Clientes este mes")), /*#__PURE__*/React.createElement("div", {
      className: "border-b pb-6 pl-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "⭐"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "PUNTAJE ACTIVO"), /*#__PURE__*/React.createElement("p", {
      className: "text-4xl font-black text-gray-900"
    }, (totalLineas * 0.5).toFixed(2)), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Nivel: Avanzado")), /*#__PURE__*/React.createElement("div", {
      className: "border-r pt-6 pr-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "✅"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "LÍNEAS WIRELESS"), /*#__PURE__*/React.createElement("p", {
      className: "text-4xl font-black text-gray-900"
    }, agent.lineasWireless), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Líneas activas")), /*#__PURE__*/React.createElement("div", {
      className: "pt-6 pl-6"
    }, /*#__PURE__*/React.createElement("div", {
      className: "text-3xl mb-2"
    }, "🎯"), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-500 text-sm font-semibold uppercase"
    }, "ESCALA"), /*#__PURE__*/React.createElement("p", {
      className: "text-2xl font-black text-gray-900"
    }, escala), /*#__PURE__*/React.createElement("p", {
      className: "text-gray-400 text-sm"
    }, "Escala actual"))))), /*#__PURE__*/React.createElement("div", {
      className: "bg-white rounded-2xl p-6 border shadow-lg"
    }, /*#__PURE__*/React.createElement("h3", {
      className: "text-xl font-bold text-gray-900 mb-4"
    }, "📈 Resumen de Líneas"), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-cols-3 gap-4"
    }, /*#__PURE__*/React.createElement("div", {
      className: "bg-blue-50 rounded-xl p-4 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-3xl font-black text-blue-600"
    }, totalLineas), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-blue-600 font-semibold"
    }, "Total Líneas")), /*#__PURE__*/React.createElement("div", {
      className: "bg-green-50 rounded-xl p-4 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-3xl font-black text-green-600"
    }, agent.lineasWireless), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-green-600 font-semibold"
    }, "Wireless")), /*#__PURE__*/React.createElement("div", {
      className: "bg-purple-50 rounded-xl p-4 text-center"
    }, /*#__PURE__*/React.createElement("p", {
      className: "text-3xl font-black text-purple-600"
    }, agent.lineasSinWireless), /*#__PURE__*/React.createElement("p", {
      className: "text-sm text-purple-600 font-semibold"
    }, "Sin Wireless")))));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "max-w-7xl mx-auto"
  }, showAgentModal && /*#__PURE__*/React.createElement(AgentViewModal, {
    agent: selectedAgent,
    onClose: () => setShowAgentModal(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: "mb-8"
  }, /*#__PURE__*/React.createElement("h1", {
    className: "text-4xl font-bold text-gray-900 mb-2"
  }, "Comisiones - Team Líneas"), /*#__PURE__*/React.createElement("p", {
    className: "text-gray-600"
  }, isSupervisor && userSupervisor ? `Equipo de ${userSupervisor}` : `Agentes de Team Líneas (${agentsLineas.length})`), /*#__PURE__*/React.createElement("div", {
    className: "flex items-center justify-center gap-4 mt-4 bg-white rounded-xl p-4 border border-gray-200 shadow-sm"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: goToPrevMonth,
    className: "p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6 text-gray-600",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M15 19l-7-7 7-7"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "text-center min-w-[200px]"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-2xl font-bold text-gray-900"
  }, MONTH_NAMES[currentMonth - 1]), /*#__PURE__*/React.createElement("span", {
    className: "text-2xl font-bold text-gray-400 ml-2"
  }, currentYear)), /*#__PURE__*/React.createElement("button", {
    onClick: goToNextMonth,
    className: "p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "w-6 h-6 text-gray-600",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24"
  }, /*#__PURE__*/React.createElement("path", {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    d: "M9 5l7 7-7 7"
  })))), /*#__PURE__*/React.createElement("p", {
    className: "text-center text-sm text-gray-500 mt-2"
  }, "💡 Mantén presionada una tarjeta para ver la vista completa del agente")), agentsLineas.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "bg-white rounded-xl border border-gray-200 p-12 text-center"
  }, /*#__PURE__*/React.createElement("p", {
    className: "text-gray-600 text-lg"
  }, "No hay agentes en Team Líneas")) : /*#__PURE__*/React.createElement("div", {
    className: "space-y-8"
  }, teamsToRender.map(team => /*#__PURE__*/React.createElement("div", {
    key: team.label
  }, /*#__PURE__*/React.createElement("h2", {
    className: "text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2"
  }, /*#__PURE__*/React.createElement("span", null, "📞"), " ", team.label.toUpperCase()), /*#__PURE__*/React.createElement("div", {
    className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
  }, team.agents.map(agent => /*#__PURE__*/React.createElement("div", {
    key: agent.id,
    className: "bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow cursor-pointer select-none",
    onMouseDown: () => handleMouseDown(agent),
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
    onTouchStart: () => handleTouchStart(agent),
    onTouchEnd: handleTouchEnd
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-start justify-between mb-4"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex items-center gap-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: `w-12 h-12 ${team.color.bg} rounded-full flex items-center justify-center`
  }, /*#__PURE__*/React.createElement("span", {
    className: `font-bold ${team.color.text}`
  }, getInitials(agent.name))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "font-semibold text-gray-900"
  }, agent.name), /*#__PURE__*/React.createElement("p", {
    className: "text-sm text-gray-500"
  }, agent.sales, " ventas")))), /*#__PURE__*/React.createElement("div", {
    className: "space-y-3"
  }, /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between text-sm"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-gray-600"
  }, "Ventas"), /*#__PURE__*/React.createElement("span", {
    className: "font-semibold text-gray-900"
  }, agent.sales)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between text-sm"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-gray-600"
  }, "Líneas Wireless"), /*#__PURE__*/React.createElement("span", {
    className: "font-semibold text-gray-900"
  }, agent.lineasWireless)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between text-sm"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-gray-600"
  }, "Líneas sin Wireless"), /*#__PURE__*/React.createElement("span", {
    className: "font-semibold text-gray-900"
  }, agent.lineasSinWireless)), /*#__PURE__*/React.createElement("div", {
    className: "flex justify-between text-sm pt-2 border-t"
  }, /*#__PURE__*/React.createElement("span", {
    className: "text-gray-600 font-semibold"
  }, "Comisión"), /*#__PURE__*/React.createElement("span", {
    className: "font-bold text-green-600"
  }, formatUsd(agent.commission)))))))))));
};
ReactDOM.render(/*#__PURE__*/React.createElement(ComisionesLineas, null), document.getElementById('root'));