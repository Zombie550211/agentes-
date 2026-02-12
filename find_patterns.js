#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

const content = fs.readFileSync(filePath, 'utf8');

// Search for patterns
const patterns = [
    'DIRECÇ',
    'DIRECC',
    'DIREC',
    'DÃ',
    'DIA',
    'LÍNEA',
    'LINEA',
    'LÃNEA',
    'LÃN',
];

console.log('Searching for similar patterns...\n');

patterns.forEach(pat => {
    const idx = content.indexOf(pat);
    if (idx >= 0) {
        const context = content.substring(idx - 10, idx + 30);
        console.log(`Pattern "${pat}" found:`);
        console.log(`  Context: ...${context}...`);
        console.log(`  Bytes: ${Buffer.from(context, 'utf8').toString('hex').substring(0, 80)}`);
        console.log();
    }
});

// Also show exact line 178 again
const lines = content.split('\n');
console.log('Line 178 content:');
console.log(lines[177]);
