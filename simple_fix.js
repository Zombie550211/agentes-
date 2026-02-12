const fs = require('fs');

let content = fs.readFileSync('frontend/Costumer.html', 'utf8');

// Simple replace: find what shows as wrong and replace
const replaces = [
  ['TELÃfono', 'TELÉFONO'],
  ['TELÃfonos', 'TELÉFONOS'],
  ['NÃÅ¡mero', 'NÚMERO'],
  ['DIRECCIÃ¡n', 'DIRECCIÓN'],
  ['DÃa', 'DÍA'],
  ['INSTALACIÃ³n', 'INSTALACIÓN'],
  ['LÃneas', 'LÍNEAS'],
];

let count = 0;
for (const [bad, good] of replaces) {
  while (content.includes(bad)) {
    content = content.replace(bad, good);
    count++;
  }
}

fs.writeFileSync('frontend/Costumer.html', content, 'utf8');
console.log(`Fixed: ${count}`);
