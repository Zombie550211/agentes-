#!/usr/bin/env node
const fs = require('fs');

const filePath = 'c:\\Users\\Zombie\\Documents\\dashboard\\frontend\\Costumer.html';

console.log('1. Leyendo archivo con UTF-8...');
let content = fs.readFileSync(filePath, 'utf-8');
console.log(`2. Tamaño: ${content.length} caracteres`);

// Convertir de Buffer a Latin-1 y de vuelta a UTF-8
console.log('3. Detectando corrupción...');
const buffer = fs.readFileSync(filePath);
const asLatin1 = buffer.toString('latin1');
const fixedContent = Buffer.from(asLatin1, 'latin1').toString('utf-8');

console.log(`4. Comparando...`);
console.log(`   Original size: ${content.length}`);
console.log(`   Fixed size: ${fixedContent.length}`);

if (fixedContent !== content && fixedContent.includes('TELÉFONO')) {
    console.log('5. ✓ Encontré la versión corregida');
    fs.writeFileSync(filePath, fixedContent, 'utf-8');
    console.log('6. ✓ Archivo actualizado');
} else {
    console.log('5. Intentando reemplazos directos...');
    
    // Intentar reemplazos específicos para caracteres corruptos
    const corrections = [
        ['TELÃ‰FONO', 'TELÉFONO'],
        ['NÃšMERO', 'NÚMERO'],
        ['DIRECCIÃ"N', 'DIRECCIÓN'],
        ['DÃA', 'DÍA'],
        ['LÃNEAS', 'LÍNEAS'],
        ['INSTALACIÃ"N', 'INSTALACIÓN'],
        ['TELÃ‰FONOS', 'TELÉFONOS'],
        ['estÃ¡', 'está'],
        ['todavÃ­a', 'todavía'],
        ['FunciÃ³n', 'Función'],
        ['EdiciÃ³n', 'Edición'],
        ['provisionÃ³', 'provisión'],
        ['proporcionÃ³', 'proporcionó'],
        ['encontrÃ³', 'encontró'],
        ['registroÃ©', 'registro'],
    ];
    
    let fixed = content;
    let count = 0;
    
    corrections.forEach(([bad, good]) => {
        while (fixed.includes(bad)) {
            fixed = fixed.replace(bad, good);
            count++;
        }
    });
    
    console.log(`6. Total correcciones: ${count}`);
    if (count > 0) {
        fs.writeFileSync(filePath, fixed, 'utf-8');
        console.log('7. ✓ Archivo actualizado');
    } else {
        console.log('7. No se encontraron caracteres para corregir');
    }
}

// Verificación final
const final = fs.readFileSync(filePath, 'utf-8').substring(0, 5000);
if (final.includes('TELÉFONO')) {
    console.log('\n✓✓✓ ÉXITO: TELÉFONO ahora está correcto');
} else {
    console.log('\n✗ TELÉFONO aún corrupto');
}
