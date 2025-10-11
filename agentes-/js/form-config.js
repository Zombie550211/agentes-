/*
  FormConfig y utilidades para formularios dinámicos por equipo.
  - Define configuración por defecto y overrides por equipo (p.ej. 'team lineas').
  - Exponer globales: window.FormConfig, window.applyTeamFormConfig
  Uso esperado en lead.html:
    <script src="/js/form-config.js"></script>
    <script>
      // obtener teamKey del usuario actual, p.ej. 'team lineas'
      applyTeamFormConfig(teamKey);
    </script>
*/

(function () {
  // Normalizador simple: minúsculas, sin acentos, colapsa espacios
  const norm = (s) => {
    try {
      return String(s || '')
        .normalize('NFD')
        .replace(/\p{Diacritic}+/gu, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    } catch { return ''; }
  };

  // Lista de usuarios con permiso para ver campos especiales
  const ALLOWLIST = new Set([
    'jonathan figueroa',
    'lineas-carlos',
    'lineas-cristian r',
    'lineas-edward',
    'lineas-jocelyn',
    'lineas-luis g',
    'lineas-oscar r',
    'lineas- karla', // variante con espacio después del guion
    'lineas-karla',
    'lineas- daniel',
    'lineas-daniel',
    'lineas-sandy'
  ].map(norm));

  const DEFAULTS = {
    fields: {
      nombre_cliente: { visible: true, required: true, label: 'Nombre del Cliente', type: 'text' },
      telefono_principal: { visible: true, required: true, label: 'Teléfono Principal', type: 'tel' },
      numero_cuenta: { visible: true, required: true, label: 'Número de Cuenta', type: 'text' },
      autopay: { visible: true, required: true, label: 'Autopay', type: 'select', options: ['si', 'no'], placeholder: 'Seleccione' },
      // Oculto globalmente
      pin_seguridad: { visible: false, required: false, label: 'PIN de Seguridad', type: 'text' },
      direccion: { visible: true, required: true, label: 'Dirección', type: 'text' },
      // Servicios: no aplicar overrides globales (conservar comportamiento del HTML por defecto)
      servicios: {},
      dia_venta: { visible: true, required: true, label: 'Día de venta', type: 'date' },
      dia_instalacion: { visible: true, required: true, label: 'Día de instalación', type: 'date' },
      status: { visible: true, required: true, label: 'Status', type: 'select', options: ['PENDING', 'REPRO'] },
      // Oculto globalmente
      cantidad_lineas: { visible: false, required: false, label: 'Cantidad de Líneas', type: 'select', options: ['1','2','3','4','5'] },
      // Oculto globalmente (grupo dinámica de teléfonos adicionales)
      telefonos: { visible: false, required: false, label: 'Teléfonos', type: 'tel[]', max: 5 },
      // Select de servicio por cada teléfono (ocultos por defecto, sin etiqueta visible)
      servicio_1: { visible: false, required: false, type: 'select', options: ['SIM WIRELES','WIRELESS'] },
      servicio_2: { visible: false, required: false, type: 'select', options: ['SIM WIRELES','WIRELESS'] },
      servicio_3: { visible: false, required: false, type: 'select', options: ['SIM WIRELES','WIRELESS'] },
      servicio_4: { visible: false, required: false, type: 'select', options: ['SIM WIRELES','WIRELESS'] },
      servicio_5: { visible: false, required: false, type: 'select', options: ['SIM WIRELES','WIRELESS'] },
      // Oculto globalmente
      ID: { visible: false, required: false, label: 'ID', type: 'text' },
      mercado: { visible: true, required: true, label: 'Mercado', type: 'select', options: ['BAMO', 'ICON'] },
      // Supervisor: no aplicar overrides globales (conservar comportamiento del HTML por defecto)
      supervisor: {},
      // Por defecto visible para perfiles NO Team Líneas
      comentario: { visible: true, required: true, label: '¿Por qué llamó el cliente?', type: 'select' }
    }
  };

  const TEAM_LINEAS = {
    key: 'team lineas',
    fields: {
      // Mantener ocultos también para Team Líneas
      servicios: { visible: false, required: false, label: 'Servicios (múltiple)', type: 'checkboxes', options: ['INTERNET', 'TV', 'TELEFONIA'] },
      status: { visible: true, required: true, label: 'Status', type: 'select', options: ['PENDING', 'REPRO'] },
      supervisor: { visible: false, required: false, label: 'Supervisor', type: 'select', options: ['JONATHAN', 'DIEGO'] },
      mercado: { visible: true, required: true, label: 'Mercado', type: 'select', options: ['BAMO', 'ICON'] },
      cantidad_lineas: { visible: false, required: false, label: 'Cantidad de Líneas', type: 'select', options: ['1','2','3','4','5'] },
      telefonos: { visible: false, required: false, label: 'Teléfonos (según cantidad)', type: 'tel[]', max: 5 },
      ID: { visible: false, required: false, label: 'ID', type: 'text' }
    }
  };

  function deepMerge(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...(base || {}) };
    for (const k of Object.keys(override || {})) {
      const bv = base ? base[k] : undefined;
      const ov = override[k];
      if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
        out[k] = deepMerge(bv, ov);
      } else {
        out[k] = Array.isArray(ov) ? ov.slice() : ov;
      }
    }
    return out;
  }

  const FormConfig = {
    defaults: DEFAULTS,
    teams: {
      'team lineas': deepMerge(DEFAULTS, TEAM_LINEAS),
      'team lineas 1': deepMerge(DEFAULTS, TEAM_LINEAS),
      'team lineas 2': deepMerge(DEFAULTS, TEAM_LINEAS)
    }
  };

  function setVisibility(el, show) {
    if (!el) return;
    const container = el.closest('[data-field]') || el;
    container.style.display = show ? '' : 'none';
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      if (!show) {
        el.setAttribute('data-prev-required', el.required ? '1' : '0');
        el.required = false;
      } else {
        if (el.getAttribute('data-prev-required') === '1') el.required = true;
      }
    }
  }

  function applyFieldConfig(key, cfg) {
    // Busca por data-field="key"; si no, intenta por id/name
    let el = document.querySelector(`[data-field="${key}"] input, [data-field="${key}"] select, [data-field="${key}"] textarea`);
    if (!el) el = document.getElementById(key);
    if (!el) el = document.querySelector(`[name="${key}"]`);
    if (!el) return; // tolerante a faltantes

    // Label
    const container = el.closest('[data-field]') || el.closest('.form-group') || el.parentElement;
    // Solo el label directo del contenedor, para no tocar radio-label internos
    const label = container ? container.querySelector(':scope > label') : null;
    if (label && cfg.label) label.textContent = cfg.label;

    // Visibilidad
    setVisibility(el, cfg.visible !== false);

    // Required
    if (typeof cfg.required === 'boolean') el.required = cfg.required;

    // Tipo y opciones (select/checkboxes)
    if (cfg.type === 'select' && Array.isArray(cfg.options)) {
      if (el.tagName === 'SELECT') {
        // Conservar placeholder si existe
        const placeholderOpt = el.querySelector('option[value=""]');
        el.innerHTML = '';
        if (cfg.placeholder || placeholderOpt) {
          const opt0 = document.createElement('option');
          opt0.value = '';
          opt0.textContent = cfg.placeholder || (placeholderOpt ? placeholderOpt.textContent : 'Seleccione');
          el.appendChild(opt0);
        }
        for (const opt of cfg.options) {
          const o = document.createElement('option');
          o.value = String(opt).toLowerCase();
          o.textContent = String(opt);
          el.appendChild(o);
        }
      }
    }
    if (cfg.type === 'checkboxes' && Array.isArray(cfg.options)) {
      // Contenedor de checkboxes dentro del data-field
      const group = container ? container.querySelector('.checkbox-group') || container : null;
      if (group) {
        group.innerHTML = '';
        for (const opt of cfg.options) {
          const id = `${key}_${String(opt).toLowerCase()}`;
          const w = document.createElement('div');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.id = id;
          input.name = key;
          input.value = String(opt);
          const lbl = document.createElement('label');
          lbl.setAttribute('for', id);
          lbl.textContent = String(opt);
          w.appendChild(input);
          w.appendChild(lbl);
          group.appendChild(w);
        }
      }
    }
  }

  function applyTeamFormConfig(teamKey) {
    try {
      const key = String(teamKey || '').toLowerCase();
      const cfg = FormConfig.teams[key] || FormConfig.defaults;
      const fields = (cfg && cfg.fields) || {};
      Object.keys(fields).forEach(f => applyFieldConfig(f, fields[f] || {}));

      // Reglas: cantidad_lineas controla número de inputs de teléfono visibles
      const cantidadSelect = document.querySelector('[data-field="cantidad_lineas"] select') || document.getElementById('cantidad_lineas') || document.querySelector('[name="cantidad_lineas"]');
      const telefonoContainers = [1,2,3,4,5].map(i =>
        document.querySelector(`[data-field="telefono_${i}"]`) || document.getElementById(`telefono_${i}`)?.closest('[data-field]') || null
      );
      const servicioContainers = [1,2,3,4,5].map(i =>
        document.querySelector(`[data-field="servicio_${i}"]`) || document.getElementById(`servicio_${i}`)?.closest('[data-field]') || null
      );
      const updateTelefonos = () => {
        const n = Number((cantidadSelect && cantidadSelect.value) || 0) || 0;
        telefonoContainers.forEach((cont, idx) => {
          if (!cont) return;
          const input = cont.querySelector('input');
          const show = idx < n;
          cont.style.display = show ? '' : 'none';
          if (input) input.required = show; // requeridos solo los visibles
        });
        servicioContainers.forEach((cont, idx) => {
          if (!cont) return;
          const select = cont.querySelector('select');
          const show = idx < n;
          cont.style.display = show ? '' : 'none';
          if (select) select.required = show; // requeridos solo los visibles
          // Asegurar opciones correctas
          if (select && !select.__patched) {
            select.innerHTML = '';
            const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='Elige'; select.appendChild(opt0);
            ['SIM WIRELES','WIRELESS'].forEach(o=>{ const opt=document.createElement('option'); opt.value=String(o).toLowerCase().replace(/\s+/g,'-'); opt.textContent=o; select.appendChild(opt); });
            select.__patched = true;
          }
        });
      };
      if (cantidadSelect) {
        cantidadSelect.addEventListener('change', updateTelefonos);
        updateTelefonos();
      }

      // Habilitar campos especiales solo para usuarios en allowlist
      try {
        const userStr = localStorage.getItem('user') || sessionStorage.getItem('user') || '{}';
        const user = JSON.parse(userStr || '{}');
        const candidates = [user?.username, user?.name, user?.nombre, user?.fullName]
          .filter(v => typeof v === 'string' && v.trim())
          .map(norm);
        // Detectar team por usuario (además de allowlist)
        const teamByUser = (window.Teams && typeof window.Teams.getTeamForUser==='function')
          ? norm(window.Teams.getTeamForUser(user) || '')
          : '';
        const isTeamLineas = (teamByUser === 'team lineas' || teamByUser === 'team lineas 1' || teamByUser === 'team lineas 2');
        const isAllowed = candidates.some(n => ALLOWLIST.has(n));
        if (isAllowed || isTeamLineas) {
          try { document.body.classList.add('team-lineas'); } catch {}
          // 1) Ocultar todo lo conocido primero
          const allKeys = Object.keys(FormConfig.defaults.fields || {});
          allKeys.forEach(k => applyFieldConfig(k, { visible: false, required: false }));
          // Campos adicionales que existen en el DOM pero no en defaults
          ['sistema','riesgo','zip-code','puntaje','comentario'].forEach(k => applyFieldConfig(k, { visible: false, required: false }));

          // 2) Mostrar SOLO los campos de las capturas
          const show = (k, required=false, extra={}) => applyFieldConfig(k, { visible: true, required, ...extra });

          show('nombre_cliente', true);
          show('telefono_principal', true);
          show('numero_cuenta', true);
          show('autopay', true);
          show('pin_seguridad', true);
          show('direccion', true);
          // Servicios: por cada teléfono (no usar campo global 'servicios')
          // Mantener oculto el campo global 'servicios' y la pregunta 'comentario'
          applyFieldConfig('servicios', { visible: false, required: false });
          applyFieldConfig('comentario', { visible: false, required: false });
          // Fallback fuerte: ocultar 'Servicios' global por data-field/name/id/label
          try {
            // 1) data-field="servicios"
            const dfServicios = document.querySelector('[data-field="servicios"]');
            if (dfServicios) dfServicios.style.display = 'none';
            // 2) select[name="servicios"]
            const byNameServicios = document.querySelector('select[name="servicios"]');
            if (byNameServicios) {
              const contN = byNameServicios.closest('[data-field]') || byNameServicios.closest('.form-group') || byNameServicios.parentElement;
              if (contN) contN.style.display = 'none';
              byNameServicios.required = false;
            }
            // 3) id="servicios" (por si existe)
            const byIdServicios = document.getElementById('servicios');
            if (byIdServicios) {
              const contI = byIdServicios.closest('[data-field]') || byIdServicios.closest('.form-group') || byIdServicios.parentElement;
              if (contI) contI.style.display = 'none';
              byIdServicios.required = false;
            }
            // 4) label[for="servicios"] (por si hay etiqueta suelta)
            const lbl = Array.from(document.querySelectorAll('label[for="servicios"]')).find(Boolean);
            if (lbl) {
              const cont2 = lbl.closest('[data-field]') || lbl.closest('.form-group');
              if (cont2) cont2.style.display = 'none';
            }
            // Ocultar robustamente 'comentario'
            const comCont = document.querySelector('[data-field="comentario"]');
            if (comCont) comCont.style.display = 'none';
          } catch(_) {}
          show('dia_venta', true);
          show('dia_instalacion', true);
          show('status', true, { type: 'select', options: ['PENDING','REPRO'] });
          show('cantidad_lineas', true, { type: 'select', options: ['1','2','3','4','5'] });
          // Telefónicos adicionales se controlan por cantidad_lineas
          show('telefonos', false);
          // Mostrar contenedores de servicio por línea (visibilidad final la controla updateTelefonos)
          show('servicio_1', false, { type: 'select', options: ['SIM WIRELES','WIRELESS'] });
          show('servicio_2', false, { type: 'select', options: ['SIM WIRELES','WIRELESS'] });
          show('servicio_3', false, { type: 'select', options: ['SIM WIRELES','WIRELESS'] });
          show('servicio_4', false, { type: 'select', options: ['SIM WIRELES','WIRELESS'] });
          show('servicio_5', false, { type: 'select', options: ['SIM WIRELES','WIRELESS'] });
          show('ID', true);
          show('mercado', true, { type: 'select', options: ['BAMO','ICON'] });
          show('supervisor', true, { type: 'select', options: ['JONATHAN','GUITIERREZ'] });

          // 3) Forzar ocultar por id aquellos que no usan data-field
          try {
            const hideById = (id) => { const el = document.getElementById(id); if (el) { const cont = el.closest('[data-field]') || el.closest('.form-group') || el; cont.style.display = 'none'; } };
            ['zip-code','puntaje'].forEach(hideById);
          } catch {}

          // 4) Reaplicar regla telefónica si se habilitó cantidad_lineas
          if (cantidadSelect) updateTelefonos();

          // Prefijar supervisor por sub-team si aplica
          try {
            const supSelect = document.querySelector('[data-field="supervisor"] select') || document.getElementById('supervisor') || document.querySelector('[name="supervisor"]');
            if (supSelect) {
              let desired = '';
              if (teamByUser === 'team lineas 1') desired = 'JONATHAN';
              if (teamByUser === 'team lineas 2') desired = 'GUITIERREZ';
              if (desired) {
                const opt = Array.from(supSelect.options).find(o => String(o.textContent||o.value).toUpperCase().includes(desired));
                if (opt) { supSelect.value = (opt.value || '').toLowerCase(); }
              }
            }
          } catch {}
        }
      } catch (e) {
        console.warn('[FormConfig] allowlist error:', e);
      }
    } catch (e) {
      console.warn('applyTeamFormConfig error:', e);
    }
  }

  // Exponer globals
  window.FormConfig = FormConfig;
  window.applyTeamFormConfig = applyTeamFormConfig;
})();
