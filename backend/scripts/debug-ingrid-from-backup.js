const fs = require('fs');
const path = require('path');

function parseNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  var s = String(value).trim().replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function parseDateFlexible(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const parts = s.split('/').map(p => parseInt(p,10));
    const d = new Date(parts[2], parts[1]-1, parts[0]);
    if (!isNaN(d)) return d;
  }
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2;
  return null;
}

(async function(){
  const backupPath = path.join(__dirname, '..', '..', 'backups', 'costumers.1764368998810.json');
  if (!fs.existsSync(backupPath)) {
    console.error('Backup file not found:', backupPath);
    process.exit(2);
  }
  console.log('Reading backup:', backupPath);
  const raw = fs.readFileSync(backupPath, 'utf8');
  let docs = [];
  try {
    docs = JSON.parse(raw);
  } catch (e) {
    console.error('Error parsing JSON:', e.message);
    process.exit(3);
  }
  console.log('Total docs in backup:', docs.length);

  const regex = /ingrid/i;
  const start = new Date(2026, 2, 1);
  const end   = new Date(2026, 3, 1);

  let matchedAny = 0;
  let inMonth = 0;
  let sumPuntos = 0;
  const rows = [];

  for (const d of docs) {
    if (!d) continue;
    const agentFields = [d.agente, d.agenteNombre, d.createdBy, d.vendedor, d.registeredBy, d.nombre, d.name];
    const matches = agentFields.some(f => f && regex.test(String(f)));
    if (!matches) continue;
    matchedAny++;

    let dt = parseDateFlexible(d.dia_venta) || parseDateFlexible(d.createdAt) || parseDateFlexible(d.created_at) || parseDateFlexible(d.fecha_contratacion);
    if (!dt) continue;
    if (dt >= start && dt < end) {
      inMonth++;
      const p = parseNumber(d.puntaje || d.Puntaje || d.points || d.score || 0);
      sumPuntos += p;
      rows.push({ id: d._id, agente: d.agente || d.agenteNombre || d.name, dia_venta: d.dia_venta, createdAt: d.createdAt, puntaje: p });
    }
  }

  console.log('\n=== Summary from backup for 2026-03 ===');
  console.log('matchedAny (any date):', matchedAny);
  console.log('count in month:', inMonth);
  console.log('sumPuntos:', Number(sumPuntos.toFixed(4)));
  console.log('first rows (50):', rows.slice(0,50));

})();
