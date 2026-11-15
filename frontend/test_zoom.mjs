import puppeteer from 'puppeteer';
import os from 'os';
import path from 'path';

(async () => {
  const customUserDataDir = path.join(os.tmpdir(), 'puppeteer_zoom_' + Date.now());
  const browser = await puppeteer.launch({
    headless: 'new',
    userDataDir: customUserDataDir,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle2' });

  // Switch to 3D Globe
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => x.innerText.includes('3D Earth Globe'));
    if (b) b.click();
  });

  await new Promise(r => setTimeout(r, 4000));

  // Get initial camera altitude and canvas rect
  const state0 = await page.evaluate(() => {
    const canvas = document.querySelector('.cesium-widget canvas');
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    return {
      hasCanvas: !!canvas,
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      scrollBefore: window.scrollY
    };
  });
  console.log('Initial Canvas State:', JSON.stringify(state0));

  if (!state0.rect) {
    console.error('No canvas found!');
    await browser.close();
    return;
  }

  const cx = state0.rect.left + state0.rect.width / 2;
  const cy = state0.rect.top + state0.rect.height / 2;

  // Move mouse to center and wheel
  await page.mouse.move(cx, cy);
  console.log(`Mouse moved to (${cx}, ${cy}). Wheeling deltaY: -500 (Zoom in)...`);
  await page.mouse.wheel({ deltaY: -500 });
  await new Promise(r => setTimeout(r, 1000));

  const scrollAfter = await page.evaluate(() => window.scrollY);
  console.log(`Window scrollY after wheel: ${scrollAfter} (before was ${state0.scrollBefore})`);

  await browser.close();
})();
