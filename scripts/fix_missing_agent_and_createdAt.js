const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_DB = process.env.MONGODB_DB || 'crmagente';
const MONGODB_URI = process.env.MONGODB_URI;

function parseArgs(argv) {
  const args = { commit: false, dryRun: false, limit: 0, collectionRegex: '^costumers(_|$)', db: DEFAULT_DB };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') args.commit = true;
    if (a === '--dry-run') args.dryRun = true;
    if (a === '--limit') args.limit = parseInt(argv[i + 1] || '0', 10) || 0, i++;
    if (a === '--db') args.db = argv[i + 1] || DEFAULT_DB, i++;
    if (a === '--collections-regex') args.collectionRegex = argv[i + 1] || args.collectionRegex, i++;
  }
  if (!args.commit) args.dryRun = true;
  return args;
}

function isPlaceholderAgent(v) {
  const s = (v ?? '').toString().trim();
  if (!s) return true;
  const lc = s.toLowerCase();
  return lc === 'agente' || lc === 'agente desconocido' || lc === 'n/a' || lc === 'na';
}

async function chooseAgentName(doc, usersCollection) {
  try {
    const agentId = doc.agenteId;
    if (agentId && usersCollection) {
      const s = String(agentId).trim();
      let user = null;
      if (/^[a-fA-F0-9]{24}$/.test(s)) {
        try { user = await usersCollection.findOne({ _id: new ObjectId(s) }); } catch (_) {}
      }
      if (!user) {
        try { user = await usersCollection.findOne({ $or: [{ id: s }, { _id: s }] }); } catch (_) {}
      }
      const uName = (user?.name || user?.username || '').toString().trim();
      if (uName && !isPlaceholderAgent(uName) && uName.toLowerCase() !== 'sistema') return uName;
    }
  } catch {}

  const candidates = [
    doc.createdBy,
    doc.creadoPor,
    doc.representante,
    doc.asignadoPor,
    doc.ownerName,
    doc.registeredBy,
  ].filter(v => typeof v === 'string' && v.trim());
  for (const c of candidates) {
    const v = c.toString().trim();
    if (!isPlaceholderAgent(v) && v.toLowerCase() !== 'sistema') return v;
  }

  // historial: buscar entrada de creación
  try {
    if (Array.isArray(doc.historial)) {
      const creation = doc.historial.find(h => (h && (h.accion === 'CREADO' || h.action === 'CREADO' || h.accion === 'CREATED' || h.action === 'CREATED')));
      const u = creation && (creation.usuario || creation.user || creation.username);
      if (u && typeof u === 'string' && u.trim() && !isPlaceholderAgent(u) && u.toLowerCase() !== 'sistema') return u.trim();
    }
  } catch {}

  return null;
}

function chooseCreatedAt(doc) {
  const v = doc.creadoEn || doc.fecha_creacion || doc.fechaCreacion || doc.created_on || doc.createdOn;
  if (!v) return null;
  try {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  } catch {}
  return null;
}

function chooseUpdatedAt(doc) {
  const v = doc.actualizadoEn || doc.updatedAt || doc.updated_on || doc.updatedOn;
  if (!v) return null;
  try {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  } catch {}
  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!MONGODB_URI) {
    console.error('Falta MONGODB_URI en .env');
    process.exit(1);
  }

  console.log('[fix_missing_agent_and_createdAt] args:', args);
  console.log(args.commit ? 'MODO COMMIT (aplica cambios)' : 'MODO DRY-RUN (no aplica cambios)');

  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    tlsAllowInvalidCertificates: true
  });

  await client.connect();
  const db = client.db(args.db);
  const usersCollection = db.collection('users');

  const collections = await db.listCollections().toArray();
  const rx = new RegExp(args.collectionRegex, 'i');
  const costumersCollections = collections.map(c => c.name).filter(n => rx.test(n));

  console.log(`Colecciones a revisar: ${costumersCollections.length}`);

  let totalMatched = 0;
  let totalWouldChange = 0;
  let totalUpdatedDocs = 0;

  for (const colName of costumersCollections) {
    const col = db.collection(colName);

    const query = {
      $or: [
        { agente: { $exists: false } },
        { agenteNombre: { $exists: false } },
        { agente: null },
        { agenteNombre: null },
        { agente: 'Agente' },
        { agenteNombre: 'Agente' },
        { agente: 'Agente Desconocido' },
        { agenteNombre: 'Agente Desconocido' },
        { createdAt: { $exists: false } },
      ]
    };

    const cursor = col.find(query).limit(args.limit > 0 ? args.limit : 0);

    let colMatched = 0;
    let colWouldChange = 0;
    let colUpdated = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) break;
      colMatched++;
      totalMatched++;

      const set = {};

      // Fix agente/agenteNombre
      const needAgent = isPlaceholderAgent(doc.agente) || isPlaceholderAgent(doc.agenteNombre);
      if (needAgent) {
        const agent = await chooseAgentName(doc, usersCollection);
        if (agent) {
          set.agente = agent;
          set.agenteNombre = agent;
          // Solo si createdBy es placeholder
          if (isPlaceholderAgent(doc.createdBy) || (doc.createdBy || '').toString().trim() === '') {
            set.createdBy = agent;
          }
        }
      }

      // Fix createdAt/updatedAt
      if (!doc.createdAt) {
        const createdAt = chooseCreatedAt(doc);
        if (createdAt) set.createdAt = createdAt;
      }
      if (!doc.updatedAt) {
        const updatedAt = chooseUpdatedAt(doc);
        if (updatedAt) set.updatedAt = updatedAt;
      }

      if (Object.keys(set).length > 0) {
        colWouldChange++;
        totalWouldChange++;

        if (args.commit) {
          const r = await col.updateOne({ _id: doc._id }, { $set: set });
          if (r && r.modifiedCount > 0) {
            colUpdated++;
            totalUpdatedDocs++;
          }
        }
      }
    }

    if (colMatched || colWouldChange) {
      console.log(`[${colName}] matched=${colMatched} wouldChange=${colWouldChange} updated=${colUpdated}`);
    }
  }

  console.log('================ RESUMEN ================');
  console.log('totalMatched:', totalMatched);
  console.log('totalWouldChange:', totalWouldChange);
  console.log('totalUpdatedDocs:', totalUpdatedDocs);

  await client.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
