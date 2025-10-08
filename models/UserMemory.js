const bcrypt = require('bcryptjs');

console.log('[UserMemory] Inicializando base de datos en memoria...');

// Base de datos en memoria para desarrollo
let users = [];

// Inicializar usuarios por defecto
async function initializeUsers() {
  if (users.length === 0) {
    console.log('[UserMemory] Creando usuarios por defecto...');
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password', salt);
    
    users = [
      {
        _id: '1',
        username: 'Daniel Martinez',
        password: hashedPassword,
        role: 'Administrador',
        team: 'Administración',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        _id: '2', 
        username: 'admin',
        password: hashedPassword,
        role: 'Administrador',
        team: 'Administración',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    console.log('[UserMemory] Usuarios creados:', users.map(u => u.username));
  }
}

// Inicializar inmediatamente
initializeUsers().catch(console.error);

class UserMemory {
  constructor(username, password, role) {
    this.username = username;
    this.password = password;
    this.role = role;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  // Método para guardar un nuevo usuario
  async save() {
    try {
      // Verificar si el usuario ya existe
      const existingUser = users.find(u => u.username === this.username);
      
      if (existingUser) {
        throw new Error('El nombre de usuario ya está en uso');
      }

      // Hashear la contraseña
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);

      // Generar ID único
      this._id = (users.length + 1).toString();
      
      // Agregar a la "base de datos"
      users.push(this);
      
      return this._id;
    } catch (error) {
      console.error('Error al guardar el usuario:', error);
      throw error;
    }
  }

  // Método estático para buscar un usuario por nombre de usuario
  static async findByUsername(username) {
    try {
      // Asegurar que los usuarios estén inicializados
      await initializeUsers();
      
      console.log(`[UserMemory] Buscando usuario: ${username}`);
      console.log(`[UserMemory] Usuarios disponibles:`, users.map(u => u.username));
      
      const user = users.find(u => u.username === username);
      console.log(`[UserMemory] Usuario encontrado:`, !!user);
      
      return user || null;
    } catch (error) {
      console.error('Error al buscar usuario por nombre de usuario:', error);
      throw error;
    }
  }

  // Método estático para buscar un usuario por ID
  static async findById(id) {
    try {
      return users.find(u => u._id === id.toString()) || null;
    } catch (error) {
      console.error('Error al buscar usuario por ID:', error);
      throw error;
    }
  }

  // Método para verificar la contraseña
  async comparePassword(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  }

  // Método estático para actualizar la contraseña por username
  static async updatePasswordByUsername(username, newPassword) {
    try {
      const userIndex = users.findIndex(u => u.username === username);
      if (userIndex === -1) {
        return { updated: false, reason: 'not_found' };
      }
      
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(newPassword, salt);
      
      users[userIndex].password = hashed;
      users[userIndex].updatedAt = new Date();
      
      return { updated: true };
    } catch (error) {
      console.error('Error al actualizar contraseña por username:', error);
      throw error;
    }
  }

  // Método para obtener todos los usuarios (para debug)
  static async getAllUsers() {
    return users.map(u => ({
      _id: u._id,
      username: u.username,
      role: u.role,
      team: u.team,
      createdAt: u.createdAt
    }));
  }
}

module.exports = UserMemory;
