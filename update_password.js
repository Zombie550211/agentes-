require('dotenv').config();
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');

const MONGODB_URI = process.env.MONGODB_URI;
const USER_NAME = 'Daniel Martinez';
const NEW_PASSWORD = 'Zombie5502M';
const SALT_ROUNDS = 10; // Valor estándar para el "salt"

async function updateUserPassword() {
  if (!MONGODB_URI) {
    console.error('[ERROR] La variable de entorno MONGODB_URI no está definida. Asegúrate de tener un archivo .env.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    console.log(`[INFO] Conectando a la base de datos...`);
    await client.connect();
    const db = client.db();
    const usersCollection = db.collection('users');
    console.log(`[INFO] Conexión exitosa.`);

    console.log(`[INFO] Encriptando la nueva contraseña...`);
    const hashedPassword = await bcrypt.hash(NEW_PASSWORD, SALT_ROUNDS);
    console.log(`[INFO] Contraseña encriptada.`);

    console.log(`[INFO] Buscando al usuario '${USER_NAME}'...`);
    // Asumo que el campo para el nombre de usuario es 'nombre'
    const result = await usersCollection.updateOne(
      { username: { $regex: new RegExp('^' + USER_NAME + '$', 'i') } },
      { $set: { password: hashedPassword } }
    );

    if (result.matchedCount === 0) {
      console.error(`[ERROR] No se encontró ningún usuario con el nombre '${USER_NAME}'. No se realizó ningún cambio.`);
    } else if (result.modifiedCount === 0) {
      console.warn(`[WARN] Se encontró al usuario '${USER_NAME}', pero la contraseña no cambió. Es posible que ya fuera la misma.`);
    } else {
      console.log(`[SUCCESS] ¡La contraseña para el usuario '${USER_NAME}' ha sido actualizada exitosamente!`);
    }

  } catch (error) {
    console.error('[FATAL] Ocurrió un error durante el proceso:', error);
  } finally {
    console.log('[INFO] Cerrando la conexión a la base de datos.');
    await client.close();
  }
}

updateUserPassword();
