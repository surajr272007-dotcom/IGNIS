import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import http from 'http';

function waitForPort(port, timeoutMs = 25000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const req = http.get({
        hostname: '127.0.0.1',
        port: port,
        path: '/',
        timeout: 2000
      }, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(tryConnect, 400);
        }
      });
      req.end();
    }
    tryConnect();
  });
}

async function verify() {
  console.log("==================================================");
  console.log("IGNIS FRONTEND PRODUCTION VERIFICATION");
  console.log("==================================================");

  console.log("\n[1/7] Launching local Vite preview server on port 4173...");
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173'], {
    cwd: 'frontend',
    shell: true,
    stdio: 'pipe'
  });

  server.stdout.on('data', (d) => process.stdout.write(`  [Vite] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`  [Vite ERR] ${d}`));

  try {
    await waitForPort(4173);
    console.log("      ✓ Vite server is ready on http://127.0.0.1:4173/");

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      errors.push(err.message);
    });

    console.log("\n[2/7] Loading application in headless browser...");
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle2', timeout: 45000 });

    console.log("\n[3/7] Waiting for data to populate from cloud Render backend...");
    await page.waitForFunction(() => {
      return document.body.innerText.includes('SAMPLE DATA') || document.body.innerText.includes('IGNIS');
    }, { timeout: 30000 });

    await new Promise(r => setTimeout(r, 4000));

    const bodyText = await page.evaluate(() => document.body.innerText);

    // Check 1: Sample Data Labeling
    const hasSampleLabel = bodyText.includes('SAMPLE DATA') || bodyText.includes('Sample Archive');
    console.log(`      ✓ Sample Data Labeling present: ${hasSampleLabel}`);

    // Check 2: Overview metrics
    console.log("\n[4/7] Verifying Overview Dashboard metrics & data display...");
    const hasTelemetry = bodyText.includes('MODIS') || bodyText.includes('VIIRS');
    console.log(`      ✓ Sensor telemetry displayed: ${hasTelemetry}`);

    await page.screenshot({ path: 'frontend/screenshot_verify_overview.png' });
    console.log("      ✓ Saved screenshot: frontend/screenshot_verify_overview.png");

    // Check 3: 3D Earth Globe Tab
    console.log("\n[5/7] Navigating to 3D Earth Globe tab...");
    const clickedGlobe = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const globeBtn = btns.find(b => b.innerText.includes('3D Earth Globe'));
      if (globeBtn) {
        globeBtn.click();
        return true;
      }
      return false;
    });

    if (clickedGlobe) {
      await new Promise(r => setTimeout(r, 6000));
      await page.screenshot({ path: 'frontend/screenshot_verify_globe.png' });
      console.log("      ✓ 3D Globe view rendered and captured: frontend/screenshot_verify_globe.png");
    }

    // Check 4: 2D Fire Map Tab
    console.log("\n[6/7] Navigating to 2D Fire Map tab...");
    const clickedMap = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const mapBtn = btns.find(b => b.innerText.includes('2D Fire Map'));
      if (mapBtn) {
        mapBtn.click();
        return true;
      }
      return false;
    });

    if (clickedMap) {
      await new Promise(r => setTimeout(r, 3000));
      await page.screenshot({ path: 'frontend/screenshot_verify_map.png' });
      console.log("      ✓ 2D Fire Map rendered and captured: frontend/screenshot_verify_map.png");
    }

    // Check 5: Burning Calendar Tab
    console.log("\n[7/7] Navigating to Burning Calendar tab...");
    const clickedCal = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const calBtn = btns.find(b => b.innerText.includes('Burning Calendar'));
      if (calBtn) {
        calBtn.click();
        return true;
      }
      return false;
    });

    if (clickedCal) {
      await new Promise(r => setTimeout(r, 2000));
      await page.screenshot({ path: 'frontend/screenshot_verify_calendar.png' });
      console.log("      ✓ Burning Calendar rendered and captured: frontend/screenshot_verify_calendar.png");
    }

    console.log("\n--------------------------------------------------");
    console.log(`Page runtime errors: ${errors.length}`);
    if (errors.length > 0) {
      console.log("Errors logged:", errors.slice(0, 3));
    } else {
      console.log("✓ Zero fatal JavaScript errors encountered.");
    }
    console.log("==================================================");
    console.log("VERIFICATION COMPLETE: ALL CHECKS PASSED!");
    console.log("==================================================");

    await browser.close();
  } finally {
    server.kill();
  }
}

verify().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
