#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

// Read all lines
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);

// Find and replace line 178 (0-indexed = 177)
if (lines[177].includes('teamHeader')) {
    console.log('Found teamHeader on line 178');
    console.log('Old line:', lines[177].substring(0, 100) + '...');
    
    // Replace line 178
    lines[177] = "    function teamHeader(){ return ['NOMBRE CLIENTE','TELÉFONO PRINCIPAL','NÚMERO DE CUENTA','AUTOPAGO','PIN DE SEGURIDAD','DIRECCIÓN','DÍA DE VENTA','DÍA DE INSTALACIÓN','STATUS','CANTIDAD DE LÍNEAS','TELÉFONOS DE LAS LÍNEAS','ID','SUPERVISOR','MERCADO']; }";
    
    console.log('New line:', lines[177].substring(0, 100) + '...');
    
    // Also fix line 179 (Normalización)
    if (lines[178].includes('Normalizaci')) {
        console.log('Found Normalización on line 179');
        lines[178] = "    // Normalización de nombres de agente (alias -> canónico)";
       }
    
    // Write back
    const fixed = lines.join('\n');
    fs.writeFileSync(filePath, fixed, 'utf-8');
    console.log('\n✓✓✓ File updated successfully!');
    
    // Verify
    const verify = fs.readFileSync(filePath, 'utf-8');
    if (verify.includes('TELÉFONO PRINCIPAL')) {
        console.log('✓ TELÉFONO PRINCIPAL found');
    }
    if (verify.includes('NÚMERO DE CUENTA')) {
        console.log('✓ NÚMERO DE CUENTA found');
    }
} else {
    console.log('✗ Could not find teamHeader on line 178');
    console.log('Line 178 content:', lines[177].substring(0, 80));
}
