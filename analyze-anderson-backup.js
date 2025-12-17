const fs = require('fs');
const path = require('path');

// Encontrar el archivo de backup más reciente
const backupDir = path.join(__dirname, 'backups');
const files = fs.readdirSync(backupDir)
  .filter(f => f.startsWith('costumers.') && f.endsWith('.json'))
  .sort()
  .reverse();

if (files.length === 0) {
  console.error('No backup files found');
  process.exit(1);
}

const backupFile = path.join(backupDir, files[0]);
console.log(`\n📂 Leyendo backup: ${files[0]}\n`);

function isDecember2025(record) {
  // Parsear diferentes formatos de fecha
  let date = null;
  
  // Intentar createdAt
  if (record.createdAt) {
    date = new Date(record.createdAt);
  }
  
  // Intentar dia_venta
  if (!date || isNaN(date.getTime())) {
    const dia = record.dia_venta;
    if (dia) {
      // Formatos: "12/16/2025", "16/12/2025", "2025-12-16"
      if (typeof dia === 'string') {
        // Intenta "d/m/yyyy" o "m/d/yyyy"
        const parts = dia.split('/');
        if (parts.length === 3) {
          const year = parseInt(parts[2]);
          let month = parseInt(parts[0]);
          let day = parseInt(parts[1]);
          
          // Si el primer número es > 12, es "d/m/yyyy"
          if (parts[0] > 12) {
            day = parseInt(parts[0]);
            month = parseInt(parts[1]);
          }
          
          if (year === 2025 && month === 12) {
            return true;
          }
        } else if (dia.includes('-')) {
          // Formato "yyyy-mm-dd"
          if (dia.startsWith('2025-12')) return true;
        }
      }
    }
  }
  
  // Verificar si la fecha está en diciembre 2025
  if (date && !isNaN(date.getTime())) {
    return date.getFullYear() === 2025 && date.getMonth() === 11; // Mes 0-indexed
  }
  
  return false;
}

try {
  const content = fs.readFileSync(backupFile, 'utf8');
  const data = JSON.parse(content);
  
  if (!Array.isArray(data)) {
    console.error('Backup no es un array');
    process.exit(1);
  }
  
  // Filtrar registros de Anderson del mes 12
  const andersonRecords = data.filter(r => 
    r.agenteNombre && r.agenteNombre.toLowerCase().includes('anderson') && isDecember2025(r)
  );
  
  console.log(`=== REGISTROS DE ANDERSON GUZMAN - DICIEMBRE 2025 ===\n`);
  console.log(`Total encontrados: ${andersonRecords.length}\n`);
  
  let totalPuntaje = 0;
  let completed = 0;
  let pending = 0;
  let cancelled = 0;
  
  andersonRecords.forEach((record, idx) => {
    const puntaje = record.puntaje || 0;
    totalPuntaje += puntaje;
    const status = (record.status || 'unknown').toLowerCase();
    
    if (status.includes('cancel')) cancelled++;
    else if (status.includes('pending') || status.includes('pendiente')) pending++;
    else completed++;
    
    const excluir = record.excluirDeReporte ? '✓ SÍ' : 'no';
    
    console.log(
      `${idx + 1}. Puntaje: ${puntaje.toString().padEnd(5)} | Status: ${(status).padEnd(12)} | Excluir: ${excluir} | Cliente: ${record.nombre_cliente || 'N/A'}`
    );
  });
  
  console.log(`\n=== RESUMEN ===`);
  console.log(`Total puntaje acumulado: ${totalPuntaje.toFixed(2)}`);
  console.log(`Status Completed: ${completed}`);
  console.log(`Status Pending/Pendiente: ${pending}`);
  console.log(`Status Cancelled: ${cancelled}`);
  console.log(`\nDiferencia esperada (16.05 - ${totalPuntaje.toFixed(2)}): ${(16.05 - totalPuntaje).toFixed(2)}`);
  
  // Buscar específicamente registros con puntaje 0.75
  const con075 = andersonRecords.filter(r => r.puntaje === 0.75);
  console.log(`\n⚠️  Registros con puntaje 0.75: ${con075.length}`);
  con075.forEach((record, idx) => {
    const status = (record.status || 'unknown').toLowerCase();
    console.log(`  ${idx + 1}. Status: ${status}, Cliente: ${record.nombre_cliente}, Excluir: ${record.excluirDeReporte ? 'SÍ' : 'no'}`);
  });
  
} catch(e) {
  console.error('❌ Error:', e.message);
}

