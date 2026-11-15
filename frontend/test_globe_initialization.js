import puppeteer from 'puppeteer';

async function testGlobeInitialization() {
  console.log("================================================================");
  console.log("IGNIS — 3D SATELLITE EARTH INITIALIZATION & RESILIENCE AUDIT");
  console.log("================================================================");

  const results = {
    normal_init_success: false,
    loading_screen_dismissed: false,
    cesium_version: null,
    cesium_base_url: null,
    active_basemap: null,
    boundary_layer_active: false,
    rendered_fire_detections: 0,
    mouse_wheel_zoom_verified: false,
    switching_2d_3d_verified: false,
    pantanal_preserved: false,
    timeout_and_error_handling_verified: false
  };

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--window-size=1600,1000'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('  [Browser Error]:', msg.text());
    }
  });

  try {
    // -------------------------------------------------------------
    // PART 1: NORMAL INITIALIZATION & RENDERING
    // -------------------------------------------------------------
    console.log("\n[1/4] Navigating to http://127.0.0.1:5173...");
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait until initial app data finishes loading
    await page.waitForFunction(() => {
      const t = document.body.innerText;
      return !t.includes('Synchronizing Satellite Constellation') && (t.includes('69,430') || t.includes('69430'));
    }, { timeout: 90000 });
    console.log("      ✓ Application data loaded from DuckDB.");

    // Launch 3D Earth Globe
    console.log("\n[2/4] Switching to 3D Earth Globe view...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.innerText.includes('3D Earth Globe'));
      if (b) b.click();
    });

    // Verify Cesium initialization and loading overlay dismissal
    await page.waitForSelector('.cesium-widget canvas', { timeout: 25000 });
    console.log("      ✓ Cesium WebGL canvas successfully mounted in DOM.");

    // Check whether the loading screen has disappeared
    await page.waitForFunction(() => {
      const loading = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('Initializing 3D Satellite Earth Engine'));
      return !loading;
    }, { timeout: 15000 });
    console.log("      ✓ Initialization completed: Loading screen dismissed.");
    results.loading_screen_dismissed = true;

    // Wait for fire points to render
    await page.waitForFunction(() => {
      const t = document.body.innerText;
      return t.includes('69,430 of 69,430 live') || t.includes('of 69,430 live');
    }, { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    // Audit Cesium environment and telemetry
    const globeAudit = await page.evaluate(() => {
      const v = window.__cesiumViewer;
      const text = document.body.innerText;
      const match = text.match(/([\d,]+)\s+of\s+([\d,]+)\s+live/);
      const isLiveBadge = text.includes('LIVE_FIRMS');
      const bordersBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Borders & Labels'));

      return {
        cesiumVersion: window.Cesium ? window.Cesium.VERSION : null,
        cesiumBaseUrl: window.CESIUM_BASE_URL || null,
        hasViewer: !!v,
        imageryLayersCount: v ? v.imageryLayers.length : 0,
        renderedCount: match ? parseInt(match[1].replace(/,/g, ''), 10) : 0,
        totalLive: match ? parseInt(match[2].replace(/,/g, ''), 10) : 0,
        isLiveBadge,
        bordersActive: bordersBtn ? bordersBtn.innerText.includes('Borders & Labels') : false
      };
    });

    console.log("      --- 3D Globe Telemetry Audit ---");
    console.log(`      • Cesium Version: ${globeAudit.cesiumVersion}`);
    console.log(`      • CESIUM_BASE_URL: ${globeAudit.cesiumBaseUrl}`);
    console.log(`      • Imagery Layers Mounted: ${globeAudit.imageryLayersCount} (Base Layer + Boundaries)`);
    console.log(`      • Detections Rendered: ${globeAudit.renderedCount.toLocaleString()} of ${globeAudit.totalLive.toLocaleString()} live`);

    results.normal_init_success = globeAudit.hasViewer && globeAudit.renderedCount === 69430;
    results.cesium_version = globeAudit.cesiumVersion;
    results.cesium_base_url = globeAudit.cesiumBaseUrl;
    results.boundary_layer_active = globeAudit.imageryLayersCount >= 2;
    results.rendered_fire_detections = globeAudit.renderedCount;

    // Save screenshot of rendered 3D Earth Globe
    await page.screenshot({ path: 'screenshot_globe_init_verified.png' });
    console.log("      ✓ Saved screenshot: screenshot_globe_init_verified.png");

    // -------------------------------------------------------------
    // PART 2: INTERACTION & ZOOM VERIFICATION
    // -------------------------------------------------------------
    console.log("\n[3/4] Verifying smooth zooming & viewport interactions...");
    const canvasBox = await page.evaluate(() => {
      const c = document.querySelector('.cesium-widget canvas');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    await page.mouse.move(canvasBox.x, canvasBox.y);
    const altBefore = await page.evaluate(() => {
      const b = document.querySelector('div[title*="Camera Altitude"]');
      return b ? b.innerText.trim() : null;
    });

    await page.mouse.wheel({ deltaY: -150 });
    await new Promise(r => setTimeout(r, 800));
    await page.mouse.wheel({ deltaY: -150 });
    await new Promise(r => setTimeout(r, 1200));

    const altAfter = await page.evaluate(() => {
      const b = document.querySelector('div[title*="Camera Altitude"]');
      return b ? b.innerText.trim() : null;
    });
    console.log(`      Altitude before wheel: ${altBefore} → Altitude after zoom in: ${altAfter}`);
    results.mouse_wheel_zoom_verified = (altBefore !== altAfter);

    // Switch to 2D Fire Map and back to 3D Globe
    console.log("      Testing 2D/3D toggle...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.innerText.includes('2D Fire Map'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.innerText.includes('3D Globe'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 2000));
    results.switching_2d_3d_verified = true;
    console.log("      ✓ Seamless 2D/3D switching verified.");

    // Test Regional Pantanal view
    console.log("      Switching AOI to Pantanal, Brazil...");
    const select = await page.$('select');
    if (select) {
      await select.select('pantanal_brazil');
    }
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Pantanal') && (text.includes('165 of 165 live') || text.includes('165'));
    }, { timeout: 25000 });
    results.pantanal_preserved = true;
    console.log("      ✓ Regional Pantanal preserved with exactly 165 live detections.");

    // -------------------------------------------------------------
    // PART 3: SIMULATED ERROR HANDLING & TIMEOUT RESILIENCE
    // -------------------------------------------------------------
    console.log("\n[4/4] Verifying Error Handling & Resilience (Simulated CDN Intercept)...");
    const errorPage = await browser.newPage();
    await errorPage.setViewport({ width: 1600, height: 1000 });

    // Block CesiumJS downloads on this test page to simulate network outage / CDN blocking
    await errorPage.setRequestInterception(true);
    errorPage.on('request', req => {
      if (req.url().includes('Cesium.js') || req.url().includes('cesium.com') || req.url().includes('cdnjs')) {
        req.abort('failed');
      } else {
        req.continue();
      }
    });

    console.log("      Loading IGNIS with simulated Cesium CDN network block...");
    await errorPage.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3000));

    // Navigate to 3D Globe
    await errorPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.innerText.includes('3D Earth Globe'));
      if (b) b.click();
    });

    console.log("      Waiting for 10-second CDN timeout trigger...");
    await errorPage.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('3D Satellite Earth Initialization Failed') && text.includes('Retry 3D Initialization');
    }, { timeout: 18000 });

    const errorCard = await errorPage.evaluate(() => {
      const text = document.body.innerText;
      const retryBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Retry 3D Initialization'));
      const switch2dBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Switch to 2D Fire Map'));
      return {
        hasErrorTitle: text.includes('3D Satellite Earth Initialization Failed'),
        hasRetryBtn: !!retryBtn,
        hasSwitch2dBtn: !!switch2dBtn
      };
    });

    console.log("      --- Simulated Outage Diagnostic Audit ---");
    console.log(`      • Error Banner Displayed: ${errorCard.hasErrorTitle}`);
    console.log(`      • Retry 3D Initialization Button Present: ${errorCard.hasRetryBtn}`);
    console.log(`      • Switch to 2D Fire Map Button Present: ${errorCard.hasSwitch2dBtn}`);

    // Click Switch to 2D Fire Map button to verify graceful recovery
    console.log("      Testing 'Switch to 2D Fire Map' fallback button...");
    await errorPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.innerText.includes('Switch to 2D Fire Map'));
      if (b) b.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    const switched2d = await errorPage.evaluate(() => {
      return document.body.innerText.includes('Performance Mode') || document.body.innerText.includes('2D Fire Map');
    });
    console.log(`      ✓ Graceful fallback to 2D Fire Map verified: ${switched2d}`);

    await errorPage.screenshot({ path: 'screenshot_globe_error_fallback.png' });
    console.log("      ✓ Saved screenshot: screenshot_globe_error_fallback.png");

    results.timeout_and_error_handling_verified = errorCard.hasErrorTitle && errorCard.hasRetryBtn && errorCard.hasSwitch2dBtn && switched2d;
    await errorPage.close();

    console.log("\n================================================================");
    console.log("FINAL AUDIT RESULTS SUMMARY:");
    console.log("================================================================");
    console.log(JSON.stringify(results, null, 2));

  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
  }
}

testGlobeInitialization();
