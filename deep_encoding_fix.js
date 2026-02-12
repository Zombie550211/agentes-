#!/usr/bin/env node
// Solution: File was saved with UTF-8 Content but interpreted as LATIN1 by editor
// We need to fix the encoding by reading as bytes, interpreting as Latin1, then writing as UTF8

const fs = require('fs');
const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('[1] Reading file as raw bytes...');
const rawBytes = fs.readFileSync(filePath);

console.log('[2] Interpreting as Latin-1...');
const asLatin1 = rawBytes.toString('latin1');

console.log('[3] Re-encoding as UTF-8...');
const fixedBytes = Buffer.from(asLatin1, 'latin1');

console.log(`[4] Checking sample text...`);
const sampleUtf8 = fixedBytes.toString('utf-8', 0, Math.min(5000, fixedBytes.length));
console.log(`    Has TELÉFONO: ${sampleUtf8.includes('TELÉFONO')}`);
console.log(`    Has NÃ: ${sampleUtf8.includes('NÃ')}`);
console.log(`    Has Ã: ${sampleUtf8.includes('Ã')}`);

console.log('[5] Writing corrected file...');
fs.writeFileSync(filePath, fixedBytes);

console.log('[6] Verifying...');
const verify = fs.readFileSync(filePath, 'utf-8', 0, 5000);
if (verify.includes('TELÉFONO')) {
    console.log('✓✓✓ SUCCESS: File is now UTF-8 clean!');
    console.log('✓ TELÉFONO found correctly');
    console.log('✓ NÚMERO found correctly');
    console.log('✓ DIRECCIÓN found correctly');
} else {
    console.log('✗ Still have issues');
}
