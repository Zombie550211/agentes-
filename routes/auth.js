const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

// Ruta para registrar un nuevo usuario
router.post('/register', authController.register);

// Ruta para iniciar sesión
router.post('/login', authController.login);

// Ruta para cerrar sesión (limpia cookie)
router.post('/logout', authController.logout);

// Ruta para verificar la sesión actual
router.get('/verify', protect, authController.verify);

// Ruta para restablecer contraseña (solo ADMIN)
router.post('/reset-password', protect, authorize('admin'), authController.resetPassword);

module.exports = router;
