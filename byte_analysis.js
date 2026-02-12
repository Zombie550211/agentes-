#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('Analyzing line 178 byte by byte...\n');
const line178 = lines[177];

// Find the part with DIRECCIÓN variants
const dirIdx = line178.indexOf('DIRECC');
if (dirIdx >= 0) {
    const section = line178.substring(dirIdx, dirIdx + 30);
    console.log('DIRECCIÓN section:');
    console.log('  Text:', section);
    console.log('  Bytes:', Buffer.from(section, 'utf8').toString('hex'));
    console.log();
}

// Find DÍA variant
const dayIdx = line178.indexOf('DE VENTA');
if (dayIdx >= 0) {
    const section = line178.substring(dayIdx - 20, dayIdx + 10);
    console.log('DÍA section:');
    console.log('  Text:', section);
    console.log('  Bytes:', Buffer.from(section, 'utf8').toString('hex'));
    console.log();
}

// Find LÍNEAS variant
const lineasIdx = line178.indexOf('CANTIDAD');
if (lineasIdx >= 0) {
    const section = line178.substring(lineasIdx, lineasIdx + 30);
    console.log('LÍNEAS section:');
    console.log('  Text:', section);
    console.log('  Bytes:', Buffer.from(section, 'utf8').toString('hex'));
}
