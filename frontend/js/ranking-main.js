    // La verificación de autenticación se maneja por auth-check.js
    // Este script solo maneja la lógica específica de la página

    // ========== PRECALENTAMIENTO DE RANKINGS (FAST PATH) ==========
    function tryLoadFromPrecachedRankings() {
      try {
        const storedData = sessionStorage.getItem('rankingsData');
        const storedTimestamp = sessionStorage.getItem('rankingsTimestamp');
        
        if (!storedData || !storedTimestamp) {
          return null;
        }

        // Validar que el caché no esté expirado (5 minutos = 300000ms)
        const cacheAge = Date.now() - new Date(storedTimestamp).getTime();
        const TTL = 5 * 60 * 1000;
        
        if (cacheAge > TTL) {
          sessionStorage.removeItem('rankingsData');
          sessionStorage.removeItem('rankingsTimestamp');
          return null;
        }

        const data = JSON.parse(storedData);
        // Retornar los datos cacheados para usar en la página
        return {
          success: true,
          data: data,
          fromCache: true,
          loadTime: 0
        };
      } catch (e) {
        console.warn('[PRECACHE-RANKINGS] ⚠️ Error procesando caché:', e?.message);
        return null;
      }
    }

    document.addEventListener('DOMContentLoaded', async function() {
      // FAST PATH: Intentar cargar datos del caché primero
      const precachedResponse = tryLoadFromPrecachedRankings();
      
      if (precachedResponse) {
        // Los datos están disponibles en precachedResponse.data
        window.__precachedRankingsData = precachedResponse.data;
      } else {
        // La página cargará datos normalmente desde la API cuando sea necesario
      }
      
      // Esperar a que auth-check.js termine su verificación
      await new Promise(resolve => setTimeout(resolve, 100));
      
      try {
        // Obtener datos del usuario desde sessionStorage (establecido por auth-check.js)
        let user = null;
        const storedUser = sessionStorage.getItem('user') || localStorage.getItem('user');
        
        if (storedUser) {
          try {
            user = JSON.parse(storedUser);
          } catch (e) {
            console.error('ÔØî Error parseando usuario guardado:', e);
          }
        }
        
        // Si no hay usuario en storage, intentar obtenerlo del servidor
        if (!user) {
          const res = await fetch('/api/auth/verify', { method: 'GET', credentials: 'include' });
          
          if (res.ok) {
            const data = await res.json();
            user = data?.user;
            if (user) {
              // Guardar en sessionStorage para uso futuro
              sessionStorage.setItem('user', JSON.stringify(user));
            }
          }
        }
        
        if (!user || !user.username) {
          console.error('ÔØî No se pudieron obtener datos del usuario');
          return;
        }
        
        // Mostrar nombre de usuario en el sidebar
        const welcomeMessage = document.getElementById('welcome-message');
        if (welcomeMessage) {
          welcomeMessage.textContent = `Bienvenido/a, ${user.username || 'Usuario'}`;
        }

        // Actualizar informaci├│n del usuario en el panel de bienvenida
        const welcomeUserName = document.getElementById('welcome-user-name');
        const welcomeUserRole = document.getElementById('welcome-user-role');
        
        if (welcomeUserName) {
          welcomeUserName.textContent = `Bienvenido/a, ${user.username || 'Usuario'}`;
        }
        
        if (welcomeUserRole) {
          const role = user.role || 'usuario';
          welcomeUserRole.textContent = `${role.charAt(0).toUpperCase() + role.slice(1)} - ${user.team || 'Sin equipo'}`;
        }

        // Mostrar nombre de usuario en el perfil de usuario
        const userNameElement = document.getElementById('user-name');
        if (userNameElement) {
          userNameElement.textContent = user.username || 'Usuario';
        } else {
        }

        // Mostrar rol del usuario
        const userRoleElement = document.getElementById('user-role');
        if (userRoleElement) {
          const role = user.role || 'usuario';
          userRoleElement.textContent = role.charAt(0).toUpperCase() + role.slice(1);
        } else {
        }

        // Mostrar opci├│n de "Crear cuenta" solo si es ADMIN
        const createAccountItem = document.getElementById('menu-create-account');
        function canUpload(role){
          const r = (role||'').toString().toLowerCase();
          return ['admin','administrador','administrativo','supervisor','backoffice','supervisor team lineas'].includes(r);
        }

        if (createAccountItem) {
          const roleLower = (user.role || '').toLowerCase();
          createAccountItem.style.display = canUpload(roleLower) ? 'block' : 'none';
        }

        // Actualizar estad├¡sticas en el sidebar
        const sidebarUserSales = document.getElementById('sidebar-user-sales');
        const sidebarUserPoints = document.getElementById('sidebar-user-points');
        const sidebarUserTeam = document.getElementById('sidebar-user-team');

        if (sidebarUserTeam) {
          sidebarUserTeam.textContent = user.team || 'Sin equipo';
        }

        // Los datos del dashboard y las estad├¡sticas del usuario se cargar├ín
        // cuando el evento 'ranking:loaded' sea disparado por ranking.js
        document.addEventListener('ranking:loaded', (event) => {
          const rankingData = event.detail.ranking || [];
          updateUserStats(rankingData, user);
          // Aqu├¡ se podr├¡an actualizar otras m├®tricas si fuera necesario
        });

        // La informaci├│n del usuario y las estad├¡sticas se actualizan en el evento 'ranking:loaded'
        // y al cargar el DOM, por lo que la funci├│n updateUserInfoInSidebar ya no es necesaria.

      } catch (e) {
        console.error('Error verificando autenticaci├│n:', e);
        window.location.href = 'login.html';
      }
    });



    // Helpers seguros para manipular el DOM solo si los elementos existen
    function safeEl(id) { return document.getElementById(id) || null; }
    function setText(id, value) { const el = safeEl(id); if (el) el.textContent = value; }

    // Funci├│n para actualizar m├®tricas del dashboard
    async function updateDashboardMetrics(leads, user) {
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      // Filtrar leads del mes actual
      const monthlyLeads = leads.filter(lead => {
        const leadDate = new Date(lead.fecha_contratacion || lead.createdAt || lead.fecha);
        return leadDate.getMonth() === currentMonth && leadDate.getFullYear() === currentYear;
      });
      
      // Calcular m├®tricas
      const totalLeads = leads.length;
      const totalSales = leads.filter(lead => lead.status === 'vendido' || lead.status === 'cerrado').length;
      const conversionRate = totalLeads > 0 ? ((totalSales / totalLeads) * 100).toFixed(1) : 0;
      const totalRevenue = leads.reduce((sum, lead) => sum + (parseFloat(lead.valor || lead.revenue || 0)), 0);
      
      // Actualizar elementos del DOM (solo si existen en esta p├ígina)
      setText('total-leads', totalLeads);
      setText('total-sales', totalSales);
      setText('conversion-rate', conversionRate + '%');
      setText('total-revenue', '$' + totalRevenue.toLocaleString());

      // Calcular cambios (simulados por ahora)
      setText('leads-change', '+12%');
      setText('sales-change', '+8%');
      setText('conversion-change', '+5%');
      setText('revenue-change', '+15%');
    }

    // Funci├│n para actualizar estad├¡sticas del usuario usando los datos del ranking
    function updateUserStats(rankingData, user) {
      // Buscar al usuario actual en los datos del ranking
      const targetUsername = (user?.username || user?.usuario?.username || '').toString().trim().toLowerCase();
      const targetName = (user?.name || user?.nombre || user?.fullName || '').toString().trim().toLowerCase();
      const userStats = rankingData.find((agent) => {
        const displayName = resolveDisplayName(agent).toString().trim().toLowerCase();
        if (targetUsername && displayName === targetUsername) return true;
        const legacyNames = [agent.nombre, agent.name, agent.fullName]
          .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
          .filter(Boolean);
        if (targetUsername && legacyNames.includes(targetUsername)) return true;
        if (targetName && legacyNames.includes(targetName)) return true;
        return false;
      });

      let userSales = 0;
      let userPoints = 0;
      let userRanking = 'N/A';

      if (userStats) {
        userSales = userStats.ventas;
        userPoints = userStats.puntos;
        // La posici├│n ya viene en el objeto del ranking
        userRanking = `#${userStats.posicion}`;
      } else {
        // Si el usuario no est├í en el top 10, su ranking es > 10
        userRanking = '>10';
      }

      // Usar la funci├│n segura para actualizar elementos del DOM
      setText('user-sales-count', userSales);
      setText('user-points-total', userPoints.toFixed(1));
      setText('user-team-name', user.team || 'Sin equipo');
      setText('user-ranking', userRanking);

      // Tambi├®n actualizar el sidebar si los elementos existen
      setText('sidebar-user-sales', userSales);
      setText('sidebar-user-points', userPoints.toFixed(1));

    }

    // Funci├│n para crear gr├íficos
    async function createCharts(leads) {
      // Gr├ífico de ventas por mes
      createSalesChart(leads);
      
      // Gr├ífico de distribuci├│n por teams
      createTeamsChart(leads);
    }

    function createSalesChart(leads) {
      const canvas = document.getElementById('salesChart');
      if (!canvas) return; // No hay gr├ífico en esta p├ígina
      const ctx = canvas.getContext('2d');
      
      // Preparar datos por mes (├║ltimos 6 meses)
      const months = [];
      const salesData = [];
      const currentDate = new Date();
      
      for (let i = 5; i >= 0; i--) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('es-ES', { month: 'short' });
        months.push(monthName);
        
        const monthlySales = leads.filter(lead => {
          const leadDate = new Date(lead.fecha_contratacion || lead.createdAt || lead.fecha);
          return leadDate.getMonth() === date.getMonth() && leadDate.getFullYear() === date.getFullYear();
        }).length;
        
        salesData.push(monthlySales);
      }
      
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: months,
          datasets: [{
            label: 'Ventas',
            data: salesData,
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: {
                color: 'rgba(0,0,0,0.1)'
              }
            },
            x: {
              grid: {
                display: false
              }
            }
          }
        }
      });
    }

    function createTeamsChart(leads) {
      const canvas = document.getElementById('teamsChart');
      if (!canvas) return; // No hay gr├ífico en esta p├ígina
      const ctx = canvas.getContext('2d');
      
      // Contar leads por team
      const teamCounts = {};
      leads.forEach(lead => {
        const team = lead.team || 'Sin equipo';
        teamCounts[team] = (teamCounts[team] || 0) + 1;
      });
      
      const teams = Object.keys(teamCounts);
      const counts = Object.values(teamCounts);
      const colors = [
        '#667eea', '#f093fb', '#4facfe', '#43e97b', 
        '#fa709a', '#feb47b', '#a8edea', '#d299c2'
      ];
      
      new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: teams,
          datasets: [{
            data: counts,
            backgroundColor: colors.slice(0, teams.length),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 20,
                usePointStyle: true
              }
            }
          }
        }
      });
    }

    // Debug: Verificar elementos del sidebar
      document.addEventListener('DOMContentLoaded', async () => {
        // --- Funciones de utilidad y l├│gica de la p├ígina ---
        const escapeHtml = (value) => String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

        const escapeAttr = (value) => escapeHtml(value).replace(/`/g, '&#96;');

        const sanitizeAvatarUrl = (rawUrl) => {
          const url = (rawUrl == null ? '' : String(rawUrl)).trim();
          if (!url) return '';
          if (/^data:image\//i.test(url)) return url;
          if (/^https?:\/\//i.test(url)) return url;
          if (/^\/\//.test(url)) {
            try { return `${window.location.protocol}${url}`; } catch (_) { return `https:${url}`; }
          }
          if (url.startsWith('/')) return url;
          if (/^uploads\//i.test(url)) return `/${url}`;
          return '';
        };

        const maybeProxyMedia = (rawUrl) => {
          const url = (rawUrl == null ? '' : String(rawUrl)).trim();
          if (!url) return '';
          if (/^data:/i.test(url)) return url;
          if (/^\/media\/proxy/i.test(url)) return url;
          if (/^https?:\/\//i.test(url)) {
            if (/^https?:\/\/res\.cloudinary\.com\//i.test(url)) {
              return `/media/proxy?url=${encodeURIComponent(url)}`;
            }
            return url;
          }
          if (url.startsWith('//')) {
            const absolute = `${window.location.protocol}${url}`;
            if (/^https?:\/\/res\.cloudinary\.com\//i.test(absolute)) {
              return `/media/proxy?url=${encodeURIComponent(absolute)}`;
            }
            return absolute;
          }
          return url;
        };

        const toTimestamp = (value) => {
          if (!value && value !== 0) return null;
          if (typeof value === 'number' && Number.isFinite(value)) return value;
          if (typeof value === 'object' && value !== null) {
            if (value.$date) {
              const parsed = Date.parse(value.$date);
              return Number.isNaN(parsed) ? null : parsed;
            }
            if (value instanceof Date && Number.isFinite(value.getTime())) {
              return value.getTime();
            }
          }
          const parsed = Date.parse(value);
          return Number.isNaN(parsed) ? null : parsed;
        };

        const avatarsEnabled = () => true;

        const buildAgentAvatarUrl = (agent) => {
          if (!avatarsEnabled()) return '';
          if (!agent) return '';
          const raw = agent.avatarUrl || agent.imageUrl || '';
          const sanitized = sanitizeAvatarUrl(raw);
          if (!sanitized) return '';
          if (sanitized.includes('v=')) return maybeProxyMedia(sanitized);
          const timestamp = toTimestamp(agent.avatarUpdatedAt || agent.avatarUpdatedAtMs);
          let finalUrl = sanitized;
          if (timestamp) {
            const sep = sanitized.includes('?') ? '&' : '?';
            finalUrl = `${sanitized}${sep}v=${timestamp}`;
          }
          return maybeProxyMedia(finalUrl);
        };

        function resolveDisplayName(agent) {
          if (!agent) return 'ÔÇö';
          const usernameCandidates = [
            agent.username,
            agent.usuario?.username,
            agent.user?.username,
            agent.usuario?.userName,
            agent.userName
          ];
          for (const candidate of usernameCandidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
              return candidate.trim();
            }
          }
          const nameCandidates = [
            agent.nombre,
            agent.name,
            agent.fullName,
            agent.displayName,
            agent.usuario?.name,
            agent.user?.name
          ];
          for (const candidate of nameCandidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
              return candidate.trim();
            }
          }
          return 'ÔÇö';
        }

        const renderAvatarHtml = (agent, altText = 'Avatar') => {
          if (!avatarsEnabled()) return '<i class="fas fa-user"></i>';
          const url = buildAgentAvatarUrl(agent);
          if (url) {
            return `<img src="${escapeAttr(url)}" alt="${escapeAttr(altText)}" class="avatar-photo" loading="lazy">`;
          }
          return '<i class="fas fa-user"></i>';
        };

        const applyAvatarToElement = (imgEl, agent, options = {}) => {
          const { allowPhoto = true } = options;
          if (!imgEl) return;
          // NO guardar ni restaurar imágenes originales del podio - mantener las del semáforo
          // Solo quitar la clase avatar-photo si no se usa foto
          if (!allowPhoto) {
            imgEl.classList.remove('avatar-photo');
            imgEl.removeAttribute('loading');
            return;
          }
          if (!imgEl.dataset.defaultSrc) {
            imgEl.dataset.defaultSrc = imgEl.getAttribute('src') || '';
          }
          if (!imgEl.dataset.defaultAlt) {
            imgEl.dataset.defaultAlt = imgEl.getAttribute('alt') || 'Avatar';
          }
          const shouldUsePhoto = allowPhoto && avatarsEnabled() && agent;
          if (!shouldUsePhoto) {
            imgEl.classList.remove('avatar-photo');
            return;
          }
          const url = buildAgentAvatarUrl(agent);
          if (url) {
            imgEl.src = url;
            imgEl.loading = 'lazy';
            imgEl.classList.add('avatar-photo');
            imgEl.alt = resolveDisplayName(agent) || 'Avatar';
          } else {
            imgEl.classList.remove('avatar-photo');
          }
        };

        // NO guardar defaultSrc de astronautas - mantener las imágenes del semáforo sin círculo
        // document.querySelectorAll('.astronaut-image').forEach((img) => {
        //   if (!img.dataset.defaultSrc) {
        //     img.dataset.defaultSrc = img.getAttribute('src') || '';
        //   }
        // });

        async function getUser(){
          try {
            // Primero intentar obtener del storage (m├ís r├ípido)
            const storedUser = sessionStorage.getItem('user') || localStorage.getItem('user');
            if (storedUser) {
              try {
                return JSON.parse(storedUser);
              } catch (e) {
                console.warn('Error parseando usuario guardado:', e);
              }
            }
            
            // Si no hay en storage, obtener del servidor
            const res = await fetch('/api/auth/verify', { credentials: 'include' });
            if (!res.ok) return null;
            const data = await res.json();
            
            // Guardar en storage para uso futuro
            if (data.user) {
              sessionStorage.setItem('user', JSON.stringify(data.user));
            }
            
            return data.user;
          } catch(error){
            console.error('Error obteniendo usuario:', error);
            return null;
          }
        }

        // ====== RANKING: delegate to external implementation ======
        // The full `loadRankingTop3` logic lives in `js/ranking-page.js` to avoid
        // duplicate definitions. Here we call the external implementation if
        // available, or poll briefly until it is defined.
        async function loadRankingTop3(){
          try {
            if (typeof window.loadRankingTop3 === 'function' && window.loadRankingTop3 !== loadRankingTop3) {
              // External implementation already available
              await window.loadRankingTop3();
              return;
            }

            // Poll for the external function for up to 3s
            const start = Date.now();
            while (Date.now() - start < 3000) {
              if (typeof window.loadRankingTop3 === 'function' && window.loadRankingTop3 !== loadRankingTop3) {
                await window.loadRankingTop3();
                return;
              }
              // small delay
              await new Promise(r => setTimeout(r, 150));
            }

            console.warn('[RANKING] External loadRankingTop3 not found; skipping init.');
          } catch (err) {
            console.error('[RANKING] Error delegating loadRankingTop3:', err);
          }
        }

        function canUpload(role){
          const r = (role||'').toString().toLowerCase();
          return ['admin','administrador','administrativo','supervisor','backoffice','supervisor team lineas'].includes(r);
        }

        function isAdmin(role){
          const r = (role||'').toString().toLowerCase();
          // Solo roles de administrador completo pueden ver multimedia
          return ['admin','administrador','supervisor','backoffice'].includes(r);
        }

        async function handleUpload(e){
          const input = e.target;
          const file = input.files[0];
          if (!file) return;

          const formData = new FormData();
          formData.append('file', file);
          formData.append('category', 'marketing'); // identifica como material de marketing

          try {
            const res = await fetch('/api/upload', {
              method: 'POST',
              credentials: 'include',
              headers: { 'x-media-category': 'marketing' },
              body: formData
            });
            
            if (!res.ok) throw new Error('upload failed');
            
            const result = await res.json();
            // Esperar un momento para que la BD se actualice
            setTimeout(async () => {
              await loadLatestMedia();
            }, 500);
            
          } catch(err){
            console.error('[PROMO] ÔØî Error en upload:', err);
            alert('No se pudo subir el archivo: ' + err.message);
          } finally { 
            input.value = ''; 
          }
        }

        async function fixMediaDates() {
          if (!confirm('┬┐Est├ís seguro de que quieres corregir las fechas de los archivos multimedia?')) {
            return;
          }
          try {
            const res = await fetch('/api/media/fix-dates', {
              method: 'POST',
              credentials: 'include'
            });
            const result = await res.json();
            alert(result.message || 'Proceso completado.');
            if (result.success) {
              loadLatestMedia();
            }
          } catch (error) {
            console.error('Error al ejecutar la correcci├│n:', error);
            alert('Fall├│ la correcci├│n: ' + error.message);
          }
        }

        function renderPromo(container, file){
          container.innerHTML = '';
          if (!file || !file.url){
            container.innerHTML = '<div class="promo-placeholder">Sin promoci├│n. Sube una imagen o video.</div>';
            return;
          }
          const isVideo = (file.type||'').startsWith('video/');
          const versionedUrl = (() => {
            const base = file.url || '';
            if (!base) return '';
            const sep = base.includes('?') ? '&' : '?';
            return `${base}${sep}t=${Date.now()}`;
          })();
          const mediaUrl = maybeProxyMedia(versionedUrl || file.url || '');
          const applyFit = (mediaEl, naturalW, naturalH) => {
            const box = container;
            const boxW = box.clientWidth || 1100;
            const ratio = naturalW && naturalH ? (naturalW / naturalH) : (16/9);
            let targetH = Math.min(420, Math.max(200, Math.round(boxW / ratio)));
            box.style.height = targetH + 'px';
            box.classList.toggle('contain', ratio < 1.6);
          };

          if (isVideo){
            const v = document.createElement('video');
            v.src = mediaUrl || versionedUrl; v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true; v.controls = true;
            v.addEventListener('loadedmetadata', () => applyFit(v, v.videoWidth, v.videoHeight));
            v.addEventListener('error', () => { container.innerHTML = '<div class="promo-placeholder">Archivo multimedia no disponible</div>'; });
            container.appendChild(v);
          } else {
            const img = document.createElement('img');
            img.src = mediaUrl || versionedUrl; img.alt = file.name || 'Promoci├│n';
            img.addEventListener('load', () => applyFit(img, img.naturalWidth, img.naturalHeight));
            img.addEventListener('error', () => { container.innerHTML = '<div class="promo-placeholder">Archivo multimedia no disponible</div>'; });
            container.appendChild(img);
          }
        }

        async function loadLatestMedia(){
          const mediaBox = document.getElementById('promo-media');
          if (!mediaBox) return;
          
          try {
            const url = `/api/media?category=marketing&limit=1&sort=desc&orderBy=uploadDate&t=${Date.now()}`;
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error('Server response not OK');

            const list = await res.json();
            const last = Array.isArray(list) && list.length ? list[0] : null;

            if (!last || !last.url) {
              mediaBox.innerHTML = '<div class="promo-placeholder">­ƒô¡ Sin promoci├│n disponible</div>';
              return;
            }
            
            const headUrl = maybeProxyMedia(last.url) || last.url;
            const fileResponse = await fetch(headUrl, { method: 'HEAD' });
            if (!fileResponse.ok) {
              mediaBox.innerHTML = '<div class="promo-placeholder">­ƒô¡ Archivo no encontrado</div>';
              return;
            }

            renderPromo(mediaBox, last);
          } catch(e){
            console.error('[PROMO] Error cargando multimedia:', e);
            mediaBox.innerHTML = '<div class="promo-placeholder">ÔØî Error al cargar promoci├│n</div>';
          }
        }

        // --- Inicializaci├│n y Event Listeners ---
        const user = await getUser();
        const promoActions = document.getElementById('promo-actions');
        const promoFileInput = document.getElementById('promo-file');
        const promoHero = document.querySelector('.promo-hero');

        // Mostrar SIEMPRE la secci├│n de promociones para todos los roles
        if (promoHero) promoHero.style.display = 'flex';
        // Cargar multimedia para todos los usuarios (solo lectura si no es admin)
        try { await loadLatestMedia(); } catch(_) {}
        // Mostrar el bot├│n de subir SOLO si es admin/supervisor/backoffice
        const allowUpload = user && isAdmin(user.role);
        if (promoActions) promoActions.style.display = allowUpload ? 'flex' : 'none';
        if (allowUpload && promoFileInput) promoFileInput.addEventListener('change', handleUpload);
        // Cargar ranking siempre (independiente del rol)
        try { 
          await loadRankingTop3(); 
        } catch(e){ console.warn('[RANKING] No se pudo cargar el top 3 en init:', e); }

        // === Navegaci├│n mensual del ranking con flechas ===
        // Estado de mes visible (a├▒o/mes actuales por defecto)
        window.__rankYear = (new Date()).getFullYear();
        window.__rankMonth = (new Date()).getMonth(); // 0-11

        try { setPeriodLabel(window.__rankYear, window.__rankMonth); } catch(_) {}

        function monthBounds(y, m){
          const start = new Date(y, m, 1);
          const now = new Date();
          const isCurrent = (y === now.getFullYear() && m === now.getMonth());
          const end = isCurrent ? now : new Date(y, m + 1, 0); // hoy si es mes actual, ├║ltimo d├¡a si es pasado
          const yyyy = start.getFullYear();
          const mm = String(start.getMonth()+1).padStart(2,'0');
          const ddEnd = String(end.getDate()).padStart(2,'0');
          return { fechaInicio: `${yyyy}-${mm}-01`, fechaFin: `${yyyy}-${mm}-${ddEnd}`, isCurrent };
        }

        function updateRankingUI(list){
          try{
            const safe = Array.isArray(list) ? list : [];
            const [top1, top2, top3] = [safe[0]||{}, safe[1]||{}, safe[2]||{}];
            const normalizeNameText = (value) => {
              const raw = (value == null ? '' : String(value)).trim();
              if (!raw) return raw;
              try {
                if (typeof window.__rankNormalizePersonName === 'function') {
                  return window.__rankNormalizePersonName(raw);
                }
              } catch (_) {}
              const cleaned = raw.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
              if (!cleaned) return raw;
              const parts = cleaned.split(' ').filter(Boolean).map((w) => {
                const lower = w.toLowerCase();
                return lower.charAt(0).toUpperCase() + lower.slice(1);
              });
              if (parts.length > 2) return `${parts[0]} ${parts[parts.length - 1]}`;
              return parts.join(' ');
            };
            const normalizeRankingDom = () => {
              try {
                document.querySelectorAll('.astronaut-name, #rank-list-dynamic .agent-details h4, #full-rank-table tbody td:nth-child(2)').forEach((el) => {
                  const before = (el.textContent || '').trim();
                  const after = normalizeNameText(before);
                  if (after && after !== before) el.textContent = after;
                });
              } catch (_) {}
            };
            const displayName = (it) => {
              let base = '—';
              try {
                if (typeof window.__rankResolveDisplayName === 'function') base = window.__rankResolveDisplayName(it);
                else base = resolveDisplayName(it);
              } catch (_) {
                try { base = resolveDisplayName(it); } catch (__){ base = '—'; }
              }
              try {
                if (typeof window.__rankNormalizePersonName === 'function') {
                  return window.__rankNormalizePersonName(base);
                }
              } catch (_) {}
              return base;
            };
            const getScore = (it)=> (typeof it.sumPuntaje==='number'?it.sumPuntaje:(typeof it.puntos==='number'?it.puntos:(typeof it.promedio==='number'?it.promedio:0)));
            const fmt = (n)=>{
              const v = Number(n)||0;
              // Redondear a 2 decimales para evitar n├║meros largos
              const rounded = Math.round((v + Number.EPSILON) * 100) / 100;
              // Si es entero, mostrar sin decimales
              if (rounded === Math.floor(rounded)) {
                return rounded.toString();
              }
              // Si tiene decimales, mostrar m├íximo 2 y quitar ceros finales
              return rounded.toFixed(2).replace(/\.?0+$/, '');
            };
            const setSlot=(sel,it)=>{
              const nameEl=document.querySelector(`${sel} .astronaut-name`);
              const scoreEl=document.querySelector(`${sel} .astronaut-score`);
              // NO tocar las imágenes - mantener los astronautas del semáforo sin círculo
              if(nameEl) nameEl.textContent = displayName(it);
              if(scoreEl) scoreEl.textContent = fmt(getScore(it));
            };
            // limpiar - solo nombre y puntaje, NO las imágenes
            ['.first-pos','.second-pos','.third-pos'].forEach(sel=>{
              const nameEl=document.querySelector(`${sel} .astronaut-name`);
              const scoreEl=document.querySelector(`${sel} .astronaut-score`);
              if(nameEl) nameEl.textContent='—'; if(scoreEl) scoreEl.textContent='0';
            });
            // set top3
            setSlot('.first-pos', top1); setSlot('.second-pos', top2); setSlot('.third-pos', top3);

            // lista lateral
            const container=document.getElementById('rank-list-dynamic');
            if(container){
              const rest=safe.slice(3, 13);
              container.innerHTML='';
              rest.forEach((agent,idx)=>{
                const li=document.createElement('div');
                li.className='rank-item';
                const position = agent.position||agent.posicion||(idx+4);
                const name = escapeHtml(displayName(agent));
                const role = escapeHtml(agent.cargo||'');
                const pointsValue = fmt(getScore(agent));
                const salesValue = Number(agent.ventas||0);
                const avatarMarkup = renderAvatarHtml(agent, displayName(agent) || 'Avatar');
                li.innerHTML=`
                  <span class="rank-number">${position}</span>
                  <div class="agent-info">
                    <div class="agent-avatar">${avatarMarkup}</div>
                    <div class="agent-details">
                      <h4>${name}</h4>
                      <p>${role}</p>
                    </div>
                  </div>
                  <div class="agent-stats">
                    <span class="points">${escapeHtml(pointsValue)} pts</span>
                    <span class="sales">${escapeHtml(salesValue.toString())} ventas</span>
                  </div>`;
                container.appendChild(li);
              });
            }

            // tabla
            const table=document.getElementById('full-rank-table');
            if(table){
              const tbody=table.querySelector('tbody');
              if(tbody){
                tbody.innerHTML='';
                (safe.slice(0,10)).forEach((agent,idx)=>{
                  const tr=document.createElement('tr');
                  tr.innerHTML=`
                    <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${agent.position||agent.posicion||(idx+1)}</td>
                    <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${escapeHtml(displayName(agent))}</td>
                    <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right;">${agent.ventas??0}</td>
                    <td style="padding:8px; border-bottom:1px solid #f1f5f9; text-align:right; font-weight:700;">${fmt(getScore(agent))}</td>`;
                  tbody.appendChild(tr);
                });
              }
            }

            normalizeRankingDom();
            setTimeout(normalizeRankingDom, 0);
          }catch(e){ console.warn('[RANKING] update UI error', e); }
        }

        function setPeriodLabel(y,m){
          const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
          const label = document.getElementById('rank-period-label') || (function(){
            const el = document.createElement('div');
            el.id = 'rank-period-label';
            el.style.cssText = 'position:relative;margin:10px auto 0 auto;text-align:center;font-weight:700;color:#0b2447;';
            const anchor = document.querySelector('.circular-podium') || document.querySelector('.ranking-content') || document.body;
            anchor.parentNode.insertBefore(el, anchor);
            return el;
          })();
          label.textContent = `Ranking ÔÇö ${monthNames[m]} ${y}`;
          try {
            const modalTitle = document.getElementById('full-ranking-title');
            if (modalTitle) modalTitle.textContent = `Ranking completo ÔÇö ${monthNames[m]} ${y}`;
          } catch (_) {}
        }

        // Delegate monthly loader to external implementation in `js/ranking-page.js`
        async function loadRankingByMonth(y,m){
          try {
            if (typeof window.loadRankingByMonth === 'function' && window.loadRankingByMonth !== loadRankingByMonth) {
              await window.loadRankingByMonth(y,m);
              try { setPeriodLabel(y, m); } catch(_) {}
              return;
            }
            const start = Date.now();
            while (Date.now() - start < 3000) {
              if (typeof window.loadRankingByMonth === 'function' && window.loadRankingByMonth !== loadRankingByMonth) {
                await window.loadRankingByMonth(y,m);
                try { setPeriodLabel(y, m); } catch(_) {}
                return;
              }
              await new Promise(r => setTimeout(r, 150));
            }
            console.warn('[RANKING] External loadRankingByMonth not found; skipping month load.');
          } catch (e) { console.warn('[RANKING] Error delegating loadRankingByMonth:', e); }
        }

        document.addEventListener('rank-nav', () => {
          try {
            setTimeout(() => {
              try { setPeriodLabel(window.__rankYear, window.__rankMonth); } catch(_) {}
            }, 300);
          } catch (_) {}
        });

        // --- L├│gica de Resize ---
        let _resizeT;
        window.addEventListener('resize', () => {
          clearTimeout(_resizeT);
          _resizeT = setTimeout(() => {
            const media = document.querySelector('#promo-media img, #promo-media video');
            const box = document.getElementById('promo-media');
            if (media && box) {
              const isVideo = media.tagName === 'VIDEO';
              const naturalW = isVideo ? media.videoWidth : media.naturalWidth;
              const naturalH = isVideo ? media.videoHeight : media.naturalHeight;
              const boxW = box.clientWidth || 1100;
              const ratio = naturalW && naturalH ? (naturalW / naturalH) : (16/9);
              let targetH = Math.min(420, Math.max(200, Math.round(boxW / ratio)));
              box.style.height = targetH + 'px';
              box.classList.toggle('contain', ratio < 1.6);
            }
          }, 200);
        });

      });

      // Escuchar evento de precalentamiento desde login.html
      window.addEventListener('rankingsPreheated', (event) => {
        sessionStorage.setItem('rankingsData', JSON.stringify(event.detail));
        window.__precachedRankingsData = event.detail;
      });

    document.addEventListener('DOMContentLoaded', () => {
      const prev = document.getElementById('rank-prev');
      const next = document.getElementById('rank-next');
      if (prev) prev.addEventListener('click', () => document.dispatchEvent(new CustomEvent('rank-nav', { detail: { dir: -1 } })));
      if (next) next.addEventListener('click', () => document.dispatchEvent(new CustomEvent('rank-nav', { detail: { dir: 1 } })));
    });

    (async function renderRoleBar(){
      try{
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const opts = { method: 'GET', credentials: 'include', headers: Object.assign({'Content-Type':'application/json'}, token?{ 'Authorization': `Bearer ${token}` }:{}) };

        // Intentar obtener todos los usuarios (ruta admin-list) y filtrar por role
        let users = [];
        try {
          const resp = await fetch('/api/users/admin-list', opts);
          if (resp && resp.ok) {
            const json = await resp.json();
            users = Array.isArray(json.users) ? json.users : (Array.isArray(json.data) ? json.data : []);
          } else {
            // si no permite admin-list, intentar obtener solo agentes y construir placeholders
            const resp2 = await fetch('/api/users/agents', opts);
            if (resp2 && resp2.ok) {
              const j2 = await resp2.json();
              users = Array.isArray(j2.agents) ? j2.agents : [];
            }
          }
        } catch(e){ console.warn('[RoleBar] error fetching users', e); }

        // Normalizar roles
        const byRole = { backoffice: [], supervisor: [], admin: [] };
        users.forEach(u => {
          const role = (u.role||'').toString().toLowerCase();
          if (role.includes('back')) byRole.backoffice.push(u);
          else if (role.includes('supervisor')) byRole.supervisor.push(u);
          else if (role.includes('admin')) byRole.admin.push(u);
        });

        // Si no hay admins en list (por ejemplo, no tuvimos permission), intentar mostrar el usuario actual
        if (!byRole.admin.length) {
          try{
            const me = JSON.parse(localStorage.getItem('user')||sessionStorage.getItem('user')||'{}');
            if (me && (me.role||'').toString().toLowerCase().includes('admin')) byRole.admin.push({ id: me.id || me._id, username: me.username, name: me.name || me.username, avatarUrl: me.avatarUrl });
          }catch(e){}
        }

        // Render avatars helper
        const renderAvatars = (elId, arr) => {
          const container = document.getElementById(elId);
          if (!container) return;
          container.innerHTML = '';
          arr.slice(0,8).forEach(u=>{
            const a = document.createElement('div'); a.className='role-avatar';
            // Buscar avatar en m├║ltiples campos, priorizando avatarFileId
            let url = null;
            
            // 1. Si tiene avatarFileId, construir URL desde GridFS
            if (u.avatarFileId) {
              url = `/api/user-avatars/${u.avatarFileId}`;
            }
            // 2. Intentar campos de URL directa
            else if (u.avatarUrl || u.photo || u.picture || u.imageUrl || u.avatar) {
              url = u.avatarUrl || u.photo || u.picture || u.imageUrl || u.avatar;
            }
            // 3. Si tiene un ID de usuario, intentar construir URL
            else if (u._id || u.id) {
              const uid = u._id || u.id;
              url = `/api/user-avatars/${uid}`;
            }
            
            if (url) {
              const img = document.createElement('img'); 
              img.src = url; 
              img.alt = u.name || u.username || ''; 
              img.onerror = function() { 
                // Si falla la imagen, mostrar iniciales
                this.style.display = 'none';
                const initials = (u.name || u.username || '').split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase();
                const span = document.createElement('div'); 
                span.className='initials'; 
                span.textContent = initials || '?';
                a.appendChild(span);
              };
              a.appendChild(img);
            } else {
              const initials = (u.name || u.username || '').split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase();
              const span = document.createElement('div'); span.className='initials'; span.textContent = initials || '?';
              a.appendChild(span);
            }
            // Tooltip with name
            a.title = u.name || u.username || '';
            container.appendChild(a);
          });
          const countEl = document.getElementById(elId.replace('Avatars','Count'));
          if (countEl) countEl.textContent = `${arr.length} usuarios`;
        };

        renderAvatars('backofficeAvatars', byRole.backoffice);
        renderAvatars('supervisorAvatars', byRole.supervisor);
        renderAvatars('adminAvatars', byRole.admin);

        // If no data at all, hide bar to avoid empty UI
        if (!byRole.backoffice.length && !byRole.supervisor.length && !byRole.admin.length) {
          document.getElementById('roleBar').style.display = 'none';
        }

      }catch(err){ console.error('[RoleBar] error', err); }
    })();