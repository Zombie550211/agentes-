#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('Reading file as UTF-8...');
const content = fs.readFileSync(filePath, 'utf8');

// Look for the teamHeader line
const lines = content.split('\n');
const teamHeaderIdx = lines.findIndex(l => l.includes('teamHeader'));

console.log(`teamHeader found at line ${teamHeaderIdx + 1}`);
const lineContent = lines[teamHeaderIdx];

console.log('Line content (first 150 chars):');
console.log(lineContent.substring(0, 150));

// Check for specific strings
const checks = [
    'TELÉFONO',
    'TELÃ‰FONO',
    'TELÃ',
    'NUMERO',  
    'NÚMERO',
    'NÃšMERO'
];

console.log('\nContent checks:');
checks.forEach(term => {
    const found = content.includes(term);
    console.log(`  ${found ? '✓' : '✗'} "${term}"`);
});

// Show bytes of the word "TELEFONO" area
console.log('\nHex dump of teamHeader area:');
const idx = content.indexOf('teamHeader');
if (idx >= 0) {
    const slice = content.substring(idx + 40, idx + 80);
    console.log('Text:', slice);
    const bytes = Buffer.from(slice, 'utf8');
    console.log('Hex: ', bytes.toString('hex'));
}
