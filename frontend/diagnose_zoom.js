import puppeteer from 'puppeteer';

async function diagnose() {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !document.body.innerText.includes('Synchronizing Satellite Constellation'), { timeout: 90000 });

  // Switch to Globe
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => x.innerText.includes('3D Earth Globe'));
    if (b) b.click();
  });

  await page.waitForSelector('.cesium-widget canvas', { timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  const stateBefore = await page.evaluate(() => {
    const v = window.__cesiumViewer;
    if (!v) return 'No viewer on window';
    const c = v.camera;
    return {
      pos: [c.position.x, c.position.y, c.position.z],
      dir: [c.direction.x, c.direction.y, c.direction.z],
      near: c.frustum.near,
      far: c.frustum.far,
      controllerZoomEventTypes: v.scene.screenSpaceCameraController.zoomEventTypes
    };
  });
  console.log('State Before Wheel:', stateBefore);

  const canvas = await page.$('.cesium-widget canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  console.log('Dispatching wheel...');
  await page.mouse.wheel({ deltaY: -100 });
  await new Promise(r => setTimeout(r, 1500));

  const stateAfter = await page.evaluate(() => {
    const v = window.__cesiumViewer;
    if (!v) return 'No viewer on window';
    const c = v.camera;
    return {
      pos: [c.position.x, c.position.y, c.position.z],
      dir: [c.direction.x, c.direction.y, c.direction.z],
      near: c.frustum.near,
      far: c.frustum.far
    };
  });
  console.log('State After Wheel:', stateAfter);

  await browser.close();
}

diagnose().catch(console.error);
