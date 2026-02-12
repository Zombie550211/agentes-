const fs = require('fs');

// Read as buffer
const buffer = fs.readFileSync('frontend/Costumer.html');
let content = buffer;

// Replace byte sequences directly
const replacements = [
  // DIRECCIÃ"N -> DIRECCIÓN (c383 + e2809c + 4e -> c3b3 + 4e)
  // Actually DIRECCIÃ"N is: 44495245434349 c383 e2809c 4e 27
  // Should be: 44495245434349 c38d 4e 27
  // But wait, Ó is c393, not c38d
  // Let me check: DIRECCIÓN in UTF-8 = 4449525:45434349c383 4e
  // No wait, let me be more careful
  
  // Just scan and replace the actual patterns
  [Buffer.from('DIRECCIÃñN'), Buffer.from('DIRECCIÓN')],  // Won't work
];

// Better approach: read as string with latin1, then convert
let str = buffer.toString('latin1');
str = str.replace(/DIRECCIÃ"N/g, 'DIRECCIÓN');
str = str.replace(/INSTALACIÃ"N/g, 'INSTALACIÓN');  
str = str.replace(/LÃNEAS/g, 'LÍNEAS');
str = str.replace(/TELÃ‰FONOS/g, 'TELÉFONOS');

fs.writeFileSync('frontend/Costumer.html', str, 'utf8');
console.log('Fixed');
