require('dotenv').config({ path: 'c:\\Users\\Zombie\\Documents\\dashboard\\.env' });
const mongoose = require('mongoose');

// Conexión a la base de datos
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Conectado a MongoDB'))
    .catch(err => console.error('Error conectando a MongoDB:', err));

const userSchema = new mongoose.Schema({
    username: String,
    role: String,
    team: String,
    // otros campos si son necesarios
}, { collection: 'users' });

const User = mongoose.model('User', userSchema);

async function listSupervisors() {
    try {
        // Buscar usuarios cuyo rol contenga "supervisor" (insensible a mayúsculas)
        const supervisors = await User.find({ 
            role: { $regex: /supervisor/i } 
        }).sort({ username: 1 });

        console.log('\n--- LISTA DE SUPERVISORES ENCONTRADOS (users) ---');
        if (supervisors.length === 0) {
            console.log('No se encontraron usuarios con rol de supervisor.');
        } else {
            console.table(supervisors.map(s => ({
                ID: s._id.toString(),
                Username: s.username,
                Role: s.role,
                Team: s.team || 'N/A'
            })));
        }

        // También buscar usuarios únicos que aparecen como 'supervisor' en la colección de costumers (ventas)
        // para ver si hay discrepancias
        const salesCollection = mongoose.connection.collection('costumers');
        const salesSupervisors = await salesCollection.distinct('supervisor');
        
        console.log('\n--- SUPERVISORES USADOS EN VENTAS (campo supervisor) ---');
        console.log(salesSupervisors.filter(s => s).sort());

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDesconectado de MongoDB');
    }
}

listSupervisors();
