#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('Reading entire file as buffer...');
const buffer = fs.readFileSync(filePath);

// Detect encoding by checking byte patterns
console.log('File size:', buffer.length, 'bytes');
console.log('First 20 bytes (hex):', buffer.slice(0, 20).toString('hex'));

// Try different decodings
const asUtf8 = buffer.toString('utf-8');
const asLatin1 = buffer.toString('iso-8859-1');
const asUtf16le = buffer.toString('utf16le');

console.log('\nDecoding tests:');
console.log('UTF-8 has TELÃ?', asUtf8.includes('TELÃ'));
console.log('UTF-8 has TELÉFONO?', asUtf8.includes('TELÉFONO'));
console.log('Latin1 has TELÉFONO?', asLatin1.includes('TELÉFONO'));

// If none work, try the "double encoding" fix
console.log('\nTrying double encoding fix...');
const fixedString = Buffer.from(asLatin1, 'latin1').toString('utf-8');
console.log('Fixed has TELÉFONO?', fixedString.includes('TELÉFONO'));

if (fixedString.includes('TELÉFONO')) {
    console.log('\n✓ Double encoding fix works!');
    console.log('Writing corrected file...');
    fs.writeFileSync(filePath, Buffer.from(fixedString, 'utf-8'));
    console.log('✓ File updated');
    
    // Verify
    const verify = fs.readFileSync(filePath, 'utf-8');
    console.log('Verification - TELÉFONO present?', verify.includes('TELÉFONO'));
} else {
    console.log('\n✗ No working fix detected');
    console.log('Sample of asLatin1:');
    console.log(asLatin1.substring(4900, 5000));
}
