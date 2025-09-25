const express = require('express');
const router = express.Router();
const EmployeeOfMonth = require('../models/EmployeeOfMonth'); 
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { getDb, connectToMongoDB } = require('../config/db');

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'tu_cloud_name',
  api_key: process.env.CLOUDINARY_API_KEY || 'tu_api_key',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'tu_api_secret'
});

// Configuración de Multer para subida en memoria (para Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const COLLECTION = 'employees_of_month';

async function ensureCollection() {
  try {
    const db = getDb();
    return db.collection(COLLECTION);
  } catch (err) {
    // Conexión no inicializada: intentar conectar y reobtner la colección
    await connectToMongoDB();
    return getDb().collection(COLLECTION);
  }
}

// GET - Obtener empleados del mes
router.get('/', async (req, res) => {
  try {
    const collection = await ensureCollection();
    const employees = await collection.find({}).toArray();
    res.json(employees);
  } catch (error) {
    console.error('Error obteniendo empleados del mes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST - Guardar/actualizar datos de empleado del mes (sin imagen)
router.post('/', protect, authorize('Administrador', 'admin', 'Supervisor Team Lineas'), async (req, res) => {
  try {
    const { employee, name, description, imageUrl, imageClass, date } = req.body;
    if (!employee || !name || !imageUrl) {
      return res.status(400).json({ message: 'Datos incompletos. Se requiere employee, name y imageUrl.' });
    }
    const collection = await ensureCollection();
    await collection.updateOne(
      { employee },
      {
        $set: {
          employee,
          name,
          description: description || '',
          imageUrl, // Guardamos la URL de Cloudinary
          imageClass: imageClass || '',
          date: date || new Date().toLocaleDateString('es-ES'),
          updatedBy: req.user?.username || 'Sistema',
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    res.json({ message: 'Empleado guardado correctamente' });
  } catch (error) {
    console.error('Error guardando empleado del mes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST - Nuevo endpoint para subir la imagen a Cloudinary
router.post('/upload-image', protect, authorize('Administrador', 'admin', 'Supervisor Team Lineas'), upload.single('employeeImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se recibió ningún archivo.' });
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'employees_of_the_month' // Carpeta dedicada en Cloudinary
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.json({ 
      message: 'Imagen subida exitosamente a Cloudinary',
      imageUrl: uploadResult.secure_url 
    });

  } catch (error) {
    console.error('[CLOUDINARY EOM UPLOAD] Error:', error);
    res.status(500).json({ message: 'Error subiendo la imagen a Cloudinary' });
  }
});


// DELETE - Eliminar empleado del mes
router.delete('/:employee', protect, authorize('Administrador', 'admin', 'Supervisor Team Lineas'), async (req, res) => {
  try {
    const { employee } = req.params;
    const collection = await ensureCollection();
    const result = await collection.deleteOne({ employee });
    if (result.deletedCount > 0) {
      res.json({ message: 'Empleado eliminado correctamente' });
    } else {
      res.status(404).json({ message: 'Empleado no encontrado' });
    }
  } catch (error) {
    console.error('Error eliminando empleado del mes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

module.exports = router;
