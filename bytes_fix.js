#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\Dashboard\\frontend\\Costumer.html';

console.log('Reading file as buffer...');
const buffer = fs.readFileSync(filePath);

// Show first byte signature
console.log('First 3 bytes (BOM check):', buffer.slice(0, 3).toString('hex'));

// Try to interpret as Latin-1 which was then UTF-8 encoded
const asLatin1 = buffer.toString('latin1');
const asUtf8Bytes = Buffer.from(asLatin1, 'latin1');
const asUtf8String = asUtf8Bytes.toString('utf-8');

console.log('Trying UTF-8 interpretation...');
console.log('Contains TELÉFONO?', asUtf8String.includes('TELÉFONO'));
console.log('Contains TELÃ?', asUtf8String.includes('TELÃ'));
console.log('Sample text:', asUtf8String.substring(5000, 5200));

// If the UTF-8 interpretation works, write it back
if (asUtf8String.includes('TELÉFONO')) {
    console.log('\n✓ Found correct encoding! Writing file...');
    fs.writeFileSync(filePath, asUtf8Bytes);
    console.log('✓ File updated');
} else if (asUtf8String.includes('TELÃ')) {
    console.log('\nFile is corrupted as TELÃ...');
    // Try double encoding fix
    const fixed = Buffer.from(asUtf8String, 'latin1').toString('utf-8');
    if (fixed.includes('TELÉFONO')) {
        console.log('✓ Double-fix works!');
        fs.writeFileSync(filePath, Buffer.from(fixed, 'utf-8'));
    }
} else {
    console.log('\n✗ Cannot determine encoding');
    // Show what we have
    console.log('Text contains:', asUtf8String.substring(4950, 5100));
}
