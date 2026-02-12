#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

// Read as UTF-8
let text = fs.readFileSync(filePath, 'utf-8');

console.log('Original size:', text.length);

// Replace the corrupted function USING REGEX with literal characters
    // Split by lines
    let modified = false;
    for (let i = 0; i < lines.length; i++) {
        // Look for the function declaration start
        if (lines[i].includes('function teamHeader()')) {
            console.log(`Found teamHeader at line ${i + 1}`);
            console.log('Old line preview:', lines[i].substring(0, 80) + '...');
            
            // May span multiple lines, so reconstruct
            let funcStart = i;
            let funcLine = lines[i];
            
            // Collect full function if it spans lines
            let j = i;
            while (j < lines.length && !funcLine.includes(']; }')) {
                j++;
                if (j < lines.length) {
                    funcLine += lines[j];
                }
            }
            
            // Now replace in the accumulated string
            const corrected = funcLine
                .replace(/TELÃ‰FONO/g, 'TELÉFONO')
                .replace(/NÃšMERO/g, 'NÚMERO')
                .replace(/DIRECCIÃ"/g, 'DIRECCIÓN')
                .replace(/DÃA/g, 'DÍA')
                .replace(/LÃNEAS/g, 'LÍNEAS')
                .replace(/TELÃ‰FONOS/g, 'TELÉFONOS')
                .replace(/INSTALACIÃ"/g, 'INSTALACIÓN');
            
            // Write back - may need to split again
            lines[i] = corrected;
            // Remove the extra lines we merged
            lines.splice(i + 1, j - i);
            
            modified = true;
            console.log('Fixed!');
            break;
        }
    }

// Fix other corrupted lines while we're at it
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('NormalizaciÃ³n')) {
        console.log(`Fixing Normalización at line ${i + 1}`);
        lines[i] = lines[i].replace(/NormalizaciÃ³n/g, 'Normalización').replace(/canÃ³nico/g, 'canónico');
    }
    if (lines[i].includes('todavÃ­a')) {
        lines[i] = lines[i].replace(/todavÃ­a/g, 'todavía');
    }
    if (lines[i].includes('estÃ¡')) {
        lines[i] = lines[i].replace(/estÃ¡/g, 'está');
    }
    if (lines[i].includes('SÃ­')) {
        lines[i] = lines[i].replace(/SÃ­/g, 'Sí');
    }
}

if (modified) {
    const fixed = lines.join('\n');
    fs.writeFileSync(filePath, fixed, 'utf-8');
    console.log('\n✓✓✓ SUCCESS: File has been fixed!');
    console.log('New size:', fixed.length);
    
    // Verify
    const verify = fs.readFileSync(filePath, 'utf-8');
    console.log('Verify: TELÉFONO found?', verify.includes('TELÉFONO'));
    console.log('Verify: NÚMERO found?', verify.includes('NÚMERO'));
} else {
    console.log('teamHeader function not found');
}
