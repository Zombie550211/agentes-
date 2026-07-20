/**
 * Text Pressure — texto donde cada letra reacciona (peso/ancho/inclinación
 * variable de la fuente) según la cercanía del cursor.
 * Portado de https://reactbits.dev/text-animations/text-pressure (React) a JS vanilla.
 * Requiere una fuente variable (por defecto Roboto Flex, cargada desde Google Fonts).
 *
 * Uso:
 *   const tp = initTextPressure(document.getElementById('titulo'), { text: 'CONNECTING' });
 *   // tp.destroy() para desmontar
 */
function initTextPressure(container, userOptions = {}) {
  const options = Object.assign(
    {
      text: 'Compressa',
      fontFamily: 'Roboto Flex',
      fontUrl:
        'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wdth,wght@8..144,25..151,100..1000&display=swap',
      width: true,
      weight: true,
      italic: true,
      alpha: false,
      flex: true,
      stroke: false,
      scale: false,
      textColor: '#FFFFFF',
      strokeColor: '#FF0000',
      className: '',
      minFontSize: 24
    },
    userOptions
  );

  const dist = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const getAttr = (distance, maxDist, minVal, maxVal) => {
    const val = maxVal - Math.abs((maxVal * distance) / maxDist);
    return Math.max(minVal, val + minVal);
  };
  const debounce = (fn, delay) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), delay);
    };
  };

  if (!document.querySelector(`link[data-text-pressure-font="${options.fontUrl}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = options.fontUrl;
    link.setAttribute('data-text-pressure-font', options.fontUrl);
    document.head.appendChild(link);
  }

  const styleId = 'text-pressure-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .text-pressure-flex { display: flex; justify-content: space-between; }
      .text-pressure-stroke span { position: relative; }
      .text-pressure-stroke span::after {
        content: attr(data-char);
        position: absolute; left: 0; top: 0;
        color: transparent; z-index: -1;
        -webkit-text-stroke-width: 3px;
      }
    `;
    document.head.appendChild(style);
  }

  container.style.position = 'relative';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.background = 'transparent';

  const chars = options.text.split('');

  const title = document.createElement('h1');
  const classes = ['text-pressure-title', options.className];
  if (options.flex) classes.push('text-pressure-flex');
  if (options.stroke) classes.push('text-pressure-stroke');
  title.className = classes.filter(Boolean).join(' ');
  title.style.cssText = `font-family:${options.fontFamily};text-transform:uppercase;margin:0;text-align:center;user-select:none;white-space:nowrap;font-weight:100;width:100%;color:${options.textColor};transform-origin:center top;`;
  title.style.fontSize = options.minFontSize + 'px';

  const spans = chars.map(ch => {
    const span = document.createElement('span');
    span.dataset.char = ch;
    span.textContent = ch;
    span.style.display = 'inline-block';
    if (!options.stroke) span.style.color = options.textColor;
    else span.style.setProperty('-webkit-text-stroke-color', options.strokeColor);
    title.appendChild(span);
    return span;
  });

  container.appendChild(title);

  const mouse = { x: 0, y: 0 };
  const cursor = { x: 0, y: 0 };

  const handleMouseMove = e => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  };
  const handleTouchMove = e => {
    const t = e.touches[0];
    cursor.x = t.clientX;
    cursor.y = t.clientY;
  };
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('touchmove', handleTouchMove, { passive: true });

  const rect0 = container.getBoundingClientRect();
  mouse.x = rect0.left + rect0.width / 2;
  mouse.y = rect0.top + rect0.height / 2;
  cursor.x = mouse.x;
  cursor.y = mouse.y;

  const setSize = () => {
    const { width: containerW, height: containerH } = container.getBoundingClientRect();
    let newFontSize = containerW / (chars.length / 2);
    newFontSize = Math.max(newFontSize, options.minFontSize);
    title.style.fontSize = newFontSize + 'px';
    title.style.lineHeight = '1';
    title.style.transform = 'scale(1, 1)';

    requestAnimationFrame(() => {
      // Salvavidas: la fórmula de arriba asume ~2 caracteres por "em", lo
      // cual varía mucho según la fuente. Si el texto igual desborda el
      // contenedor, lo reducimos hasta que entre.
      if (containerW > 0) {
        const renderedWidth = title.scrollWidth;
        if (renderedWidth > containerW) {
          const ratio = containerW / renderedWidth;
          const adjusted = Math.max(options.minFontSize, newFontSize * ratio * 0.98);
          title.style.fontSize = adjusted + 'px';
        }
      }
      if (!options.scale) return;
      const textRect = title.getBoundingClientRect();
      if (textRect.height > 0) {
        const yRatio = containerH / textRect.height;
        title.style.transform = `scale(1, ${yRatio})`;
        title.style.lineHeight = String(yRatio);
      }
    });
  };

  const debouncedSetSize = debounce(setSize, 100);
  debouncedSetSize();
  window.addEventListener('resize', debouncedSetSize);

  let rafId;
  const animate = () => {
    mouse.x += (cursor.x - mouse.x) / 15;
    mouse.y += (cursor.y - mouse.y) / 15;

    const titleRect = title.getBoundingClientRect();
    const maxDist = titleRect.width / 2;

    spans.forEach(span => {
      const rect = span.getBoundingClientRect();
      const charCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const d = dist(mouse, charCenter);

      const wdth = options.width ? Math.floor(getAttr(d, maxDist, 5, 200)) : 100;
      const wght = options.weight ? Math.floor(getAttr(d, maxDist, 100, 900)) : 400;
      const italVal = options.italic ? getAttr(d, maxDist, 0, 1).toFixed(2) : 0;
      const alphaVal = options.alpha ? getAttr(d, maxDist, 0, 1).toFixed(2) : 1;

      const settings = `'wght' ${wght}, 'wdth' ${wdth}, 'ital' ${italVal}`;
      if (span.style.fontVariationSettings !== settings) {
        span.style.fontVariationSettings = settings;
      }
      if (options.alpha && span.style.opacity !== alphaVal) {
        span.style.opacity = alphaVal;
      }
    });

    rafId = requestAnimationFrame(animate);
  };
  animate();

  const destroy = () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('resize', debouncedSetSize);
    if (title.parentNode) title.parentNode.removeChild(title);
  };

  return { title, destroy };
}
