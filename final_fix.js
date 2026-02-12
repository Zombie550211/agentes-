#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

// Read as UTF-8
let text = fs.readFileSync(filePath, 'utf-8');
console.log('Original size:', text.length);

// Simple string replace for corrupted characters
let fixed = text
    .replace(/TELÃ‰FONO/g, 'TELÉFONO')
    .replace(/NÃšMERO/g, 'NÚMERO')
    .replace(/DIRECCIÃ"/g, 'DIRECCIÓN')
    .replace(/DÃA/g, 'DÍA')
    .replace(/LÃNEAS/g, 'LÍNEAS')
    .replace(/INSTALACIÃ"/g, 'INSTALACIÓN')
    .replace(/TELÃ‰FONOS/g, 'TELÉFONOS')
    .replace(/NormalizaciÃ³n/g, 'Normalización')
    .replace(/canÃ³nico/g, 'canónico')
    .replace(/todavÃ­a/g, 'todavía')
    .replace(/estÃ¡/g, 'está')
    .replace(/SÃ­/g, 'Sí')
    .replace(/pequeÃ±o/g, 'pequeño')
    .replace(/proporcionÃ³/g, 'proporcionó')
    .replace(/encontrÃ³/g, 'encontró')
    .replace(/EdiciÃ³n/g, 'Edición')
    .replace(/FunciÃ³n/g, 'Función')
    .replace(/registroÃ©/g, 'registro')
    .replace(/âŒ/g, '❌')
    .replace(/â€¢/g, '•')
    .replace(/penqueÃ±o/g, 'pequeño');

fs.writeFileSync(filePath, fixed, 'utf-8');

console.log('New size:', fixed.length);
console.log('Replacements done\n');

// Verify 
const verify = fs.readFileSync(filePath, 'utf-8');
const checks = [
    ['TELÉFONO', verify.includes('TELÉFONO')],
    ['NÚMERO', verify.includes('NÚMERO')],
    ['DIRECCIÓN', verify.includes('DIRECCIÓN')],
    ['DÍA', verify.includes('DÍA')],
    ['LÍNEAS', verify.includes('LÍNEAS')],
];

let allGood = true;
checks.forEach(([term, found]) => {
    const status = found ? '✓' : '✗';
    console.log(`${status} ${term}`);
    if (!found) allGood = false;
});

if (allGood) {
    console.log('\n✓✓✓ SUCCESS: All checks passed!');
} else {
    console.log('\n✗ Some checks failed');
}
