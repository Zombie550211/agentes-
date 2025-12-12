// auto-stubbed runtime globals
var window = {}; var document = { querySelector: ()=>null, querySelectorAll: ()=>[] }; var Map = global.Map; var Array = global.Array;

      function maskPin(v){
        const s = String(v || '');
        return s ? '•'.repeat(Math.min(4, s.length)) : '';
      }
      function serviciosResumen(l){
        const arr = Array.isArray(l.telefonos)? l.telefonos:[];
        if(arr.length){ const m=new Map(); arr.forEach(t=>{ const k=(t?.servicio||t?.tipo||'').toString().trim()||'SERVICIO'; m.set(k,(m.get(k)||0)+1);}); return [...m.entries()].map(([k,v])=> v>1?`${k} x${v}`:k).join('; '); }
        return l.servicios_texto||l.tipo_servicios||l.servicios||l.producto||'';
      }
      // normDate ahora se carga desde js/date-formatter.js
      function teamHeader(){ return ['NOMBRE CLIENTE','TELÉFONO PRINCIPAL','NÚMERO DE CUENTA','AUTOPAGO','PIN DE SEGURIDAD','DIRECCIÓN','DÍA DE VENTA','DÍA DE INSTALACIÓN','STATUS','CANTIDAD DE LÍNEAS','TELÉFONOS DE LAS LÍNEAS','ID','SUPERVISOR','MERCADO']; }
      // Normalización de nombres de agente (alias -> canónico)
      function __normStrAgent(s){
        try {
          return String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\s+/g,'').replace(/\./g,'');
        } catch { return String(s||'').toLowerCase().replace(/\s+/g,'').replace(/\./g,''); }
      }
      function agentCanonicalName(name){
        const n = __normStrAgent(name);
        const map = {
          'eduardor': 'Eduardo Rivas',
          'eduardorivas': 'Eduardo Rivas',
          'eduardorrivas': 'Eduardo Rivas',
          'alexanderhernandez': 'Riquelmi Torres',
          'julioMejia': 'Julio Chavez',
          'juliomejia': 'Julio Chavez'
        };
        return map[n] || (name || '');
      }
      function agentName(l){
        const raw = l.agenteNombre||l.nombreAgente||l.agente||l.agent||l.ownerName||l.vendedor||l.seller||'';
        return agentCanonicalName(raw);
      }
      function applyHeader(){ const thead=document.querySelector('.costumer-table thead'); if(!thead) return; const hs=teamHeader(); thead.innerHTML=`<tr>${hs.map(h=>`<th>${h}</th>`).join('')}</tr>`; }
      // Efficient renderer: uses batched rendering with DocumentFragment to avoid
      // repeated reflows when inserting many rows. Renders in micro-batches so
      // the main thread is not blocked for long periods.
      function renderRows(list){
        const tbody = document.getElementById('costumer-tbody'); if(!tbody) return;
        // Clear existing rows quickly
        tbody.innerHTML = '';

        const rows = Array.isArray(list) ? list : (Array.isArray(list?.leads) ? list.leads : []);
        if (rows.length === 0) return;

        const batchSize = 200; // tuneable: number of rows rendered per tick
        let idx = 0;

        function makeTrFromLead(l) {
          const autop = (l.autopay ?? l.autopago);
          const autopTxt = typeof autop === 'boolean' ? (autop ? 'Sí' : 'No') : (String(autop || '').toUpperCase() === 'SI' ? 'Sí' : (String(autop || '').toUpperCase() === 'NO' ? 'No' : String(autop || '')));
          const cant = (l.cantidad_lineas != null) ? l.cantidad_lineas : (Array.isArray(l.telefonos) ? l.telefonos.length : '');
          const statusRaw = (l.status || '').toString();
          const statusNorm = statusRaw.trim().toLowerCase();
          const idVal = (l.id_cliente || l._id || l.id || '');

          const values = [
            l.nombre_cliente || '',
            l.telefono_principal || '',
            l.numero_cuenta || '',
            autopTxt || '',
            maskPin(l.pin_seguridad) || '',
            l.direccion || '',
            normDate(l.dia_venta || l.fecha_contratacion || l.fecha || ''),
            normDate(l.dia_instalacion || ''),
            statusRaw.toUpperCase(),
            cant || '',
            serviciosResumen(l) || '',
            idVal,
            l.supervisor || '',
            l.mercado || ''
          ];

          const tr = document.createElement('tr');
          if (idVal) tr.setAttribute('data-lead-id', String(idVal));
          if (statusNorm) {
            let cls = 'row-status-';
            if (/cancel/.test(statusNorm)) cls += 'canceled';
            else if (/hold/.test(statusNorm)) cls += 'hold';
            else if (/repro|resched/.test(statusNorm)) cls += 'rescheduled';
            else if (/complete|active/.test(statusNorm)) cls += 'complete';
            else cls += 'pending';
            tr.classList.add(cls);
          }

          // Create TDs with textContent (safer and faster than innerHTML parsing)
          for (let i = 0; i < values.length; i++) {
            const td = document.createElement('td');
            const v = values[i];
            try { td.textContent = (v == null ? '' : v); } catch { td.textContent = '' + (v || ''); }
            tr.appendChild(td);
          }

          // store status normalized for CSS and later coloring
          try { const tdStatus = tr.children[8]; if (tdStatus) tdStatus.dataset.status = statusNorm; } catch {}
          return tr;
        }

        function renderBatch() {
          const fragment = document.createDocumentFragment();
          const end = Math.min(idx + batchSize, rows.length);
          for (; idx < end; idx++) {
            try { fragment.appendChild(makeTrFromLead(rows[idx])); } catch (e) { /* ignore single-row errors */ }
          }
          tbody.appendChild(fragment);

          if (idx < rows.length) {
            // yield to the event loop to keep UI responsive
            setTimeout(renderBatch, 0);
          } else {
            // finalization: ensure row IDs and coloring applied
            try {
              ensureRowIds();
              syncStatusDatasets();
              applyRowStatusColors();
              if (typeof window.rebuildStickyHead === 'function') window.rebuildStickyHead();
            } catch (e) { /* ignore */ }
            try {
              document.dispatchEvent(new CustomEvent('leads:rendered', { detail: { count: rows.length } }));
            } catch (e) { /* ignore */ }
          }
        }

        // Start rendering asynchronously
        renderBatch();
      }
      // Guardar referencia al renderizador anterior
      const originalRenderer = window.renderCostumerTable;
      
      // Sobrescribir con nuestro renderizador Team Líneas
      // Aplicador global para el renderizado no-Team: colorea filas según texto del status en la col 9
      function ensureRowIds(){
        try{
          const tbody=document.getElementById('costumer-tbody'); if(!tbody) return;
          const rows=[...tbody.querySelectorAll('tr')].filter(tr=>!tr.classList.contains('costumer-month-separator'));
          rows.forEach(tr=>{
            if (tr.hasAttribute('data-lead-id')) return;
            // Intentar obtener ID desde el botón Editar
            const btn = tr.querySelector('button[onclick^="editarLead("]');
            if (btn){
              const m = btn.getAttribute('onclick')?.match(/editarLead\('([^']+)'\)/);
              if (m && m[1]) { tr.setAttribute('data-lead-id', m[1]); return; }
            }
            // Intentar obtener ID desde el select de status (onchange="updateLeadStatus('ID', this.value)")
            const sel = tr.querySelector('select.status-select[onchange]');
            if (sel){
              const oc = sel.getAttribute('onchange')||'';
              const m2 = oc.match(/updateLeadStatus\('([^']+)'/);
              if (m2 && m2[1]) { tr.setAttribute('data-lead-id', m2[1]); return; }
            }
          });
        }catch{}
      }

      window.syncStatusDatasets = function(){
        try{
          const tbody=document.getElementById('costumer-tbody'); if(!tbody) return;
          ensureRowIds();
          const rows=[...tbody.querySelectorAll('tr')]
            .filter(tr=>!tr.classList.contains('costumer-month-separator'));
          // Construir mapa id->status desde memoria si existe
          let map = null;
          try{
            const list = Array.isArray(window.ultimaListaLeads) ? window.ultimaListaLeads : [];
            if (list.length && typeof getLeadId==='function') {
              map = new Map(list.map(l=>[ String(getLeadId(l)), String(l?.status||'').trim().toLowerCase() ]));
            }
          }catch{}
          rows.forEach(tr=>{
            const td=tr.children[8]; if (!td) return;
            const id = tr.getAttribute('data-lead-id') || '';
            // 0) status desde memoria por id
            let val = '';
            if (map && id && map.has(String(id))) val = map.get(String(id));
            // 1) select interno
            if (!val) {
              const sel = td.querySelector('select');
              if (sel && sel.value) val = String(sel.value).trim().toLowerCase();
            }
            // 2) badge con data-value
            if (!val) {
              const badge = td.querySelector('[data-value], .badge, .badge-status, .status-badge');
              if (badge && badge.getAttribute) {
                const dv = String(badge.getAttribute('data-value')||'').trim().toLowerCase();
                if (dv) val = dv;
              }
            }
            // 3) clases comunes en badges
            if (!val) {
              const b = td.querySelector('.badge, .badge-status, .status-badge');
              const cls = b ? (' '+b.className+' ') : (' '+td.className+' ');
              if (/cancel/.test(cls)) val = 'cancelled';
              else if (/hold/.test(cls)) val = 'hold';
              else if (/resched|repro/.test(cls)) val = 'rescheduled';
              else if (/complete|active/.test(cls)) val = 'completed';
              else if (/pend/i.test(cls)) val = 'pending';
            }
            // 4) texto visible de la celda
            if (!val) {
              const txt = (td.textContent||'').trim().toLowerCase();
              if (txt) val = txt;
            }
            if (val) td.dataset.status = val;
          });
        }catch{}
      }

      window.applyRowStatusColors = function(){
        try{
          const tbody=document.getElementById('costumer-tbody'); if(!tbody) return;
          ensureRowIds();
          const rows=[...tbody.querySelectorAll('tr')]
            .filter(tr=>!tr.classList.contains('costumer-month-separator'));
          rcLog('applyRowStatusColors start', {rows: rows.length});
          // asegurar que cada celda STATUS tenga data-status actualizado antes de colorear
          syncStatusDatasets();
          rows.forEach(tr=>{
            const td=tr.children[8]; // 9na columna (STATUS)
            let txt='';
            if (td){
              // Priorizar select interno si existe
              const sel = td.querySelector('select');
              const ds = (td.dataset && td.dataset.status) ? String(td.dataset.status).trim().toLowerCase() : '';
              if (ds) txt = ds;
              else if (sel && sel.value) txt = String(sel.value).trim().toLowerCase();
              else txt = (td.textContent||'').trim().toLowerCase();
            }
            tr.classList.remove('row-status-pending','row-status-hold','row-status-rescheduled','row-status-canceled','row-status-cancelled','row-status-complete','row-status-active');
            let cls='row-status-';
            if(/cancel/.test(txt)) cls+='canceled';
            else if(/hold/.test(txt)) cls+='hold';
            else if(/repro|resched/.test(txt)) cls+='rescheduled';
            else if(/complete|active/.test(txt)) cls+='complete';
            else cls+='pending';
            tr.classList.add(cls);
            // Inline color para persistencia visual
            const color = statusToColor(txt);
            const tds = tr ? Array.from(tr.children) : [];
            try{ tr.dataset.rowStatus = cls.replace('row-status-',''); }catch{}
            try{ tr.style.setProperty('background', 'none', 'important'); }catch{}
            try{ tr.style.setProperty('background-color', color, 'important'); }catch{}
            tds.forEach(td=>{ try{ td.style.setProperty('background', 'none', 'important'); }catch{} });
            tds.forEach(td=>{ try{ td.style.setProperty('background-color', color, 'important'); }catch{} });
            if (rcEnabled()) {
              const id = tr?.getAttribute('data-lead-id') || '(sin-id)';
              rcLog('row colored', {id, txt, cls, color, rowStatus: tr?.dataset?.rowStatus});
            }
          });
          rcLog('applyRowStatusColors end');
        }catch(e){ /* noop */ }
      };

      window.__suspendRender = false; // habilitado por defecto para que funcione el filtro
      window.__suspendRenderTO = null;
      window.disableGlobalRender = function(){
        try{ window.__suspendRender = true; console.log('[Render] Global render DESHABILITADO'); }catch{}
      };
      window.enableGlobalRender = function(){
        try{ window.__suspendRender = false; console.log('[Render] Global render HABILITADO'); }catch{}
      };

      // Monkey-patch robusto: impedir re-renders incluso si otro script reasigna la función
      (function(){
        let _renderFn = typeof originalRenderer==='function' ? originalRenderer.bind(window) : (typeof window.renderCostumerTable==='function' ? window.renderCostumerTable.bind(window) : null);
        Object.defineProperty(window, 'renderCostumerTable', {
          configurable: true,
          enumerable: true,
          get(){
            return function(leads){
              try {
                console.log('renderCostumerTable llamada con leads:', leads?.length || (Array.isArray(leads?.leads)?leads.leads.length:0));
                // Bloqueo global
                if (window.__suspendRender) {
                  // Permitir un ÚNICO render inicial para poblar la tabla
                  if (!window.__initialPaintDone) {
                    try {
                      const arr = Array.isArray(leads)?leads:(Array.isArray(leads?.leads)?leads.leads:[]);
                      const tbody = document.getElementById('costumer-tbody');
                      if (tbody) tbody.innerHTML = '';
                      if (typeof _renderFn === 'function') {
                        // Usar el render original para respetar filtros/toolbars
                        _renderFn(arr);
                        console.log('[Render] Pintado inicial permitiendo _renderFn() (una sola vez)');
                      } else if (typeof renderWithMonthlySeparators === 'function') {
                        renderWithMonthlySeparators(arr);
                        console.log('[Render] Pintado inicial forzado con renderWithMonthlySeparators()');
                      }
                      // Aplicar colores cuando el DOM ya tenga filas (el render original puede ser asíncrono)
                      try {
                        const tryApplyColors = (attempt=0) => {
                          try {
                            const tbody = document.getElementById('costumer-tbody');
                            const count = tbody ? tbody.querySelectorAll('tr').length : 0;
                            if (count === 0 && attempt < 20) { // reintentar hasta 2s
                              return setTimeout(() => tryApplyColors(attempt+1), 100);
                            }
                            if (typeof syncStatusDatasets==='function') syncStatusDatasets();
                            if (typeof window.applyRowStatusColors==='function') window.applyRowStatusColors();
                          } catch(_) {}
                        };
                        tryApplyColors();
                        try { setTimeout(()=>{ document.dispatchEvent(new CustomEvent('leads:rendered',{detail:{count: arr.length}})); }, 100); }catch(_){ }
                      } catch(_) {}
                      window.__initialPaintDone = true;
                    } catch(e){ console.warn('[Render] fallo en pintado inicial', e); }
                  } else {
                    console.log('[Render] BLOQUEADO por __suspendRender');
                  }
                  return;
                }
                // Aplicar filtro por defecto: mostrar solo leads del mes actual
                // Para ver todos los leads (comportamiento anterior) establecer `window.__renderShowAll = true` desde la consola o desde otra parte del frontend.
                function _parseDateFromLead(l) {
                  try {
                    const s = String(l?.dia_venta || l?.fecha || l?.createdAt || l?.created_at || '').trim();
                    if (!s) return null;
                    // Formato ISO YYYY-MM-DD
                    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
                    // Formato DD/MM/YYYY
                    const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
                    if (dmy) return new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00`);
                    // Try Date parse for other formats
                    const dt = new Date(s);
                    if (!isNaN(dt)) return dt;
                  } catch(e){}
                  return null;
                }
                function _isInCurrentMonth(l) {
                  const d = _parseDateFromLead(l);
                  if (!d) return false;
                  const now = new Date();
                  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
                }

                // Vista Team Líneas
                try{
                  if (isTeamLineas()){
                    console.log('[Team Líneas] Aplicando vista Team Líneas');
                    applyHeader();
                    let arr = Array.isArray(leads)?leads:(Array.isArray(leads?.leads)?leads.leads:[]);
                    // Guardar lista completa para usos futuros
                    try { window.ultimaListaLeadsFull = Array.isArray(arr) ? arr.slice(0) : []; } catch(e){}
                    // Mostrar todos los meses por defecto (sin filtrar por mes actual)
                    window.ultimaListaLeads = Array.isArray(arr) ? arr.slice(0) : [];
                    
                    // FILTRO SUPERVISOR: Si el usuario es supervisor, mostrar solo clientes de sus agentes
                    try {
                      const currentUser = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
                      const userRole = (currentUser.role || '').toString().trim().toLowerCase();
                      
                      if (userRole === 'supervisor') {
                        const supervisorName = (currentUser.username || currentUser.name || '').trim();
                        console.log('[SUPERVISOR FILTER] Aplicando filtro para supervisor (Team Líneas):', supervisorName);
                        
                        // Obtener lista de agentes del supervisor
                        let supervisorAgents = new Set();
                        try {
                          if (window.teamsApiRoot && typeof window.teamsApiRoot.getAgentsForSupervisor === 'function') {
                            const agents = window.teamsApiRoot.getAgentsForSupervisor(supervisorName);
                            if (Array.isArray(agents)) {
                              agents.forEach(agent => supervisorAgents.add(String(agent).toLowerCase().trim()));
                              console.log('[SUPERVISOR FILTER] Agentes del supervisor (Team Líneas):', Array.from(supervisorAgents));
                            }
                          }
                        } catch(e) {
                          console.warn('[SUPERVISOR FILTER] Error obteniendo agentes del supervisor:', e);
                        }
                        
                        // Filtrar leads
                        if (supervisorAgents.size === 0) {
                          const matchSupervisor = (leadSupRaw, supName) => {
                            try {
                              const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}+/gu,'').replace(/[^a-z0-9]+/g,'').trim();
                              const supCanon = norm(supName || '');
                              const leadCanon = norm(leadSupRaw || '');
                              if (!leadCanon) return false;
                              if (leadCanon === supCanon) return true;
                              if (supCanon.includes(leadCanon) || leadCanon.includes(supCanon)) return true;
                              const last = x => { const parts = (x||'').split(/\s+/).filter(Boolean); return parts.length ? parts.pop() : x; };
                              if (last(leadCanon) && last(supCanon) && last(leadCanon) === last(supCanon)) return true;
                              return false;
                            } catch (e) { return false; }
                          };
                          arr = arr.filter(lead => {
                            const leadSupervisor = (lead.supervisor || lead.team || '').toString().trim();
                            return matchSupervisor(leadSupervisor, supervisorName);
                          });
                        } else {
                          arr = arr.filter(lead => {
                            const agenteName = (lead.agenteNombre || lead.nombreAgente || lead.agente || '').toString().trim().toLowerCase();
                            return supervisorAgents.has(agenteName);
                          });
                        }
                        
                        console.log('[SUPERVISOR FILTER] Leads después de filtro (Team Líneas):', arr.length);
                        window.ultimaListaLeads = Array.isArray(arr) ? arr.slice(0) : [];
                      }
                    } catch(e) {
                      console.warn('[SUPERVISOR FILTER] Error en filtro de supervisor (Team Líneas):', e);
                    }
                    
                    renderRows(arr);
                    return;
                  }
                }catch(err){ console.warn('[Team Líneas render] error', err); }
                // Fallback al render original si no está suspendido
                if (typeof _renderFn === 'function') {
                  try {
                    let arr = Array.isArray(leads)?leads:(Array.isArray(leads?.leads)?leads.leads:[]);
                    try { window.ultimaListaLeadsFull = Array.isArray(arr) ? arr.slice(0) : []; } catch(e){}
                    // Mostrar todos los meses por defecto (sin filtrar por mes actual)
                    window.ultimaListaLeads = Array.isArray(arr) ? arr.slice(0) : [];
                    
                    // FILTRO SUPERVISOR: Si el usuario es supervisor, mostrar solo clientes de sus agentes
                    try {
                      const currentUser = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
                      const userRole = (currentUser.role || '').toString().trim().toLowerCase();
                      
                      if (userRole === 'supervisor') {
                        const supervisorName = (currentUser.username || currentUser.name || '').trim();
                        console.log('[SUPERVISOR FILTER] Aplicando filtro para supervisor:', supervisorName);
                        
                        // Obtener lista de agentes del supervisor desde teamsApiRoot si está disponible
                        let supervisorAgents = new Set();
                        
                        try {
                          if (window.teamsApiRoot && typeof window.teamsApiRoot.getAgentsForSupervisor === 'function') {
                            const agents = window.teamsApiRoot.getAgentsForSupervisor(supervisorName);
                            if (Array.isArray(agents)) {
                              agents.forEach(agent => supervisorAgents.add(String(agent).toLowerCase().trim()));
                              console.log('[SUPERVISOR FILTER] Agentes del supervisor:', Array.from(supervisorAgents));
                            }
                          }
                        } catch(e) {
                          console.warn('[SUPERVISOR FILTER] Error obteniendo agentes del supervisor desde teamsApiRoot:', e);
                        }
                        
                        // Si teamsApiRoot no funciona, usar el campo 'supervisor' en los leads
                        if (supervisorAgents.size === 0) {
                          console.log('[SUPERVISOR FILTER] Fallback: filtrando por campo supervisor en los leads');
                          const matchSupervisor = (leadSupRaw, supName) => {
                            try {
                              const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}+/gu,'').replace(/[^a-z0-9]+/g,'').trim();
                              const supCanon = norm(supName || '');
                              const leadCanon = norm(leadSupRaw || '');
                              if (!leadCanon) return false;
                              if (leadCanon === supCanon) return true;
                              if (supCanon.includes(leadCanon) || leadCanon.includes(supCanon)) return true;
                              const last = x => { const parts = (x||'').split(/\s+/).filter(Boolean); return parts.length ? parts.pop() : x; };
                              if (last(leadCanon) && last(supCanon) && last(leadCanon) === last(supCanon)) return true;
                              return false;
                            } catch (e) { return false; }
                          };
                          // Filtrar leads cuyo supervisor coincida con el usuario actual (más robusto)
                          arr = arr.filter(lead => {
                            const leadSupervisor = (lead.supervisor || lead.team || '').toString().trim();
                            return matchSupervisor(leadSupervisor, supervisorName);
                          });
                        } else {
                          // Filtrar leads cuyo agente esté en la lista de agentes del supervisor
                          arr = arr.filter(lead => {
                            const agenteName = (lead.agenteNombre || lead.nombreAgente || lead.agente || '').toString().trim().toLowerCase();
                            return supervisorAgents.has(agenteName);
                          });
                        }
                        
                        console.log('[SUPERVISOR FILTER] Leads después de filtro:', arr.length);
                        window.ultimaListaLeads = Array.isArray(arr) ? arr.slice(0) : [];
                      }
                    } catch(e) {
                      console.warn('[SUPERVISOR FILTER] Error en filtro de supervisor:', e);
                    }
                    
                    const r = _renderFn(arr);
                    setTimeout(()=>{ try{ syncStatusDatasets(); window.applyRowStatusColors(); }catch{} }, 0);
                    try { setTimeout(()=>{ document.dispatchEvent(new CustomEvent('leads:rendered',{detail:{count: arr.length}})); }, 150); }catch(_){ }
                    return r;
                  } catch(e) {
                    console.warn('[Render fallback] error applying default month filter', e);
                    const r = _renderFn(leads);
                    setTimeout(()=>{ try{ syncStatusDatasets(); window.applyRowStatusColors(); }catch{} }, 0);
                    return r;
                  }
                }
              } catch(e){ console.warn('[Render wrapper] error', e); }
            }
          },
          set(fn){
            try{
              _renderFn = (typeof fn === 'function') ? fn.bind(window) : null;
              console.log('[Render] Nueva función asignada; wrapper activo. __suspendRender=', window.__suspendRender);
            }catch(e){ console.warn('[Render] setter error', e); }
          }
        });
      })();

      // Recoloreo garantizado tras carga inicial de la página
      try {
        window.addEventListener('DOMContentLoaded', function(){
          let tries = 0;
          const maxTries = 100; // hasta 10s
          const attempt = () => {
            tries++;
            try { if (typeof syncStatusDatasets==='function') syncStatusDatasets(); } catch{}
            try { if (typeof window.applyRowStatusColors==='function') window.applyRowStatusColors(); } catch{}
            try {
              const tbody = document.getElementById('costumer-tbody');
              const rows = tbody ? tbody.querySelectorAll('tr') : [];
              const colored = rows && rows.length>0 && Array.from(rows).some(tr => (tr.dataset && tr.dataset.rowStatus) || (tr.style && tr.style.backgroundColor));
              if (!colored && tries < maxTries) { setTimeout(attempt, 100); }
            } catch { if (tries < maxTries) { setTimeout(attempt, 100); } }
          };
          setTimeout(attempt, 150);

          // Observer ligero: nuevas filas -> recolorear inmediatamente
          try {
            const tbody = document.getElementById('costumer-tbody');
            if (tbody && window.MutationObserver) {
              let timer = null;
              const apply = () => {
                try { if (typeof syncStatusDatasets==='function') syncStatusDatasets(); } catch{}
                try { if (typeof window.applyRowStatusColors==='function') window.applyRowStatusColors(); } catch{}
              };
              const obs = new MutationObserver(muts => {
                let added = false;
                for (const m of muts) { if (m.type==='childList' && (m.addedNodes&&m.addedNodes.length)) { added = true; break; } }
                if (added) {
                  if (timer) clearTimeout(timer);
                  timer = setTimeout(apply, 50);
                }
              });
              obs.observe(tbody, { childList: true, subtree: false });
              // Guardar referencia global por si se requiere depuración
              try { window.__rowColorObserver = obs; } catch {}
            }
          } catch {}
        });
      } catch {}
    })();
  