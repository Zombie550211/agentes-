const { MongoClient } = require('mongodb');

const uri = process.argv[2] || process.env.MONGO_URI;
if (!uri) {
  console.error('Usage: node test_connect.js <mongo-uri>   OR set MONGO_URI in env');
  process.exit(2);
}

function mask(u) {
  try { const s = String(u); return s.length > 40 ? s.slice(0, 12) + '...(' + s.length + ' chars)' : s; } catch { return '<unprintable>'; }
}

(async function(){
  console.log('[test_connect] attempting to connect using uri:', mask(uri));
  // If uri is SRV and DNS server provided via env args, attempt SRV resolve to direct
  let final = String(uri);
  try {
    const args = require('minimist')(process.argv.slice(2));
    const dnsServer = args.dnsServer || process.env.DNS_SERVER;
    if (dnsServer && final.startsWith('mongodb+srv://')) {
      const { resolveSrvToDirectUri } = require('./srv_helper');
      try { final = await resolveSrvToDirectUri(final, dnsServer); console.log('[test_connect] SRV resolved via', dnsServer); } catch (e) { /* ignore */ }
    }
  } catch (e) {}
  const clientOptions = {};
  const args = require('minimist')(process.argv.slice(2));
  if (process.env.TLS_INSECURE === '1' || args.insecure) {
    clientOptions.tls = true;
    clientOptions.tlsAllowInvalidCertificates = true;
  }
  const client = new MongoClient(final, clientOptions);
  try {
    await client.connect();
    console.log('[test_connect] connected successfully');
    await client.close();
  } catch (err) {
    console.error('[test_connect] error:', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
})();
