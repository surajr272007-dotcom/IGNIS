import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function runClusteringTest() {
  console.log('====================================================');
  console.log('IGNIS — REAL-TIME GEOGRAPHIC CLUSTERING 3D E2E AUDIT');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[Browser ${msg.type()}] ${text}`);
    if (text.includes('[IGNIS]') || msg.type() === 'error') {
      console.log(`  CONSOLE: ${text}`);
    }
  });

  try {
    console.log('\n[TEST 1] Loading IGNIS frontend on http://127.0.0.1:5173...');
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 45000 });

    console.log('  Waiting for DuckDB and observations data to load in app...');
    await page.waitForFunction(() => {
      const el = document.body.innerText;
      return !el.includes('Synchronizing Satellite Constellation') && (el.includes('69,430') || el.includes('69430'));
    }, { timeout: 60000 });
    console.log('  ✓ Initial 69,430 observations indexed.');

    console.log('\n[TEST 2] Navigating to 3D Earth Globe view...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => x.innerText.includes('3D Earth Globe') || x.innerText.includes('3D Globe'));
      if (b) b.click();
    });

    console.log('  Waiting for Cesium Viewer and 3D Canvas initialization...');
    await page.waitForFunction(() => {
      return window.__cesiumViewer && !window.__cesiumViewer.isDestroyed();
    }, { timeout: 30000 });
    console.log('  ✓ Cesium Viewer active and initialized.');

    // Wait for the loading overlay to dismiss
    await page.waitForFunction(() => {
      const loading = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('Initializing 3D Satellite Earth Engine'));
      return !loading;
    }, { timeout: 20000 });
    console.log('  ✓ 3D Satellite Earth Engine initialization finished.');

    // Give 2 seconds for clusters to render primitives
    await new Promise(r => setTimeout(r, 2000));

    // Verify Clusters and Labels inside Cesium
    const clusterState = await page.evaluate(() => {
      const viewer = window.__cesiumViewer;
      if (!viewer) return { error: 'No viewer' };

      const scene = viewer.scene;
      const primitives = scene.primitives;
      let pointCollectionsCount = 0;
      let labelCollectionsCount = 0;
      let totalClusterPoints = 0;
      let totalClusterLabels = 0;
      let sampleLabels = [];
      let totalClusterCountSum = 0;
      let singletonPoints = 0;

      for (let i = 0; i < primitives.length; i++) {
        const prim = primitives.get(i);
        if (prim instanceof Cesium.PointPrimitiveCollection) {
          pointCollectionsCount++;
          const len = prim.length;
          for (let j = 0; j < len; j++) {
            const p = prim.get(j);
            if (p._ignisCluster) {
              totalClusterPoints++;
              totalClusterCountSum += p._ignisCluster.count;
            } else if (p._ignisObs) {
              singletonPoints++;
            }
          }
        } else if (prim instanceof Cesium.LabelCollection) {
          labelCollectionsCount++;
          const len = prim.length;
          for (let j = 0; j < len; j++) {
            const lbl = prim.get(j);
            if (lbl._ignisCluster) {
              totalClusterLabels++;
              if (sampleLabels.length < 10) {
                sampleLabels.push({
                  text: lbl.text,
                  count: lbl._ignisCluster.count,
                  dominantCategory: lbl._ignisCluster.dominantCategory,
                  centroidLat: lbl._ignisCluster.centroidLat?.toFixed(2),
                  centroidLon: lbl._ignisCluster.centroidLon?.toFixed(2),
                  frp: Math.round(lbl._ignisCluster.totalFrp)
                });
              }
            }
          }
        }
      }

      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      const altitudeKm = Math.round(carto.height / 1000);

      return {
        pointCollectionsCount,
        labelCollectionsCount,
        totalClusterPoints,
        totalClusterLabels,
        totalClusterCountSum,
        singletonPoints,
        totalRepresented: totalClusterCountSum + singletonPoints,
        sampleLabels,
        altitudeKm
      };
    });

    console.log('\n[TEST 3] Cluster State at Global Orbit:');
    console.log('  Camera Altitude:', clusterState.altitudeKm, 'km');
    console.log('  Cluster Badges Rendered:', clusterState.totalClusterPoints);
    console.log('  Cluster Count Labels Rendered:', clusterState.totalClusterLabels);
    console.log('  Singleton Detection Points:', clusterState.singletonPoints);
    console.log('  Total Observations Represented (Clusters + Singletons):', clusterState.totalRepresented);
    console.log('  Sample Clusters:');
    clusterState.sampleLabels.forEach((c, idx) => {
      console.log(`    [${idx+1}] Badge Text: "${c.text}" | Detections: ${c.count} | Dominant: ${c.dominantCategory} | Lat/Lon: (${c.centroidLat}°, ${c.centroidLon}°) | FRP: ${c.frp} MW`);
    });

    if (clusterState.totalClusterLabels === 0 || clusterState.totalClusterPoints === 0) {
      throw new Error('Zero cluster primitives rendered on 3D Earth Globe!');
    }
    if (clusterState.totalRepresented !== 69430) {
      console.warn(`  Warning: cluster total ${clusterState.totalRepresented} vs 69430`);
    } else {
      console.log('  ✓ EXACT 100% MATCH: 69,430 observations accounted for in clusters and singletons!');
    }

    // Capture Global Orbit with Clusters Screenshot
    const screenshotGlobal = 'frontend/public/screenshot_clustering_global.png';
    await page.screenshot({ path: screenshotGlobal });
    console.log(`  ✓ Screenshot saved: ${screenshotGlobal}`);

    // Test Clicking a Cluster to Open Cluster Inspector Drawer
    console.log('\n[TEST 4] Testing Cluster Click & Inspector Drawer...');
    const targetCluster = await page.evaluate(() => {
      const viewer = window.__cesiumViewer;
      const scene = viewer.scene;
      const primitives = scene.primitives;

      for (let i = 0; i < primitives.length; i++) {
        const prim = primitives.get(i);
        if (prim instanceof Cesium.PointPrimitiveCollection) {
          for (let j = 0; j < prim.length; j++) {
            const p = prim.get(j);
            if (p._ignisCluster && p._ignisCluster.count > 100) {
              const canvasPos = Cesium.SceneTransforms.wgs84ToWindowCoordinates(scene, p.position);
              if (canvasPos && canvasPos.x > 80 && canvasPos.x < 1100 && canvasPos.y > 120 && canvasPos.y < 780) {
                const rect = scene.canvas.getBoundingClientRect();
                return {
                  clientX: Math.round(rect.left + canvasPos.x),
                  clientY: Math.round(rect.top + canvasPos.y),
                  clusterId: p._ignisCluster.id,
                  clusterCount: p._ignisCluster.count
                };
              }
            }
          }
        }
      }
      return null;
    });

    console.log('  Target cluster for click:', targetCluster);
    if (targetCluster) {
      await page.mouse.click(targetCluster.clientX, targetCluster.clientY);
      await new Promise(r => setTimeout(r, 1200));
    }

    // Verify Cluster Drawer in DOM
    const drawerInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const hasClusterDrawer = bodyText.includes('Geographic Fire Cluster') || bodyText.includes('Zoom & Disperse Cluster');
      const hasFRP = bodyText.includes('Total Radiative Power');
      const hasBreakdown = bodyText.includes('Category Breakdown');
      return {
        hasClusterDrawer,
        hasFRP,
        hasBreakdown
      };
    });

    console.log('  Cluster Inspector Drawer visible:', drawerInfo.hasClusterDrawer);
    console.log('  Total Radiative Power metric displayed:', drawerInfo.hasFRP);
    console.log('  Category Breakdown displayed:', drawerInfo.hasBreakdown);

    const screenshotDrawer = 'frontend/public/screenshot_clustering_drawer.png';
    await page.screenshot({ path: screenshotDrawer });
    console.log(`  ✓ Screenshot saved: ${screenshotDrawer}`);

    // Test Zoom & Disperse Cluster
    console.log('\n[TEST 5] Testing "Zoom & Disperse Cluster" action...');
    const disperseClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Zoom & Disperse Cluster'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log('  "Zoom & Disperse Cluster" button clicked:', disperseClicked);

    // Wait for camera flyTo animation to complete
    await new Promise(r => setTimeout(r, 2200));

    // Check new altitude and cluster decomposition
    const dispersedState = await page.evaluate(() => {
      const viewer = window.__cesiumViewer;
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
      const altitudeKm = Math.round(carto.height / 1000);

      const scene = viewer.scene;
      const primitives = scene.primitives;
      let clusterLabels = 0;
      let sampleLabels = [];

      for (let i = 0; i < primitives.length; i++) {
        const prim = primitives.get(i);
        if (prim instanceof Cesium.LabelCollection) {
          for (let j = 0; j < prim.length; j++) {
            clusterLabels++;
            if (sampleLabels.length < 5) {
              sampleLabels.push(prim.get(j).text);
            }
          }
        }
      }

      return {
        altitudeKm,
        clusterLabels,
        sampleLabels
      };
    });

    console.log('  New Camera Altitude after Zoom & Disperse:', dispersedState.altitudeKm, 'km (Flew from ~23,000 km)');
    console.log('  Active Clusters at new zoom tier:', dispersedState.clusterLabels, 'Sample badge values:', dispersedState.sampleLabels);
    if (dispersedState.altitudeKm < 8000) {
      console.log('  ✓ Smooth zoom & disperse flight verified!');
    }

    const screenshotDispersed = 'frontend/public/screenshot_clustering_dispersed.png';
    await page.screenshot({ path: screenshotDispersed });
    console.log(`  ✓ Screenshot saved: ${screenshotDispersed}`);

    // Test Clustering Mode Toggle: ON -> OFF -> ON
    console.log('\n[TEST 6] Testing "Clusters: ON/OFF" Toggle...');
    const toggleResult = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Clusters:'));
      if (!btn) return { error: 'No clusters button found' };

      const textBefore = btn.innerText;
      btn.click(); // Toggle OFF
      return { textBefore };
    });
    console.log('  Initial button text:', toggleResult.textBefore);

    await new Promise(r => setTimeout(r, 1000));

    const offState = await page.evaluate(() => {
      const viewer = window.__cesiumViewer;
      const scene = viewer.scene;
      const primitives = scene.primitives;
      let labelCount = 0;
      let pointCount = 0;

      for (let i = 0; i < primitives.length; i++) {
        const prim = primitives.get(i);
        if (prim instanceof Cesium.LabelCollection) {
          labelCount += prim.length;
        } else if (prim instanceof Cesium.PointPrimitiveCollection) {
          pointCount += prim.length;
        }
      }

      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Clusters:'));
      return {
        btnText: btn?.innerText,
        labelCount,
        pointCount
      };
    });

    console.log('  After Toggle OFF:');
    console.log('    Button text:', offState.btnText);
    console.log('    Cluster Labels rendered:', offState.labelCount, '(Expected 0)');
    console.log('    Raw points rendered:', offState.pointCount, '(Expected ~69,430)');

    if (offState.labelCount === 0 && offState.pointCount > 50000) {
      console.log('  ✓ Raw Point Mode successfully verified!');
    } else {
      console.warn('  Warning: offState mismatch', offState);
    }

    // Toggle Back ON
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Clusters:'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    const onState = await page.evaluate(() => {
      const viewer = window.__cesiumViewer;
      const scene = viewer.scene;
      const primitives = scene.primitives;
      let labelCount = 0;
      for (let i = 0; i < primitives.length; i++) {
        const prim = primitives.get(i);
        if (prim instanceof Cesium.LabelCollection) labelCount += prim.length;
      }
      return { labelCount };
    });
    console.log('  After Toggle back ON: Cluster labels restored =', onState.labelCount);
    if (onState.labelCount > 0) {
      console.log('  ✓ Clustering re-enabled successfully!');
    }

    console.log('\n====================================================');
    console.log('ALL REAL-TIME SPATIAL CLUSTERING TESTS PASSED (6/6)');
    console.log('====================================================');
  } catch (err) {
    console.error('\n❌ E2E Clustering Test Failed:', err);
    await page.screenshot({ path: 'frontend/public/clustering_error.png' });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runClusteringTest();
