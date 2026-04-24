(function () {
  'use strict';

  let __allLeadsData  = [];
  let __filteredLeads = [];
  let currentPage     = 1;
  let pageSize        = 100;
  let activeStatusTab = 'all';
  // ── FIX: onlyTwoMonths arranca en FALSE para supervisores ──
  let onlyTwoMonths   = false;
  let __socket        = null;

  const NOTES_STORE   = {};
  let noteAttachments = { images: [], audio: null };
  const NOTE_MAX_CHARS = 500;
  const NOTE_TYPE_META = {
    general:     { emoji:'💬', label:'General',     cls:'general'     },
    llamada:     { emoji:'📞', label:'Llamada',     cls:'llamada'     },
    visita:      { emoji:'🏠', label:'Visita',      cls:'visita'      },
    alerta:      { emoji:'⚠️',  label:'Alerta',      cls:'alerta'      },
    seguimiento: { emoji:'📌', label:'Seguimiento', cls:'seguimiento' },
  };

  /* ── AUTH ── */
  const AUTH = (function () {
    const TOKEN_KEY='token', USER_KEY='crm_user', LS_STAMP_KEY='crm_token_ts', SESSION_MAX_MS=12*60*60*1000;
    function getToken() { return localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||null; }
    function getTimestamp() { return parseInt(localStorage.getItem(LS_STAMP_KEY)||sessionStorage.getItem(LS_STAMP_KEY)||'0',10); }
    function isExpiredClientSide() { const ts=getTimestamp(); if(!ts) return false; return (Date.now()-ts)>SESSION_MAX_MS; }
    function clearSession() { [TOKEN_KEY,USER_KEY,LS_STAMP_KEY].forEach(function(k){ localStorage.removeItem(k); sessionStorage.removeItem(k); }); }
    function redirectToLogin(reason) { clearSession(); sessionStorage.setItem('crm_redirect_after_login',window.location.pathname+window.location.search); window.location.replace('/login.html'+(reason?'?reason='+encodeURIComponent(reason):'')); }
    function check() { const token=getToken(); if(!token){redirectToLogin('no_session');return null;} if(isExpiredClientSide()){redirectToLogin('expired');return null;} return token; }
    function authHeaders(extra) { const token=check(); if(!token) return null; return Object.assign({'Authorization':'Bearer '+token,'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},extra||{}); }
    async function secureFetch(url,options) {
      const token=check(); if(!token) return null;
      const headers=authHeaders((options||{}).headers); if(!headers) return null;
      try {
        const res=await fetch(url,Object.assign({},options,{headers}));
        if(res.status===401){clearSession();showToast('Tu sesión ha expirado. Redirigiendo…','error');setTimeout(function(){redirectToLogin('token_rejected');},1200);return null;}
        if(res.status===403){showToast('No tienes permisos para realizar esta acción','error');return null;}
        return res;
      } catch(err){console.error('[AUTH] Error de red:',err);showToast('Error de conexión. Verifica tu red.','error');return null;}
    }
    async function verifySession() {
      const token=getToken(); if(!token) return false;
      try{const res=await fetch('/api/auth/verify',{headers:{'Authorization':'Bearer '+token,'X-Requested-With':'XMLHttpRequest'}});if(res.status===404)return !!token;return res.ok;}catch(_){return !!token;}
    }
    return {getToken,check,authHeaders,secureFetch,clearSession,redirectToLogin,verifySession};
  })();

  /* ── HELPERS ── */
  function escHTML(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function showToast(msg,type){const t=document.createElement('div');t.textContent=msg;t.setAttribute('role','alert');t.setAttribute('aria-live','assertive');Object.assign(t.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',background:type==='ok'?'var(--go)':type==='error'?'var(--stop)':'var(--warn)',color:'#fff',padding:'10px 22px',borderRadius:'var(--rf)',fontSize:'.8rem',fontWeight:'700',zIndex:'9999',boxShadow:'0 4px 16px rgba(0,0,0,.15)'});document.body.appendChild(t);setTimeout(function(){t.remove();},3000);}
  function getVal(id){return(document.getElementById(id)?document.getElementById(id).value:'').trim();}
  function setVal(id,v){const el=document.getElementById(id);if(el)el.value=(v==null)?'':String(v);}
  function setSelectSafe(id,value){const el=document.getElementById(id);if(!el)return;const v=(value==null)?'':String(value).trim();if(!v){el.value='';return;}const opts=Array.from(el.options);if(opts.some(function(o){return o.value===v;})){el.value=v;return;}const vL=v.toLowerCase();const hit=opts.find(function(o){return o.value.toLowerCase()===vL;});if(hit){el.value=hit.value;return;}const opt=document.createElement('option');opt.value=v;opt.textContent=v;el.appendChild(opt);el.value=v;}
  function fmtDate(rawDate){if(!rawDate)return'—';try{const str=String(rawDate).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(str)){const parts=str.split('-');const dt=new Date(parseInt(parts[0],10),parseInt(parts[1],10)-1,parseInt(parts[2],10));return dt.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});}return new Date(rawDate).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});}catch(_){return String(rawDate);}}
  function cell(txt){return'<td>'+(txt||'—')+'</td>';}
  function getUserData(){try{return JSON.parse(localStorage.getItem('user')||sessionStorage.getItem('user')||'{}');}catch(_){return{};}}
  const SUPERVISOR_DISPLAY_MAP = {
    'irania serrano':    'IRANIA',
    'roberto velasquez': 'ROBERTO',
    'marisol beltran':   'MARISOL',
    'bryan pleitez':     'PLEITEZ',
    'johana':            'JOHANA',
  };
  function fmtSupervisor(val){
    if(!val) return '—';
    const key = String(val).toLowerCase().trim();
    return SUPERVISOR_DISPLAY_MAP[key] || val;
  }

  function isAdminOrBackoffice(role){const r=String(role||'').toLowerCase();return['admin','administrador','administrator','administrativo','backoffice','back office','back_office','bo','b.o','rol_icon','rol-icon','rol_bamo'].some(function(v){return r===v||r.includes(v);});}
  function isAgent(role){const r=String(role||'').toLowerCase();return['agente','agent','agentes','vendedor','vendedores','seller'].some(function(v){return r===v||r.includes(v);});}
  function isSupervisor(role){const r=String(role||'').toLowerCase();return['supervisor','supervisores','supervisora'].some(function(v){return r===v||r.includes(v);});}

  /* ── NORMALIZATION ── */
  function formatAutopago(val){const v=String(val||'').toLowerCase().trim();if(v==='true'||v==='1'||v==='sí'||v==='si'||v==='yes')return'Sí';if(v==='false'||v==='0'||v==='no')return'No';return String(val||'');}

  function normalizeSupervisorName(name){
    const s=String(name||'').trim().toUpperCase();
    if(!s)return'';
    if(s.includes('BRYAN')||s.includes('PLEITEZ'))return'PLEITEZ';
    if(s.includes('IRANIA')||s.includes('SERRANO'))return'IRANIA';
    if(s.includes('MARISOL')||s.includes('BELTRAN'))return'MARISOL';
    if(s.includes('ROBERTO')||s.includes('VELASQUEZ'))return'ROBERTO';
    if(s.includes('JOHANA')||s.includes('GUADALUPE')||s.includes('SANTANA'))return'JOHANA';
    if(s.includes('JONATHAN')||s.includes('FIGUEROA'))return'JONATHAN';
    return s;
  }

  function normalizePersonNameFull(v){
    return String(v||'')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .replace(/\./g,' ')
      .replace(/[^a-z0-9\s]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function normalizeStatus(sv){const s=String(sv||'').trim().toLowerCase();if(!s)return'pending';if(s==='pending'||s==='pendiente'||s.includes('pend'))return'pending';if(s==='reserva'||s.includes('reser'))return'reserva';if(s==='cancelled'||s.includes('cancel'))return'cancelled';if(s==='hold'||s.includes('hold'))return'hold';if(s==='rescheduled'||s.includes('resched')||s.includes('reagend')||s.includes('reprogram'))return'rescheduled';if(s==='oficina'||(s.includes('active')&&s.includes('oficina')))return'oficina';if(s==='active'||s==='activo'||s==='activa')return'active';if(s==='completed'||s.includes('complet')||s.includes('cerrad'))return'completed';return s;}
  function normalizeRiesgo(rv){const s=String(rv||'').trim().toLowerCase();if(s==='alto'||s==='high'||s==='h')return'Alto';if(s==='medio'||s==='medium'||s==='m')return'Medio';if(s==='bajo'||s==='low'||s==='l')return'Bajo';return String(rv||'');}
  function pickField(obj,keys,fallback){if(!obj)return fallback!==undefined?fallback:'';for(let i=0;i<keys.length;i++){const v=obj[keys[i]];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return fallback!==undefined?fallback:'';}

  /* ── COLCHÓN DETECTION ── */
  function isColchonLead(lead, refMonthStr){
    try{
      const dv=String(lead.dia_venta||lead.diaVenta||'').slice(0,7);
      const di=String(lead.dia_instalacion||lead.diaInstalacion||'').slice(0,7);
      if(!dv||!di)return false;
      if(refMonthStr){
        // Con filtro de mes activo: instalado ese mes pero vendido en mes anterior
        return dv!==refMonthStr&&di===refMonthStr;
      }
      // Sin filtro de mes: colchón si vendido en mes diferente (anterior) a la instalación
      return dv<di;
    }catch(_){return false;}
  }
  function isColchonActivo(lead, refMonthStr){
    return isColchonLead(lead, refMonthStr) && (normalizeStatus(lead.status)==='completed'||normalizeStatus(lead.status)==='active');
  }

  function extractMongoId(it, idx) {
    if (!it) return 'tmp-' + idx;
    var v = it._id !== undefined ? it._id : (it.id !== undefined ? it.id : null);
    if (!v) return 'tmp-' + idx;
    if (typeof v === 'string' && v.trim() && v !== '[object Object]') return v.trim();
    if (typeof v === 'object') {
      if (v.$oid) return String(v.$oid);
      if (v.oid)  return String(v.oid);
      if (typeof v.toHexString === 'function') return v.toHexString();
      var s = v.toString();
      if (s && s !== '[object Object]' && /^[a-f0-9]{24}$/i.test(s)) return s;
    }
    return 'tmp-' + idx;
  }

  function normalizeLeads(items){
    if(!Array.isArray(items))return[];
    return items.map(function(it,idx){
      const raw=(it&&it._raw&&typeof it._raw==='object')?it._raw:null;
      const pick=function(keys){return pickField(it,keys)||pickField(raw,keys)||'';};
      const lead={
        _id:             extractMongoId(it, idx),
        _raw:            it,
        _es_colchon:     !!(it&&it._es_colchon),
        nombre_cliente:  pick(['nombre_cliente','clientName','nombre'])||'SIN NOMBRE',
        telefono:        pick(['telefono','telefono_principal','phone','telefonoPrincipal']),
        telefono_alt:    pick(['telefono_alt','telefono_alterno','altPhone','telefonoAlterno']),
        numero_cuenta:   pick(['numero_cuenta','no_cuenta','accountNumber','cuenta']),
        autopago:        formatAutopago(pick(['autopago','autoPago','autopay','auto_pay'])),
        direccion:       pick(['direccion','address','direccion_cliente']),
        sistema:         pick(['sistema','system']),
        riesgo:          normalizeRiesgo(pick(['riesgo','risk'])),
        dia_venta:       (function(){
          var v=pick(['dia_venta','saleDate','fecha_venta','fechaVenta','diaVenta']);
          if(v&&String(v).trim()&&String(v).trim()!=='')return String(v).slice(0,10);
          var fc=pick(['fecha_contratacion']);
          if(fc&&String(fc).trim())return String(fc).slice(0,10);
          var ca=pick(['creadoEn','createdAt','fecha_creacion']);
          if(ca)return String(ca).slice(0,10);
          return '';
        })(),
        dia_instalacion: String(pick(['dia_instalacion','installDate','fecha_instalacion','fechaInstalacion','diaInstalacion'])).slice(0,10),
        status:          normalizeStatus(pick(['status','Status','estado','state'])),
        servicios:       pick(['servicios','servicios_texto','producto_contratado','serviceDescription']),
        tipo_servicio:   pick(['tipo_servicio','serviceType','tipoServicio','tipo_servicios','servicios_texto']),
        mercado:         pick(['mercado','market']),
        supervisor:      pick(['supervisor','SUPERVISOR','team','Team','equipo']),
        agente:          pick(['agenteNombre','agente','createdBy','creadoPor'])||pickField(raw,['agenteNombre','agente','createdBy','creadoPor'],''),
        motivo_llamada:  pick(['motivo_llamada','motivo','reason','motivoLlamada','comentario']),
        zip_code:        pick(['zip_code','zip','zipcode','zipCode']),
        puntaje:         (function(){
          var v=pickField(it,['puntaje','score','puntos','Puntaje','Score'],'');
          if(v===''||v===null||v===undefined)return '';
          var n=parseFloat(String(v).replace(',','.'));
          return isNaN(n)?'':n;
        })(),
        notas:           it&&(it.notas||it.notas_cliente||it.notes)||[],
        was_reserva:     !!(it&&(it.was_reserva===true||it.was_reserva==='true'||it.was_reserva===1)),
      };
      if(!lead._es_colchon){const st=normalizeStatus(lead.status);lead._es_colchon=isColchonLead(lead)&&(st==='completed'||st==='active');}
      return lead;
    });
  }

  // Teams normalization helpers
  let _teams = [];
  function normalizeStringForCompare(s){
    try{ return String(s||'').normalize('NFD').replace(/\p{Diacritic}+/gu,'').trim().toLowerCase().replace(/\s+/g,' '); }
    catch{ return String(s||'').trim().toLowerCase(); }
  }
  async function loadTeams(){
    if(!AUTH.check()) return;
    try{
      const res = await AUTH.secureFetch('/api/teams');
      if(!res||!res.ok) return;
      const data = await res.json();
      _teams = Array.isArray(data.teams) ? data.teams : (data.teams || []);
    }catch(_){ _teams = []; }
  }
  function normalizeTeam(raw){
    const r = String(raw||'').trim(); if(!r) return '';
    const n = normalizeStringForCompare(r);
    for(const t of (_teams||[])){
      const candidates = [t.value, t.label, t.supervisor, t.supervisorName];
      for(const c of candidates){ if(!c) continue; if(normalizeStringForCompare(c) === n) return t.label || t.value; }
    }
    return r;
  }

  /* ── FETCH ── */
  // month: 'YYYY-MM' opcional. Si no se pasa, usa el mes actual.
  async function fetchLeads(month) {
    if (!AUTH.check()) return [];
    const ud = getUserData();
    const role = String(ud.role||ud.rol||'').toLowerCase();
    const isAdm = isAdminOrBackoffice(role);
    const isSup = isSupervisor(role);
    const needsAll = isAdm || isSup;
    const limit = needsAll ? 2000 : 500;
    const scope = needsAll ? '&scope=ranking' : '';

    // Calcular rango del mes — por defecto mes actual en hora El Salvador
    const targetMonth = month || new Date().toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' }).slice(0, 7);
    const [y, m] = targetMonth.split('-').map(Number);
    const fi = targetMonth + '-01';
    const lastDay = new Date(y, m, 0).getDate();
    const ff = targetMonth + '-' + String(lastDay).padStart(2, '0');
    const dateParams = '&fechaInicio=' + fi + '&fechaFin=' + ff;

    const url = '/api/leads?limit='+limit+'&offset=0'+scope+dateParams;
    const res = await AUTH.secureFetch(url);
    if (!res) return [];
    if (!res.ok) { showToast('Error del servidor: ' + res.status, 'error'); return []; }
    try {
      const data = await res.json();
      return Array.isArray(data) ? data : (data.data||data.leads||data.customers||[]);
    } catch (err) {
      console.error('fetchLeads parse error:', err);
      showToast('Error al procesar datos','error');
      return [];
    }
  }

  var __usersFromAPI=[];
  async function fetchUsersForFilters(){
    if(!AUTH.check())return null;
    const res=await AUTH.secureFetch('/api/users/agents');
    if(!res||!res.ok)return null;
    try{
      const data=await res.json();
      const users=data.agents||data.data||[];
      __usersFromAPI=users;
      // Poblar #liberar-agente-select con todos los agentes
      var liberarSel=document.getElementById('liberar-agente-select');
      if(liberarSel){
        var prevVal=liberarSel.value;
        liberarSel.innerHTML='<option value="">-- Selecciona agente --</option>';
        var getName=function(u){return(u.name||u.fullName||u.nombre||u.username||'').trim();};
        users.filter(function(u){var r=String(u.role||'').toLowerCase();return r.includes('agente')||r.includes('vendedor')||r.includes('agent');})
          .sort(function(a,b){return getName(a).localeCompare(getName(b));})
          .forEach(function(u){var n=getName(u);if(!n)return;var o=document.createElement('option');o.value=n;o.textContent=n;liberarSel.appendChild(o);});
        if(prevVal)liberarSel.value=prevVal;
      }
      return users;
    }catch(_){return null;}
  }
  async function fetchMonthsForFilters(){if(!AUTH.check())return null;const res=await AUTH.secureFetch('/api/leads/months?limit=120');if(!res||!res.ok)return null;try{const data=await res.json();return data.months||data.data||[];}catch(_){return null;}}

  /* ── RENDER ── */
  window.renderCostumerTable=function(items){__allLeadsData=normalizeLeads(items||[]);window.__allLeadsData=__allLeadsData;currentPage=1;applyFilters();setTimeout(refreshFilterOptions,0);};

  function refreshFilterOptions(){
    if(!__allLeadsData.length)return;
    const equipos=new Set(),agentes=new Set(),mercados=new Set(),meses=new Set();
    // Incluir agentes de la API (usuarios registrados, aunque no tengan leads aún)
    if(__usersFromAPI&&__usersFromAPI.length){
      __usersFromAPI.forEach(function(u){
        var r=String(u.role||'').toLowerCase();
        if(r.includes('agente')||r.includes('vendedor')||r.includes('agent')){
          var n=(u.name||u.fullName||u.nombre||u.username||'').trim();
          if(n)agentes.add(n);
        }
      });
    }
    __allLeadsData.forEach(function(lead){
      if(lead.supervisor) equipos.add(normalizeSupervisorName(lead.supervisor));
      if(lead.agente)agentes.add(lead.agente);
      if(lead.mercado)mercados.add(lead.mercado);
      var toYM=function(v){if(!v)return'';var s=String(v).trim();return s.length>=7?s.slice(0,7):'';};
      var fechas=[
        lead.dia_venta, lead.dia_instalacion,
        lead._raw&&lead._raw.fecha_contratacion,
        lead._raw&&lead._raw.creadoEn,
        lead._raw&&lead._raw.createdAt,
        lead._raw&&lead._raw.fecha_creacion,
      ].map(toYM).filter(function(f){return f&&f.length===7&&/^\d{4}-\d{2}$/.test(f);});
      fechas.forEach(function(f){meses.add(f);});
    });
    function updateSelect(id,items){const el=document.getElementById(id);if(!el)return;const cur=el.value;el.innerHTML='<option value="">Todos</option>';Array.from(items).sort().forEach(function(v){const o=document.createElement('option');o.value=v;o.textContent=v;el.appendChild(o);});el.value=cur;}
    updateSelect('teamFilter',equipos);updateSelect('agentFilter',agentes);updateSelect('mercadoFilter',mercados);
    const monthEl=document.getElementById('monthFilter');
    if(monthEl){const cur=monthEl.value;monthEl.innerHTML='<option value="">Todos</option>';const mn=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];Array.from(meses).sort().reverse().forEach(function(m){const o=document.createElement('option');const parts=m.split('-');o.value=m;o.textContent=mn[parseInt(parts[1],10)-1]+' '+parts[0];monthEl.appendChild(o);});monthEl.value=cur;}
  }
  window._refreshFilterOptions=refreshFilterOptions;

  /* ── FILTER ── */
  let applyFiltersTimer=null;
  function applyFiltersDebounced(){clearTimeout(applyFiltersTimer);applyFiltersTimer=setTimeout(applyFilters,150);}
  window.applyFilters=applyFilters;

  function applyFilters(){
    const search=getVal('costumer-search').toUpperCase();
    const svc=getVal('serviceFilter'),team=getVal('teamFilter'),agent=getVal('agentFilter'),mercado=getVal('mercadoFilter'),month=getVal('monthFilter'),from=getVal('dateFrom'),to=getVal('dateTo');
    const ud=getUserData(),role=String(ud.role||ud.rol||'').toLowerCase();
    const userName=String(ud.nombre||ud.name||ud.username||'').trim();
    const userUsername=String(ud.username||'').trim();
    const isAdm=isAdminOrBackoffice(role),isAgt=isAgent(role),isSup=isSupervisor(role);
    const d=new Date(),padZ=function(n){return String(n).padStart(2,'0');};
    const today=d.getFullYear()+'-'+padZ(d.getMonth()+1)+'-'+padZ(d.getDate());
    const curMon=d.getFullYear()+'-'+padZ(d.getMonth()+1);
    // Mes de referencia para detectar colchón: el filtro activo, o null (sin filtro = comparar fechas del lead)
    const refMes=month||null;
    // _es_colchon_route: lead's "home month" is dia_instalacion (all statuses)
    // _es_colchon:       shows the colchón badge (only completed/active)
    __allLeadsData.forEach(function(lead){
      const st=normalizeStatus(lead.status);
      const isActive=st==='completed'||st==='active';
      const isRoute=isColchonLead(lead,refMes);
      lead._es_colchon_route=isRoute;
      lead._es_colchon=isRoute&&isActive;
    });

    // ── DEBUG: log de datos del usuario logueado (solo en desarrollo) ──
    if(isSup) {
    }

    __filteredLeads=__allLeadsData.filter(function(lead){
      // Supervisores SÍ pueden ver leads de oficina de su equipo
      if(!isAdm && !isSup){
        if(lead.status==='oficina')return false;
      }
      // Agentes solo ven sus propios leads
      if(isAgt){
        const normalize=function(s){return String(s||'').replace(/\./g,' ').trim().toLowerCase();};
        const agentMatch=normalize(lead.agente)===normalize(userName)||normalize(lead.agente)===normalize(userUsername)||normalize(lead.agenteNombre||'')===normalize(userName)||normalize(lead.agenteNombre||'')===normalize(userUsername);
        if(!agentMatch)return false;
      }
      // ══════════════════════════════════════════
      // FIX SUPERVISOR: comparación robusta
      // Usa las palabras del nombre y del team del usuario logueado
      // para matchear contra el campo supervisor del lead
      // ══════════════════════════════════════════
      else if(isSup){
        const leadSup = String(lead.supervisor || '').trim().toUpperCase();

        // Palabras clave del nombre del usuario (ej: "GUADALUPE SANTANA" → ["GUADALUPE","SANTANA"])
        const userNombreUpper = userName.trim().toUpperCase();
        const userWords = userNombreUpper.split(/\s+/).filter(function(w){ return w.length >= 4; });

        // Palabras clave del team (ej: "TEAM GUADALUPE SANTANA" → ["GUADALUPE","SANTANA"])
        const userTeam = String(ud.team || '').trim().toUpperCase();
        const teamWords = userTeam.replace(/\bTEAM\b/g,'').trim().split(/\s+/).filter(function(w){ return w.length >= 4; });

        // Todas las keywords a buscar
        const keywords = userWords.concat(teamWords);

        // Normalización con la función existente como fallback
        const normLead = normalizeSupervisorName(leadSup);
        const normUser = normalizeSupervisorName(userNombreUpper);

        // Match si el campo supervisor del lead contiene ALGUNA keyword del usuario
        const keywordMatch = keywords.some(function(kw){ return leadSup.includes(kw); });
        // Match por normalizeSupervisorName
        const normMatch = normLead === normUser && normLead !== '';

        if(isSup) {
          // Debug solo para primeros 3 leads para no saturar consola
          if(__allLeadsData.indexOf(lead) < 3) {
          }
        }

        if(!keywordMatch && !normMatch) return false;
      }

      if(search){
        const searchDigits = search.replace(/\D/g,'');
        const normPhone = function(p){
          const d = String(p||'').replace(/\D/g,'');
          return d.length >= 10 ? d.slice(-10) : d;
        };
        if(searchDigits.length >= 7){
          const searchNorm = searchDigits.length >= 10 ? searchDigits.slice(-10) : searchDigits;
          const tel1 = normPhone(lead.telefono);
          const tel2 = normPhone(lead.telefono_alt);
          const phoneMatch = tel1.includes(searchNorm) || tel2.includes(searchNorm);
          if(phoneMatch) return true;
          const h = [lead.nombre_cliente,lead.numero_cuenta,lead.zip_code]
            .map(function(f){return String(f||'').toUpperCase();}).join('|');
          if(h.indexOf(search)===-1) return false;
        } else {
          const tel1raw = String(lead.telefono||'').toUpperCase();
          const tel2raw = String(lead.telefono_alt||'').toUpperCase();
          const tel1dig = normPhone(lead.telefono);
          const tel2dig = normPhone(lead.telefono_alt);
          const h = [
            lead.nombre_cliente, lead.numero_cuenta, lead.zip_code,
            tel1raw, tel2raw, tel1dig, tel2dig
          ].map(function(f){return String(f||'').toUpperCase();}).join('|');
          if(h.indexOf(search)===-1) return false;
        }
      }
      if(svc&&String(lead.tipo_servicio||'').toUpperCase().indexOf(svc.toUpperCase())===-1)return false;
      if(team&&String(lead.supervisor||'').toUpperCase().indexOf(team.toUpperCase())===-1)return false;
      if(agent){
        const normA=function(s){return String(s||'').replace(/\./g,' ').trim().toLowerCase();};
        const agentOk=normA(lead.agente)===normA(agent)||normA(lead.agenteNombre||'')===normA(agent)||normA(lead.createdBy||'')===normA(agent);
        if(!agentOk)return false;
      }
      if(mercado&&lead.mercado!==mercado)return false;

      if(activeStatusTab&&activeStatusTab!=='all'){
        if(activeStatusTab==='colchon'){if(!lead._es_colchon_route)return false;}
        else if(activeStatusTab==='completed'){if(lead.status!=='completed'&&lead.status!=='active')return false;if(lead._es_colchon&&onlyTwoMonths)return false;}
        else if(activeStatusTab==='pending'){if(lead.status!=='pending')return false;if(lead._es_colchon&&onlyTwoMonths)return false;}
        else{if(lead.status!==activeStatusTab)return false;}
      }

      if(month){
        // Convert any date format to YYYY-MM
        const toYM=function(v){
          if(!v)return'';
          const s=String(v).trim();
          // Try ISO format first: YYYY-MM-DD or YYYY-MM
          if(/^\d{4}-\d{2}/.test(s)) return s.slice(0,7);
          // Try DD/MM/YYYY or DD-MM-YYYY
          const dmyMatch=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
          if(dmyMatch){
            const d=String(dmyMatch[1]).padStart(2,'0');
            const m=String(dmyMatch[2]).padStart(2,'0');
            const y=dmyMatch[3];
            return y+'-'+m;
          }
          // Try MMM DD YYYY or DD MMM YYYY (es: "01 mar 2026" or "01 MAR 2026")
          const mmmMatch=s.match(/(\d{1,2})\s+([a-z]{3})\s+(\d{4})/i);
          if(mmmMatch){
            const months={'ene':'01','feb':'02','mar':'03','abr':'04','may':'05','jun':'06','jul':'07','ago':'08','sep':'09','oct':'10','nov':'11','dic':'12'};
            const mStr=mmmMatch[2].toLowerCase();
            const mNum=months[mStr]||'00';
            const y=mmmMatch[3];
            return y+'-'+mNum;
          }
          // Fallback: slice first 7 chars
          return s.slice(0,7);
        };
        if(activeStatusTab==='colchon'){
          // Pestaña colchón: siempre filtrar por dia_instalacion
          const diaInstYM=toYM(lead.dia_instalacion);
          if(!diaInstYM||diaInstYM!==month)return false;
        } else if(!onlyTwoMonths){
          // Modo "Solo 2 meses": leads con dia_instalacion diferente al dia_venta
          // se enrutan por dia_instalacion (cualquier status).
          if(lead._es_colchon_route){
            const diaInstYM=toYM(lead.dia_instalacion);
            if(!diaInstYM||diaInstYM!==month)return false;
          } else {
            const diaVentaYM=toYM(lead.dia_venta);
            if(!diaVentaYM||diaVentaYM!==month)return false;
            // Safety net: exclude leads with a future installation month not caught by route flag
            const diaInstYM=toYM(lead.dia_instalacion);
            if(diaInstYM&&diaInstYM>month)return false;
          }
        } else {
          // Modo "Todos los meses": solo ventas del mes, sin colchones de ningún tipo
          const diaVentaYM=toYM(lead.dia_venta);
          if(!diaVentaYM||diaVentaYM!==month)return false;
          if(lead._es_colchon_route)return false;
        }
      }

      // Apply the "last 2 months" limit when no specific month is selected and
      // the toggle is in 'Solo 2 meses' mode (onlyTwoMonths === false).
      if(!month && !onlyTwoMonths){
        const limit=new Date(d.getFullYear(),d.getMonth()-1,1);
        const ref=lead._es_colchon_route?(lead.dia_instalacion||lead.dia_venta):(lead.dia_venta||lead.dia_instalacion);
        if(ref&&new Date(ref)<limit) return false;
      }

      if(from&&to){const ref=lead._es_colchon_route?(lead.dia_instalacion||lead.dia_venta):(lead.dia_venta||lead.dia_instalacion);if(!ref)return false;const ld=new Date(ref);if(ld<new Date(from))return false;if(ld>new Date(to+'T23:59:59'))return false;}
      return true;
    });

    __filteredLeads.sort(function(a,b){const ra=a._es_colchon_route?(a.dia_instalacion||a.dia_venta):(a.dia_venta||a.dia_instalacion);const rb=b._es_colchon_route?(b.dia_instalacion||b.dia_venta):(b.dia_venta||b.dia_instalacion);return(rb||'').localeCompare(ra||'');});
    currentPage=1;renderTableRows();updateKPIs();setTimeout(refreshFilterOptions,0);
  }

  /* ── STATUS CONFIG ── */
  const STATUS_CFG={completed:{label:'Completed',cls:'badge-active'},active:{label:'Completed',cls:'badge-active'},oficina:{label:'Oficina',cls:'badge-active'},pending:{label:'Pending',cls:'badge-pending'},reserva:{label:'Reserva',cls:'badge-pending'},cancelled:{label:'Cancelled',cls:'badge-cancelled'},hold:{label:'Hold',cls:'badge-hold'},rescheduled:{label:'Rescheduled',cls:'badge-hold'}};

  function badgeHTML(status,isColchon){
    const cfg=STATUS_CFG[status]||{label:status,cls:'badge-hold'};
    const statusBadge='<span class="badge '+cfg.cls+'">'+escHTML(cfg.label)+'</span>';
    if(isColchon){return statusBadge+'<span class="badge badge-colchon" style="margin-top:3px;font-size:.6rem;padding:1px 6px;">🛏 Colchón</span>';}
    return statusBadge;
  }

  function statusCellHTML(leadId,currentStatus,isColchon){
    const ud=getUserData(),role=String(ud.role||ud.rol||'').toLowerCase();
    if(!isAdminOrBackoffice(role))return badgeHTML(currentStatus,isColchon);
    const lidStr=String(leadId);
    const cfg=STATUS_CFG[currentStatus]||{cls:'badge-hold'};
    const allOpts=[{value:'pending',label:'Pending'},{value:'completed',label:'Completed'},{value:'cancelled',label:'Cancelled'},{value:'hold',label:'Hold'},{value:'oficina',label:'Oficina'},{value:'reserva',label:'Reserva'}];
    const opts=allOpts.map(function(o){return'<option value="'+o.value+'"'+(o.value===currentStatus?' selected':'')+'>'+o.label+'</option>';}).join('');
    const colchonAttr=isColchon?' data-is-colchon="1"':'';
    const colchonChip=isColchon?'<span class="badge badge-colchon" style="margin-top:3px;font-size:.6rem;padding:1px 6px;display:block;">🛏 Colchón</span>':'';
    return'<select class="status-inline-select '+cfg.cls+(isColchon?' colchon-select':'')+'" data-lead-id="'+escHTML(lidStr)+'"'+colchonAttr+' onchange="inlineStatusChange(this)" aria-label="Cambiar status">'+opts+'</select>'+colchonChip;
  }

  /* ── TABLE ROWS ── */
  function renderTableRows(){
    const tbody=document.getElementById('costumer-tbody');if(!tbody)return;
    const total=__filteredLeads.length,ps=pageSize===99999?total:pageSize,start=(currentPage-1)*ps,paged=__filteredLeads.slice(start,start+ps);
    if(!paged.length){tbody.innerHTML='<tr><td colspan="19" style="text-align:center;padding:40px;color:var(--ink-4);font-size:.82rem;">Sin resultados para los filtros aplicados</td></tr>';}
    else{tbody.innerHTML=paged.map(function(lead){
      const lid=String(lead._id),isCol=!!lead._es_colchon_route,rowClass=isCol?' class="row-colchon"':'';
      return'<tr data-id="'+escHTML(lid)+'"'+rowClass+'>'+
        '<td style="padding:12px 14px 12px 18px;font-weight:600;color:var(--ink-1);">'+(isCol?'<span title="Venta colchón" style="margin-right:4px;font-size:.8rem;">🛏</span>':'')+escHTML(lead.nombre_cliente)+'<span class="row-actions" style="margin-left:6px;"><button class="rab" onclick="editLead(\''+lid+'\')" title="Editar" aria-label="Editar '+escHTML(lead.nombre_cliente)+'">✎</button><button class="rab delete-btn" onclick="deleteLead(\''+lid+'\')" title="Eliminar" aria-label="Eliminar '+escHTML(lead.nombre_cliente)+'">✕</button></span></td>'+
        cell(lead.telefono?'<span class="mono">'+escHTML(lead.telefono)+'</span>':'—')+
        cell(lead.telefono_alt?'<span class="mono">'+escHTML(lead.telefono_alt)+'</span>':'—')+
        cell('<span class="mono">'+escHTML(lead.numero_cuenta)+'</span>')+
        cell(escHTML(lead.autopago))+cell(escHTML(lead.direccion))+cell(escHTML(lead.tipo_servicio))+cell(escHTML(lead.sistema))+cell(escHTML(lead.riesgo))+
        cell(fmtDate(lead.dia_venta))+cell(fmtDate(lead.dia_instalacion))+
        '<td class="status-td">'+statusCellHTML(lid,lead.status,isCol)+'</td>'+
        cell(escHTML(lead.servicios))+cell(escHTML(lead.mercado))+cell(escHTML(fmtSupervisor(lead.supervisor)))+cell(escHTML(lead.motivo_llamada))+
        cell('<span class="mono">'+escHTML(lead.zip_code)+'</span>')+
        cell(lead.puntaje!==''&&lead.puntaje!==null&&lead.puntaje!==undefined?'<span style="font-family:var(--f-mono);font-size:.72rem;background:var(--sheet-2);border:1px solid var(--line-1);border-radius:var(--r1);padding:2px 6px;'+(parseFloat(lead.puntaje)>=1?'color:var(--go)':parseFloat(lead.puntaje)>=0.5?'color:var(--warn)':'color:var(--stop)')+'">'+escHTML(String(lead.puntaje))+'</span>':'—')+
        '<td style="padding:8px 14px;"><button class="rab" onclick="editLead(\''+lid+'\')" style="width:auto;padding:0 8px;font-size:.7rem;gap:4px;" aria-label="Editar">✎ Editar</button></td>'+
        '</tr>';
    }).join('');}
    const countEl=document.getElementById('recuentoCount');if(countEl)countEl.value=total;
    const puntajeTotal=__filteredLeads.reduce(function(sum,lead){
      const raw=lead._raw||{};
      const candidates=[lead.puntaje,raw.puntaje,raw.score,raw.puntos,raw.Puntaje,raw.Score,raw.Puntos];
      var p=0;
      for(var i=0;i<candidates.length;i++){var v=candidates[i];if(v===null||v===undefined||v==='')continue;var n=parseFloat(String(v).replace(',','.'));if(!isNaN(n)&&n>0){p=n;break;}}
      return sum+p;
    },0);
    const puntajeEl=document.getElementById('puntajeTotalCount');
    if(puntajeEl)puntajeEl.value=puntajeTotal.toFixed(2)+' pts';
    const pages=Math.ceil(total/(pageSize===99999?total||1:pageSize))||1;
    const pageEl=document.getElementById('pageInfo');if(pageEl)pageEl.textContent='Página '+currentPage+' de '+pages;
    const prev=document.getElementById('pagePrev'),next=document.getElementById('pageNext');
    if(prev)prev.disabled=currentPage<=1;if(next)next.disabled=currentPage>=pages;
  }

  /* ── KPIs ── */
  function updateKPIs(){
    const d=new Date(),pad=function(n){return String(n).padStart(2,'0');};
    const today=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    // Use selected month filter if present, otherwise default to current month
    const selectedMonth = (document.getElementById('monthFilter') && document.getElementById('monthFilter').value) ? document.getElementById('monthFilter').value : '';
    const curMon = selectedMonth || (d.getFullYear()+'-'+pad(d.getMonth()+1));
    const inclCol=document.getElementById('check-colchon-activas')&&document.getElementById('check-colchon-activas').checked;
    let kpi={hoy:0,mes:0,activas:0,colchon:0,pend:0,cancel:0,oficina:0,reserva:0,hold:0};
    
    // When a specific month is selected, count ALL leads in __filteredLeads (they're already filtered by month)
    if(selectedMonth){
      kpi.mes = __filteredLeads.length; // Count all filtered leads (already filtered by month in applyFilters)
      // Also break down by status for the other KPIs
      __filteredLeads.forEach(function(l){
        if(!l)return;
        const st=l.status;
        if(st==='completed'||st==='active')kpi.activas++;
        else if(st==='pending')kpi.pend++;
        else if(st==='cancelled')kpi.cancel++;
        else if(st==='oficina')kpi.oficina++;
        else if(st==='reserva')kpi.reserva++;
        else if(st==='hold')kpi.hold++;
      });
    } else {
      // When no month is selected, use the original logic (count by status and month range)
      __filteredLeads.forEach(function(l){
        if(!l)return;
        const dv=String(l.dia_venta||'').slice(0,10),st=l.status,isCol=!!l._es_colchon;
        if(st==='oficina'){kpi.oficina++;return;}
        if(st==='reserva'){kpi.reserva++;return;}
        if(isCol){if(st==='completed'||st==='active')kpi.colchon++;return;}
        if(!dv.startsWith(curMon))return;
        if(dv===today)kpi.hoy++;
        if(st==='completed'||st==='active'){kpi.mes++;kpi.activas++;}
        else if(st==='pending'){kpi.mes++;kpi.pend++;}
        else if(st==='cancelled'){kpi.cancel++;}
      });
    }
    
    animateCount('costumer-ventas-hoy',kpi.hoy);
    animateCount('costumer-ventas-mes',kpi.mes);
    animateCount('costumer-ventas-activas',inclCol?kpi.activas+kpi.colchon:kpi.activas);
    animateCount('costumer-pendientes',kpi.pend);
    animateCount('costumer-cancelados',kpi.cancel);
    animateCount('costumer-oficina',kpi.oficina);
    animateCount('costumer-reserva',kpi.reserva);
    animateCount('costumer-colchon',kpi.colchon);
  }
  function animateCount(id,to){const el=document.getElementById(id);if(!el)return;const from=parseInt(el.textContent,10)||0;const dur=500,start=performance.now();function step(now){const p=Math.min((now-start)/dur,1);el.textContent=Math.round(from+(to-from)*p);if(p<1)requestAnimationFrame(step);}requestAnimationFrame(step);}
  window.updateKPIsWithColchon=function(){updateKPIs();};
  window.toggleColchonInActivas=function(){};

  /* ── INLINE STATUS ── */
  window.inlineStatusChange=async function(selectEl){
    const leadId=selectEl.dataset.leadId,newStatus=selectEl.value;
    const lead=__allLeadsData.find(function(l){return String(l._id)===leadId;});
    if(!lead){showToast('Lead no encontrado','error');return;}
    if(String(leadId).startsWith('tmp-')){showToast('Este lead no tiene ID válido — recarga la página','error');return;}
    const oldStatus=lead.status;
    const oldCls=(STATUS_CFG[oldStatus]||{cls:'badge-hold'}).cls;
    const newCls=(STATUS_CFG[newStatus]||{cls:'badge-hold'}).cls;
    lead.status=newStatus;
    selectEl.classList.remove(oldCls);selectEl.classList.add(newCls);
    updateKPIs();
    const res=await AUTH.secureFetch('/api/leads/'+leadId,{method:'PUT',body:JSON.stringify({status:newStatus})});
    if(res&&res.ok){showToast('Status actualizado ✓','ok');showCRMNotif('status',{cliente:lead.nombre_cliente||leadId,actor:getUserData().name||getUserData().username||'Tú',detalle:'Cambió el status del lead',extra:'Nuevo status: '+newStatus});applyFilters();}
    else if(res){lead.status=oldStatus;selectEl.value=oldStatus;selectEl.classList.remove(newCls);selectEl.classList.add(oldCls);showToast('No se pudo guardar el status','error');}
  };

  /* ── EDIT MODAL ── */
  window.editLead=function(leadId){
    const lead=__allLeadsData.find(function(l){return String(l._id)===String(leadId);});
    if(!lead){showToast('Lead no encontrado','error');return;}
    const raw=lead._raw||{},pick=function(keys){return pickField(lead,keys)||pickField(raw,keys)||'';};
    setVal('edit-lead-id',leadId);setVal('edit-id',leadId);
    setVal('edit-nombre',pick(['nombre_cliente','clientName','nombre']));
    setVal('edit-telefono',pick(['telefono','telefono_principal','phone']));
    setVal('edit-telefono-alt',pick(['telefono_alt','telefono_alterno','altPhone']));
    setVal('edit-cuenta',pick(['numero_cuenta','no_cuenta','accountNumber']));
    setVal('edit-direccion',pick(['direccion','address']));
    setVal('edit-zip',pick(['zip_code','zip','zipcode']));
    setSelectSafe('edit-autopago',lead.autopago);setSelectSafe('edit-riesgo',lead.riesgo);
    setSelectSafe('edit-tipo-servicio',pick(['tipo_servicio','serviceType']));
    setSelectSafe('edit-sistema',pick(['sistema','system']));
    setSelectSafe('edit-mercado',pick(['mercado','market']));
    setSelectSafe('edit-servicios',pick(['servicios']));
    setVal('edit-dia-venta',String(pick(['dia_venta','saleDate','fecha_venta'])).slice(0,10));
    setVal('edit-dia-instalacion',String(pick(['dia_instalacion','installDate'])).slice(0,10));
    setVal('edit-puntaje',lead.puntaje!==''?lead.puntaje:'');
    setSelectSafe('edit-status',lead.status);
    setVal('edit-supervisor',pick(['supervisor','team']));
    setVal('edit-motivo',pick(['motivo_llamada','motivo','reason']));

    // ── Campo Agente: poblar con usuarios + pre-seleccionar el actual ──
    (function(){
      const ud=getUserData();
      const myRole=String(ud.role||ud.rol||'').toLowerCase();
      const canEdit=isAdminOrBackoffice(myRole)||isSupervisor(myRole);
      const sel=document.getElementById('edit-agente');
      if(!sel)return;
      sel.disabled=!canEdit;

      // Construir opciones: agentes de la API + agentes únicos en leads cargados
      const names=new Set();
      if(Array.isArray(__usersFromAPI)){
        __usersFromAPI.forEach(function(u){
          const r=String(u.role||'').toLowerCase();
          if(r.includes('agente')||r.includes('vendedor')||r.includes('agent')||r.includes('lineas')){
            const n=u.name||u.username||'';
            if(n.trim())names.add(n.trim());
          }
        });
      }
      // Completar con agentes únicos de la tabla actual
      if(Array.isArray(__allLeadsData)){
        __allLeadsData.forEach(function(l){
          const a=l.agente||l.agenteNombre||'';
          if(a.trim())names.add(a.trim());
        });
      }

      const currentAgent=pick(['agenteNombre','agente','createdBy','creadoPor'])||'';
      sel.innerHTML='<option value="">— Sin asignar —</option>';
      Array.from(names).sort().forEach(function(n){
        const opt=document.createElement('option');
        opt.value=n;
        opt.textContent=n;
        if(n.toLowerCase()===currentAgent.toLowerCase())opt.selected=true;
        sel.appendChild(opt);
      });
      // Si el agente actual no está en la lista, añadirlo
      if(currentAgent&&!Array.from(names).some(function(n){return n.toLowerCase()===currentAgent.toLowerCase();})){
        const opt=document.createElement('option');
        opt.value=currentAgent;
        opt.textContent=currentAgent+' (actual)';
        opt.selected=true;
        sel.insertBefore(opt,sel.options[1]);
      }
    })();
    const idSpan=document.getElementById('modal-lead-id');if(idSpan)idSpan.textContent='#'+String(leadId).slice(-4).toUpperCase();
    const isCol=!!lead._es_colchon;
    const container=document.getElementById('liberar-reserva-container');
    if(container){const showBanner=(lead.status==='reserva'||lead.was_reserva)&&!isCol;container.style.display=showBanner?'block':'none';if(showBanner){const sel=document.getElementById('liberar-agente-select');if(sel){const agentSet=new Set();__allLeadsData.forEach(function(l){const a=l.agente||'';if(a.trim())agentSet.add(a.trim());});sel.innerHTML='<option value="">-- Selecciona agente --</option>';Array.from(agentSet).sort().forEach(function(a){const opt=document.createElement('option');opt.value=a;opt.textContent=a;sel.appendChild(opt);});}}}

    // ── Permisos de edición: solo Admin y Backoffice pueden modificar ──
    (function(){
      const ud=getUserData();
      const myRole=String(ud.role||ud.rol||'').toLowerCase();
      const canEdit=isAdminOrBackoffice(myRole);
      const modal=document.getElementById('editarModal');
      if(!modal)return;
      // Habilitar/deshabilitar todos los campos editables
      modal.querySelectorAll('input,select,textarea').forEach(function(el){
        if(el.id==='edit-lead-id'||el.id==='edit-id')return; // campos ocultos siempre activos
        el.disabled=!canEdit;
        el.style.opacity=canEdit?'':'0.6';
        el.style.cursor=canEdit?'':'not-allowed';
      });
      // Botón guardar
      const saveBtn=modal.querySelector('.btn-save');
      if(saveBtn){
        saveBtn.disabled=!canEdit;
        saveBtn.style.opacity=canEdit?'':'0.45';
        saveBtn.style.cursor=canEdit?'':'not-allowed';
        saveBtn.title=canEdit?'':'Solo administradores y backoffice pueden guardar cambios';
      }
      // Banner informativo si no puede editar
      let noEditBanner=modal.querySelector('.no-edit-banner');
      if(!canEdit){
        if(!noEditBanner){
          noEditBanner=document.createElement('div');
          noEditBanner.className='no-edit-banner';
          noEditBanner.style.cssText='background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:8px 14px;font-size:.74rem;color:#92400e;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px;';
          noEditBanner.innerHTML='<span>🔒</span> Solo Administradores y Backoffice pueden editar esta información.';
          const body=modal.querySelector('.modal-body');
          if(body)body.insertBefore(noEditBanner,body.firstChild);
        }
        noEditBanner.style.display='flex';
      } else {
        if(noEditBanner)noEditBanner.style.display='none';
      }
    })();

    document.getElementById('editarModal-wrapper').style.display='flex';
    setTimeout(function(){const m=document.getElementById('editarModal');if(m)m.scrollTop=0;},50);
    renderNotesPanel(leadId);
  };
  window.cerrarModal=function(){document.getElementById('editarModal-wrapper').style.display='none';};

  // Auto-fill tipo-servicio y sistema al cambiar servicios en el modal
  (function(){
    var EDIT_TYPE_MAP={
      'VIDEO DIRECTV VIA INTERNET':'VIDEO','VIDEO DIRECTV VIA SATELITE':'VIDEO',
      'ATT AIR':'AT&T AIR','ATT 18 - 25 MB':'INTERNET','ATT 50 - 100 MB':'INTERNET',
      'ATT 100 FIBRA':'INTERNET','ATT 300':'ATT 300','ATT 500':'ATT 500','ATT 1G':'ATT 1G',
      'SPECTRUM 400 MBPS':'INTERNET','SPECTRUM 500':'INTERNET','SPECTRUM 500MBPS+':'INTERNET',
      'SPECTRUM 1G':'INTERNET','SPECTRUM 2G':'INTERNET',
      'FRONTIER 200 MB':'FRONTIER','FRONTIER 500 MB':'FRONTIER','FRONTIER 1G':'FRONTIER','FRONTIER 2G':'FRONTIER',
      'CONSOLIDATED':'CONSOLIDATE',
      'XFINITY 300':'XFINITY','XFINITY 500':'XFINITY','XFINITY 1G':'XFINITY',
      'BRIGHTSPEED':'BRIGHTSPEED',
      'INTERNET EARTHLINK 300 MB':'EARTHLINK','EARTHLINK':'EARTHLINK',
      'ZIPLY FIBER 10G':'ZIPLY FIBER','ZIPLY FIBER 5G':'ZIPLY FIBER','ZIPLY FIBER 2G':'ZIPLY FIBER',
      'ZIPLY FIBER 1G':'ZIPLY FIBER','ZIPLY FIBER 300':'ZIPLY FIBER','ZIPLY FIBER 200':'ZIPLY FIBER',
      'ZIPLY FIBER':'ZIPLY FIBER',
      'OPTIMUM':'OPTIMUM','WOW':'WOW','ALTAFIBER':'ALTAFIBER','WINDSTREAM':'WINDSTREAM',
      'HUGHESNET':'HUGHESNET','VIASAT':'VIASAT','CENTURYLINK':'CENTURYLINK','METRONET':'METRONET',
      'HAWAIIAN':'HAWAIIAN','VIVINT':'VIVINT','MOBILITY':'WIRELESS'
    };
    var EDIT_SYS_MAP={
      'VIDEO DIRECTV VIA INTERNET':'SARA','VIDEO DIRECTV VIA SATELITE':'SARA',
      'ATT AIR':'SARA','ATT 18 - 25 MB':'SARA','ATT 50 - 100 MB':'SARA','ATT 100 FIBRA':'SARA',
      'ATT 300':'SARA','ATT 500':'SARA','ATT 1G':'SARA',
      'SPECTRUM 400 MBPS':'SARA','SPECTRUM 500':'SARA','SPECTRUM 500MBPS+':'SARA','SPECTRUM 1G':'SARA','SPECTRUM 2G':'SARA',
      'FRONTIER 200 MB':'SARA','FRONTIER 500 MB':'SARA','FRONTIER 1G':'SARA','FRONTIER 2G':'SARA',
      'CONSOLIDATED':'SARA','XFINITY 300':'N/A','XFINITY 500':'N/A','XFINITY 1G':'N/A',
      'BRIGHTSPEED':'SARA','INTERNET EARTHLINK 300 MB':'SARA','EARTHLINK':'SARA',
      'ZIPLY FIBER 10G':'SARA','ZIPLY FIBER 5G':'SARA','ZIPLY FIBER 2G':'SARA',
      'ZIPLY FIBER 1G':'SARA','ZIPLY FIBER 300':'SARA','ZIPLY FIBER 200':'SARA','ZIPLY FIBER':'SARA',
      'OPTIMUM':'SARA','WOW':'SARA','ALTAFIBER':'SARA','WINDSTREAM':'SARA',
      'HUGHESNET':'CHUZO','VIASAT':'CHUZO','CENTURYLINK':'SARA','METRONET':'SARA',
      'HAWAIIAN':'SARA','VIVINT':'CHUZO','MOBILITY':'CHUZO'
    };
    var EDIT_SCORE_MAP={
      'VIDEO DIRECTV VIA INTERNET':1.0,'VIDEO DIRECTV VIA SATELITE':1.0,
      'ATT AIR':0.45,'ATT 18 - 25 MB':0.25,'ATT 50 - 100 MB':0.35,'ATT 100 FIBRA':0.70,
      'ATT 300':1.25,'ATT 500':1.25,'ATT 1G':1.5,
      'XFINITY 300':0.75,'XFINITY 500':0.75,'XFINITY 1G':0.75,
      'SPECTRUM 400 MBPS':0.75,'SPECTRUM 500':0.75,'SPECTRUM 500MBPS+':1.0,'SPECTRUM 1G':1.0,'SPECTRUM 2G':1.25,
      'FRONTIER 200 MB':1.0,'FRONTIER 500 MB':1.0,'FRONTIER 1G':1.25,'FRONTIER 2G':1.5,
      'CONSOLIDATED':0.35,'BRIGHTSPEED':1.0,'INTERNET EARTHLINK 300 MB':1.0,'EARTHLINK':1.0,
      'ZIPLY FIBER 10G':1.25,'ZIPLY FIBER 5G':1.25,'ZIPLY FIBER 2G':1.0,'ZIPLY FIBER 1G':1.0,
      'ZIPLY FIBER 300':0.35,'ZIPLY FIBER 200':0.35,'ZIPLY FIBER':0.35,
      'WINDSTREAM':1.0,'WOW':1.0,'ALTAFIBER':1.0,'HUGHESNET':0.35,'VIASAT':0.75,
      'CENTURYLINK':1.0,'METRONET':1.0,'HAWAIIAN':1.0,'OPTIMUM':1.0,'VIVINT':1.0,'MOBILITY':0.5
    };
    document.addEventListener('change',function(e){
      if(e.target&&e.target.id==='edit-servicios'){
        var svc=e.target.value;
        if(EDIT_TYPE_MAP[svc]) setSelectSafe('edit-tipo-servicio',EDIT_TYPE_MAP[svc]);
        if(EDIT_SYS_MAP[svc])  setSelectSafe('edit-sistema',EDIT_SYS_MAP[svc]);
        if(EDIT_SCORE_MAP[svc]!==undefined) setVal('edit-puntaje',EDIT_SCORE_MAP[svc]);
      }
    });
  })();

  window.guardarCambiosLead=async function(){
    const leadId=getVal('edit-lead-id');
    const lead=__allLeadsData.find(function(l){return String(l._id)===String(leadId);});
    if(!lead)return;
    if(String(leadId).startsWith('tmp-')){showToast('Este lead no tiene ID válido en BD — recarga la tabla','error');return;}
    const updates={
      nombre_cliente:  getVal('edit-nombre'),
      telefono:        getVal('edit-telefono'),
      telefono_alt:    getVal('edit-telefono-alt'),
      telefono_alterno:getVal('edit-telefono-alt'),
      numero_cuenta:   getVal('edit-cuenta'),
      direccion:       getVal('edit-direccion'),
      zip_code:        getVal('edit-zip'),
      zip:             getVal('edit-zip'),
      autopago:        getVal('edit-autopago'),
      riesgo:          getVal('edit-riesgo'),
      tipo_servicio:   getVal('edit-tipo-servicio'),
      sistema:         getVal('edit-sistema'),
      mercado:         getVal('edit-mercado'),
      servicios:       getVal('edit-servicios'),
      dia_venta:       getVal('edit-dia-venta'),
      dia_instalacion: getVal('edit-dia-instalacion'),
      puntaje:         getVal('edit-puntaje')?parseFloat(getVal('edit-puntaje'))||0:'',
      status:          getVal('edit-status'),
      supervisor:      getVal('edit-supervisor'),
      motivo_llamada:  getVal('edit-motivo'),
      agente:          getVal('edit-agente'),
      agenteNombre:    getVal('edit-agente'),
      createdBy:       getVal('edit-agente'),
    };
    Object.assign(lead, updates);
    lead._es_colchon=isColchonLead(lead);
    const saveBtn=document.querySelector('#editarModal .btn-save');
    if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='⏳ Guardando…';}
    const res=await AUTH.secureFetch('/api/leads/'+leadId,{method:'PUT',body:JSON.stringify(updates)});
    if(res&&res.ok){showToast('Guardado ✓','ok');showCRMNotif('edicion',{cliente:getVal('edit-nombre'),actor:getUserData().name||getUserData().username||'Tú',detalle:'Información del lead actualizada'});}else if(res){showToast('No se pudo guardar en servidor','warn');}
    if(saveBtn){saveBtn.disabled=false;saveBtn.innerHTML='💾 Guardar cambios';}
    window.cerrarModal();applyFilters();
  };

  /* ── DELETE ── */
  window.deleteLead=async function(leadId){
    const lead=__allLeadsData.find(function(l){return String(l._id)===String(leadId);});
    if(!lead){showToast('Lead no encontrado','error');return;}
    if(!confirm('¿Eliminar a '+(lead.nombre_cliente||'este cliente')+'?\nEsta acción no se puede deshacer.'))return;
    const res=await AUTH.secureFetch('/api/leads/'+leadId,{method:'DELETE'});
    if(res&&res.ok){showToast('Cliente eliminado ✓','ok');const idx=__allLeadsData.findIndex(function(l){return String(l._id)===String(leadId);});if(idx!==-1)__allLeadsData.splice(idx,1);applyFilters();}
    else if(res){res.json().then(function(d){showToast(d.message||'No se pudo eliminar','error');}).catch(function(){showToast('No se pudo eliminar','error');});}
  };

  /* ── LIBERAR RESERVA ── */
  window.liberarDeReservaConAsignacion=async function(){
    const leadId=getVal('edit-lead-id');
    const lead=__allLeadsData.find(function(l){return String(l._id)===String(leadId);});
    if(!lead){showToast('Lead no encontrado','error');return;}
    const agente=document.getElementById('liberar-agente-select')&&document.getElementById('liberar-agente-select').value;
    if(!agente){showToast('⚠️ Selecciona el agente que envió el lead','error');return;}
    if(!confirm('¿Confirmas liberar esta venta y asignarla a '+agente+'?'))return;
    lead.was_reserva=false;lead.agente=agente;lead.agenteNombre=agente;
    const container=document.getElementById('liberar-reserva-container');if(container)container.style.display='none';
    const res=await AUTH.secureFetch('/api/leads/'+leadId,{method:'PUT',body:JSON.stringify({was_reserva:false,agente:agente,agenteNombre:agente})});
    if(res&&res.ok){showToast('✅ Venta liberada y asignada a '+agente,'ok');updateKPIs();}
    else{showToast('Liberada localmente, error al sincronizar','warn');}
  };
  window.liberarDeReserva=window.liberarDeReservaConAsignacion;

  /* ── BULK STATUS ── */
  function canUseBulkStatus(){const ud=getUserData(),role=String(ud.role||ud.rol||'').toLowerCase();return !isAgent(role)&&!isSupervisor(role);}
  var _bulkMode='phone';
  window.openBulkStatusPhoneModal=function(){if(!canUseBulkStatus()){showToast('No tienes permisos para esta herramienta','error');return;}const modal=document.getElementById('bulkStatusPhoneModal');if(modal){modal.style.display='flex';modal.setAttribute('aria-hidden','false');}};
  window.closeBulkStatusPhoneModal=function(){const modal=document.getElementById('bulkStatusPhoneModal');if(modal){modal.style.display='none';modal.setAttribute('aria-hidden','true');}const pr=document.getElementById('bulkStatusPreview');if(pr)pr.style.display='none';const ta1=document.getElementById('bulkPhoneNumbers');if(ta1)ta1.value='';const ta2=document.getElementById('bulkNamesList');if(ta2)ta2.value='';_updateBulkCount();};
  function _switchBulkTab(mode){_bulkMode=mode;const phonePanel=document.getElementById('bulkPanelPhone');const namePanel=document.getElementById('bulkPanelName');const tabPhone=document.getElementById('bulkTabPhone');const tabName=document.getElementById('bulkTabName');if(phonePanel)phonePanel.style.display=mode==='phone'?'block':'none';if(namePanel)namePanel.style.display=mode==='name'?'block':'none';if(tabPhone){tabPhone.style.background=mode==='phone'?'var(--a)':'var(--sheet)';tabPhone.style.color=mode==='phone'?'#fff':'var(--ink-2)';}if(tabName){tabName.style.background=mode==='name'?'var(--a)':'var(--sheet)';tabName.style.color=mode==='name'?'#fff':'var(--ink-2)';}  _updateBulkCount();}
  window.switchBulkTab=_switchBulkTab;
  function _updateBulkCount(){const execBtn=document.getElementById('btnExecuteBulkStatus');const selSt=document.getElementById('bulkNewStatus');const countEl=document.getElementById('phoneCount');if(_bulkMode==='phone'){const ta=document.getElementById('bulkPhoneNumbers');const nums=ta?(ta.value.split('\n').map(function(s){const d=String(s||'').replace(/\D/g,'');return d.length>=10?d.slice(-10):'';}).filter(function(s){return s.length===10;})):[];if(countEl)countEl.textContent=nums.length+' números';if(execBtn&&selSt)execBtn.disabled=!(nums.length>0&&selSt.value);}else{const ta=document.getElementById('bulkNamesList');const names=ta?(ta.value.split('\n').map(function(s){return s.trim();}).filter(function(s){return s.length>=3;})):[];if(countEl)countEl.textContent=names.length+' nombres';if(execBtn&&selSt)execBtn.disabled=!(names.length>0&&selSt.value);}}
  window.executeBulkStatus=async function(){if(!canUseBulkStatus()){showToast('No tienes permisos','error');return;}const newStatus=document.getElementById('bulkNewStatus')&&document.getElementById('bulkNewStatus').value;if(!newStatus){showToast('Selecciona un status','error');return;}const btn=document.getElementById('btnExecuteBulkStatus');const preview=document.getElementById('bulkStatusPreview');const content=document.getElementById('bulkStatusPreviewContent');if(btn){btn.disabled=true;btn.textContent='⏳ Actualizando…';}if(preview)preview.style.display='block';if(content)content.textContent='Procesando…';try{let res,data,normalizedStatus=normalizeStatus(newStatus);if(_bulkMode==='phone'){const ta=document.getElementById('bulkPhoneNumbers');const nums=(ta?ta.value:'').split('\n').map(function(s){const d=String(s||'').replace(/\D/g,'');return d.length>=10?d.slice(-10):'';}).filter(function(s){return s.length===10;});if(!nums.length){showToast('Sin números válidos','error');return;}res=await AUTH.secureFetch('/api/leads/bulk-status-by-phone',{method:'POST',body:JSON.stringify({phones:nums,newStatus:normalizeStatus(newStatus)})});if(!res)throw new Error('Sin conexión');data=await res.json().catch(function(){return{};});if(!res.ok||!data.success){showToast((data&&data.message)||('Error: '+res.status),'error');if(content)content.textContent=(data&&data.message)||'Error';return;}const src=(Array.isArray(data.updatedLeads)&&data.updatedLeads.length)?data.updatedLeads.map(function(x){return x&&x.telefono;}):(Array.isArray(data.foundPhones)?data.foundPhones:[]);const fSet=new Set((src||[]).map(function(p){const d=String(p||'').replace(/\D/g,'');return d.length>=10?d.slice(-10):d;}).filter(Boolean));__allLeadsData.forEach(function(l){const d=String(l.telefono||'').replace(/\D/g,'');const c=d.length>=10?d.slice(-10):d;if(fSet.has(c))l.status=normalizedStatus;});}else{const ta=document.getElementById('bulkNamesList');const names=(ta?ta.value:'').split('\n').map(function(s){return s.trim();}).filter(function(s){return s.length>=3;});if(!names.length){showToast('Sin nombres válidos','error');return;}res=await AUTH.secureFetch('/api/leads/bulk-status-by-name',{method:'POST',body:JSON.stringify({names:names,newStatus:normalizeStatus(newStatus)})});if(!res)throw new Error('Sin conexión');data=await res.json().catch(function(){return{};});if(!res.ok||!data.success){showToast((data&&data.message)||('Error: '+res.status),'error');if(content)content.textContent=(data&&data.message)||'Error';return;}const updatedLeads=Array.isArray(data.updatedLeads)?data.updatedLeads:[];const nameSet=new Set(updatedLeads.map(function(x){return String(x&&x.nombre_cliente||'').trim().toLowerCase();}).filter(Boolean));__allLeadsData.forEach(function(l){if(nameSet.has(String(l.nombre_cliente||'').trim().toLowerCase()))l.status=normalizedStatus;});}applyFilters();if(content)content.innerHTML='<div style="color:var(--go);font-weight:700;">✅ Actualizado: '+(data.updated||0)+' leads</div>';showToast('Status masivo aplicado ✓','ok');}catch(e){if(content)content.textContent=e&&e.message?e.message:'Error inesperado';showToast(e&&e.message?e.message:'Error inesperado','error');}finally{if(btn){btn.disabled=false;btn.textContent='🔄 Actualizar status';}}};

  /* ── NOTES ENGINE ── */
  function getCurrentUserName(){try{const raw=localStorage.getItem('crm_user')||sessionStorage.getItem('crm_user');if(raw){const u=JSON.parse(raw);return u.name||u.username||(u.email?u.email.split('@')[0]:'')||'Usuario';}}catch(_){}return'Usuario';}
  function getInitials(name){return String(name||'U').split(' ').slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase()||'U';}
  async function loadNotes(leadId){const key=String(leadId);if(NOTES_STORE[key])return NOTES_STORE[key];const lead=__allLeadsData.find(function(l){return String(l._id)===key;});if(lead){const notas=lead.notas||lead.notas_cliente||lead.notes;if(Array.isArray(notas)&&notas.length){NOTES_STORE[key]=notas;return NOTES_STORE[key];}}const res=await AUTH.secureFetch('/api/leads/'+leadId);if(res&&res.ok){const data=await res.json().catch(function(){return{};});const src=data.data||data.lead||data;const notas=src&&(src.notas||src.notas_cliente||src.notes);NOTES_STORE[key]=Array.isArray(notas)?notas:[];}else{NOTES_STORE[key]=[];}return NOTES_STORE[key];}
  async function renderNotesPanel(leadId){const key=String(leadId),list=document.getElementById('notes-list'),badge=document.getElementById('notes-count-badge');if(!list)return;list.innerHTML='<div class="notes-empty"><div style="width:20px;height:20px;border:2px solid var(--a-line);border-top-color:var(--a);border-radius:50%;animation:spin .6s linear infinite;"></div></div>';const notes=await loadNotes(leadId);if(badge)badge.textContent=notes.length;if(!notes.length){list.innerHTML='<div class="notes-empty" id="notes-empty"><span style="font-size:1.6rem">📋</span><span>Sin notas aún.</span></div>';return;}list.innerHTML=notes.slice().reverse().map(function(n){const type=NOTE_TYPE_META[n.type]||NOTE_TYPE_META.general,initials=getInitials(n.author||'U');const dateStr=n.createdAt?new Date(n.createdAt).toLocaleString('es-MX',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';return'<div class="note-card" data-note-id="'+escHTML(n.id)+'" role="listitem"><div class="note-card-avatar">'+escHTML(initials)+'</div><div class="note-card-body"><div class="note-card-meta"><span class="note-card-author">'+escHTML(n.author||'Desconocido')+'</span><span class="note-card-time">'+escHTML(dateStr)+'</span><span class="note-type-chip '+type.cls+'">'+type.emoji+' '+type.label+'</span></div><div class="note-card-text">'+escHTML(n.text)+'</div></div><button class="note-card-delete" onclick="deleteNote(\''+key+'\',\''+escHTML(n.id)+'\')" aria-label="Eliminar nota">✕</button></div>';}).join('');}
  window.addNoteToLead=async function(){const leadId=getVal('edit-lead-id'),text=(document.getElementById('new-note-input')?document.getElementById('new-note-input').value:'').trim(),type=getVal('note-type-select')||'general',author=getCurrentUserName(),btn=document.getElementById('btn-add-note');if(!leadId){showToast('No hay cliente seleccionado','error');return;}if(!text){showToast('Escribe algo antes de guardar','error');return;}if(text.length>NOTE_MAX_CHARS){showToast('Máximo '+NOTE_MAX_CHARS+' caracteres','error');return;}const note={id:'n_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),text,type,author,createdAt:new Date().toISOString(),attachments:[]};const key=String(leadId);if(!NOTES_STORE[key])NOTES_STORE[key]=[];NOTES_STORE[key].push(note);const ta=document.getElementById('new-note-input');if(ta){ta.value='';ta.dispatchEvent(new Event('input'));}await renderNotesPanel(leadId);showToast('Nota agregada ✓','ok');showCRMNotif('nota',{cliente:getVal('edit-nombre')||leadId,actor:author,detalle:text.slice(0,90)+(text.length>90?'…':'')});if(btn)btn.disabled=true;await AUTH.secureFetch('/api/leads/'+leadId,{method:'PUT',body:JSON.stringify({notas:NOTES_STORE[key]})}).catch(function(){});if(btn)btn.disabled=false;};
  window.deleteNote=async function(leadId,noteId){const key=String(leadId);if(!NOTES_STORE[key])return;NOTES_STORE[key]=NOTES_STORE[key].filter(function(n){return n.id!==noteId;});await renderNotesPanel(leadId);showToast('Nota eliminada','ok');await AUTH.secureFetch('/api/leads/'+leadId,{method:'PUT',body:JSON.stringify({notas:NOTES_STORE[key]})}).catch(function(){});};
  function renderNoteFilesPreview(){const preview=document.getElementById('note-files-preview');if(!preview)return;preview.innerHTML='';preview.style.display='none';}
  window.handleNoteImageSelect=function(){};
  window.handleNoteAudioSelect=function(){};
  window.removeNoteAttachment=function(){};

  /* ── EXPORT CSV ── */
  function exportToCSV(){
    if(!__filteredLeads.length){showToast('Sin datos para exportar','error');return;}
    const cols=[{label:'Agente',fn:function(l){return l.agente||'';}},{label:'Nombre cliente',fn:function(l){return l.nombre_cliente||'';}},{label:'Teléfono',fn:function(l){return l.telefono||'';}},{label:'Tel. alterno',fn:function(l){return l.telefono_alt||'';}},{label:'No. cuenta',fn:function(l){return l.numero_cuenta||'';}},{label:'Autopago',fn:function(l){return l.autopago||'';}},{label:'Dirección',fn:function(l){return l.direccion||'';}},{label:'Tipo servicio',fn:function(l){return l.tipo_servicio||'';}},{label:'Sistema',fn:function(l){return l.sistema||'';}},{label:'Riesgo',fn:function(l){return l.riesgo||'';}},{label:'Día venta',fn:function(l){return l.dia_venta||'';}},{label:'Día instalación',fn:function(l){return l.dia_instalacion||'';}},{label:'Status',fn:function(l){return l.status||'';}},{label:'Colchón',fn:function(l){return l._es_colchon?'Sí':'No';}},{label:'Servicios',fn:function(l){return l.servicios||'';}},{label:'Mercado',fn:function(l){return l.mercado||'';}},{label:'Supervisor',fn:function(l){return l.supervisor||'';}},{label:'Motivo llamada',fn:function(l){return l.motivo_llamada||'';}},{label:'ZIP',fn:function(l){return l.zip_code||'';}},{label:'Puntaje',fn:function(l){return l.puntaje!==''&&l.puntaje!=null?l.puntaje:'';}}];
    function escCSV(v){const s=String(v==null?'':v).replace(/"/g,'""');return(s.includes(',')||s.includes('"')||s.includes('\n'))?'"'+s+'"':s;}
    const header=cols.map(function(c){return escCSV(c.label);}).join(',');
    const rows=__filteredLeads.map(function(lead){return cols.map(function(c){return escCSV(c.fn(lead));}).join(',');});
    const totalPuntaje=__filteredLeads.reduce(function(s,l){return s+(parseFloat(l.puntaje)||0);},0);
    const csv='\uFEFF'+[header].concat(rows).concat(['TOTAL,,,,,,,,,,,,,,,,,,,,'+totalPuntaje.toFixed(2)]).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    const now=new Date();const fecha=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
    a.href=url;a.download='CRM_'+fecha+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    showToast('Exportado ✓','ok');
  }

  /* ── CUADRATURA ── */
  var _cuadData={all:[],currentTab:'diff'};
  function normForCuad(s){return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
  window.openCuadraturaModal=function(){const modal=document.getElementById('cuadraturaModal');if(modal){modal.style.display='flex';modal.setAttribute('aria-hidden','false');}updateCuadraturaFilterInfo();limpiarCuadratura();};
  window.closeCuadraturaModal=function(){const modal=document.getElementById('cuadraturaModal');if(modal){modal.style.display='none';modal.setAttribute('aria-hidden','true');}};
  function updateCuadraturaFilterInfo(){const el=document.getElementById('cuadratura-filter-info');if(!el)return;const agent=getVal('agentFilter');const month=getVal('monthFilter');const status=document.querySelector('#quickStatusChips .stab.is-active');const parts=[];if(agent)parts.push('Agente: '+agent);if(month)parts.push('Mes: '+month);if(status&&status.dataset.status!=='all')parts.push('Status: '+status.textContent.trim());const n=__filteredLeads.length;parts.push(n+' leads');el.textContent=parts.join(' · ')||'Todos los leads ('+n+')';const warn=document.getElementById('cuadratura-filter-warn');if(warn){const hasStatus=status&&status.dataset.status!=='all';warn.style.display=hasStatus?'none':'block';}}
  window.limpiarCuadratura=function(){const inp=document.getElementById('cuadraturaInput');const res=document.getElementById('cuadratura-result');const inpP=document.getElementById('cuadratura-input-panel');const lim=document.getElementById('btn-cuadratura-limpiar');const btn=document.getElementById('btnEjecutarCuadratura');if(inp)inp.value='';if(res)res.style.display='none';if(inpP)inpP.style.display='block';if(lim)lim.style.display='none';if(btn){btn.style.display='';btn.disabled=true;}_cuadData={all:[],currentTab:'diff'};updateCuadraturaFilterInfo();};
  window.switchCuadTab=function(btn){document.querySelectorAll('.cuad-tab').forEach(function(t){t.classList.remove('is-active');});btn.classList.add('is-active');_cuadData.currentTab=btn.dataset.tab;renderCuadTable();};
  window.ejecutarCuadratura=function(){const ta=document.getElementById('cuadraturaInput');if(!ta||!ta.value.trim()){showToast('Pega tu lista primero','error');return;}const lineas=ta.value.split('\n').map(function(l){return l.trim();}).filter(Boolean);const manual=lineas.map(function(l){var nombre='',puntajeStr='',hasPuntaje=false;if(l.indexOf('\t')!==-1){var p=l.split('\t');nombre=p[0].trim();puntajeStr=p[p.length-1].trim();hasPuntaje=true;}else{var m=l.match(/^(.+?)\s+([0-9]+[.,][0-9]+)\s*$/);if(m){nombre=m[1].trim();puntajeStr=m[2].trim();hasPuntaje=true;}else{var lc=l.lastIndexOf(',');if(lc!==-1){var after=l.slice(lc+1).trim();if(/^[0-9]+([.,][0-9]+)?$/.test(after)){nombre=l.slice(0,lc).trim();puntajeStr=after;hasPuntaje=true;}else{nombre=l;}}else{nombre=l;}}}var puntaje=null;if(hasPuntaje&&puntajeStr){var pN=puntajeStr.replace(',','.');puntaje=parseFloat(pN);if(isNaN(puntaje)){puntaje=null;hasPuntaje=false;}}return{nombre:nombre||l,puntaje:puntaje,hasPuntaje:hasPuntaje};});const leads=__filteredLeads.filter(function(l){const st=normalizeStatus(l.status);if(st==='cancelled'||st==='canceled')return false;if(st==='hold')return false;if(st==='rescheduled')return false;if(st==='reserva')return false;if(st==='oficina')return false;return st==='completed'||st==='active';});const crmMap={};leads.forEach(function(lead){const norm=normForCuad(lead.nombre_cliente);if(!crmMap[norm])crmMap[norm]=[];crmMap[norm].push(lead);});const manualNormSet=new Set(manual.map(function(m){return normForCuad(m.nombre);}));const results=[];const crmUsedIndex={};manual.forEach(function(m){const norm=normForCuad(m.nombre);const crmLeads=crmMap[norm];if(!crmLeads||!crmLeads.length){var found=null;Object.keys(crmMap).forEach(function(k){if(!found&&(k.includes(norm.split(' ')[0])||norm.includes(k.split(' ')[0]))){if(norm.split(' ')[0].length>=4)found={key:k,leads:crmMap[k]};}});if(found){const idx=crmUsedIndex[found.key]||0;const lead=found.leads[idx]||found.leads[0];crmUsedIndex[found.key]=idx+1;const crmPts=parseFloat(lead.puntaje)||0;const diff=m.hasPuntaje?parseFloat((m.puntaje-crmPts).toFixed(2)):null;results.push({tipo:diff===0?'ok':(diff!==null?'diff':'miss-partial'),nombre:m.nombre,nombreCRM:lead.nombre_cliente,puntajeManual:m.puntaje,puntajeCRM:crmPts,diff:diff,parcial:true});}else{results.push({tipo:'miss',nombre:m.nombre,nombreCRM:null,puntajeManual:m.puntaje,puntajeCRM:null,diff:null});}}else{const idx=crmUsedIndex[norm]||0;const lead=crmLeads[idx]||crmLeads[crmLeads.length-1];crmUsedIndex[norm]=idx+1;const crmPts=parseFloat(lead.puntaje)||0;const diff=m.hasPuntaje?parseFloat((m.puntaje-crmPts).toFixed(2)):null;const tipo=diff===null?'ok':(diff===0?'ok':'diff');results.push({tipo:tipo,nombre:m.nombre,nombreCRM:lead.nombre_cliente,puntajeManual:m.puntaje,puntajeCRM:crmPts,diff:diff,parcial:false});}});const sobrantesMap={};leads.forEach(function(lead){const norm=normForCuad(lead.nombre_cliente);if(!manualNormSet.has(norm)){const yaIncluido=results.some(function(r){return normForCuad(r.nombreCRM||'')===norm;});if(!yaIncluido){if(!sobrantesMap[norm])sobrantesMap[norm]={nombre:lead.nombre_cliente,pts:0,count:0};sobrantesMap[norm].pts+=parseFloat(lead.puntaje)||0;sobrantesMap[norm].count++;}}});Object.values(sobrantesMap).forEach(function(s){const nota=s.count>1?' ('+s.count+' registros)':'';results.push({tipo:'extra',nombre:s.nombre+nota,nombreCRM:s.nombre,puntajeManual:null,puntajeCRM:parseFloat(s.pts.toFixed(2)),diff:null});});_cuadData.all=results;_cuadData.currentTab='diff';document.querySelectorAll('.cuad-tab').forEach(function(t){t.classList.remove('is-active');});const diffTab=document.querySelector('.cuad-tab[data-tab="diff"]');if(diffTab)diffTab.classList.add('is-active');document.getElementById('cuadratura-input-panel').style.display='none';document.getElementById('cuadratura-result').style.display='block';document.getElementById('btn-cuadratura-limpiar').style.display='';document.getElementById('btnEjecutarCuadratura').style.display='none';renderCuadKPIs();renderCuadTable();renderCuadTotales();};
  function renderCuadKPIs(){const all=_cuadData.all;const ok=all.filter(function(r){return r.tipo==='ok';}).length;const diff=all.filter(function(r){return r.tipo==='diff'||r.tipo==='miss-partial';}).length;const miss=all.filter(function(r){return r.tipo==='miss';}).length;const extra=all.filter(function(r){return r.tipo==='extra';}).length;const kpiEl=document.getElementById('cuadratura-kpis');if(!kpiEl)return;function kpi(icon,label,val,color){return'<div style="background:var(--sheet);border:1px solid var(--line-1);border-radius:var(--r2);padding:10px 12px;text-align:center;"><div style="font-size:1.1rem;">'+icon+'</div><div style="font-family:var(--f-mono);font-size:1.1rem;font-weight:800;color:'+color+';">'+val+'</div><div style="font-size:.63rem;color:var(--ink-4);text-transform:uppercase;letter-spacing:.06em;">'+label+'</div></div>';}kpiEl.innerHTML=kpi('✅','Coinciden',ok,'var(--go)')+kpi('⚠️','Diferencias',diff,'var(--warn)')+kpi('❌','No en CRM',miss,'var(--stop)')+kpi('🔍','Sobrantes CRM',extra,'var(--info)');}
  function renderCuadTable(){const tab=_cuadData.currentTab;const all=_cuadData.all;const tbody=document.getElementById('cuadratura-tbody');if(!tbody)return;const filtered=all.filter(function(r){if(tab==='ok')return r.tipo==='ok';if(tab==='diff')return r.tipo==='diff'||r.tipo==='miss-partial';if(tab==='miss')return r.tipo==='miss';if(tab==='extra')return r.tipo==='extra';return true;});if(!filtered.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--ink-4);">Sin registros en esta categoría</td></tr>';return;}tbody.innerHTML=filtered.map(function(r){var icon='',rowCls='';if(r.tipo==='ok'){icon='✅';rowCls='cuad-row-ok';}else if(r.tipo==='diff'){icon='⚠️';rowCls='cuad-row-diff';}else if(r.tipo==='miss-partial'){icon='⚠️~';rowCls='cuad-row-diff';}else if(r.tipo==='miss'){icon='❌';rowCls='cuad-row-miss';}else if(r.tipo==='extra'){icon='🔍';rowCls='cuad-row-extra';}var ptsManual=r.puntajeManual!=null?r.puntajeManual.toFixed(2):'—';var ptsCRM=r.puntajeCRM!=null?r.puntajeCRM.toFixed(2):'—';var diffStr='—';var diffColor='';if(r.diff!=null){diffStr=(r.diff>0?'+':'')+r.diff.toFixed(2);diffColor=r.diff>0?'color:var(--warn)':r.diff<0?'color:var(--stop)':'color:var(--go)';}var nombre=escHTML(r.nombre||(r.tipo==='extra'?r.nombreCRM:''));if(r.parcial)nombre+=' <span style="font-size:.6rem;color:var(--ink-4);">(parcial)</span>';return'<tr class="'+rowCls+'"><td>'+icon+'</td><td>'+nombre+'</td><td style="text-align:right;font-family:var(--f-mono);">'+escHTML(ptsManual)+'</td><td style="text-align:right;font-family:var(--f-mono);">'+escHTML(ptsCRM)+'</td><td style="text-align:right;font-family:var(--f-mono);'+diffColor+'">'+escHTML(diffStr)+'</td></tr>';}).join('');}
  function renderCuadTotales(){const el=document.getElementById('cuadratura-totales');if(!el)return;const all=_cuadData.all;const totManual=all.filter(function(r){return r.tipo!=='extra';}).reduce(function(s,r){return s+(r.puntajeManual||0);},0);const totCRMMatchados=all.filter(function(r){return r.tipo!=='extra'&&r.puntajeCRM!=null;}).reduce(function(s,r){return s+(r.puntajeCRM||0);},0);const totCRMReal=all.filter(function(r){return r.puntajeCRM!=null;}).reduce(function(s,r){return s+(r.puntajeCRM||0);},0);const diff=parseFloat((totManual-totCRMMatchados).toFixed(2));const diffColor=diff===0?'var(--go)':diff>0?'var(--warn)':'var(--stop)';el.innerHTML='<span>Manual: <b>'+totManual.toFixed(2)+' pts</b></span><span>CRM (matchados): <b>'+totCRMMatchados.toFixed(2)+' pts</b></span>'+(totCRMReal!==totCRMMatchados?'<span style="color:var(--info)">CRM total: <b>'+totCRMReal.toFixed(2)+' pts</b></span>':'')+'<span style="color:'+diffColor+'">Diferencia: <b>'+(diff>0?'+':'')+diff.toFixed(2)+' pts</b></span>';}

  // ── PHONE NUMBERS CUADRATURA ──
  function normalizePhoneNumber(phone){var cleaned=String(phone||'').replace(/\D/g,'');if(cleaned.length>10){cleaned=cleaned.slice(-10);}return cleaned;}
  window.switchCuadMode=function(mode){document.querySelectorAll('[id^="cuad-mode-"]').forEach(function(el){el.style.display='none';});document.querySelectorAll('.cuad-mode-tab').forEach(function(btn){btn.classList.remove('is-active');});const modeEl=document.getElementById('cuad-mode-'+mode);if(modeEl)modeEl.style.display='block';const modeBtn=document.getElementById('cuad-tab-'+mode);if(modeBtn)modeBtn.classList.add('is-active');if(mode==='telefonos'){limpiarCuadraturaTelefonos();updateCuadraturaPhonesFilterInfo();document.getElementById('btnEjecutarCuadratura').style.display='none';document.getElementById('btnEjecutarCuadraturaTelefonos').style.display='';document.getElementById('btn-cuadratura-limpiar').style.display='none';document.getElementById('btn-cuadratura-limpiar-phones').style.display='none';}else{limpiarCuadratura();document.getElementById('btnEjecutarCuadratura').style.display='';document.getElementById('btnEjecutarCuadraturaTelefonos').style.display='none';document.getElementById('btn-cuadratura-limpiar').style.display='none';document.getElementById('btn-cuadratura-limpiar-phones').style.display='none';}};
  window.ejecutarCuadraturaTelefonos=function(){
    const ta=document.getElementById('cuadraturaPhoneInput');
    if(!ta||!ta.value.trim()){showToast('Pega tu lista de teléfonos primero','error');return;}
    const lineas=ta.value.split('\n').map(function(l){return l.trim();}).filter(Boolean);
    const inputPhones=new Set();
    lineas.forEach(function(line){const n=normalizePhoneNumber(line);if(n)inputPhones.add(n);});
    if(!inputPhones.size){showToast('No se encontraron números válidos','error');return;}
    const monthInput=document.getElementById('cuadratura-phone-month').value;
    const sourceEl=document.querySelector('input[name="cuad-phone-source"]:checked');
    const source=sourceEl?sourceEl.value:'residencial';
    let query='/api/phones-unified?source='+source;
    if(monthInput){const parts=monthInput.split('-');query+='&month='+parts[1]+'&year='+parts[0];}
    AUTH.secureFetch(query).then(function(r){return r.json();}).then(function(data){
      if(!data.success||!data.phones){showToast('Error cargando teléfonos de servidor','error');return;}
      // CRM phones NOT in input list (registros únicos del CRM ausentes de tu lista)
      const crmNotInInput=[];
      const crmPhoneSet=new Set();
      const crmRawTotal=data.phones.length;
      const crmNoPhone=data.phones.filter(function(l){return !normalizePhoneNumber(l.telefono_principal);}).length;
      data.phones.forEach(function(lead){
        const phone=normalizePhoneNumber(lead.telefono_principal);
        if(!phone)return;
        if(!crmPhoneSet.has(phone)){
          crmPhoneSet.add(phone);
          if(!inputPhones.has(phone)){
            crmNotInInput.push({phone:phone,cliente:lead.nombre_cliente||'—',status:lead.status||'—'});
          }
        }
      });
      // Input phones NOT in CRM (tu lista que no existe en CRM)
      const inputNotInCRM=[];
      inputPhones.forEach(function(phone){
        if(!crmPhoneSet.has(phone))inputNotInCRM.push(phone);
      });
      const duplicadosCRM=crmRawTotal - crmNoPhone - crmPhoneSet.size;
      _cuadData.phones={
        inputCount:inputPhones.size,
        crmUniqueCount:crmPhoneSet.size,
        crmRawTotal:crmRawTotal,
        crmNoPhone:crmNoPhone,
        duplicadosCRM:duplicadosCRM,
        crmNotInInput:crmNotInInput,
        inputNotInCRM:inputNotInCRM
      };
      document.getElementById('cuadratura-telefonos-input-panel').style.display='none';
      document.getElementById('cuadratura-phone-result').style.display='block';
      document.getElementById('btn-cuadratura-limpiar-phones').style.display='';
      document.getElementById('btnEjecutarCuadraturaTelefonos').style.display='none';
      renderCuadPhoneKPIs();renderCuadPhoneTable();
    }).catch(function(e){console.error('[Cuadratura Phones]',e);showToast('Error consultando teléfonos','error');});
  };
  function renderCuadPhoneKPIs(){
    const data=_cuadData.phones;const kpiEl=document.getElementById('cuadratura-phone-kpis');if(!kpiEl||!data)return;
    function kpi(icon,label,val,color){return'<div style="background:var(--sheet);border:1px solid var(--line-1);border-radius:var(--r2);padding:10px 12px;text-align:center;"><div style="font-size:1.1rem;">'+icon+'</div><div style="font-family:var(--f-mono);font-size:1.1rem;font-weight:800;color:'+color+';">'+val+'</div><div style="font-size:.63rem;color:var(--ink-4);text-transform:uppercase;letter-spacing:.06em;line-height:1.3;">'+label+'</div></div>';}
    kpiEl.innerHTML=
      kpi('📋','Tu lista',data.inputCount||0,'var(--ink-1)')+
      kpi('🗄️','CRM únicos',data.crmUniqueCount||0,'var(--info)')+
      kpi('🔴','CRM no en lista',(data.crmNotInInput||[]).length,'var(--stop)')+
      kpi('⚠️','Lista no en CRM',(data.inputNotInCRM||[]).length,'var(--warn)');
    // Info line
    const infoEl=document.getElementById('cuadratura-phone-info');if(!infoEl)return;
    const parts=[];
    parts.push('Registros totales en CRM: <b>'+(data.crmRawTotal||0)+'</b>');
    if(data.crmNoPhone)parts.push('Sin teléfono: <b>'+data.crmNoPhone+'</b>');
    if(data.duplicadosCRM>0)parts.push('Teléfonos duplicados (mismo número, varios registros): <b>'+data.duplicadosCRM+'</b>');
    infoEl.innerHTML=parts.join(' &nbsp;·&nbsp; ');
  }
  function renderCuadPhoneTable(){
    const data=_cuadData.phones;
    // Table 1: CRM not in input
    const tbody=document.getElementById('cuadratura-phone-tbody');
    if(tbody){
      if(!(data.crmNotInInput||[]).length){
        tbody.innerHTML='<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--ink-4);">✅ Todos los teléfonos únicos del CRM están en tu lista</td></tr>';
      }else{
        tbody.innerHTML=(data.crmNotInInput||[]).map(function(row){return'<tr style="border-bottom:1px solid var(--line-1);"><td style="padding:7px 12px;">'+escHTML(row.cliente)+'</td><td style="padding:7px 12px;font-family:var(--f-mono);font-weight:600;">'+escHTML(row.phone)+'</td><td style="padding:7px 12px;font-size:.7rem;color:var(--ink-3);">'+escHTML(row.status)+'</td></tr>';}).join('');
      }
    }
    // Table 2: input not in CRM
    const tbody2=document.getElementById('cuadratura-phone-tbody-2');
    if(tbody2){
      if(!(data.inputNotInCRM||[]).length){
        tbody2.innerHTML='<tr><td style="text-align:center;padding:20px;color:var(--ink-4);">✅ Todos tus números fueron encontrados en CRM</td></tr>';
      }else{
        tbody2.innerHTML=(data.inputNotInCRM||[]).map(function(phone){return'<tr style="border-bottom:1px solid var(--line-1);"><td style="padding:7px 12px;font-family:var(--f-mono);font-weight:600;">'+escHTML(phone)+'</td></tr>';}).join('');
      }
    }
  }
  window.limpiarCuadraturaTelefonos=function(){const inp=document.getElementById('cuadraturaPhoneInput');const res=document.getElementById('cuadratura-phone-result');const inpP=document.getElementById('cuadratura-telefonos-input-panel');const monthInput=document.getElementById('cuadratura-phone-month');if(inp)inp.value='';if(res)res.style.display='none';if(inpP)inpP.style.display='block';if(monthInput)monthInput.value='';_cuadData.phones={inputCount:0,crmUniqueCount:0,crmRawTotal:0,crmNoPhone:0,duplicadosCRM:0,crmNotInInput:[],inputNotInCRM:[]};updateCuadraturaPhonesFilterInfo();};
  function updateCuadraturaPhonesFilterInfo(){const monthInput=document.getElementById('cuadratura-phone-month');const infoEl=document.getElementById('cuadratura-phone-filter-info');if(!infoEl||!monthInput)return;if(monthInput.value){const parts=monthInput.value.split('-');const month=parseInt(parts[1],10);const meses=['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];const monthName=meses[month]||parts[1];infoEl.innerHTML='📅 '+monthName+' '+parts[0];}else{infoEl.innerHTML='Sin mes seleccionado';}}

  /* ── SCROLLBAR MIRROR ── */
  function initScrollMirror(){const scroll=document.querySelector('.tscroll'),mirror=document.getElementById('scrollbarMirror'),inner=document.getElementById('scrollbarMirrorInner');if(!scroll||!mirror||!inner)return;function syncWidth(){inner.style.width=scroll.scrollWidth+'px';}scroll.addEventListener('scroll',function(){mirror.scrollLeft=scroll.scrollLeft;});mirror.addEventListener('scroll',function(){scroll.scrollLeft=mirror.scrollLeft;});if(window.ResizeObserver)new ResizeObserver(syncWidth).observe(scroll);syncWidth();}

  /* ── LOADER HTML ── */
  function getLoaderTR(label){
    label = label || 'CARGANDO';
    const txt = label.toUpperCase();
    return '<tr><td colspan="19"><div class="crm-loader-wrap">'
      + '<div class="loader">'
      + ['<span>'+txt+'</span>','<span>'+txt+'</span>','<span>'+txt+'</span>',
         '<span>'+txt+'</span>','<span>'+txt+'</span>','<span>'+txt+'</span>',
         '<span>'+txt+'</span>','<span>'+txt+'</span>','<span>'+txt+'</span>']
        .map(function(s){ return '<div class="text">'+s+'</div>'; }).join('')
      + '<div class="line"></div>'
      + '</div>'
      + '</div></td></tr>';
  }

  /* ── INIT ── */
  async function loadInitialData(){
    if(!AUTH.check())return;
    const tbody=document.getElementById('costumer-tbody');
    if(tbody)tbody.innerHTML=getLoaderTR();
    // Paralelizar: verificar sesión, cargar teams y filtros al mismo tiempo
    const [valid] = await Promise.all([
      AUTH.verifySession(),
      loadTeams(),
      fetchUsersForFilters().catch(function(){}),
      fetchMonthsForFilters().catch(function(){})
    ]);
    if(!valid){showToast('Sesión no válida. Redirigiendo…','error');setTimeout(function(){AUTH.redirectToLogin('invalid');},1200);return;}
    const leads=await fetchLeads();
    window.renderCostumerTable(leads);
    setInterval(async function(){const ok=await AUTH.verifySession();if(!ok){showToast('Tu sesión ha expirado','error');setTimeout(function(){AUTH.redirectToLogin('session_timeout');},1500);}},30*60*1000);
  }

  function initSocketNotifications(){
    if(__socket||typeof io!=='function')return;
    try{
      __socket=io({transports:['websocket','polling'],withCredentials:true});
      // Intentar todas las claves posibles donde se guarda el usuario
      const raw=localStorage.getItem('user')||sessionStorage.getItem('user')||localStorage.getItem('crm_user')||sessionStorage.getItem('crm_user');
      let userData={};try{userData=raw?JSON.parse(raw):{};}catch(_){}
      const userRole=String(userData.role||userData.rol||userData.rol_nombre||'').toLowerCase();
      __socket.emit('register',{username:userData.username||userData.name,role:userRole});
      __socket.on('connect',function(){ document.dispatchEvent(new Event('crm-socket-ready')); });
      document.dispatchEvent(new Event('crm-socket-ready'));
      // Las notificaciones (note-added, lead-updated, lead-deleted, force-logout)
      // son manejadas por crm-notifications.js (cargado via sidebar-loader).
      // No registrar listeners duplicados aquí.
    }catch(e){console.warn('[SOCKET]',e);}
  }

  // ── SISTEMA DE NOTIFICACIONES ───────────────────────────────
  (function(){
    // Contenedor de notificaciones apiladas
    var _container = null;
    function getContainer(){
      if(!_container){
        _container = document.createElement('div');
        _container.id = 'crm-notif-stack';
        _container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
        document.body.appendChild(_container);
      }
      return _container;
    }

    var TYPE_CFG = {
      status:  { color:'#6C47FF', bg:'#f0ecff', icon:'🔄', label:'Cambio de Status'  },
      edicion: { color:'#f59e0b', bg:'#fffbeb', icon:'✏️',  label:'Lead Editado'      },
      nota:    { color:'#10b981', bg:'#ecfdf5', icon:'📝',  label:'Nota Agregada'     },
      deleted: { color:'#ef4444', bg:'#fef2f2', icon:'🗑️',  label:'Lead Eliminado'    },
      info:    { color:'#3b82f6', bg:'#eff6ff', icon:'ℹ️',  label:'Info'              },
    };

    function fmtTime(){ return new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}); }

    window.showCRMNotif = function(tipo, data){
      // data: { cliente, actor, detalle, extra }
      var cfg = TYPE_CFG[tipo] || TYPE_CFG.info;
      var card = document.createElement('div');
      card.style.cssText = [
        'pointer-events:all;width:320px;background:#fff;border-radius:14px;',
        'box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;',
        'display:flex;flex-direction:column;',
        'transform:translateX(360px);transition:transform .35s cubic-bezier(.16,1,.3,1),opacity .35s;opacity:0;',
        'font-family:system-ui,sans-serif;'
      ].join('');

      var actor = data.actor || 'Usuario';
      var cliente = data.cliente || '';
      var detalle = data.detalle || '';
      var extra = data.extra || '';
      var hora = fmtTime();

      card.innerHTML = [
        '<div style="height:4px;background:'+cfg.color+'"></div>',
        '<div style="padding:14px 16px;display:flex;gap:12px;align-items:flex-start;">',
          '<div style="width:38px;height:38px;border-radius:10px;background:'+cfg.bg+';display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">'+cfg.icon+'</div>',
          '<div style="flex:1;min-width:0;">',
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">',
              '<span style="font-size:.72rem;font-weight:700;color:'+cfg.color+';text-transform:uppercase;letter-spacing:.04em;">'+cfg.label+'</span>',
              '<span style="font-size:.68rem;color:#9ca3af;">'+hora+'</span>',
            '</div>',
            (cliente ? '<div style="font-size:.85rem;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;">'+escHTML(cliente)+'</div>' : ''),
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">',
              '<div style="width:20px;height:20px;border-radius:50%;background:'+cfg.color+';color:#fff;font-size:.62rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+escHTML(actor.charAt(0).toUpperCase())+'</div>',
              '<span style="font-size:.78rem;color:#374151;font-weight:600;">'+escHTML(actor)+'</span>',
            '</div>',
            (detalle ? '<div style="font-size:.76rem;color:#6b7280;margin-top:2px;">'+escHTML(detalle)+'</div>' : ''),
            (extra   ? '<div style="font-size:.74rem;color:'+cfg.color+';font-weight:600;margin-top:4px;padding:3px 8px;background:'+cfg.bg+';border-radius:6px;display:inline-block;">'+escHTML(extra)+'</div>' : ''),
          '</div>',
          '<button style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:1rem;padding:0;line-height:1;flex-shrink:0;" onclick="this.closest(\'.crm-notif-card\').remove()">✕</button>',
        '</div>',
        '<div class="crm-notif-bar" style="height:3px;background:'+cfg.color+';transform-origin:left;animation:crm-shrink 6s linear forwards;"></div>'
      ].join('');
      card.classList.add('crm-notif-card');

      if(!document.getElementById('crm-notif-kf')){
        var s=document.createElement('style');
        s.id='crm-notif-kf';
        s.textContent='@keyframes crm-shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}';
        document.head.appendChild(s);
      }

      getContainer().appendChild(card);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        card.style.transform='translateX(0)'; card.style.opacity='1';
      });});

      var timer = setTimeout(function(){ dismissCard(card); }, 6000);
      card.addEventListener('mouseenter', function(){ clearTimeout(timer); });
      card.addEventListener('mouseleave', function(){ timer=setTimeout(function(){ dismissCard(card); },3000); });

      // Notif nativa (cuando la pestaña está en background)
      if('Notification' in window && Notification.permission==='granted' && document.hidden){
        try{ new Notification(cfg.label+(cliente?' — '+cliente:''), { body: (actor?actor+': ':'')+detalle, icon:'/favicon.ico' }); }catch(_){}
      }
    };

    function dismissCard(card){
      card.style.opacity='0'; card.style.transform='translateX(360px)';
      setTimeout(function(){ if(card.parentNode) card.parentNode.removeChild(card); }, 380);
    }

    // Wrapper retrocompatible
    window.showWinNotif = function(title, body){
      window.showCRMNotif('info', { cliente: title, detalle: body, actor: '' });
    };
  })();

  function initNotifBanner() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    var banner = document.createElement('div');
    banner.id = 'notif-banner';
    banner.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#1e1b4b;color:#fff;border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,.3);font-size:.82rem;max-width:320px;';
    banner.innerHTML = '<span style="font-size:1.3rem">🔔</span><span style="flex:1;line-height:1.4">Activa las notificaciones para recibir alertas en tiempo real</span><button id="notif-allow-btn" style="background:#6C47FF;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap;">Activar</button><button id="notif-dismiss-btn" style="background:transparent;color:#aaa;border:none;cursor:pointer;font-size:1rem;padding:0 2px;">✕</button>';
    document.body.appendChild(banner);
    document.getElementById('notif-allow-btn').addEventListener('click', function() {
      Notification.requestPermission().then(function(p) {
        banner.remove();
        if (p === 'granted') showCRMNotif('info', { cliente:'Notificaciones activadas', detalle:'Recibirás alertas de cambios en tiempo real', actor:'' });
      });
    });
    document.getElementById('notif-dismiss-btn').addEventListener('click', function() { banner.remove(); });
  }

  document.addEventListener('DOMContentLoaded',function(){
    initNotifBanner();
    initSocketNotifications();initScrollMirror();
    const ud=getUserData(),role=String(ud.role||'').toLowerCase();

    // ── FIX: Supervisores arrancan sin "Solo 2 meses" para ver todos sus leads ──
    const isSup=isSupervisor(role);
    onlyTwoMonths=false; // siempre false al iniciar
    const tmBtn=document.getElementById('toggleMonthsBtn');
    if(tmBtn){
      tmBtn.textContent='Solo 2 meses'; // siempre muestra "Solo 2 meses" al inicio
      tmBtn.classList.remove('active');
    }

    const colchonCb=document.getElementById('check-colchon-activas');
    if(colchonCb)colchonCb.addEventListener('change',function(){updateKPIs();});

    const searchEl=document.getElementById('costumer-search');if(searchEl)searchEl.addEventListener('input',applyFiltersDebounced);
    const refreshBtn=document.getElementById('refresh-table');
    if(refreshBtn)refreshBtn.addEventListener('click',async function(){refreshBtn.disabled=true;refreshBtn.textContent='↻ Cargando…';const m=getVal('monthFilter')||'';const leads=await fetchLeads(m||undefined);window.renderCostumerTable(leads);refreshBtn.disabled=false;refreshBtn.textContent='↻ Refrescar';});
    document.querySelectorAll('#quickStatusChips .stab').forEach(function(btn){btn.addEventListener('click',function(){document.querySelectorAll('#quickStatusChips .stab').forEach(function(b){b.classList.remove('is-active');});btn.classList.add('is-active');activeStatusTab=btn.dataset.status||'all';currentPage=1;applyFiltersDebounced();});});
    const pagePrev=document.getElementById('pagePrev'),pageNext=document.getElementById('pageNext');
    if(pagePrev)pagePrev.addEventListener('click',function(){if(currentPage>1){currentPage--;renderTableRows();}});
    if(pageNext)pageNext.addEventListener('click',function(){const ps=pageSize===99999?__filteredLeads.length:pageSize;const pages=Math.ceil(__filteredLeads.length/(ps||1))||1;if(currentPage<pages){currentPage++;renderTableRows();}});
    const psSelect=document.getElementById('pageSizeSelect');if(psSelect)psSelect.addEventListener('change',function(){pageSize=parseInt(this.value,10)||100;currentPage=1;renderTableRows();});
    if(tmBtn)tmBtn.addEventListener('click',function(){onlyTwoMonths=!onlyTwoMonths;tmBtn.textContent=onlyTwoMonths?'Todos los meses':'Solo 2 meses';tmBtn.classList.toggle('active',onlyTwoMonths);currentPage=1;applyFiltersDebounced();});
    const btnClear=document.getElementById('btnClearDates');if(btnClear)btnClear.addEventListener('click',function(){setVal('dateFrom','');setVal('dateTo','');applyFiltersDebounced();});
    ['dateFrom','dateTo'].forEach(function(id){const el=document.getElementById(id);if(el)el.addEventListener('change',applyFiltersDebounced);});
    // Add event listeners for all filter selects
    // monthFilter → re-fetch desde servidor con el mes seleccionado
    const monthFilterEl=document.getElementById('monthFilter');
    if(monthFilterEl)monthFilterEl.addEventListener('change',async function(){
      const m=this.value||undefined;
      const tbody=document.getElementById('costumer-tbody');
      if(tbody)tbody.innerHTML=getLoaderTR();
      const leads=await fetchLeads(m);
      window.renderCostumerTable(leads);
    });
    ['serviceFilter','teamFilter','agentFilter','mercadoFilter'].forEach(function(id){const el=document.getElementById(id);if(el)el.addEventListener('change',applyFiltersDebounced);});
    const compactBtn=document.getElementById('toggle-compact'),table=document.querySelector('.costumer-table');if(compactBtn&&table)compactBtn.addEventListener('click',function(){table.classList.toggle('compact-mode');});
    document.querySelectorAll('.token select').forEach(function(sel){sel.addEventListener('change',function(){const token=sel.closest('.token');if(!token)return;const tvId=token.querySelector('[id^="tv-"]');if(tvId){const chosen=sel.options[sel.selectedIndex];tvId.textContent=chosen.text;token.classList.toggle('active',!!sel.value);}applyFiltersDebounced();});});
    const cuadBtn=document.getElementById('btn-cuadratura');if(cuadBtn)cuadBtn.addEventListener('click',window.openCuadraturaModal);

    // ── Botón 🔔 activa notificaciones manualmente ──
    const enBtn=document.getElementById('enable-notifications-btn');
    if(enBtn){
      enBtn.addEventListener('click',function(){
        if(!('Notification' in window)){showToast('Tu navegador no soporta notificaciones','warn');return;}
        if(Notification.permission==='granted'){showCRMNotif('info',{cliente:'Notificaciones activas',detalle:'Ya tienes las notificaciones activadas',actor:''});return;}
        Notification.requestPermission().then(function(p){
          if(p==='granted'){showCRMNotif('info',{cliente:'Notificaciones activadas',detalle:'Recibirás alertas de cambios en tiempo real',actor:''});}
          else{showToast('Permiso denegado — actívalo desde la configuración del navegador','warn');}
        });
      });
    }

    // ── Botón force-logout (solo admins) ──
    const flBtn=document.getElementById('btn-force-logout');
    if(flBtn){
      if(isAdminOrBackoffice(role)) flBtn.style.display='';
      flBtn.addEventListener('click',async function(){
        if(!confirm('¿Cerrar sesión de TODOS los usuarios?\nTendrán que iniciar sesión nuevamente.'))return;
        flBtn.disabled=true; flBtn.textContent='⏳ Cerrando sesiones…';
        try{
          const res=await AUTH.secureFetch('/api/admin/force-logout-all',{method:'POST'});
          if(res&&res.ok){showToast('Todas las sesiones cerradas ✓','ok');}
          else{showToast('Error al cerrar sesiones','error');}
        }catch(e){showToast('Error: '+e.message,'error');}
        flBtn.disabled=false; flBtn.innerHTML='⏏ Cerrar todas las sesiones';
      });
    }

    // ── Popup anuncio único: sistema de notificaciones ──
    if(!localStorage.getItem('crm_notif_announcement_v1')){
      setTimeout(function(){
        var overlay=document.createElement('div');
        overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);';
        overlay.innerHTML=[
          '<div style="background:#fff;border-radius:20px;max-width:420px;width:100%;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.3);font-family:system-ui,sans-serif;">',
            '<div style="background:linear-gradient(135deg,#6C47FF,#a855f7);padding:28px 28px 20px;color:#fff;text-align:center;">',
              '<div style="font-size:2.5rem;margin-bottom:8px;">🔔</div>',
              '<div style="font-size:1.2rem;font-weight:700;margin-bottom:4px;">Sistema de Notificaciones</div>',
              '<div style="font-size:.82rem;opacity:.85;">Ya está activo en el CRM</div>',
            '</div>',
            '<div style="padding:24px 28px;">',
              '<ul style="list-style:none;padding:0;margin:0 0 20px;display:flex;flex-direction:column;gap:12px;">',
                '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">🔄</span><div><strong style="display:block;font-size:.85rem;color:#111;">Cambio de status</strong><span style="font-size:.78rem;color:#6b7280;">Recibirás alerta cuando se modifique el status de un lead</span></div></li>',
                '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">✏️</span><div><strong style="display:block;font-size:.85rem;color:#111;">Edición de leads</strong><span style="font-size:.78rem;color:#6b7280;">Notificación cuando un agente edita información</span></div></li>',
                '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">📝</span><div><strong style="display:block;font-size:.85rem;color:#111;">Notas nuevas</strong><span style="font-size:.78rem;color:#6b7280;">Alerta cuando se agrega una nota a tu cliente</span></div></li>',
                '<li style="display:flex;gap:12px;align-items:flex-start;"><span style="font-size:1.2rem">🗑️</span><div><strong style="display:block;font-size:.85rem;color:#111;">Lead eliminado</strong><span style="font-size:.78rem;color:#111;background:#fef2f2;padding:1px 6px;border-radius:4px;font-size:.75rem;">(Solo admins)</span></div></li>',
              '</ul>',
              '<button id="crm-notif-ann-btn" style="width:100%;background:#6C47FF;color:#fff;border:none;border-radius:12px;padding:13px;font-size:.9rem;font-weight:700;cursor:pointer;">Activar notificaciones ahora</button>',
              '<button id="crm-notif-ann-skip" style="width:100%;background:none;border:none;color:#9ca3af;font-size:.78rem;cursor:pointer;margin-top:8px;padding:6px;">Quizás más tarde</button>',
            '</div>',
          '</div>'
        ].join('');
        document.body.appendChild(overlay);

        document.getElementById('crm-notif-ann-btn').addEventListener('click',function(){
          if('Notification' in window && Notification.permission==='default'){
            Notification.requestPermission().then(function(p){
              if(p==='granted') showCRMNotif('info',{cliente:'Notificaciones activadas',detalle:'Recibirás alertas en tiempo real',actor:''});
            });
          }
          localStorage.setItem('crm_notif_announcement_v1','1');
          overlay.remove();
        });
        document.getElementById('crm-notif-ann-skip').addEventListener('click',function(){
          localStorage.setItem('crm_notif_announcement_v1','1');
          overlay.remove();
        });
      }, 1200);
    }

    // ── Socket: force-logout ──
    if(typeof io==='function'&&!window.__forceLogoutListening){
      window.__forceLogoutListening=true;
      document.addEventListener('crm-socket-ready',function(){
        if(window.__socket){
          window.__socket.on('force-logout',function(){
            showToast('El administrador cerró todas las sesiones','warn');
            setTimeout(function(){AUTH.redirectToLogin('force_logout');},2000);
          });
        }
      });
    }
    const getScroll=function(){return document.querySelector('.tscroll');};
    const slBtn=document.getElementById('scroll-left'),srBtn=document.getElementById('scroll-right');
    if(slBtn)slBtn.addEventListener('click',function(){const s=getScroll();if(s)s.scrollLeft-=300;});
    if(srBtn)srBtn.addEventListener('click',function(){const s=getScroll();if(s)s.scrollLeft+=300;});
    const noteTA=document.getElementById('new-note-input'),charCount=document.getElementById('note-char-count');
    if(noteTA&&charCount){noteTA.addEventListener('input',function(){const len=noteTA.value.length;charCount.textContent=len+' / '+NOTE_MAX_CHARS;charCount.classList.toggle('over-limit',len>NOTE_MAX_CHARS);});noteTA.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();window.addNoteToLead();}});}
    const addNoteBtn=document.getElementById('btn-add-note');if(addNoteBtn)addNoteBtn.addEventListener('click',window.addNoteToLead);
    const avatar=document.getElementById('compose-avatar');if(avatar)avatar.textContent=getInitials(getCurrentUserName());
    const wrapper=document.getElementById('editarModal-wrapper');if(wrapper)wrapper.addEventListener('click',function(e){if(e.target===wrapper)window.cerrarModal();});
    document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;if(document.getElementById('editarModal-wrapper').style.display!=='none')window.cerrarModal();if(document.getElementById('bulkStatusPhoneModal').getAttribute('aria-hidden')==='false')window.closeBulkStatusPhoneModal();if(document.getElementById('cuadraturaModal')&&document.getElementById('cuadraturaModal').getAttribute('aria-hidden')==='false')window.closeCuadraturaModal();});
    const cuadTA=document.getElementById('cuadraturaInput');
    if(cuadTA)cuadTA.addEventListener('input',function(){const lines=cuadTA.value.split('\n').map(function(l){return l.trim();}).filter(Boolean);const cnt=document.getElementById('cuadratura-count');if(cnt)cnt.textContent=lines.length+' líneas';const btn=document.getElementById('btnEjecutarCuadratura');if(btn)btn.disabled=lines.length===0;});
    const cuadPhoneTA=document.getElementById('cuadraturaPhoneInput');
    if(cuadPhoneTA)cuadPhoneTA.addEventListener('input',function(){const lines=cuadPhoneTA.value.split('\n').map(function(l){return l.trim();}).filter(Boolean);const cnt=document.getElementById('cuadratura-phone-count');if(cnt)cnt.textContent=lines.length+' números';const btn=document.getElementById('btnEjecutarCuadraturaTelefonos');if(btn)btn.disabled=lines.length===0;});
    const cuadPhoneMonth=document.getElementById('cuadratura-phone-month');
    if(cuadPhoneMonth)cuadPhoneMonth.addEventListener('change',updateCuadraturaPhonesFilterInfo);
    // Update hint text when source radio changes
    document.querySelectorAll('input[name="cuad-phone-source"]').forEach(function(radio){
      radio.addEventListener('change',function(){
        const hint=document.getElementById('cuad-phone-source-hint');
        if(!hint)return;
        if(radio.value==='residencial'){hint.innerHTML='Un número por línea. Compara contra <b>costumers_unified</b> (Servicios Residenciales). Formato: <b>1234567890</b>';}
        else{hint.innerHTML='Un número por línea. Compara contra <b>TEAM_LINEAS</b>. Formato: <b>1234567890</b>';}
      });
    });

    const canUse=canUseBulkStatus();
    const bspBtn=document.getElementById('btn-bulk-status-phone');
    if(bspBtn){bspBtn.style.display=canUse?'':'none';if(canUse)bspBtn.addEventListener('click',window.openBulkStatusPhoneModal);}
    const selSt=document.getElementById('bulkNewStatus');
    const ta1=document.getElementById('bulkPhoneNumbers');const ta2=document.getElementById('bulkNamesList');
    if(ta1)ta1.addEventListener('input',_updateBulkCount);
    if(ta2)ta2.addEventListener('input',_updateBulkCount);
    if(selSt)selSt.addEventListener('change',_updateBulkCount);

    loadInitialData();
  });

})();
