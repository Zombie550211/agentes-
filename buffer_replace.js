#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('Reading file...');
const buffer = fs.readFileSync(filePath);

console.log('Converting buffer to string...');
let str = buffer.toString('utf8');

console.log('File length:', str.length);
console.log('Looking for DIRECCIÓN alternatives...');

// Search using Buffer to find exact byte patterns
const dirPatterns = [
    Buffer.from('DIRECCIÃ"N'),
    Buffer.from('DÃA'),
    Buffer.from('LÃNEAS'),
    Buffer.from('DIRECCIÓN'),
];

dirPatterns.forEach(pattern => {
    const idx = buffer.indexOf(pattern);
    if (idx >= 0) {
        console.log(`Found "${pattern.toString('utf8')}" at byte ${idx}`);
    }
});

// Try a different approach: replace at the buffer level
console.log('\nSearching in current content:');
let tempStr = str;

// Replace using actual UTF-8 encoded versions
const pairs = [
    [Buffer.from('DIRECCIÃ"N').toString('latin1'), 'DIRECCIÓN'],  
    [Buffer.from('DÃA').toString('latin1'), 'DÍA'],
    [Buffer.from('LÃNEAS').toString('latin1'), 'LÍNEAS'],
];

pairs.forEach(([bad, good]) => {
    console.log(`Looking for: "${bad}"`);
    if (tempStr.includes(bad)) {
        console.log(`  Found! Replacing...`);
        tempStr = tempStr.replace(new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), good);
    } else {
        console.log(`  Not found`);
    }
});

fs.writeFileSync(filePath, tempStr, 'utf8');
console.log('\nFile updated');
