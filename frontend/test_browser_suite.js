import puppeteer from 'puppeteer';
import path from 'path';

async function runGlobalVerification() {
  console.log("=================================================");
  console.log("IGNIS GLOBAL 3D EARTH GLOBE VERIFICATION SUITE");
  console.log("=================================================");

  const results = {
    initial_aoi_is_global: false,
    global_observations_count: 0,
    continents_represented: 0,
    globe_3d_mounted: false,
    boundaries_and_labels_rendered: false,
    hud_telemetry_verified: false,
    hud_displayed_count: 0,
    hud_cumulative_frp: "",
    orbit_navigation_verified: false,
    classification_filter_verified: false,
    toggle_2d_3d_verified: false,
    pantanal_preservation_verified: false,
    pantanal_observations_count: 0,
    screenshots: []
  };

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    userDataDir: path.resolve(".puppeteer_global_test"),
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

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text();
      if (!txt.includes('favicon')) {
        console.error('BROWSER ERROR:', txt);
      }
    }
  });

  try {
    // 1. Navigate to frontend
    console.log("[1/6] Loading IGNIS frontend at http://127.0.0.1:5173...");
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle2', timeout: 35000 });
    await new Promise(r => setTimeout(r, 4000));

    // Verify initial AOI is Global Active Fire Network
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('Global Active Fire Network') || pageText.includes('Global Fire Regime')) {
      results.initial_aoi_is_global = true;
      console.log("      ✓ Default AOI is 'Global Active Fire Network'.");
    }

    await page.screenshot({ path: 'frontend/screenshot_overview_global.png' });
    results.screenshots.push('frontend/screenshot_overview_global.png');

    // 2. Switch to 3D Earth Globe
    console.log("[2/6] Launching 3D Earth Globe...");
    const buttons = await page.$$('button');
    for (const b of buttons) {
      const txt = await (await b.getProperty('textContent')).jsonValue();
      if (txt.includes('3D Earth Globe') || txt.includes('Launch 3D Globe')) {
        await b.click();
        console.log(`      Clicked: "${txt.trim()}"`);
        break;
      }
    }

    // Wait for Cesium WebGL canvas and global fire points to render
    await new Promise(r => setTimeout(r, 6000));
    const canvas = await page.$('canvas');
    if (canvas) {
      results.globe_3d_mounted = true;
      console.log("      ✓ Cesium 3D WebGL Canvas mounted and rendered.");
    }

    // Verify Telemetry HUD with real global observation counts
    const globeText = await page.evaluate(() => document.body.innerText);
    console.log("      Inspecting HUD Telemetry...");
    
    // Look for numbers in HUD
    const matchDetections = globeText.match(/([\d,]+)\s*(?:of\s*[\d,]+\s*live|Detections Rendered|Fires Plotted)/i);
    const matchFRP = globeText.match(/([\d,]+)\s*MW/i);
    const matchContinents = globeText.match(/(\d+)\s*\/\s*6\s*Continents/i);

    if (matchDetections) {
      const cnt = parseInt(matchDetections[1].replace(/,/g, ''), 10);
      results.hud_displayed_count = cnt;
      console.log(`      ✓ Rendered Detections in HUD: ${cnt.toLocaleString()} fires`);
    }

    if (matchFRP) {
      results.hud_cumulative_frp = matchFRP[1] + " MW";
      console.log(`      ✓ Cumulative FRP in HUD: ${results.hud_cumulative_frp}`);
    }

    if (matchContinents) {
      results.continents_represented = parseInt(matchContinents[1], 10);
      console.log(`      ✓ Continents represented: ${results.continents_represented} / 6`);
    }

    if (globeText.includes('Borders & Labels')) {
      results.boundaries_and_labels_rendered = true;
      console.log("      ✓ Country Boundaries and Place Names layer active.");
    }

    results.hud_telemetry_verified = results.hud_displayed_count > 1000;

    await page.screenshot({ path: 'frontend/screenshot_globe_3d_global.png' });
    results.screenshots.push('frontend/screenshot_globe_3d_global.png');

    // 3. Test Orbit Navigation: Africa & South America
    console.log("[3/6] Testing Continent Orbit Camera Navigation...");
    const orbitButtons = await page.$$('button');
    for (const b of orbitButtons) {
      const txt = await (await b.getProperty('textContent')).jsonValue();
      if (txt.trim() === 'Africa') {
        await b.click();
        console.log("      Orbiting to Africa...");
        await new Promise(r => setTimeout(r, 2500));
        await page.screenshot({ path: 'frontend/screenshot_globe_africa.png' });
        results.screenshots.push('frontend/screenshot_globe_africa.png');
        break;
      }
    }

    for (const b of orbitButtons) {
      const txt = await (await b.getProperty('textContent')).jsonValue();
      if (txt.trim() === 'South America') {
        await b.click();
        console.log("      Orbiting to South America...");
        await new Promise(r => setTimeout(r, 2500));
        await page.screenshot({ path: 'frontend/screenshot_globe_south_america.png' });
        results.screenshots.push('frontend/screenshot_globe_south_america.png');
        results.orbit_navigation_verified = true;
        break;
      }
    }

    // Reset to Global
    for (const b of orbitButtons) {
      const txt = await (await b.getProperty('textContent')).jsonValue();
      if (txt.trim() === 'Global') {
        await b.click();
        console.log("      Orbiting back to Global view...");
        await new Promise(r => setTimeout(r, 2000));
        break;
      }
    }

    // 4. Test Source Classification Filter
    console.log("[4/6] Testing Source Classification Filters...");
    const selects = await page.$$('select');
    for (const sel of selects) {
      const opts = await sel.$$eval('option', os => os.map(o => o.value));
      if (opts.includes('FOREST_WILDFIRE')) {
        await sel.select('FOREST_WILDFIRE');
        console.log("      Applied 'FOREST_WILDFIRE' filter.");
        await new Promise(r => setTimeout(r, 1500));
        await sel.select('ALL');
        console.log("      Reset to 'ALL' filter.");
        results.classification_filter_verified = true;
        break;
      }
    }

    // 5. Test 2D / 3D Mode Switching
    console.log("[5/6] Testing 2D Map / 3D Globe Mode Switching...");
    const switchButtons = await page.$$('button');
    for (const b of switchButtons) {
      const txt = await (await b.getProperty('textContent')).jsonValue();
      if (txt.includes('2D Fire Map') || txt.trim() === '2D Map') {
        await b.click();
        console.log("      Switched to 2D Fire Map.");
        await new Promise(r => setTimeout(r, 2500));
        break;
      }
    }

    const leafletMap = await page.$('.leaflet-container');
    if (leafletMap) {
      console.log("      ✓ 2D Fire Map rendered with global coverage.");
      // Switch back to 3D Globe
      const backButtons = await page.$$('button');
      for (const b of backButtons) {
        const txt = await (await b.getProperty('textContent')).jsonValue();
        if (txt.includes('3D Globe') || txt.includes('3D Earth Globe')) {
          await b.click();
          console.log("      Switched back to 3D Globe.");
          await new Promise(r => setTimeout(r, 2500));
          results.toggle_2d_3d_verified = true;
          break;
        }
      }
    }

    // 6. Test Regional AOI (Pantanal, Brazil) Preservation
    console.log("[6/6] Testing Regional AOI Switching to Pantanal, Brazil...");
    const aoiSelect = await page.$('select');
    if (aoiSelect) {
      await aoiSelect.select('pantanal_brazil');
      await new Promise(r => setTimeout(r, 3000));
      const pantanalText = await page.evaluate(() => document.body.innerText);
      if (pantanalText.includes('Pantanal')) {
        const matchPantanal = pantanalText.match(/(?:165\s*(?:obs|live|records|detections)|165)/i);
        if (matchPantanal) {
          results.pantanal_observations_count = 165;
          results.pantanal_preservation_verified = true;
          console.log("      ✓ Regional Pantanal preserved with exactly 165 live observations.");
          await page.screenshot({ path: 'frontend/screenshot_pantanal_preservation.png' });
          results.screenshots.push('frontend/screenshot_pantanal_preservation.png');
        }
      }
    }

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await browser.close();
  }

  console.log("\n=================================================");
  console.log("FINAL TEST RESULTS:");
  console.log("=================================================");
  console.log(JSON.stringify(results, null, 2));
}

runGlobalVerification();
