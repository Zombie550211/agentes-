(function () {
  'use strict';

  /* ── Verificar mantenimiento al cargar ── */
  (async function checkMaintenance() {
    try {
      var r = await fetch('/api/auth/maintenance', { cache: 'no-store' });
      if (!r.ok) return;
      var d = await r.json();
      if (d.active) {
        var banner = document.getElementById('maintenanceBanner');
        var msg    = document.getElementById('maintenanceBannerMsg');
        if (msg) msg.textContent = d.message || 'El sistema se encuentra en mantenimiento. Por favor, intenta más tarde.';
        if (banner) banner.classList.add('show');
      }
    } catch (_) {}
  })();

  /* ── Helpers ── */
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  const ALERT_MAP = {
    success: ['alert-success', 'fa-circle-check'],
    danger:  ['alert-danger',  'fa-circle-xmark'],
    warning: ['alert-warning', 'fa-triangle-exclamation'],
    info:    ['alert-info',    'fa-circle-info'],
  };

  function showAlert(boxId, iconId, textId, msg, type) {
    const [cls, ico] = ALERT_MAP[type] || ALERT_MAP.info;
    const box  = document.getElementById(boxId);
    const icon = document.getElementById(iconId);
    const text = document.getElementById(textId);
    box.className    = `alert show ${cls}`;
    icon.className   = `fas ${ico}`;
    text.textContent = msg;
  }

  function clearAlert(boxId) {
    const el = document.getElementById(boxId);
    if (el) el.className = 'alert';
  }

  function showMainPanel(id) {
    document.querySelectorAll('.main-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function showForgotStep(n) {
    document.querySelectorAll('.fp-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('fp' + n).classList.add('active');
    updateStepper(n);
    document.getElementById('stepperWrap').style.display = n === 4 ? 'none' : '';
  }

  function updateStepper(active) {
    [1, 2, 3].forEach(function (i) {
      var item = document.getElementById('step' + i);
      var num  = document.getElementById('snum' + i);
      item.classList.remove('active', 'done');
      if (i < active) {
        item.classList.add('done');
        num.innerHTML = '<i class="fas fa-check" style="font-size:9px"></i>';
      } else {
        num.textContent = i;
        if (i === active) item.classList.add('active');
      }
    });
  }

  function setLoading(btnId, spId, on) {
    var btn = document.getElementById(btnId);
    var sp  = document.getElementById(spId);
    btn.disabled = on;
    btn.classList.toggle('loading', on);
    sp.style.display = on ? 'block' : 'none';
  }

  /* ── Mensaje inicial por URL ── */
  var urlMsg = getParam('message');
  if (urlMsg) showAlert('alertLogin', 'alertLoginIcon', 'alertLoginText', decodeURIComponent(urlMsg), 'info');

  /* ── Toggle contraseña login ── */
  document.getElementById('pwToggle').addEventListener('click', function () {
    var inp = document.getElementById('password');
    var ico = document.getElementById('pwIcon');
    var show = inp.type === 'password';
    inp.type      = show ? 'text' : 'password';
    ico.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
  });

  /* ── Checkbox "Recordar sesión" ── */
  var cbRemember = document.getElementById('rememberMe');
  var checkVis   = document.getElementById('checkVis');

  // Helpers de cookie (más compatibles que localStorage en todos los navegadores)
  function setCookie(name, value, days) {
    var expires = '';
    if (days) {
      var d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      expires = '; expires=' + d.toUTCString();
    }
    document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
  }
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }
  function deleteCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
  }

  function syncCheck() {
    var on = cbRemember.checked;
    checkVis.style.background  = on ? 'var(--accent)' : '';
    checkVis.style.borderColor = on ? 'var(--accent)' : '';
    checkVis.style.color       = on ? '#fff' : 'transparent';
  }
  cbRemember.addEventListener('change', syncCheck);
  checkVis.addEventListener('click', function () {
    cbRemember.checked = !cbRemember.checked;
    syncCheck();
  });

  // Pre-llenar usuario si estaba guardado en cookie
  var _savedUsername = getCookie('crm_remember_username');
  if (_savedUsername) {
    var _uInput = document.getElementById('username');
    if (_uInput) _uInput.value = _savedUsername;
    cbRemember.checked = true;
  }
  syncCheck();

  /* ── Panel switcher login ↔ forgot ── */
  document.getElementById('btnShowForgot').addEventListener('click', function () {
    showMainPanel('mainForgot');
    clearAlert('alertForgot');
    resetForgot();
  });
  document.getElementById('btnBack').addEventListener('click', function () {
    showMainPanel('mainLogin');
    clearAlert('alertLogin');
    resetForgot();
  });
  document.getElementById('btnGoLogin').addEventListener('click', function () {
    showMainPanel('mainLogin');
    resetForgot();
  });

  /* ── Estado interno del flujo forgot ── */
  var _fpUser       = '';
  var _resetToken   = '';
  var _codeAttempts = 0;
  var MAX_ATTEMPTS  = 5;

  function resetForgot() {
    _fpUser = ''; _resetToken = ''; _codeAttempts = 0;
    document.getElementById('fpUser').value   = '';
    document.getElementById('fpNewPw').value  = '';
    document.getElementById('fpConfPw').value = '';
    document.querySelectorAll('.code-digit').forEach(function (d) {
      d.value = ''; d.classList.remove('filled');
    });
    clearAlert('alertForgot');
    stopTimer();
    ['sb1','sb2','sb3','sb4'].forEach(function (id) {
      document.getElementById(id).style.background = '';
    });
    document.getElementById('strengthLabel').textContent = '';
    showForgotStep(1);
  }

  /* ── Toggles de contraseña en paso 3 ── */
  function makePwToggle(btnId, inputId, iconId) {
    document.getElementById(btnId).addEventListener('click', function () {
      var inp  = document.getElementById(inputId);
      var ico  = document.getElementById(iconId);
      var show = inp.type === 'password';
      inp.type      = show ? 'text' : 'password';
      ico.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    });
  }
  makePwToggle('tglNew',  'fpNewPw',  'icoNew');
  makePwToggle('tglConf', 'fpConfPw', 'icoConf');

  /* ── Indicador de fortaleza ── */
  document.getElementById('fpNewPw').addEventListener('input', function () {
    var pw = this.value;
    var score = 0;
    if (pw.length >= 8)           score++;
    if (/[A-Z]/.test(pw))        score++;
    if (/[0-9]/.test(pw))        score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    var colors = ['', '#e05252', '#e0a052', '#52a0c0', '#1a7a4a'];
    var labels = ['', 'Débil', 'Regular', 'Buena', 'Fuerte'];
    ['sb1','sb2','sb3','sb4'].forEach(function (id, i) {
      document.getElementById(id).style.background =
        pw.length && i < score ? colors[score] : 'var(--border)';
    });
    var lbl = document.getElementById('strengthLabel');
    lbl.textContent = pw.length ? (labels[score] || '') : '';
    lbl.style.color = pw.length ? (colors[score] || '') : '';
  });

  /* ── Code digit inputs ── */
  var codeDigits = Array.from(document.querySelectorAll('.code-digit'));

  codeDigits.forEach(function (inp, idx) {
    inp.addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(-1);
      this.classList.toggle('filled', this.value !== '');
      if (this.value && idx < codeDigits.length - 1) codeDigits[idx + 1].focus();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !this.value && idx > 0) {
        codeDigits[idx - 1].value = '';
        codeDigits[idx - 1].classList.remove('filled');
        codeDigits[idx - 1].focus();
      }
    });
    inp.addEventListener('paste', function (e) {
      e.preventDefault();
      var pasted = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, 6);
      pasted.split('').forEach(function (ch, i) {
        if (codeDigits[i]) { codeDigits[i].value = ch; codeDigits[i].classList.add('filled'); }
      });
      codeDigits[Math.min(pasted.length, codeDigits.length - 1)].focus();
    });
  });

  function getCode() { return codeDigits.map(function (d) { return d.value; }).join(''); }

  /* ── Timer de reenvío ── */
  var _timerID = null;

  function startTimer(sec) {
    sec = sec || 60;
    var btnR  = document.getElementById('btnResend');
    var label = document.getElementById('timerLabel');
    var count = document.getElementById('timerCount');
    btnR.disabled = true;
    label.style.display = 'inline';
    count.textContent = sec;
    var rem = sec;
    _timerID = setInterval(function () {
      rem--;
      count.textContent = rem;
      if (rem <= 0) { stopTimer(); btnR.disabled = false; label.style.display = 'none'; }
    }, 1000);
  }

  function stopTimer() { clearInterval(_timerID); _timerID = null; }

  /* ── Forgot paso 1: enviar código ── */
  document.getElementById('frmFP1').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearAlert('alertForgot');
    var uname = document.getElementById('fpUser').value.trim();
    if (!uname || uname.length < 3) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Ingresa un nombre de usuario válido (mínimo 3 caracteres).', 'warning');
      return;
    }
    if (!/^[a-zA-Z0-9._@-]{3,60}$/.test(uname)) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'El usuario contiene caracteres no permitidos.', 'warning');
      return;
    }
    setLoading('btnFP1', 'spFP1', true);
    try {
      var res  = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname })
      });
      var ct   = res.headers.get('content-type') || '';
      var data = ct.includes('application/json') ? await res.json() : {};
      _fpUser  = uname;
      if (data && data.maskedEmail) {
        document.getElementById('fpCodeHint').innerHTML =
          'Código enviado a <strong>' + data.maskedEmail + '</strong>. Revisa también tu bandeja de spam.';
      } else {
        document.getElementById('fpCodeHint').textContent =
          'Si el usuario existe en el sistema, recibirás un código en el correo registrado. Revisa también la bandeja de spam.';
      }
      setLoading('btnFP1', 'spFP1', false);
      showForgotStep(2);
      startTimer(60);
      codeDigits[0].focus();
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        '¡Código enviado! Revisa tu correo electrónico.', 'success');
    } catch (err) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Error de conexión. Inténtalo de nuevo.', 'danger');
      setLoading('btnFP1', 'spFP1', false);
    }
  });

  /* ── Reenviar código ── */
  document.getElementById('btnResend').addEventListener('click', async function () {
    this.disabled = true;
    clearAlert('alertForgot');
    try {
      var res  = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: _fpUser })
      });
      var ct   = res.headers.get('content-type') || '';
      var data = ct.includes('json') ? await res.json() : {};
      if (!res.ok) throw new Error((data && data.message) || 'Error al reenviar.');
      startTimer(60);
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Código reenviado. Revisa tu correo.', 'info');
    } catch (err) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        err.message || 'No se pudo reenviar. Inténtalo más tarde.', 'danger');
      this.disabled = false;
    }
  });

  /* ── Forgot paso 2: verificar código ── */
  document.getElementById('frmFP2').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearAlert('alertForgot');
    var code = getCode();
    if (code.length < 6) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Ingresa los 6 dígitos del código.', 'warning');
      return;
    }
    _codeAttempts++;
    if (_codeAttempts > MAX_ATTEMPTS) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Demasiados intentos. Por seguridad debes solicitar un nuevo código.', 'danger');
      setTimeout(function () {
        _codeAttempts = 0; showForgotStep(1); clearAlert('alertForgot');
        document.getElementById('fpUser').focus();
      }, 3000);
      return;
    }
    setLoading('btnFP2', 'spFP2', true);
    try {
      var res  = await fetch('/api/auth/verify-reset-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: _fpUser, code: code })
      });
      var ct   = res.headers.get('content-type') || '';
      var data = ct.includes('json') ? await res.json() : {};
      if (!res.ok) {
        var left   = MAX_ATTEMPTS - _codeAttempts;
        var errMsg = (data && data.message) ? data.message : 'Código incorrecto o expirado.';
        if (left > 0) errMsg += ' Te quedan ' + left + ' intento' + (left !== 1 ? 's' : '') + '.';
        throw new Error(errMsg);
      }
      _resetToken = (data && data.resetToken) ? data.resetToken : '';
      stopTimer();
      codeDigits.forEach(function (d) { d.value = ''; d.classList.remove('filled'); });
      setLoading('btnFP2', 'spFP2', false);
      showForgotStep(3);
      clearAlert('alertForgot');
      document.getElementById('fpNewPw').focus();
    } catch (err) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        err.message || 'Error de verificación.', 'danger');
      codeDigits.forEach(function (d) { d.value = ''; d.classList.remove('filled'); });
      codeDigits[0].focus();
      setLoading('btnFP2', 'spFP2', false);
    }
  });

  /* ── Forgot paso 3: nueva contraseña ── */
  document.getElementById('frmFP3').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearAlert('alertForgot');
    if (!_resetToken) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Sesión de recuperación inválida. Reinicia el proceso desde el paso 1.', 'danger');
      setTimeout(function () { showForgotStep(1); clearAlert('alertForgot'); }, 3000);
      return;
    }
    var newPw  = document.getElementById('fpNewPw').value;
    var confPw = document.getElementById('fpConfPw').value;
    if (newPw.length < 8) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'La contraseña debe tener al menos 8 caracteres.', 'warning');
      return;
    }
    if (newPw !== confPw) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'Las contraseñas no coinciden.', 'danger');
      return;
    }
    if (!/[A-Z]/.test(newPw) || !/[0-9]/.test(newPw)) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        'La contraseña debe tener al menos una mayúscula y un número.', 'warning');
      return;
    }
    setLoading('btnFP3', 'spFP3', true);
    try {
      var res  = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: _fpUser, resetToken: _resetToken, newPassword: newPw })
      });
      var ct   = res.headers.get('content-type') || '';
      var data = ct.includes('json') ? await res.json() : {};
      if (!res.ok) throw new Error((data && data.message) || 'No se pudo cambiar la contraseña.');
      _resetToken = '';
      setLoading('btnFP3', 'spFP3', false);
      showForgotStep(4);
    } catch (err) {
      showAlert('alertForgot', 'alertForgotIcon', 'alertForgotText',
        err.message || 'Error al cambiar la contraseña.', 'danger');
      setLoading('btnFP3', 'spFP3', false);
    }
  });

  /* ── Precarga en background post-login ── */
  async function preheatOne(url, sk) {
    try {
      var r = await fetch(url, { method: 'GET', credentials: 'include' });
      if (!r.ok) return;
      var d = await r.json();
      if (!d.success) return;
      try { sessionStorage.setItem(sk, JSON.stringify(d.data || d)); } catch (_) {}
    } catch (_) {}
  }

  function preheatPages() {
    preheatOne('/api/init-dashboard',    'dashboardData');
    preheatOne('/api/init-all-pages',    'allPagesData');
    preheatOne('/api/init-estadisticas', 'estadisticasData');
    preheatOne('/api/init-rankings',     'rankingsData');
    preheatOne('/api/init-lead',         'leadData');
    preheatOne('/api/init-facturacion',  'facturacionData');
    preheatOne('/api/init-multimedia',   'multimediaData');
  }

  /* ── Login submit ── */
  var loginAttempts    = 0;
  var loginLocked      = false;
  var lockTimerID      = null;
  var MAX_LOGIN_ATTEMPTS = 5;

  document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearAlert('alertLogin');

    if (loginLocked) {
      showAlert('alertLogin', 'alertLoginIcon', 'alertLoginText',
        'Demasiados intentos fallidos. Espera antes de continuar.', 'danger');
      return;
    }

    var username    = document.getElementById('username').value.trim();
    var password    = document.getElementById('password').value;
    var redirectUrl = getParam('redirect') || '/residencial/inicio.html';

    if (!username || !password) {
      showAlert('alertLogin', 'alertLoginIcon', 'alertLoginText',
        'Por favor ingresa tu usuario y contraseña.', 'warning');
      return;
    }

    setLoading('submitBtn', 'loginSpinner', true);
    showAlert('alertLogin', 'alertLoginIcon', 'alertLoginText', 'Verificando credenciales…', 'info');

    try {
      var res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });

      var ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json'))
        throw new Error('El servidor devolvió una respuesta inesperada.');

      var data = await res.json();
      if (!res.ok || !data.success)
        throw new Error((data && data.message) || 'Credenciales inválidas.');

      loginAttempts = 0;
      document.getElementById('lockBadge').classList.remove('show');

      // Guardar info de usuario para display (no el token — la auth es por cookie)
      var userInfo = {
        id:          data.user && data.user.id,
        username:    data.user && data.user.username,
        name:        (data.user && data.user.name) || (data.user && data.user.username),
        role:        (data.user && data.user.role) || 'user',
        team:        data.user && data.user.team,
        supervisor:  data.user && data.user.supervisor,
        permissions: (data.user && data.user.permissions) || []
      };
      var _remember = document.getElementById('rememberMe') && document.getElementById('rememberMe').checked;
      if (_remember) {
        setCookie('crm_remember_username', username, 30); // 30 días
        try { localStorage.setItem('user', JSON.stringify(userInfo)); } catch(_) {}
        sessionStorage.setItem('user', JSON.stringify(userInfo));
      } else {
        deleteCookie('crm_remember_username');
        try { localStorage.removeItem('user'); } catch(_) {}
        sessionStorage.setItem('user', JSON.stringify(userInfo));
      }

      // Determinar destino según rol/equipo
      if (!getParam('redirect')) {
        var role = String(userInfo.role || '').toLowerCase();
        var team = String(userInfo.team || '').toLowerCase();
        var isLineas = role.includes('lineas') || team.includes('lineas') ||
                       role === 'supervisor team lineas';
        redirectUrl = isLineas ? '/lineas/inicio.html' : '/residencial/inicio.html';
      }

      showAlert('alertLogin', 'alertLoginIcon', 'alertLoginText', '¡Acceso concedido! Redirigiendo…', 'success');
      sessionStorage.setItem('show_welcome', '1');
      preheatPages();
      setTimeout(function () { window.location.replace(redirectUrl); }, 500);

    } catch (err) {
      loginAttempts++;
      setLoading('submitBtn', 'loginSpinner', false);

      var msg = 'Error de conexión. Verifica tu internet e intenta de nuevo.';
      if (err.message.includes('Failed to fetch'))             msg = 'No se pudo conectar al servidor.';
      else if (err.message.toLowerCase().includes('too many')) msg = 'Demasiados intentos. Espera unos minutos.';
      else if (err.message)                                    msg = err.message;

      showAlert('alertLogin', 'alertLoginIcon', 'alertLoginText', msg, 'danger');

      if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        loginLocked = true;
        var badge   = document.getElementById('lockBadge');
        var lockTxt = document.getElementById('lockText');
        badge.classList.add('show');
        var sec = 30;
        lockTxt.textContent = 'Cuenta bloqueada temporalmente. Espera ' + sec + 's.';
        lockTimerID = setInterval(function () {
          sec--;
          lockTxt.textContent = 'Cuenta bloqueada temporalmente. Espera ' + sec + 's.';
          if (sec <= 0) {
            clearInterval(lockTimerID);
            loginLocked = false;
            loginAttempts = 0;
            badge.classList.remove('show');
          }
        }, 1000);
      } else if (loginAttempts >= 3) {
        var left2 = MAX_LOGIN_ATTEMPTS - loginAttempts;
        document.getElementById('lockBadge').classList.add('show');
        document.getElementById('lockText').textContent =
          left2 + ' intento' + (left2 !== 1 ? 's' : '') + ' restante' + (left2 !== 1 ? 's' : '') + ' antes del bloqueo.';
      }

      document.getElementById('username').focus();
    }
  });

})();
