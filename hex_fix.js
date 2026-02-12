const fs = require('fs');

let content = fs.readFileSync('frontend/Costumer.html');

// Byte sequences to fix
const patterns = [
  { find: Buffer.from([0xc3, 0x83, 0xc2, 0x89]), replace: 'é' },  // Ãé -> é
  { find: Buffer.from([0xc3, 0x89]), replace: 'É' },  // Ã‰ -> É
  { find: Buffer.from([0xc3, 0xa9]), replace: 'é' },  // Ã© -> é
  { find: Buffer.from([0xc3, 0xa1]), replace: 'á' },  // Ã¡ -> á
  { find: Buffer.from([0xc3, 0xad]), replace: 'í' },  // Ã­ -> í
  { find: Buffer.from([0xc3, 0xb3]), replace: 'ó' },  // Ã³ -> ó
  { find: Buffer.from([0xc3, 0xba]), replace: 'ú' },  // Ãº -> ú
  { find: Buffer.from([0xc3, 0xb1]), replace: 'ñ' },  // Ã± -> ñ
];

let count = 0;
for (const p of patterns) {
  let idx = 0;
  while ((idx = content.indexOf(p.find, idx)) !== -1) {
    content = Buffer.concat([
      content.slice(0, idx),
      Buffer.from(p.replace, 'utf8'),
      content.slice(idx + p.find.length)
    ]);
    count++;
  }
}

fs.writeFileSync('frontend/Costumer.html', content);
console.log(`Fixed: ${count}`);
