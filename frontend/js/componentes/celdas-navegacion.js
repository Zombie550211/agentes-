/* Navegación tipo hoja de cálculo para tablas con celdas contenteditable.
 *
 *   Enter        → celda de abajo (misma columna)      Shift+Enter → la de arriba
 *   Tab          → siguiente celda editable             Shift+Tab   → la anterior
 *   ↑ ↓          → celda de arriba / de abajo
 *   ← →          → celda editable de al lado, en la misma fila. Si se está corrigiendo
 *                  un número (cursor en medio del texto), la flecha mueve el cursor y
 *                  solo salta de celda al llegar al borde del texto.
 *
 * Sin esto, Enter en un <td contenteditable> inserta un salto de línea y la fila
 * crece. También se limpia lo pegado: de una celda nunca sale más de una línea.
 *
 * Uso: navegacionCeldas(tbody)  — se delega en el tbody, así que sirve aunque las
 * filas se vuelvan a pintar.
 */
(function () {
  'use strict';

  var EDITABLE = 'td[contenteditable="true"]';

  // Una columna oculta con display:none no debe recibir el foco.
  function visible(td) { return !!td && td.offsetParent !== null; }

  function enfocar(td) {
    td.focus();
    var rango = document.createRange();
    rango.selectNodeContents(td);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rango);
  }

  function vecinaVertical(td, paso) {
    var col = td.cellIndex;
    var tr = td.parentElement;
    while ((tr = paso > 0 ? tr.nextElementSibling : tr.previousElementSibling)) {
      var cand = tr.cells[col];
      if (cand && cand.matches(EDITABLE) && visible(cand)) return cand;
    }
    return null;
  }

  function vecinaHorizontal(tbody, td, paso) {
    var celdas = Array.prototype.filter.call(tbody.querySelectorAll(EDITABLE), visible);
    return celdas[celdas.indexOf(td) + paso] || null;
  }

  // Misma fila, sin saltar a la siguiente: como las flechas de una hoja de cálculo.
  function vecinaEnFila(td, paso) {
    var celdas = td.parentElement.cells;
    for (var i = td.cellIndex + paso; i >= 0 && i < celdas.length; i += paso) {
      if (celdas[i].matches(EDITABLE) && visible(celdas[i])) return celdas[i];
    }
    return null;
  }

  // ¿Puede la flecha salir de la celda? Sí si el cursor está en ese borde del texto
  // (o todo el contenido está seleccionado, que es como queda al llegar a la celda).
  function enBorde(td, paso) {
    var sel = window.getSelection();
    if (!sel.rangeCount) return true;
    var r = sel.getRangeAt(0);
    if (!td.contains(r.startContainer) || !td.contains(r.endContainer)) return true;
    var resto = document.createRange();
    resto.selectNodeContents(td);
    if (paso < 0) resto.setEnd(r.startContainer, r.startOffset);
    else resto.setStart(r.endContainer, r.endOffset);
    return resto.toString() === '';
  }

  var FLECHAS = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 };

  function navegacionCeldas(tbody) {
    if (!tbody || tbody.dataset.navCeldas) return;
    tbody.dataset.navCeldas = '1';

    tbody.addEventListener('keydown', function (e) {
      var flecha = FLECHAS[e.key];
      if (e.key !== 'Enter' && e.key !== 'Tab' && !flecha) return;
      if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      var td = e.target.closest ? e.target.closest(EDITABLE) : null;
      if (!td || !tbody.contains(td)) return;

      if (flecha) {
        if (e.shiftKey) return;                  // Shift+flecha sigue seleccionando texto
        var vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
        if (!vertical && !enBorde(td, flecha)) return;
        var dest = vertical ? vecinaVertical(td, flecha) : vecinaEnFila(td, flecha);
        e.preventDefault();
        if (dest) enfocar(dest);
        return;
      }

      var paso = e.shiftKey ? -1 : 1;
      if (e.key === 'Enter') {
        e.preventDefault();                      // nunca un salto de línea en la celda
        var abajo = vecinaVertical(td, paso);
        if (abajo) enfocar(abajo);
        return;
      }
      // Tab: en el borde de la tabla se deja pasar, para poder salir con el teclado.
      var lado = vecinaHorizontal(tbody, td, paso);
      if (lado) { e.preventDefault(); enfocar(lado); }
    });

    // Pegar solo texto y en una línea (Excel suele añadir un salto al final).
    tbody.addEventListener('paste', function (e) {
      var td = e.target.closest ? e.target.closest(EDITABLE) : null;
      if (!td) return;
      e.preventDefault();
      var texto = ((e.clipboardData || window.clipboardData).getData('text') || '')
        .replace(/[\r\n\t]+/g, ' ').trim();
      document.execCommand('insertText', false, texto);
    });
  }

  window.navegacionCeldas = navegacionCeldas;
})();
