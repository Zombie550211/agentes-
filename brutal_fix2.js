const fs = require('fs');

let content = fs.readFileSync('frontend/Costumer.html', 'utf8');

// Más patterns de doble encoding
const fixes = {
  'TELÃFONO': 'TELÉFONO',
  'TELÃFONOS': 'TELÉFONOS',
  'NÃÅ¡MERO': 'NÚMERO',
  'DIRECCIÃâN': 'DIRECCIÓN',
  'DÃÂA': 'DÍA',
  'INSTALACIÃâN': 'INSTALACIÓN',
  'LÃÂNEAS': 'LÍNEAS',
  'Ãâ': 'Í',
  'TELÃ‰FONO': 'TELÉFONO',
  'TELÃ‰FONOS': 'TELÉFONOS',
  'NÃšMERO': 'NÚMERO',
  'DIRECCIÃ"N': 'DIRECCIÓN',
  'DÃA': 'DÍA',
  'INSTALACIÃ"N': 'INSTALACIÓN',
  'LÃNEAS': 'LÍNEAS',
  // Add variants
  'Ã"': 'Ó',
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ã³': 'ó',
  'Ãº': 'ú',
  'Ã±': 'ñ',
  'Ã‰': 'É',
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
    console.log(`${bad} -> ${good}: ${matches}`);
  }
}

fs.writeFileSync('frontend/Costumer.html', content, 'utf8');
console.log(`\nTotal: ${count}`);
