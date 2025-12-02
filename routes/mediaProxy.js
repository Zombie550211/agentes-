const express = require('express');
const router = express.Router();

// Proxy simple para recursos de Cloudinary cuando el navegador bloquea acceso directo por tracking
// Uso: /media/proxy?url=<encodeURIComponent(url)>  (ej: https://res.cloudinary.com/...) 
// Validamos que solo se permitan dominios de cloudinary para seguridad.

router.get('/', async (req, res) => {
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

    const upstream = await fetch(decoded);
    if (!upstream.ok) return res.status(502).send('Upstream error');

    // Pasar cabeceras relevantes (content-type, cache-control)
    const ct = upstream.headers.get('content-type');
    const cc = upstream.headers.get('cache-control');
    if (ct) res.setHeader('Content-Type', ct);
    if (cc) res.setHeader('Cache-Control', cc);

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
});

module.exports = router;
