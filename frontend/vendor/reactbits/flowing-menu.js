/**
 * Flowing Menu — menú donde cada ítem revela una marquesina (texto + imagen)
 * que "fluye" desde el borde más cercano al entrar/salir el cursor.
 * Portado de https://reactbits.dev/components/flowing-menu (React) a JS vanilla.
 * Requiere GSAP cargado globalmente (window.gsap) — CDN:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
 *
 * Uso:
 *   initFlowingMenu(document.getElementById('menu'), [
 *     { link: '#', text: 'Ranking', image: '/images/foo.jpg' },
 *   ], { speed: 15 });
 */
function initFlowingMenu(container, items = [], userOptions = {}) {
  if (typeof gsap === 'undefined') {
    console.error('[FlowingMenu] GSAP no está cargado. Agregá el script de gsap antes de llamar initFlowingMenu.');
    return null;
  }

  const options = Object.assign(
    {
      speed: 15,
      textColor: '#fff',
      bgColor: '#120F17',
      marqueeBgColor: '#fff',
      marqueeTextColor: '#120F17',
      borderColor: '#fff'
    },
    userOptions
  );

  const distMetric = (x, y, x2, y2) => {
    const xDiff = x - x2;
    const yDiff = y - y2;
    return xDiff * xDiff + yDiff * yDiff;
  };
  const findClosestEdge = (mouseX, mouseY, width, height) => {
    const topEdgeDist = distMetric(mouseX, mouseY, width / 2, 0);
    const bottomEdgeDist = distMetric(mouseX, mouseY, width / 2, height);
    return topEdgeDist < bottomEdgeDist ? 'top' : 'bottom';
  };

  const animationDefaults = { duration: 0.6, ease: 'expo' };

  container.classList.add('menu-wrap');
  container.style.backgroundColor = options.bgColor;
  const nav = document.createElement('nav');
  nav.className = 'menu';
  container.appendChild(nav);

  const cleanups = [];

  items.forEach(item => {
    const { link = '#', text = '', image = '' } = item;

    const menuItem = document.createElement('div');
    menuItem.className = 'menu__item';
    menuItem.style.borderColor = options.borderColor;

    const a = document.createElement('a');
    a.className = 'menu__item-link';
    a.href = link;
    a.style.color = options.textColor;
    a.textContent = text;

    const marquee = document.createElement('div');
    marquee.className = 'marquee';
    marquee.style.backgroundColor = options.marqueeBgColor;

    const marqueeInnerWrap = document.createElement('div');
    marqueeInnerWrap.className = 'marquee__inner-wrap';

    const marqueeInner = document.createElement('div');
    marqueeInner.className = 'marquee__inner';
    marqueeInner.setAttribute('aria-hidden', 'true');

    const buildParts = count => {
      marqueeInner.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const part = document.createElement('div');
        part.className = 'marquee__part';
        part.style.color = options.marqueeTextColor;
        const span = document.createElement('span');
        span.textContent = text;
        const img = document.createElement('div');
        img.className = 'marquee__img';
        if (image) img.style.backgroundImage = `url(${image})`;
        part.appendChild(span);
        part.appendChild(img);
        marqueeInner.appendChild(part);
      }
    };
    buildParts(4);

    marqueeInnerWrap.appendChild(marqueeInner);
    marquee.appendChild(marqueeInnerWrap);
    menuItem.appendChild(a);
    menuItem.appendChild(marquee);
    nav.appendChild(menuItem);

    let animation = null;

    const calculateRepetitions = () => {
      const marqueeContent = marqueeInner.querySelector('.marquee__part');
      if (!marqueeContent) return;
      const contentWidth = marqueeContent.offsetWidth;
      if (!contentWidth) return;
      const needed = Math.ceil(window.innerWidth / contentWidth) + 2;
      buildParts(Math.max(4, needed));
      setupMarquee();
    };

    const setupMarquee = () => {
      const marqueeContent = marqueeInner.querySelector('.marquee__part');
      if (!marqueeContent) return;
      const contentWidth = marqueeContent.offsetWidth;
      if (contentWidth === 0) return;
      if (animation) animation.kill();
      animation = gsap.to(marqueeInner, {
        x: -contentWidth,
        duration: options.speed,
        ease: 'none',
        repeat: -1
      });
    };

    const resizeTimer = setTimeout(calculateRepetitions, 50);
    window.addEventListener('resize', calculateRepetitions);

    const handleMouseEnter = ev => {
      const rect = menuItem.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const edge = findClosestEdge(x, y, rect.width, rect.height);
      gsap
        .timeline({ defaults: animationDefaults })
        .set(marquee, { y: edge === 'top' ? '-101%' : '101%' }, 0)
        .set(marqueeInner, { y: edge === 'top' ? '101%' : '-101%' }, 0)
        .to([marquee, marqueeInner], { y: '0%' }, 0);
    };
    const handleMouseLeave = ev => {
      const rect = menuItem.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const edge = findClosestEdge(x, y, rect.width, rect.height);
      gsap
        .timeline({ defaults: animationDefaults })
        .to(marquee, { y: edge === 'top' ? '-101%' : '101%' }, 0)
        .to(marqueeInner, { y: edge === 'top' ? '101%' : '-101%' }, 0);
    };
    a.addEventListener('mouseenter', handleMouseEnter);
    a.addEventListener('mouseleave', handleMouseLeave);

    cleanups.push(() => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', calculateRepetitions);
      a.removeEventListener('mouseenter', handleMouseEnter);
      a.removeEventListener('mouseleave', handleMouseLeave);
      if (animation) animation.kill();
    });
  });

  const destroy = () => {
    cleanups.forEach(fn => fn());
    if (nav.parentNode) nav.parentNode.removeChild(nav);
  };

  return { nav, destroy };
}
