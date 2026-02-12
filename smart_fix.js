#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// Find actual line number with teamHeader
const teamHeaderLineIdx = lines.findIndex(l => l.includes('function teamHeader()'));
console.log(`teamHeader found at index: ${teamHeaderLineIdx} (line ${teamHeaderLineIdx + 1})`);

if (teamHeaderLineIdx >= 0) {
    // Collect all consecutive lines that are part of the function until we see "]; }"
    let funcStartIdx = teamHeaderLineIdx;
    let funcEndIdx = teamHeaderLineIdx;
    
    // Work backwards to find any line that might be part of return array
    for (let i = teamHeaderLineIdx - 1; i >= Math.max(0, teamHeaderLineIdx - 5); i--) {
        if (lines[i].includes("['NOMBRE")) {
            funcStartIdx = i;
            break;
        }
    }
    
    // Work forward to find end
    for (let i = teamHeaderLineIdx + 1; i < Math.min(lines.length, teamHeaderLineIdx + 10); i++) {
        if (lines[i].includes(']; }')) {
            funcEndIdx = i;
            break;
        }
    }
    
    console.log(`Function spans lines ${funcStartIdx + 1} to ${funcEndIdx + 1}`);
    
    // Combine all lines of the function
    let funcLines = lines.slice(funcStartIdx, funcEndIdx + 1);
    console.log('Original parts:', funcLines.length);
    console.log('Part 1:', funcLines[0].substring(0, 80) + '...');
    
    // Replace the entire function as one line
    const newFunc = "    function teamHeader(){ return ['NOMBRE CLIENTE','TELÉFONO PRINCIPAL','NÚMERO DE CUENTA','AUTOPAGO','PIN DE SEGURIDAD','DIRECCIÓN','DÍA DE VENTA','DÍA DE INSTALACIÓN','STATUS','CANTIDAD DE LÍNEAS','TELÉFONOS DE LAS LÍNEAS','ID','SUPERVISOR','MERCADO']; }";
    
    // Remove old lines and insert new one
    lines.splice(funcStartIdx, funcEndIdx - funcStartIdx + 1, newFunc);
    
    console.log('After fix, total lines:', lines.length);
    
    // Write back
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log('\n✓✓✓ SUCCESS: File updated!');
    
    // Verify
    const verify = fs.readFileSync(filePath, 'utf-8');
    console.log('Verify - TELÉFONO found?', verify.includes('TELÉFONO'));
    console.log('Verify - NÚMERO found?', verify.includes('NÚMERO'));
} else {
    console.log('✗ teamHeader not found');
}
