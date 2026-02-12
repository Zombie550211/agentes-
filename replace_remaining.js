#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

let content = fs.readFileSync(filePath, 'utf8');

const replacements = [
    ['DIRECCIÃ"N', 'DIRECCIÓN'],
    ['DÃA', 'DÍA'],
    ['LÃNEAS', 'LÍNEAS'],
];

console.log('Applying replacements...');
let totalCount = 0;

replacements.forEach(([bad, good]) => {
    let count = 0;
    while (content.includes(bad)) {
        content = content.replace(bad, good);
        count++;
    }
    if (count > 0) {
        console.log(`  ✓ "${bad}" -> "${good}" (${count}x)`);
        totalCount += count;
    } else {
        console.log(`  ✗ "${bad}" not found`);
    }
});

console.log(`\nTotal: ${totalCount} replacements`);

fs.writeFileSync(filePath, content, 'utf8');

const verify = fs.readFileSync(filePath, 'utf8');
const checks = ['DIRECCIÓN', 'DÍA', 'LÍNEAS'];
console.log('\nVerification:');
checks.forEach(term => {
    const found = verify.includes(term);
    console.log(`  ${found ? '✓' : '✗'} ${term}`);
});
