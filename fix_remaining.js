const fs = require('fs');

// Read as buffer
const buffer = fs.readFileSync('frontend/Costumer.html');
let content = buffer.toString('utf8');

// Replace patterns
const patterns = [
  { from: 'DIRECCIÃ"N', to: 'DIRECCIÓN' },
  { from: 'INSTALACIÃ"N', to: 'INSTALACIÓN' },
  { from: 'LÃNEAS', to: 'LÍNEAS' },
  { from: 'TELÃ‰FONOS', to: 'TELÉFONOS' },
];

let changed = 0;
for (const p of patterns) {
  while (content.includes(p.from)) {
    content = content.replace(p.from, p.to);
    changed++;
  }
}

// Write back
fs.writeFileSync('frontend/Costumer.html', content, 'utf8');
console.log(`Changed: ${changed}`);
