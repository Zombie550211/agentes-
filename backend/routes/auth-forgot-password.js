/**
 * ═══════════════════════════════════════════════════════════════
 *  RUTAS: Recuperación de contraseña con envío de email
 *  Archivo: routes/auth-forgot-password.js
 *
 *  Integrar en server.js:
 *    const forgotRoutes = require('./routes/auth-forgot-password');
 *    app.use('/api/auth', forgotRoutes);
 *
 *  Dependencias (ya instaladas):
 *    bcryptjs, nodemailer, express-rate-limit
 *
 *  Variables de entorno requeridas (.env):
 *    EMAIL_HOST=smtp.directvdeals.net
 *    EMAIL_PORT=587
 *    EMAIL_SECURE=false
 *    EMAIL_USER=dperez@directvdeals.net
 *    EMAIL_PASS=tu_contraseña_smtp
 *    RESET_CODE_EXPIRY_MINUTES=10
 *    NODE_ENV=production
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const nodemailer = require('nodemailer');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const { getDb }  = require('../config/db');

/* ═══════════════════════════════════════════════════
   FUNCIONES DE BASE DE DATOS — MongoDB
═══════════════════════════════════════════════════ */

async function findUserByUsername(username) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  const user = await db.collection('users').findOne(
    { username: username },
    { projection: { _id: 1, username: 1, email: 1 } }
  );
  
  if (!user) return null;
  
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email
  };
}

async function saveResetCode(userId, codeHash, expiresAt, attempts) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  await db.collection('users').updateOne(
    { _id: userId },
    {
      $set: {
        reset_code_hash: codeHash,
        reset_code_expires_at: expiresAt,
        reset_code_attempts: attempts,
        reset_token_hash: null,
        reset_token_expires_at: null,
        reset_token_used: false
      }
    }
  );
}

async function findResetCode(userId) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  const user = await db.collection('users').findOne(
    { _id: userId },
    {
      projection: {
        reset_code_hash: 1,
        reset_code_expires_at: 1,
        reset_code_attempts: 1,
        reset_token_hash: 1,
        reset_token_expires_at: 1,
        reset_token_used: 1
      }
    }
  );
  
  if (!user || !user.reset_code_hash) return null;
  
  return {
    codeHash: user.reset_code_hash,
    expiresAt: user.reset_code_expires_at,
    attempts: user.reset_code_attempts || 0,
    resetTokenHash: user.reset_token_hash,
    resetTokenExpiresAt: user.reset_token_expires_at,
    resetTokenUsed: user.reset_token_used || false
  };
}

async function incrementResetCodeAttempts(userId) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  await db.collection('users').updateOne(
    { _id: userId },
    { $inc: { reset_code_attempts: 1 } }
  );
}

async function saveResetToken(userId, tokenHash, expiresAt) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  await db.collection('users').updateOne(
    { _id: userId },
    {
      $set: {
        reset_token_hash: tokenHash,
        reset_token_expires_at: expiresAt,
        reset_token_used: false
      }
    }
  );
}

async function invalidateResetCode(userId) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  await db.collection('users').updateOne(
    { _id: userId },
    {
      $set: {
        reset_code_hash: null,
        reset_code_expires_at: null,
        reset_code_attempts: 0
      }
    }
  );
}

async function updatePassword(userId, hashedPassword) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  await db.collection('users').updateOne(
    { _id: userId },
    { $set: { password: hashedPassword } }
  );
}

async function invalidateResetToken(userId) {
  const db = getDb();
  if (!db) throw new Error('Base de datos no disponible');
  
  await db.collection('users').updateOne(
    { _id: userId },
    {
      $set: {
        reset_token_hash: null,
        reset_token_expires_at: null,
        reset_token_used: true
      }
    }
  );
}

/* ═══════════════════════════════════════════════════
   CONFIGURACIÓN DE NODEMAILER
   Correo remitente: dperez@directvdeals.net
═══════════════════════════════════════════════════ */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || 'smtp.directvdeals.net',
  port:   parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || 'dperez@directvdeals.net',
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
});

transporter.verify(function (error) {
  if (error) {
    console.error('[EMAIL] ❌ Error de conexión SMTP:', error.message);
  } else {
    console.log('[EMAIL] ✅ SMTP listo — remitente: dperez@directvdeals.net');
  }
});

/* ═══════════════════════════════════════════════════
   HELPERS DE SEGURIDAD
═══════════════════════════════════════════════════ */
const EXPIRY_MS        = (parseInt(process.env.RESET_CODE_EXPIRY_MINUTES || '10')) * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const BCRYPT_ROUNDS    = 12;

function generateCode() {
  const bytes = crypto.randomBytes(4);
  const num   = (bytes.readUInt32BE(0) % 900000) + 100000;
  return String(num);
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  const visible = user.length > 2 ? user.slice(0, 2) : user.slice(0, 1);
  return visible + '***@' + domain;
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 60) return false;
  return /^[a-zA-Z0-9._@-]+$/.test(username);
}

/* ═══════════════════════════════════════════════════
   RATE LIMITING
═══════════════════════════════════════════════════ */
const forgotRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Demasiadas solicitudes. Espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

const verifyCodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Demasiados intentos de verificación.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const resetPwRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Demasiadas solicitudes de cambio de contraseña.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ═══════════════════════════════════════════════════
   RUTA 1: POST /api/auth/forgot-password
   
   Body: { username: string }
   
   Flujo:
   1. Validar y sanitizar username.
   2. Buscar usuario en BD.
   3. Si existe: generar código, hashear, guardar en BD,
      enviar email desde dperez@directvdeals.net.
   4. SIEMPRE responder 200 con mensaje genérico.
   5. Si existe: incluir maskedEmail en la respuesta.
═══════════════════════════════════════════════════ */
router.post('/forgot-password', forgotRateLimit, async (req, res) => {
  try {
    const { username } = req.body;

    if (!validateUsername(username)) {
      return res.json({
        success: true,
        message: 'Si el usuario existe, recibirás un código en tu correo.',
      });
    }

    const user = await findUserByUsername(username.trim());

    if (!user || !user.email) {
      await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
      return res.json({
        success: true,
        message: 'Si el usuario existe, recibirás un código en tu correo.',
      });
    }

    const code      = generateCode();
    const codeHash  = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + EXPIRY_MS);

    await saveResetCode(user.id, codeHash, expiresAt, 0);

    const expiryMinutes = Math.round(EXPIRY_MS / 60000);

    const htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Código de verificación — Connecting CRM</title>
</head>
<body style="margin:0;padding:0;background:#f5f2ed;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:8px;overflow:hidden;
                 box-shadow:0 4px 24px rgba(28,25,23,0.10);">

          <tr>
            <td style="background:#c0392b;padding:28px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:rgba(255,255,255,0.15);border-radius:6px;
                              padding:8px 12px;display:inline-block;">
                    <span style="color:#ffffff;font-size:14px;font-weight:600;
                                 letter-spacing:0.5px;">Connecting CRM</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:40px 40px 20px;">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;
                         color:#1c1917;letter-spacing:-0.5px;">
                Código de verificación
              </h1>
              <p style="margin:0 0 28px;font-size:14px;color:#6b6560;line-height:1.6;">
                Recibiste este mensaje porque solicitaste restablecer la contraseña
                de la cuenta <strong style="color:#1c1917;">${username}</strong>.
              </p>

              <div style="text-align:center;margin:0 0 28px;">
                <div style="display:inline-block;background:#faf8f5;
                            border:2px solid #e8e3db;border-radius:8px;
                            padding:20px 40px;">
                  <div style="font-size:42px;font-weight:800;letter-spacing:16px;
                               color:#c0392b;font-family:Georgia,serif;">
                    ${code}
                  </div>
                </div>
                <p style="margin:12px 0 0;font-size:12px;color:#b8b2aa;">
                  Este código expira en <strong>${expiryMinutes} minutos</strong>.
                </p>
              </div>

              <div style="background:#fff8f0;border:1px solid rgba(180,83,9,0.2);
                          border-radius:6px;padding:14px 16px;margin-bottom:24px;">
                <p style="margin:0;font-size:12px;color:#b45309;line-height:1.5;">
                  <strong>⚠️ Seguridad:</strong> Si no solicitaste este código, ignora este
                  mensaje. Tu contraseña no ha sido modificada. Nunca compartas este
                  código con nadie.
                </p>
              </div>

              <p style="margin:0;font-size:13px;color:#6b6560;line-height:1.6;">
                Si tienes problemas para acceder a tu cuenta, contacta a tu administrador.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 40px 32px;border-top:1px solid #e8e3db;">
              <p style="margin:0;font-size:11px;color:#b8b2aa;line-height:1.5;">
                Este correo fue enviado automáticamente por <strong>Connecting CRM Platform</strong>.
                Por favor no respondas a este mensaje.<br>
                Remitente: <a href="mailto:dperez@directvdeals.net"
                  style="color:#c0392b;text-decoration:none;">dperez@directvdeals.net</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    const textBody = [
      'Connecting CRM Platform — Código de verificación',
      '',
      `Hola ${user.username},`,
      '',
      'Recibiste este mensaje porque solicitaste restablecer tu contraseña.',
      '',
      `Tu código de verificación es: ${code}`,
      '',
      `Este código expira en ${expiryMinutes} minutos.`,
      '',
      'Si no solicitaste este código, ignora este mensaje.',
      'Nunca compartas este código con nadie.',
      '',
      '— Connecting CRM Platform',
    ].join('\n');

    await transporter.sendMail({
      from:    '"Connecting CRM" <dperez@directvdeals.net>',
      to:      user.email,
      subject: `[${code}] Tu código de verificación — Connecting CRM`,
      text:    textBody,
      html:    htmlBody,
    });

    console.log(`[FORGOT] ✅ Código enviado a ${maskEmail(user.email)} para usuario "${username}"`);

    return res.json({
      success:     true,
      message:     'Código enviado exitosamente.',
      maskedEmail: maskEmail(user.email),
    });

  } catch (err) {
    console.error('[FORGOT] ❌ Error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Error interno del servidor. Inténtalo más tarde.',
    });
  }
});


/* ═══════════════════════════════════════════════════
   RUTA 2: POST /api/auth/verify-reset-code
   
   Body: { username, code }
   
   Flujo:
   1. Buscar usuario y su código en la BD.
   2. Verificar que el código no haya expirado.
   3. Verificar que no se hayan superado los intentos.
   4. Comparar el hash con el código ingresado (bcrypt).
   5. Si OK → generar resetToken de un solo uso, guardarlo en BD.
   6. Si falla → incrementar intentos y responder con error.
═══════════════════════════════════════════════════ */
router.post('/verify-reset-code', verifyCodeRateLimit, async (req, res) => {
  try {
    const { username, code } = req.body;

    if (!validateUsername(username) || !code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: 'Datos inválidos.' });
    }

    const user = await findUserByUsername(username.trim());
    if (!user) {
      return res.status(400).json({ success: false, message: 'Código incorrecto o expirado.' });
    }

    const resetRecord = await findResetCode(user.id);
    if (!resetRecord) {
      return res.status(400).json({ success: false, message: 'No hay solicitud de recuperación activa. Vuelve al paso 1.' });
    }

    if (new Date() > new Date(resetRecord.expiresAt)) {
      await invalidateResetCode(user.id);
      return res.status(400).json({ success: false, message: 'El código ha expirado. Solicita uno nuevo.' });
    }

    if (resetRecord.attempts >= MAX_CODE_ATTEMPTS) {
      await invalidateResetCode(user.id);
      return res.status(400).json({
        success: false,
        message: 'Superaste el máximo de intentos. Solicita un nuevo código.',
      });
    }

    await incrementResetCodeAttempts(user.id);

    const valid = await bcrypt.compare(code, resetRecord.codeHash);
    if (!valid) {
      const remaining = MAX_CODE_ATTEMPTS - (resetRecord.attempts + 1);
      return res.status(400).json({
        success: false,
        message: remaining > 0
          ? `Código incorrecto. Te quedan ${remaining} intento${remaining !== 1 ? 's' : ''}.` 
          : 'Código incorrecto. Sin intentos restantes. Solicita un nuevo código.',
      });
    }

    const resetToken     = generateResetToken();
    const resetTokenHash = await bcrypt.hash(resetToken, BCRYPT_ROUNDS);
    const tokenExpiry    = new Date(Date.now() + 15 * 60 * 1000);

    await saveResetToken(user.id, resetTokenHash, tokenExpiry);
    await invalidateResetCode(user.id);

    console.log(`[VERIFY] ✅ Código verificado para usuario "${username}" — resetToken emitido`);

    return res.json({
      success:    true,
      resetToken: resetToken,
    });

  } catch (err) {
    console.error('[VERIFY] ❌ Error:', err.message);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});


/* ═══════════════════════════════════════════════════
   RUTA 3: POST /api/auth/reset-password
   
   Body: { username, resetToken, newPassword }
   
   Flujo:
   1. Validar inputs.
   2. Buscar usuario.
   3. Hashear el resetToken recibido y buscar en BD.
   4. Verificar que no haya expirado y no haya sido usado.
   5. Validar la nueva contraseña (longitud, complejidad).
   6. Hashear la nueva contraseña con bcrypt.
   7. Actualizar en BD.
   8. Invalidar el resetToken.
═══════════════════════════════════════════════════ */
router.post('/reset-password', resetPwRateLimit, async (req, res) => {
  try {
    const { username, resetToken, newPassword } = req.body;

    if (!validateUsername(username)) {
      return res.status(400).json({ success: false, message: 'Usuario inválido.' });
    }
    if (!resetToken || typeof resetToken !== 'string' || resetToken.length !== 64) {
      return res.status(400).json({ success: false, message: 'Token de recuperación inválido.' });
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ success: false, message: 'Contraseña inválida.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 8 caracteres.' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos una letra mayúscula.' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos un número.' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ success: false, message: 'La contraseña es demasiado larga.' });
    }

    const user = await findUserByUsername(username.trim());
    if (!user) {
      return res.status(400).json({ success: false, message: 'Solicitud de recuperación inválida.' });
    }

    const resetRecord = await findResetCode(user.id);
    if (!resetRecord || !resetRecord.resetTokenHash) {
      return res.status(400).json({ success: false, message: 'Token de recuperación no válido o ya utilizado.' });
    }

    if (resetRecord.resetTokenExpiresAt && new Date() > new Date(resetRecord.resetTokenExpiresAt)) {
      await invalidateResetToken(user.id);
      return res.status(400).json({ success: false, message: 'El token de recuperación ha expirado. Inicia el proceso nuevamente.' });
    }

    if (resetRecord.resetTokenUsed) {
      return res.status(400).json({ success: false, message: 'Este token ya fue utilizado.' });
    }

    const tokenValid = await bcrypt.compare(resetToken, resetRecord.resetTokenHash);
    if (!tokenValid) {
      return res.status(400).json({ success: false, message: 'Token de recuperación inválido.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await updatePassword(user.id, hashedPassword);
    await invalidateResetToken(user.id);

    console.log(`[RESET] ✅ Contraseña actualizada para usuario "${username}"`);

    return res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente.',
    });

  } catch (err) {
    console.error('[RESET] ❌ Error:', err.message);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});


module.exports = router;
