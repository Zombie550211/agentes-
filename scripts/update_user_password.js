#!/usr/bin/env node
/*
  One-off script to update a user's password in MongoDB.
  Usage:
    node scripts/update_user_password.js --username "Roxana Martinez" --password "Roxana$"

  Notes:
  - Uses the same Mongo connection as the app (`config/db.js`).
  - Searches by `username` primarily, with a case-insensitive fallback.
*/

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectToMongoDB, closeConnection, getDb } = require('../config/db');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--username' || a === '-u') {
      args.username = argv[++i];
    } else if (a === '--password' || a === '-p') {
      args.password = argv[++i];
    }
  }
  return args;
}

async function main() {
  const { username, password } = parseArgs(process.argv);
  if (!username || !password) {
    console.error('Uso: node scripts/update_user_password.js --username "NOMBRE" --password "NUEVA_PASS"');
    process.exit(1);
  }

  try {
    await connectToMongoDB();
    const db = getDb();
    const users = db.collection('users');

    // Buscar por username exacto; si no, por regex insensible a may/minus
    let user = await users.findOne({ username });
    if (!user) {
      user = await users.findOne({ username: { $regex: `^${username}$`, $options: 'i' } });
    }

    if (!user) {
      console.error(`Usuario no encontrado con username: ${username}`);
      process.exit(2);
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    const res = await users.updateOne({ _id: user._id }, { $set: { password: hashed, updatedAt: new Date() } });
    if (res.matchedCount === 0) {
      console.error('No se pudo actualizar el usuario (no match)');
      process.exit(3);
    }

    console.log(`Contraseña actualizada para '${user.username}' (id: ${user._id}).`);
  } catch (err) {
    console.error('Error actualizando contraseña:', err);
    process.exit(4);
  } finally {
    try { await closeConnection(); } catch {}
  }
}

main();
