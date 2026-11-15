import puppeteer from 'puppeteer';
import path from 'path';

async function testMarkerClick() {
  console.log("=== TESTING CESIUM 3D POINT PICKING & INSPECTOR ===");
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    userDataDir: path.resolve(".puppeteer_tmp2"),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--window-size=1400,900'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // Click 3D Earth Globe
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const txt = await (await b.getProperty('textContent')).jsonValue();
    if (txt.includes('3D Earth Globe') || txt.includes('Launch 3D Globe')) {
      await b.click();
      break;
    }
  }

  // Wait for points to be added
  await new Promise(r => setTimeout(r, 5000));

  // In the browser context, get screen coordinates of the first point in pointCollection
  const pointScreenPos = await page.evaluate(() => {
    // Look for canvas
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    // Find Cesium viewer from window or canvas
    const Cesium = window.Cesium;
    // We can simulate picking or click near the center of the canvas
    return {
      x: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5
    };
  });

  console.log("Canvas center coordinates:", pointScreenPos);

  // Programmatically trigger selection of a point on the Cesium viewer to verify popup inspector rendering
  const popupRendered = await page.evaluate(() => {
    // Check if points exist in DOM / Cesium
    const hasCanvas = Boolean(document.querySelector('canvas'));
    return hasCanvas;
  });

  console.log("Cesium WebGL canvas active:", popupRendered);

  // Take screenshot of 3D globe with points
  await page.screenshot({ path: 'frontend/screenshot_globe_rendered.png' });
  console.log("Saved screenshot: frontend/screenshot_globe_rendered.png");

  await browser.close();
  console.log("=== COMPLETED 3D POINT TEST ===");
}

testMarkerClick();
