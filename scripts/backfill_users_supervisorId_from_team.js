#!/usr/bin/env node
/**
 * Backfill de users.supervisorId basado en un mapeo de equipos conocido
 *
 * Modo de uso:
 *   - Dry run:
 *       node scripts/backfill_users_supervisorId_from_team.js --dry-run
 *   - Commit:
 *       node scripts/backfill_users_supervisorId_from_team.js --commit
 */

const { connectToMongoDB, closeConnection } = require('../config/db');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    commit: args.includes('--commit'),
    dryRun: args.includes('--dry-run') || !args.includes('--commit')
  };
}

// Normalizador seguro de nombres (quita acentos, espacios extra y pasa a lower)
function norm(s) {
  try {
    return String(s || '')
      .normalize('NFD')
      .replace(/\p{Diacritic}+/gu, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  } catch { return ''; }
}

// Mapeo de equipos (copiado/alineado con utils/teams.js). Nombres canónicos sin acentos.
const TEAMS = {
  'team irania': {
    supervisor: 'irania serrano',
    agents: [
      'josue renderos',
      'tatiana ayala',
      'giselle diaz',
      'miguel nunez',
      'roxana martinez',
      'irania serrano'
    ]
  },
  'team bryan pleitez': {
    supervisor: 'bryan pleitez',
    agents: [
      'abigail galdamez',
      'alexander rivera',
      'diego mejia',
      'evelin garcia',
      'fabricio panameno',
      'luis chavarria',
      'steven varela'
    ]
  },
  'team marisol beltran': {
    supervisor: 'marisol beltran',
    agents: [
      'fernanda castillo',
      'jonathan morales',
      'katerine gomez',
      'kimberly iglesias',
      'stefani martinez'
    ]
  },
  'team roberto velasquez': {
    supervisor: 'roberto velasquez',
    agents: [
      'cindy flores',
      'daniela bonilla',
      'francisco aguilar',
      'levy ceren',
      'lisbeth cortez',
      'lucia ferman',
      'nelson ceren'
    ]
  },
  'team randal martinez': {
    supervisor: 'randal martinez',
    agents: [
      'anderson guzman',
      'carlos grande',
      'guadalupe santana',
      'julio chavez',
      'priscila hernandez',
      'riquelmi torres'
    ]
  }
};

async function main() {
  const { dryRun, commit } = parseArgs();
  console.log(`[BACKFILL users.supervisorId] start | dryRun=${dryRun} commit=${commit}`);

  try {
    const db = await connectToMongoDB();
    const users = db.collection('users');

    // Crear índice por nombre normalizado -> documentos user
    const allUsers = await users.find({}, { projection: { _id: 1, username: 1, name: 1, nombre: 1, fullName: 1, email: 1, role: 1, supervisorId: 1 } }).toArray();
    const byName = new Map();
    for (const u of allUsers) {
      const candidates = [u.username, u.name, u.nombre, u.fullName, u.email].map(norm).filter(Boolean);
      const uniq = Array.from(new Set(candidates));
      for (const key of uniq) {
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(u);
      }
    }

    let resolvedSupervisors = 0;
    let agentAssignments = 0;
    let notFoundSupervisors = 0;
    let notFoundAgents = 0;

    for (const [teamKey, def] of Object.entries(TEAMS)) {
      const supKey = norm(def.supervisor);
      const supCandidates = byName.get(supKey) || [];
      if (supCandidates.length === 0) {
        console.warn(`[WARN] Supervisor no encontrado: '${def.supervisor}' (team: ${teamKey})`);
        notFoundSupervisors++;
        continue;
      }
      // Elegir el primer match (si hay varios, avisar)
      const sup = supCandidates[0];
      if (supCandidates.length > 1) {
        console.warn(`[INFO] Supervisor '${def.supervisor}' tiene ${supCandidates.length} coincidencias; usando _id=${sup._id}`);
      }
      resolvedSupervisors++;

      for (const agentName of def.agents || []) {
        const aKey = norm(agentName);
        const agentCandidates = byName.get(aKey) || [];
        if (agentCandidates.length === 0) {
          console.warn(`[WARN] Agente no encontrado: '${agentName}' (team: ${teamKey})`);
          notFoundAgents++;
          continue;
        }
        const agent = agentCandidates[0];
        if (agentCandidates.length > 1) {
          console.warn(`[INFO] Agente '${agentName}' tiene ${agentCandidates.length} coincidencias; usando _id=${agent._id}`);
        }

        if (dryRun) {
          console.log(`[DRY] Set supervisorId de agent '${agentName}' (_id=${agent._id}) -> ${sup._id}`);
          agentAssignments++;
          continue;
        }

        const res = await users.updateOne({ _id: agent._id }, { $set: { supervisorId: sup._id } });
        if (res.modifiedCount > 0) agentAssignments++;
      }
    }

    console.log('[BACKFILL users.supervisorId] Resumen');
    console.log('  Supervisores resueltos:', resolvedSupervisors);
    console.log('  Asignaciones a agentes (updates):', agentAssignments);
    console.log('  Supervisores no encontrados:', notFoundSupervisors);
    console.log('  Agentes no encontrados:', notFoundAgents);
    console.log('  Modo:', dryRun ? 'DRY-RUN' : 'COMMIT');
  } catch (err) {
    console.error('[BACKFILL users.supervisorId] Error:', err?.message || err);
    process.exitCode = 1;
  } finally {
    try { await closeConnection(); } catch {}
  }
}

main();
