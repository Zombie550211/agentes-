#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('Step 1: Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('Step 2: Applying replacements...');
const replacements = [
    ['TELÃ‰FONO', 'TELÉFONO'],
    ['NÃšMERO', 'NÚMERO'],
    ['DIRECCIÃ"N', 'DIRECCIÓN'],
    ['DÃA', 'DÍA'],
    ['LÃNEAS', 'LÍNEAS'],
    ['TELÃ‰FONOS', 'TELÉFONOS'],
    ['INSTALACIÃ"N', 'INSTALACIÓN'],
    ['NORMALIZACIÃ"N', 'NORMALIZACIÓN'],
    ['Normalizaci', 'Normalización'],  // fallback
    ['NormalizaciÃ³n', 'Normalización'],
    ['dinÃ¡micamente', 'dinámicamente'],
    ['canÃ³nico', 'canónico'],
    ['todavÃ­a', 'todavía'],
    ['estÃ¡', 'está'],
    ['SÃ­', 'Sí'],
    ['proporcionÃ³', 'proporcionó'],
    ['encontrÃ³', 'encontró'],
    ['pequeÃ±o', 'pequeño'],
    ['FunciÃ³n', 'Función'],
    ['EdiciÃ³n', 'Edición'],
];

let totalReplacements = 0;
replacements.forEach(([bad, good]) => {
    const regex = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const before = content;
    content = content.replace(regex, good);
    const count = (before.length - content.length) / (bad.length - good.length);
    if (count > 0) {
        console.log(`  ${bad} → ${good} (${count} replacements)`);
        totalReplacements += count;
    }
});

console.log(`\nStep 3: Total replacements: ${totalReplacements}`);

console.log('Step 4: Writing file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('Step 5: Verification...');
const verify = fs.readFileSync(filePath, 'utf8');
const checks = ['TELÉFONO', 'NÚMERO', 'DIRECCIÓN', 'DÍA', 'LÍNEAS', 'INSTALACIÓN'];
checks.forEach(term => {
    const found = verify.includes(term);
    console.log(`  ${found ? '✓' : '✗'} ${term}`);
});

if (checks.every(t => verify.includes(t))) {
    console.log('\n✓✓✓ SUCCESS: All replacements done!');
} else {
    console.log('\n⚠ Some checks failed');
}
