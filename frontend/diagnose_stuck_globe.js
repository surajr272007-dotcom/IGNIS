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
  
  const failedRequests = [];
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), error: req.failure() ? req.failure().errorText : 'Unknown' });
  });

  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log('Loading app at http://127.0.0.1:5173...');
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 30000 });

  await new Promise(r => setTimeout(r, 4000));

  // Check window.Cesium
  const check1 = await page.evaluate(() => {
    return {
      hasCesium: !!window.Cesium,
      cesiumVersion: window.Cesium ? window.Cesium.VERSION : null,
      cesiumBaseUrl: window.CESIUM_BASE_URL || null,
      scripts: Array.from(document.querySelectorAll('script')).map(s => s.src)
    };
  });
  console.log('Check 1 (Initial page):', check1);

  // Click on 3D Earth Globe
  console.log('Navigating to 3D Earth Globe tab...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => x.innerText.includes('3D Earth Globe'));
    if (b) b.click();
  });

  await new Promise(r => setTimeout(r, 6000));

  const globeStatus = await page.evaluate(() => {
    const loadingElem = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('Initializing 3D Satellite Earth Engine'));
    const canvas = document.querySelector('.cesium-widget canvas');
    const container = document.querySelector('.cesium-widget');
    const viewer = window.__cesiumViewer;
    return {
      isLoadingVisible: !!loadingElem,
      hasCanvas: !!canvas,
      hasContainer: !!container,
      hasViewer: !!viewer,
      canvasWidth: canvas ? canvas.width : 0,
      canvasHeight: canvas ? canvas.height : 0
    };
  });
  console.log('Globe Status:', globeStatus);

  console.log('\n--- FAILED REQUESTS ---');
  console.log(failedRequests.slice(0, 10));

  console.log('\n--- CONSOLE ERRORS & WARNS ---');
  const errors = consoleLogs.filter(l => l.type === 'error' || l.type === 'warn');
  console.log(errors);

  await browser.close();
}

diagnose().catch(console.error);
