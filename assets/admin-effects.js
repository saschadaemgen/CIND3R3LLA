(() => {
  'use strict';

  const canvas = document.getElementById('admin-starfield');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const palette = [
    [255, 255, 255],
    [141, 225, 236],
    [244, 92, 176],
  ];

  let width = 0;
  let height = 0;
  let stars = [];
  let frameId = 0;
  let time = 0;

  function buildStarfield() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * deviceScale;
    canvas.height = height * deviceScale;
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

    const count = Math.min(190, Math.floor((width * height) / 9000));
    stars = [];

    for (let index = 0; index < count; index += 1) {
      const choice = Math.random();
      const colorIndex = choice < 0.72 ? 0 : choice < 0.9 ? 1 : 2;

      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.3 + 0.35,
        color: palette[colorIndex],
        phase: Math.random() * 6.283,
        speed: 0.5 + Math.random() * 1.7,
        baseOpacity: 0.3 + Math.random() * 0.5,
      });
    }
  }

  function drawStarfield() {
    context.clearRect(0, 0, width, height);

    for (const star of stars) {
      const opacity = reducedMotion
        ? star.baseOpacity
        : Math.max(
            0,
            Math.min(1, star.baseOpacity + Math.sin(time * star.speed + star.phase) * 0.4),
          );

      const [red, green, blue] = star.color;
      context.fillStyle = `rgba(${red},${green},${blue},${opacity})`;
      context.beginPath();
      context.arc(star.x, star.y, star.radius, 0, 6.283);
      context.fill();

      if (star.radius > 1) {
        context.fillStyle = `rgba(${red},${green},${blue},${opacity * 0.25})`;
        context.beginPath();
        context.arc(star.x, star.y, star.radius * 2.8, 0, 6.283);
        context.fill();
      }
    }
  }

  function animateStarfield() {
    time += 0.016;
    drawStarfield();
    frameId = window.requestAnimationFrame(animateStarfield);
  }

  function rebuildStarfield() {
    if (frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    }

    buildStarfield();

    if (reducedMotion) {
      drawStarfield();
      return;
    }

    animateStarfield();
  }

  rebuildStarfield();
  window.addEventListener('resize', rebuildStarfield, { passive: true });
})();
