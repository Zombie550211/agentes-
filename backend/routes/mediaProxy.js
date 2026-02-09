const express = require('express');
const router = express.Router();

// Proxy simple para recursos de Cloudinary cuando el navegador bloquea acceso directo por tracking
// Uso: /media/proxy?url=<encodeURIComponent(url)>  (ej: https://res.cloudinary.com/...) 
// Validamos que solo se permitan dominios de cloudinary para seguridad.

const handler = async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url param');
  try {
    const decoded = decodeURIComponent(url);
    const allowed = decoded.startsWith('https://res.cloudinary.com/') || decoded.match(/^https?:\/\/[^/]+\.cloudinary\.com\//);
    if (!allowed) return res.status(403).send('Forbidden');

    // Usar fetch global (Node 18+). Si no está disponible, retornar la URL original.
    if (typeof fetch !== 'function') {
      return res.redirect(decoded);
    }

    const method = String(req.method || 'GET').toUpperCase();
    console.log('[mediaProxy] Request:', method, decoded);

    // Cloudinary a veces responde distinto a HEAD; intentar HEAD y si falla, fallback a GET
    let upstream;
    if (method === 'HEAD') {
      try {
        upstream = await fetch(decoded, { method: 'HEAD' });
      } catch (_) {
        upstream = null;
      }
      if (!upstream || !upstream.ok) {
        console.log('[mediaProxy] HEAD failed, trying GET');
        upstream = await fetch(decoded, { method: 'GET' });
      }
    } else {
      upstream = await fetch(decoded, { method: 'GET' });
    }

    // Propagar el status real del upstream (evitar 502 genérico)
    if (!upstream.ok) {
      console.log('[mediaProxy] Upstream error:', upstream.status, upstream.statusText);
      // En lugar de devolver 502, devolver 200 con headers básicos para que el frontend pueda renderizar directamente
      res.setHeader('Content-Type', 'image/png');
      if (method === 'HEAD') {
        return res.status(200).end();
      }
      return res.status(200).send(''); // body vacío, frontend renderizará con URL directa
    }

    // Pasar cabeceras relevantes (content-type, cache-control)
    const ct = upstream.headers.get('content-type');
    const cc = upstream.headers.get('cache-control');
    const cl = upstream.headers.get('content-length');
    if (ct) res.setHeader('Content-Type', ct);
    if (cc) res.setHeader('Cache-Control', cc);
    if (cl) res.setHeader('Content-Length', cl);

    // HEAD: responder solo headers
    if (method === 'HEAD') {
      console.log('[mediaProxy] HEAD response 200');
      return res.status(200).end();
    }

    console.log('[mediaProxy] GET streaming response');
    // Streamear el body al cliente
    const body = upstream.body;
    if (body && typeof body.pipe === 'function') {
      return body.pipe(res);
    }

    // Fallback a buffer
    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[mediaProxy] Error proxying:', err);
    res.status(500).send('Proxy error');
  }
};

router.get('/', handler);
router.head('/', handler);

module.exports = router;
