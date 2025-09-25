const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = 3001;

// Middleware básico
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configurar directorio para uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuración de Multer para subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, name + '-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
    'video/mp4', 'video/mov', 'video/avi', 'video/quicktime'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB límite
  }
});

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crmagente', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ Conectado a MongoDB');
}).catch((error) => {
  console.error('❌ Error conectando a MongoDB:', error);
});

// Modelo MediaFile
const mediaFileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },
  path: { type: String, required: true },
  url: { type: String, required: true },
  uploadedBy: { type: String, required: true, default: 'admin' },
  uploadDate: { type: Date, default: Date.now },
  category: { type: String, enum: ['image', 'gif', 'video'], required: true }
}, { timestamps: true });

const MediaFile = mongoose.model('MediaFile', mediaFileSchema);

// Rutas básicas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'inicio.html'));
});

app.get('/multimedia.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'multimedia.html'));
});

// API para subir archivos
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No se recibió ningún archivo'
      });
    }

    // Determinar categoría del archivo
    let category = 'image';
    if (req.file.mimetype === 'image/gif') {
      category = 'gif';
    } else if (req.file.mimetype.startsWith('video/')) {
      category = 'video';
    }

    const fileUrl = `/uploads/${req.file.filename}`;

    const mediaFile = new MediaFile({
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      url: fileUrl,
      uploadedBy: 'admin', // Por ahora hardcodeado
      category: category
    });

    await mediaFile.save();

    console.log(`📁 Archivo subido: ${req.file.originalname}`);

    res.json({
      success: true,
      message: 'Archivo subido exitosamente',
      file: {
        id: mediaFile._id,
        name: mediaFile.originalName,
        url: mediaFile.url,
        type: mediaFile.mimetype,
        size: mediaFile.size,
        category: mediaFile.category,
        uploadDate: mediaFile.uploadDate
      }
    });

  } catch (error) {
    console.error('❌ Error subiendo archivo:', error);
    
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Error subiendo archivo'
    });
  }
});

// API para obtener lista de archivos
app.get('/api/media', async (req, res) => {
  try {
    const { category, limit = 50, offset = 0 } = req.query;
    
    let query = {};
    if (category && category !== 'all') {
      query.category = category;
    }

    const files = await MediaFile.find(query)
      .sort({ uploadDate: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();

    const formattedFiles = files.map(file => ({
      id: file._id,
      name: file.originalName,
      url: file.url,
      type: file.mimetype,
      size: file.size,
      category: file.category,
      uploadDate: file.uploadDate,
      uploadedBy: file.uploadedBy
    }));

    res.json(formattedFiles);

  } catch (error) {
    console.error('❌ Error obteniendo archivos:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo archivos'
    });
  }
});

// API para eliminar archivo
app.delete('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const file = await MediaFile.findById(id);
    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'Archivo no encontrado'
      });
    }

    // Eliminar archivo físico
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    // Eliminar registro de la base de datos
    await MediaFile.findByIdAndDelete(id);

    console.log(`🗑️ Archivo eliminado: ${file.originalName}`);

    res.json({
      success: true,
      message: 'Archivo eliminado exitosamente'
    });

  } catch (error) {
    console.error('❌ Error eliminando archivo:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando archivo'
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
🚀 ===== SERVIDOR MULTIMEDIA =====
📡 Puerto: ${PORT}
🌐 URL: http://localhost:${PORT}
📁 Multimedia: http://localhost:${PORT}/multimedia.html
==================================
  `);
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
});

// Cierre graceful
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor multimedia...');
  mongoose.connection.close();
  process.exit(0);
});
