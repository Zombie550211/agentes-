const fs = require('fs');

// Read as latin1 (ISO-8859-1) para interpretar los bytes correctamente
let content = fs.readFileSync('frontend/Costumer.html', 'latin1');

// Convertir los caracteres mal interpretados
const fixes = {
  'DÃA': 'DÍA',
  'DIRECCIÃ"N': 'DIRECCIÓN',
  'INSTALACIÃ"N': 'INSTALACIÓN',
  'LÃNEAS': 'LÍNEAS',
  'TELÃ‰FONOS': 'TELÉFONOS',
  'NÃšMERO': 'NÚMERO',
  'Ãcono': 'Ícono',
  'Ã"': 'Ó',
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ã³': 'ó',
  'Ãº': 'ú',
  'Ã±': 'ñ',
};

let count = 0;
for (const [bad, good] of Object.entries(fixes)) {
  let matches = 0;
  while (content.includes(bad)) {
    content = content.replace(bad, good);
    matches++;
  }
  if (matches > 0) {
    count += matches;
    console.log(`Fixed ${bad} -> ${good}: ${matches} times`);
  }
}

// Write back as UTF-8
fs.writeFileSync('frontend/Costumer.html', content, 'utf8');
console.log(`Total: ${count} fixes`);
