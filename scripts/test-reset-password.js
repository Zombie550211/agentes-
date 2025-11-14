/*
  Script de prueba para reset-password endpoint.
  Uso (PowerShell):

  $env:BASE_URL = 'http://localhost:3000'
  $env:ADMIN_USER = 'admin'
  $env:ADMIN_PASS = 'adminpass'
  $env:TARGET_USER = 'usuario_a_restablecer'
  $env:NEW_PASS = 'NuevaPass123!'
  node scripts/test-reset-password.js

  El script hace:
   1) POST /api/auth/login con username/password para obtener cookie `token`
   2) POST /api/auth/reset-password con cookie para actualizar contraseña del TARGET_USER

  Nota: si tu servidor corre en otro puerto o dominio, ajusta BASE_URL.
*/

const http = require('http');
const https = require('https');

const fetch = global.fetch || require('node-fetch');

(async function(){
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;
  const TARGET_USER = process.env.TARGET_USER;
  const NEW_PASS = process.env.NEW_PASS;

  if (!ADMIN_USER || !ADMIN_PASS || !TARGET_USER || !NEW_PASS) {
    console.error('Faltan variables de entorno. Define ADMIN_USER, ADMIN_PASS, TARGET_USER, NEW_PASS y opcional BASE_URL.');
    process.exit(1);
  }

  try {
    // 1) Login
    console.log('-> Iniciando sesión como admin...');
    const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
      redirect: 'manual'
    });

    const loginJson = await loginResp.json().catch(()=>null);
    if (!loginResp.ok) {
      console.error('Login falló:', loginResp.status, loginJson);
      process.exit(2);
    }

    // Extraer cookie token desde set-cookie (si el servidor la envía)
    const setCookie = loginResp.headers.get('set-cookie') || loginResp.headers.get('Set-Cookie');
    let cookieHeader = '';
    if (setCookie) {
      // simplista: tomar hasta el primer ';'
      cookieHeader = setCookie.split(';')[0];
      console.log('Cookie recibida:', cookieHeader);
    } else if (loginJson && loginJson.token) {
      // Si el servidor devuelve token en JSON también lo usamos como Bearer
      cookieHeader = '';
      console.log('Token devuelto en JSON (se usará Authorization Bearer)');
    } else {
      console.warn('No se recibió cookie ni token en la respuesta. Asegúrate de que el servidor establezca cookie `token`.');
    }

    // 2) Llamar reset-password
    console.log(`-> Solicitando reset-password para usuario '${TARGET_USER}'...`);
    const body = { username: TARGET_USER, newPassword: NEW_PASS };
    const headers = { 'Content-Type': 'application/json' };
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    else if (loginJson && loginJson.token) headers['Authorization'] = `Bearer ${loginJson.token}`;

    const resp = await fetch(`${BASE_URL}/api/auth/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include'
    });
    const json = await resp.json().catch(()=>null);
    if (!resp.ok) {
      console.error('Reset failed:', resp.status, json);
      process.exit(3);
    }
    console.log('Reset OK:', json);
    process.exit(0);
  } catch (err) {
    console.error('Error ejecutando script:', err);
    process.exit(10);
  }
})();
