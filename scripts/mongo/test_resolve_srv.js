const dns = require('dns').promises;

function hostFromUri(uri) {
  if (!uri) return null;
  try {
    const m = uri.match(/mongodb\+srv:\/\/([^@]+@)?([^/\?]+)/);
    return m ? m[2] : null;
  } catch (e) { return null; }
}

const hostArg = process.argv[2] || hostFromUri(process.env.MONGO_URI);
if (!hostArg) {
  console.error('Usage: node test_resolve_srv.js <host>   OR set MONGO_URI in env');
  process.exit(2);
}

const srvName = `_mongodb._tcp.${hostArg}`;
console.log('[test_resolve_srv] resolving SRV for', srvName);

(async function(){
  try {
    const res = await dns.resolveSrv(srvName);
    console.log('[test_resolve_srv] SRV result:');
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('[test_resolve_srv] error:', err && err.message ? err.message : err);
    process.exitCode = 1;
  }
})();
