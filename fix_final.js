const fs = require('fs');

const filePath = 'frontend/Costumer.html';
let content = fs.readFileSync(filePath, 'utf8');

const replacements = {
  'DIRECCIÃ"N': 'DIRECCIÓN',
  'DÃA': 'DÍA',
  'INSTALACIÃ"N': 'INSTALACIÓN',
  'LÃNEAS': 'LÍNEAS',
  'TELÃ‰FONOS': 'TELÉFONOS',
  'NÃšMERO': 'NÚMERO',
  'Ãcono': 'Ícono',
  'âŒ': 'X',
  'â€¢': 'BULLET',
  'âš ï¸': 'WARN',
  'ðŸŽ¬': 'FILM',
  'Ã"': 'Ó',
  'Ã¡': 'á',
  'Ã©': 'é',
  'Ã­': 'í',
  'Ã³': 'ó',
  'Ãº': 'ú',
  'Ã±': 'ñ',
  'Ã‰': 'É',
  'Ã™': 'Ú',
  'Ã\u00d1': 'Ñ',
  'Â¿': '¿',
  'Â¡': '¡',
};

let count = 0;
for (const [wrong, correct] of Object.entries(replacements)) {
  const regex = new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const before = content;
  content = content.replace(regex, correct);
  if (content !== before) {
    count += (before.length - content.length) / (wrong.length - correct.length || 1);
  }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed remaining corrupted characters');
