/* Navegación tipo hoja de cálculo para tablas con celdas contenteditable.
 *
 *   Enter        → celda de abajo (misma columna)      Shift+Enter → la de arriba
 *   Tab          → siguiente celda editable             Shift+Tab   → la anterior
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

  function navegacionCeldas(tbody) {
    if (!tbody || tbody.dataset.navCeldas) return;
    tbody.dataset.navCeldas = '1';

    tbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      var td = e.target.closest ? e.target.closest(EDITABLE) : null;
      if (!td || !tbody.contains(td)) return;

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
