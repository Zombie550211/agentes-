#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('1. Leyendo archivo...');
let content = fs.readFileSync(filePath, 'utf-8');

console.log(`2. Tamaño original: ${content.length} caracteres`);

// Reemplazos de caracteres corruptos UTF-8
const replacements = {
    'Ã¡': 'á',
    'Ã©': 'é',
    'Ã­': 'í',
    'Ã³': 'ó',
    'Ã ': 'à',
    'Ã‰': 'É',
    'Ã±': 'ñ',
    'Ã"': 'Ó',
    'Ã': 'Á',
    'Ã¼': 'ü',
    'Ã„': 'Ä',
    'Ã™': 'Ú',
    'ÃŽ': 'Î',
    'Âº': 'º',
    'Â¡': '¡',
    'â€': '"',
    'â€œ': '"',
    'â€': '"',
    'â€"': '–',
    'â€"': '—',
    'â€¢': '•',
    'Ã"': 'ó',
    'Ã†': 'Æ',
    'Â': '',
    'ï¿½': ''
};

let count = 0;
for (const [old, repl] of Object.entries(replacements)) {
    const regex = new RegExp(old.split('').map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''), 'g');
    let matches = 0;
    while (content.includes(old)) {
        content = content.replace(old, repl);
        matches++;
    }
    if (matches > 0) {
        console.log(`3. Reemplazando '${old}' x${matches}`);
        count += matches;
    }
}

console.log(`4. Total reemplazos: ${count}`);
console.log(`5. Tamaño final: ${content.length} caracteres`);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('6. ✓ Archivo reparado exitosamente');
