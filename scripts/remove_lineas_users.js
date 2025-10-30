#!/usr/bin/env node
/**
 * Remove users assigned to "Líneas" safely (dry-run by default).
 * Criteria:
 *  - role matches /lineas/i OR team matches /lineas/i
 * Usage:
 *  node scripts/remove_lineas_users.js          # dry-run (list only)
 *  node scripts/remove_lineas_users.js --commit # deletes
 */

const { connectToMongoDB, closeConnection } = require('../config/db');

(async () => {
  const args = process.argv.slice(2);
  const doCommit = args.includes('--commit');

  try {
    const db = await connectToMongoDB();
    const users = db.collection('users');

    const filter = {
      $or: [
        { role: { $regex: /lineas/i } },
        { team: { $regex: /lineas/i } }
      ]
    };

    const list = await users.find(filter).project({ username: 1, email: 1, role: 1, team: 1 }).toArray();

    console.log(`Encontrados ${list.length} usuarios asociados a "Líneas"`);
    list.forEach(u => {
      console.log(`- ${u.username || '(sin username)'} | ${u.email || '-'} | role=${u.role || '-'} | team=${u.team || '-'}`);
    });

    if (!doCommit) {
      console.log('\nDRY-RUN: No se eliminó ningún usuario. Ejecuta con --commit para aplicar.');
      process.exit(0);
    }

    if (list.length === 0) {
      console.log('No hay usuarios que eliminar.');
      process.exit(0);
    }

    const res = await users.deleteMany(filter);
    console.log(`\nEliminados ${res.deletedCount} usuarios.`);
  } catch (e) {
    console.error('Error al eliminar usuarios de Líneas:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await closeConnection(); } catch {}
  }
})();
