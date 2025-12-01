const { resolveSrvToDirectUri } = require('./srv_helper');
require('dotenv').config();
(async()=>{
  try{
    const dnsServer = process.env.DNS_SERVER || null;
    const r = await resolveSrvToDirectUri(process.env.MONGODB_URI, dnsServer);
    console.log('RESOLVED:', r);
  }catch(e){
    console.error('ERR:', e && e.message);
  }
})();
