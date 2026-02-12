const fs = require('fs');
const path = require('path');

const filePath = 'frontend/Costumer.html';

// Read the file with UTF-8 encoding
let content = fs.readFileSync(filePath, 'utf8');

// Log first occurrence to debug
const idx = content.indexOf('estÃ¡');
console.log('Found estÃ¡ at:', idx);

if (idx < 0) {
  console.log('No corrupted characters found. Charset already UTF-8 correct or no matches.');
  process.exit(0);
}

// Define all replacements in order
const fixes = [
  ['estÃ¡', 'está'],
  ['todavÃ­a', 'todavía'],
  ['FunciÃ³n', 'Función'],
  ['Ã¡', 'á'],
  ['Ã©', 'é'],
  ['Ã­', 'í'],
  ['Ã³', 'ó'],
  ['Ãº', 'ú'],
  ['Ã±', 'ñ'],
  ['Ã‰', 'É'],
  ['Ã"', 'Ó'],
  ['Ã™', 'Ú'],
  ['Â¿', '¿'],
  ['Â¡', '¡'],
  ['menÂ¨Â²', 'menú'],
  ['mÂ¨Â¢s', 'más'],
  ['aÂ¨Â²n', 'aún'],
];

let total = 0;
for (const [wrong, right] of fixes) {
  let count = 0;
  while (content.includes(wrong)) {
    content = content.replace(wrong, right);
    count++;
  }
  if (count > 0) {
    total += count;
    console.log(`${wrong} -> ${right}: ${count} replacements`);
  }
}

// Write back
fs.writeFileSync(filePath, content, 'utf8');
console.log(`\nTotal: ${total} replacements made`);
