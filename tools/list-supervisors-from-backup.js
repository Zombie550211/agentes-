const fs = require('fs');
const path = require('path');

const backupPath = 'c:/Users/Zombie/Documents/dashboard/backups/users.1764368997743.json';

try {
    const data = fs.readFileSync(backupPath, 'utf8');
    const users = JSON.parse(data);

    const supervisors = users.filter(u => 
        u.role && u.role.toLowerCase().includes('supervisor')
    );

    console.log(`\nTotal usuarios encontrados en backup: ${users.length}`);
    console.log(`Total supervisores encontrados: ${supervisors.length}\n`);

    console.table(supervisors.map(s => ({
        Username: s.username,
        Role: s.role,
        Team: s.team || 'N/A',
        ID: s._id
    })));

} catch (err) {
    console.error('Error leyendo el backup:', err);
}
