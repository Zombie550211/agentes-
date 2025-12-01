#!/usr/bin/env node
// consolidate_by_shortid.js
// Scans `costumers_*` collections, groups collections that belong to the same user by agenteId
// and copies documents into a canonical collection `costumers_<shortId>[_<display>]`.
// Usage: node consolidate_by_shortid.js --dry-run (default) --apply (to perform copy) --force (delete source collections after copy)

const { MongoClient } = require('mongodb');
require('dotenv').config();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: true, apply: false, force: false };
  for (let a of args) {
    if (a === '--apply') { out.dryRun = false; out.apply = true; }
    if (a === '--dry-run') { out.dryRun = true; out.apply = false; }
    if (a === '--force') { out.force = true; }
  }
  return out;
}

function normalizeDisplay(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0000-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_.]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .slice(0, 60);
}

(async function main(){
  const opts = parseArgs();
  console.log('[consolidate] starting -', opts.dryRun ? 'DRY-RUN' : 'APPLY', opts.force ? 'FORCE' : 'NO-FORCE');

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set in .env'); process.exit(1); }

  // Attempt SRV -> direct URI resolution if needed (helps in constrained DNS environments)
  let connectUri = uri;
  try {
    const { resolveSrvToDirectUri } = require('./srv_helper');
    const dnsServer = process.env.DNS_SERVER || process.env.DNS || null;
    connectUri = await resolveSrvToDirectUri(uri, dnsServer);
    console.log('[consolidate] using resolved connectUri');
  } catch (e) {
    console.warn('[consolidate] SRV resolution fallback failed, using original URI:', e && e.message);
    connectUri = uri;
  }

  const clientOpts = {};
  if (process.env.TLS_INSECURE === '1') {
    clientOpts.tlsAllowInvalidCertificates = true;
    clientOpts.tls = true;
  }

  const client = new MongoClient(connectUri, clientOpts);
  try {
    await client.connect();
    const db = client.db();
    console.log('[consolidate] connected to', db.databaseName);

    const allCols = await db.listCollections().toArray();
    const names = allCols.map(c => c.name);

    // Filter candidate source collections: start with costumers_ but exclude costumers (global) and user_collections
    const candidates = names.filter(n => n.startsWith('costumers_') && n !== 'costumers' && n !== 'user_collections');
    console.log('[consolidate] found candidate collections:', candidates.length);

    const summary = [];

    for (const col of candidates) {
      console.log('\n[consolidate] examining', col);
      const collection = db.collection(col);
      const total = await collection.countDocuments();
      console.log('[consolidate] document count:', total);
      if (total === 0) { summary.push({ source: col, reason: 'empty', skipped: true }); continue; }

      // Sample up to 200 docs to infer agenteId/agenteNombre
      const sample = await collection.find({}, { projection: { agenteId:1, agenteNombre:1, agente:1 } }).limit(200).toArray();
      const agenteIds = [...new Set(sample.map(d => d.agenteId).filter(Boolean))];
      const agenteNames = [...new Set(sample.map(d => d.agenteNombre || d.agente).filter(Boolean))];

      if (agenteIds.length === 1) {
        const ownerId = String(agenteIds[0]);
        const shortId = ownerId.replace(/[^a-zA-Z0-9]/g,'').slice(0,6);

        // Check mapping
        let mapping = null;
        try { mapping = await db.collection('user_collections').findOne({ ownerId: ownerId }); } catch(e){/*ignore*/}

        let target = null;
        if (mapping && mapping.collectionName) {
          target = mapping.collectionName;
        } else {
          // Try to find existing collections that include the shortId
          const matches = names.filter(n => n === `costumers_${shortId}` || n.endsWith(`_${shortId}`));
          if (matches.length > 0) {
            const preferred = matches.find(n => /^costumers_[^_]+_[a-zA-Z0-9]{1,}$/.test(n) && n.endsWith(`_${shortId}`));
            target = preferred || matches[0];
          } else {
            // Build canonical
            const display = normalizeDisplay(agenteNames[0] || '');
            target = display ? `costumers_${shortId}_${display}` : `costumers_${shortId}`;
          }
        }

        console.log(`[consolidate] source ${col} -> ownerId ${ownerId} short ${shortId} target ${target}`);

        // Prepare counts for dry-run
        const targetCollection = db.collection(target);
        const targetCount = await targetCollection.countDocuments();

        summary.push({ source: col, ownerId, shortId, target, sourceCount: total, targetCountBefore: targetCount, skipped: false });

        if (!opts.dryRun) {
          // copy documents in small batches to avoid memory issues
          const cursor = collection.find({});
          let copied = 0;
          while (await cursor.hasNext()) {
            const batch = [];
            for (let i=0;i<200 && await cursor.hasNext(); i++) {
              const doc = await cursor.next();
              batch.push(doc);
            }
            for (const doc of batch) {
              try {
                await targetCollection.insertOne(doc);
                copied++;
              } catch (e) {
                if (e && e.code === 11000) {
                  // duplicate key, ignore
                } else {
                  console.error('[consolidate] error inserting doc into', target, e && e.message);
                }
              }
            }
          }
          console.log('[consolidate] copied', copied, 'documents from', col, 'to', target);

          // upsert mapping
          try {
            await db.collection('user_collections').updateOne({ ownerId }, { $set: { ownerId, collectionName: target, updatedAt: new Date() } }, { upsert: true });
            console.log('[consolidate] upserted mapping for', ownerId, '->', target);
          } catch (e) {
            console.warn('[consolidate] error upserting mapping:', e && e.message);
          }

          if (opts.force) {
            try {
              await collection.drop();
              console.log('[consolidate] dropped source collection', col);
            } catch (e) {
              console.warn('[consolidate] error dropping collection', col, e && e.message);
            }
          }
        }

      } else {
        // Mixed or missing agenteId - skip and report
        console.log('[consolidate] skipped collection (mixed/no agenteId). agenteIds sample:', agenteIds.slice(0,5));
        summary.push({ source: col, reason: 'mixed_or_no_agenteId', sampleAgenteIds: agenteIds.slice(0,10), sampleAgenteNames: agenteNames.slice(0,5), skipped: true });
      }
    }

    console.log('\n[consolidate] run complete. Summary:');
    console.table(summary.map(s => ({ source: s.source, skipped: s.skipped, reason: s.reason || '', ownerId: s.ownerId||'', shortId: s.shortId||'', target: s.target||'', sourceCount: s.sourceCount||0, targetBefore: s.targetCountBefore||0 })));

    if (opts.dryRun) {
      console.log('\n[consolidate] Dry-run mode: no writes performed. Re-run with --apply to copy documents and --force to drop sources.');
    } else {
      console.log('\n[consolidate] Apply mode completed. Review mappings in user_collections.');
    }

    process.exit(0);
  } catch (err) {
    console.error('[consolidate] fatal error:', err && err.message);
    process.exit(2);
  } finally {
    try { await client.close(); } catch(e){}
  }
})();
