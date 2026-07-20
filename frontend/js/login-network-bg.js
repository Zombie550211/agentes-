/**
 * Fondo de red de partículas (canvas 2D) para el panel izquierdo del login.
 * Puntos que flotan y se conectan con líneas cuando están cerca, estilo
 * "red tecnológica" — sin dependencias externas.
 */
function initLoginNetworkBg(canvas, userOptions = {}) {
  if (!canvas) return null;
  const options = Object.assign(
    {
      color: '77,140,255',
      density: 0.00009,
      maxDist: 140,
      speed: 0.25
    },
    userOptions
  );

  const ctx = canvas.getContext('2d');
  let width, height, dpr, points;
  let rafId = null;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.max(18, Math.min(70, Math.floor(width * height * options.density)));
    points = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * options.speed,
      vy: (Math.random() - 0.5) * options.speed
    }));
  }

  function step() {
    ctx.clearRect(0, 0, width, height);

    points.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > width) p.vx *= -1;
      if (p.y < 0 || p.y > height) p.vy *= -1;
    });

    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < options.maxDist) {
          const alpha = (1 - dist / options.maxDist) * 0.35;
          ctx.strokeStyle = `rgba(${options.color},${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    points.forEach(p => {
      ctx.fillStyle = `rgba(${options.color},0.8)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });

    rafId = requestAnimationFrame(step);
  }

  resize();
  step();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  const destroy = () => {
    if (rafId) cancelAnimationFrame(rafId);
    ro.disconnect();
  };

  return { destroy };
}
