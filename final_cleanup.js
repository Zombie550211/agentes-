#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('Reading file...');
let content = fs.readFileSync(filePath, 'utf8');

console.log('Applying final replacements...');
const replacements = [
    ['DIRECCI├âÔÇ£N', 'DIRECCIÓN'],
    ['D├â┬ìA', 'DÍA'],
    ['L├â┬ìNEAS', 'LÍNEAS'],
    ['L├â┬ìNEAS', 'LÍNEAS'],
    ['INSTALACI├âÔÇ£N', 'INSTALACIÓN'],
    ['TEL├ëFONO', 'TELÉFONO'],
    ['N├ÜMERO', 'NÚMERO'],
    ['TEL├ëFONOS', 'TELÉFONOS'],
];

let count = 0;
replacements.forEach(([bad, good]) => {
    while (content.includes(bad)) {
        content = content.replace(bad, good);
        count++;
        console.log(`  ✓ ${bad} → ${good}`);
    }
});

console.log(`\nTotal: ${count} replacements`);

console.log('Writing file...');
fs.writeFileSync(filePath, content, 'utf8');

console.log('Verification...');
const verify = fs.readFileSync(filePath, 'utf8');
const checks = ['TELÉFONO', 'NÚMERO', 'DIRECCIÓN', 'DÍA', 'LÍNEAS', 'INSTALACIÓN'];
let allGood = true;
checks.forEach(term => {
    const found = verify.includes(term);
    console.log(`  ${found ? '✓' : '✗'} ${term}`);
    if (!found) allGood = false;
});

if (allGood) {
    console.log('\n✓✓✓ SUCCESS: File is now clean!');
} else {
    console.log('\n⚠ Some items still need fixing');
}
