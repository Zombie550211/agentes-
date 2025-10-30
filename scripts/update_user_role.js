#!/usr/bin/env node
/**
 * Update a user's role by username. Dry-run by default.
 * Usage:
 *  node scripts/update_user_role.js "USERNAME" "New Role"          # dry-run
 *  node scripts/update_user_role.js "USERNAME" "New Role" --commit  # apply
 */
const { connectToMongoDB, closeConnection } = require('../config/db');

(async () => {
  const [,, usernameArg, roleArg, ...rest] = process.argv;
  const doCommit = rest.includes('--commit');
  if (!usernameArg || !roleArg) {
    console.error('Uso: node scripts/update_user_role.js "USERNAME" "New Role" [--commit]');
    process.exit(1);
  }
  const username = String(usernameArg).trim();
  const newRole = String(roleArg).trim();
  try {
    const db = await connectToMongoDB();
    const users = db.collection('users');
    const current = await users.findOne({ username });
    if (!current) {
      console.log(`Usuario no encontrado: ${username}`);
      process.exit(0);
    }
    console.log(`Usuario: ${username}`);
    console.log(`Rol actual: ${current.role || '(sin rol)'} -> Nuevo rol: ${newRole}`);
    if (!doCommit) {
      console.log('\nDRY-RUN: no se aplicaron cambios. Ejecuta con --commit para actualizar.');
      process.exit(0);
    }
    const res = await users.updateOne({ _id: current._id }, { $set: { role: newRole, updatedAt: new Date() } });
    console.log(`Actualizados: ${res.modifiedCount}`);
  } catch (e) {
    console.error('Error actualizando rol:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await closeConnection(); } catch {}
  }
})();
