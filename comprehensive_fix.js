#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const filePath = path.join('c:\\Users\\Zombie\\Documents\\dashboard\\frontend', 'Costumer.html');

console.log('[Step 1] Reading file as UTF-8');
let content = fs.readFileSync(filePath, 'utf-8');
const originalSize = content.length;

console.log('[Step 2] Identifying corrupted patterns');
const corrections = {
    // UTF-8 encoding issues (Latin-1 bytes interpreted as UTF-8)
    'Ã¡': 'á',
    'Ã©': 'é',
    'Ã­': 'í',
    'Ã³': 'ó',
    'Ã ': 'à',
    'Ã±': 'ñ',
    'Ã¼': 'ú',
    'Ã‰': 'É',
    'ÃŠ': 'Ê',
    'Ã': 'Á',
    'Ã': 'À',
    'Ã"': 'Ó',
    'Ã': 'Ã',
    'Ã®': 'î',
    'Â': '',  // Remove replacement characters
    'Â¿': '¿',
    'Â¡': '¡',
    'â€': '"',  // Smart quotes
    'â€œ': '"',
    'â€\u009d': '"', 
    'â€"': '–',
    'â€"': '—',
    'â€¢': '•',
    'âŒ': '✘',
};

console.log('[Step 3] Applying corrections');
let corrCount = 0;
for (const [corrupt, clean] of Object.entries(corrections)) {
    let idx = 0;
    while ((idx = content.indexOf(corrupt)) !== -1) {
        content = content.substring(0, idx) + clean + content.substring(idx + corrupt.length);
        corrCount++;
    }
}

console.log(`[Step 4] Applied ${corrCount} corrections`);
console.log(`   Original: ${originalSize} chars`);
console.log(`   New:      ${content.length} chars`);

// Write back
fs.writeFileSync(filePath, content, 'utf-8');
console.log('[Step 5] File written');

// Verify
console.log('[Step 6] Verification:');
const verify = fs.readFileSync(filePath, 'utf-8');
const checks = [
    'TELÉFONO',
    'NÚMERO',
    'DIRECCIÓN',
    'DÍA',
    'LÍNEAS',
    'Normalización',
    'dinámicamente',
    'proporcionó'
];

let allGood = true;
checks.forEach(term => {
    const found = verify.includes(term);
    console.log(`   ${found ? '✓' : '✗'} ${term}`);
    if (!found) allGood = false;
});

if (allGood) {
    console.log('\n✓✓✓ SUCCESS: All corrections applied!');
} else {
    console.log('\n⚠ Some terms still missing');
}
