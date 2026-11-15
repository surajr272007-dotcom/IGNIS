import React, { useEffect, useRef, useState, useMemo } from 'react';
import { 
  Globe, 
  Layers, 
  RotateCcw, 
  MapPin, 
  Compass, 
  Flame, 
  Zap, 
  Sliders, 
  X, 
  Activity, 
  Calendar, 
  Clock, 
  Eye, 
  EyeOff, 
  Satellite, 
  ShieldCheck, 
  ZoomIn,
  ZoomOut,
  Plus,
  Minus,
  Navigation,
  Radio,
  AlertCircle,
  RefreshCw,
  Grid,
  Maximize2,
  GitMerge,
  CheckCircle2,
  Scale
} from 'lucide-react';
import { harmonizeObservations } from '../services/harmonizationEngine';

const CONTINENT_CENTERS = {
  ALL: { lon: 15, lat: 20, height: 23000000 },
  Africa: { lon: 20.0, lat: 5.0, height: 8500000 },
  'South America': { lon: -58.0, lat: -15.0, height: 7500000 },
  Oceania: { lon: 135.0, lat: -25.0, height: 7000000 },
  Asia: { lon: 95.0, lat: 30.0, height: 9000000 },
  'North America': { lon: -100.0, lat: 40.0, height: 8000000 },
  Europe: { lon: 15.0, lat: 50.0, height: 5000000 },
  Pantanal: { lon: -56.5, lat: -17.5, height: 950000 }
};

// Spatial Zoom Tiers for Dynamic Real-Time Geographic Clustering
const ZOOM_TIERS = [
  { maxAltKm: Infinity, minAltKm: 14000, gridDeg: 10.0, name: 'Global Orbit' },
  { maxAltKm: 14000, minAltKm: 7500, gridDeg: 5.0, name: 'Hemispheric' },
  { maxAltKm: 7500, minAltKm: 3200, gridDeg: 2.5, name: 'Continental' },
  { maxAltKm: 3200, minAltKm: 1200, gridDeg: 1.2, name: 'Sub-Continental' },
  { maxAltKm: 1200, minAltKm: 450, gridDeg: 0.6, name: 'Regional' },
  { maxAltKm: 450, minAltKm: 160, gridDeg: 0.25, name: 'Local Basin' },
  { maxAltKm: 160, minAltKm: 0, gridDeg: 0.0, name: 'Individual Detections' },
];

function getZoomTier(altKm) {
  for (let i = 0; i < ZOOM_TIERS.length; i++) {
    if (altKm >= ZOOM_TIERS[i].minAltKm && altKm < ZOOM_TIERS[i].maxAltKm) {
      return ZOOM_TIERS[i];
    }
  }
  return ZOOM_TIERS[0];
}

// Hierarchical Spatial Hash Clustering Algorithm (O(N) performance on 69k+ observations)
function computeSpatialClusters(observations, gridDeg) {
  if (gridDeg <= 0) {
    return {
      clusters: [],
      singletons: observations,
      clusterCount: 0,
      singletonCount: observations.length,
      totalCount: observations.length
    };
  }

  const map = new Map();
  const invGrid = 1.0 / gridDeg;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    const lat = obs.latitude;
    const lon = obs.longitude;
    if (lat === undefined || lon === undefined) continue;

    const gy = Math.floor((lat + 90) * invGrid);
    const gx = Math.floor((lon + 180) * invGrid);
    const cellKey = gy * 10000 + gx;

    let c = map.get(cellKey);
    const frpVal = obs.frp || 1.0;
    const weight = Math.max(1, frpVal);

    if (!c) {
      c = {
        id: `c_${cellKey}`,
        count: 0,
        totalFrp: 0,
        maxFrp: 0,
        wLatSum: 0,
        wLonSum: 0,
        weightSum: 0,
        minLat: lat,
        maxLat: lat,
        minLon: lon,
        maxLon: lon,
        categories: { FOREST_WILDFIRE: 0, AGRICULTURAL_BURNING: 0, INDUSTRIAL_HEAT: 0, UNKNOWN: 0 },
        sensors: { MODIS: 0, VIIRS: 0 },
        firstObs: obs,
        sampleDetections: []
      };
      map.set(cellKey, c);
    }

    c.count++;
    c.totalFrp += frpVal;
    if (frpVal > c.maxFrp) c.maxFrp = frpVal;
    c.wLatSum += lat * weight;
    c.wLonSum += lon * weight;
    c.weightSum += weight;

    if (lat < c.minLat) c.minLat = lat;
    if (lat > c.maxLat) c.maxLat = lat;
    if (lon < c.minLon) c.minLon = lon;
    if (lon > c.maxLon) c.maxLon = lon;

    const cat = obs.classification_code || 'UNKNOWN';
    if (c.categories[cat] !== undefined) {
      c.categories[cat]++;
    } else {
      c.categories.UNKNOWN++;
    }

    const sensorUpper = (obs.sensor || obs.instrument || '').toUpperCase();
    if (sensorUpper.includes('MODIS')) {
      c.sensors.MODIS++;
    } else {
      c.sensors.VIIRS++;
    }

    if (c.sampleDetections.length < 5) {
      c.sampleDetections.push(obs);
    }
  }

  const clusters = [];
  const singletons = [];

  for (const c of map.values()) {
    if (c.count > 1) {
      c.centroidLat = c.wLatSum / c.weightSum;
      c.centroidLon = c.wLonSum / c.weightSum;

      let dominantCategory = 'UNKNOWN';
      let maxCatCount = -1;
      for (const [cat, cnt] of Object.entries(c.categories)) {
        if (cnt > maxCatCount) {
          maxCatCount = cnt;
          dominantCategory = cat;
        }
      }
      c.dominantCategory = dominantCategory;
      clusters.push(c);
    } else {
      singletons.push(c.firstObs);
    }
  }

  return {
    clusters,
    singletons,
    clusterCount: clusters.length,
    singletonCount: singletons.length,
    totalCount: observations.length
  };
}

// Spatial Hash Clustering for Harmonized Fire Events (HFEs)
function computeHarmonizedClusters(events, gridDeg) {
  if (gridDeg <= 0) {
    return {
      clusters: [],
      singletons: events,
      clusterCount: 0,
      singletonCount: events.length,
      totalCount: events.length
    };
  }

  const map = new Map();
  const invGrid = 1.0 / gridDeg;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const lat = ev.latitude;
    const lon = ev.longitude;
    if (lat === undefined || lon === undefined) continue;

    const gy = Math.floor((lat + 90) * invGrid);
    const gx = Math.floor((lon + 180) * invGrid);
    const cellKey = gy * 10000 + gx;

    let c = map.get(cellKey);
    const frpVal = ev.total_frp || ev.peak_frp || 1.0;
    const weight = Math.max(1, frpVal);

    if (!c) {
      c = {
        id: `hc_${cellKey}`,
        count: 0,
        totalFrp: 0,
        maxFrp: 0,
        wLatSum: 0,
        wLonSum: 0,
        weightSum: 0,
        minLat: lat,
        maxLat: lat,
        minLon: lon,
        maxLon: lon,
        coincidentCount: 0,
        viirsOnlyCount: 0,
        modisOnlyCount: 0,
        firstEvent: ev,
        sampleEvents: []
      };
      map.set(cellKey, c);
    }

    c.count++;
    c.totalFrp += frpVal;
    if (frpVal > c.maxFrp) c.maxFrp = frpVal;
    c.wLatSum += lat * weight;
    c.wLonSum += lon * weight;
    c.weightSum += weight;

    if (lat < c.minLat) c.minLat = lat;
    if (lat > c.maxLat) c.maxLat = lat;
    if (lon < c.minLon) c.minLon = lon;
    if (lon > c.maxLon) c.maxLon = lon;

    if (ev.harmonization_type === 'DUAL_SENSOR_COINCIDENT') {
      c.coincidentCount++;
    } else if (ev.harmonization_type === 'VIIRS_ONLY') {
      c.viirsOnlyCount++;
    } else {
      c.modisOnlyCount++;
    }

    if (c.sampleEvents.length < 5) {
      c.sampleEvents.push(ev);
    }
  }

  const clusters = [];
  const singletons = [];

  for (const c of map.values()) {
    if (c.count > 1) {
      c.centroidLat = c.wLatSum / c.weightSum;
      c.centroidLon = c.wLonSum / c.weightSum;
      clusters.push(c);
    } else {
      singletons.push(c.firstEvent);
    }
  }

  return {
    clusters,
    singletons,
    clusterCount: clusters.length,
    singletonCount: singletons.length,
    totalCount: events.length
  };
}

export default function EarthGlobe3D({
  observations = [],
  sampleEvents = [],
  classificationSummary = null,
  loading = false,
  isLive = true,
  onSwitchTo2D = () => {},
  selectedAoiId = "global",
  onSelectAoi = () => {},
  aoiMetadata = null,
  totalAvailable = 69430
}) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const pointCollectionsRef = useRef([]);
  const labelCollectionsRef = useRef([]);
  const boundaryLayerRef = useRef(null);

  // Robust Initialization State Machine
  const [initStatus, setInitStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [initStep, setInitStep] = useState('Verifying 3D graphics hardware and Cesium engine...');
  const [initError, setInitError] = useState(null);
  const [errorCategory, setErrorCategory] = useState(null); // 'cdn' | 'webgl' | 'imagery' | 'general'
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [activeBasemap, setActiveBasemap] = useState('Esri World Imagery');
  const [boundaryStatus, setBoundaryStatus] = useState('loading'); // 'loading' | 'active' | 'unavailable'

  const [cesiumLoaded, setCesiumLoaded] = useState(false);
  const [selectedObs, setSelectedObs] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [selectedHarmonizedEvent, setSelectedHarmonizedEvent] = useState(null);
  const [globeViewMode, setGlobeViewMode] = useState('HARMONIZED'); // 'HARMONIZED' | 'RAW'
  const [spatialThresholdKm, setSpatialThresholdKm] = useState(1.5);
  const [temporalThresholdHours, setTemporalThresholdHours] = useState(2.5);
  const [enableClustering, setEnableClustering] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [cameraAltitudeKm, setCameraAltitudeKm] = useState(23000);
  const [activeZoomTier, setActiveZoomTier] = useState(() => getZoomTier(23000));

  // Filters state
  const [sensorFilter, setSensorFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [continentFilter, setContinentFilter] = useState('ALL');
  const [minFRP, setMinFRP] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0);
  const [activeOrbit, setActiveOrbit] = useState('ALL');

  // Update zoom tier on altitude change (tier boundaries define clustering scale)
  useEffect(() => {
    const newTier = getZoomTier(cameraAltitudeKm);
    if (newTier.name !== activeZoomTier.name) {
      setActiveZoomTier(newTier);
    }
  }, [cameraAltitudeKm, activeZoomTier.name]);

  // Fast WebGL hardware check
  const verifyWebGL = () => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!(gl && gl instanceof WebGLRenderingContext);
    } catch (e) {
      return false;
    }
  };

  // 1. Verify Cesium CDN is ready with hardware check and strict 10s timeout
  useEffect(() => {
    let cancelled = false;
    setInitStatus('loading');
    setInitError(null);
    setErrorCategory(null);
    setInitStep('Checking CesiumJS 3D engine availability...');

    // WebGL Hardware Verification
    if (!verifyWebGL()) {
      setInitStatus('error');
      setErrorCategory('webgl');
      setInitError('WebGL graphics acceleration is disabled or unsupported in this browser. Please enable hardware acceleration in browser settings.');
      return;
    }

    if (window.Cesium) {
      setInitStep('CesiumJS ready. Initializing WebGL globe...');
      setCesiumLoaded(true);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      if (cancelled) return;

      if (window.Cesium) {
        clearInterval(interval);
        setInitStep('CesiumJS loaded. Initializing WebGL globe...');
        setCesiumLoaded(true);
      } else if (Date.now() - startTime > 10000) {
        clearInterval(interval);
        setInitStatus('error');
        setErrorCategory('cdn');
        setInitError('CesiumJS 3D graphics library could not be downloaded from CDN within 10 seconds. Check network connectivity or ad-blockers.');
      }
    }, 150);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [retryTrigger]);

  // 2. Initialize Cesium 3D Globe with Resilient Basemap & Non-Blocking Boundaries
  useEffect(() => {
    if (!cesiumLoaded || !containerRef.current || viewerRef.current) return;

    const Cesium = window.Cesium;
    if (!Cesium) return;

    // Clean any residual DOM elements from previous viewer to avoid WebGL context collisions
    try {
      containerRef.current.innerHTML = '';
    } catch (e) {}

    setInitStep('Setting up Esri World Imagery satellite basemap...');

    // Primary Esri Satellite Imagery Provider with fallback
    let primaryImagery = null;
    let basemapName = 'Esri World Imagery';
    try {
      primaryImagery = new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri, Maxar, Earthstar Geographics'
      });
    } catch (imageryErr) {
      console.warn("[IGNIS] Primary Esri imagery creation failed; using CartoDB dark fallback:", imageryErr);
      primaryImagery = new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
        credit: 'CartoDB Dark Basemap'
      });
      basemapName = 'CartoDB Dark (Fallback)';
    }
    setActiveBasemap(basemapName);

    let viewer = null;
    try {
      viewer = new Cesium.Viewer(containerRef.current, {
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        scene3DOnly: true,
        shouldAnimate: false,
        baseLayer: new Cesium.ImageryLayer(primaryImagery)
      });
    } catch (viewerErr) {
      console.error("[IGNIS] Primary Cesium.Viewer initialization failed:", viewerErr);
      // Attempt safe recovery without external baseLayer (offline textured ellipsoid)
      try {
        console.warn("[IGNIS] Initializing safe-mode offline ellipsoid viewer...");
        viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
          scene3DOnly: true,
          shouldAnimate: false,
          baseLayer: false
        });
        setActiveBasemap('Offline Earth Ellipsoid (Safe Mode)');
      } catch (safeErr) {
        setInitStatus('error');
        setErrorCategory('webgl');
        setInitError(`Cesium WebGL Engine initialization failed: ${viewerErr.message || 'Unable to create WebGL context'}`);
        return;
      }
    }

    // Reference Layer: Country boundaries, country labels, continent names, and cities
    // Completely non-blocking: errors or tile timeouts never prevent globe rendering
    setInitStep('Mounting geopolitical reference boundaries & country labels...');
    try {
      const boundaryProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri Reference Labels & Boundaries'
      });
      boundaryProvider.errorEvent.addEventListener((bErr) => {
        console.warn("[IGNIS] Optional country boundary tile error (globe continues):", bErr);
        setBoundaryStatus('unavailable');
      });
      const boundaryLayer = viewer.imageryLayers.addImageryProvider(boundaryProvider);
      boundaryLayer.alpha = 0.95;
      boundaryLayer.show = showBoundaries;
      boundaryLayerRef.current = boundaryLayer;
      setBoundaryStatus('active');
    } catch (e) {
      console.warn("[IGNIS] Could not load optional boundary layer (globe continues):", e);
      setBoundaryStatus('unavailable');
    }

    // Atmospheric & deep-space styling
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#070A0F');
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#070A0F');
    viewer.scene.globe.enableLighting = false;

    // Configure ScreenSpaceCameraController for smooth, bounded, reliable zooming & navigation
    const controller = viewer.scene.screenSpaceCameraController;
    controller.enableZoom = true;
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableTilt = true;
    controller.enableLook = true;
    controller.enableCollisionDetection = true;
    controller.inertiaZoom = 0.05;
    controller.inertiaTranslate = 0.05;
    controller.inertiaSpin = 0.05;

    // Configure mouse and touch gesture event mappings
    // Mouse scroll wheel is handled with precision by container wheel listener to guarantee
    // smooth, altitude-scaled, bounded zooming without Cesium nadir collinearity gimbal locks.
    controller.zoomEventTypes = [
      Cesium.CameraEventType.PINCH,
      Cesium.CameraEventType.RIGHT_DRAG
    ];
    controller.rotateEventTypes = [
      Cesium.CameraEventType.LEFT_DRAG
    ];
    controller.tiltEventTypes = [
      Cesium.CameraEventType.RIGHT_DRAG,
      Cesium.CameraEventType.MIDDLE_DRAG,
      {
        eventType: Cesium.CameraEventType.LEFT_DRAG,
        modifier: Cesium.KeyboardEventModifier.CTRL
      }
    ];

    // Initial camera position (Global Earth overview)
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(15, 20, 23000000)
    });

    // Real-time camera altitude tracker on postRender (updates every frame during camera motion)
    const onCameraPostRender = () => {
      if (viewer && !viewer.isDestroyed() && window.Cesium && viewer.camera) {
        try {
          const carto = window.Cesium.Cartographic.fromCartesian(viewer.camera.position);
          if (carto && typeof carto.height === 'number' && !isNaN(carto.height)) {
            setCameraAltitudeKm(Math.max(1, Math.round(carto.height / 1000)));
          }
        } catch (e) {}
      }
    };
    viewer.scene.postRender.addEventListener(onCameraPostRender);

    // Interactive ScreenSpaceEventHandler for point & cluster selection
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const pickedObject = viewer.scene.pick(movement.position);
      if (Cesium.defined(pickedObject) && pickedObject.primitive) {
        if (pickedObject.primitive._ignisCluster) {
          setSelectedCluster(pickedObject.primitive._ignisCluster);
          setSelectedHarmonizedEvent(null);
          setSelectedObs(null);
          return;
        }
        if (pickedObject.primitive._ignisHarmonizedEvent) {
          setSelectedHarmonizedEvent(pickedObject.primitive._ignisHarmonizedEvent);
          setSelectedCluster(null);
          setSelectedObs(null);
          return;
        }
        if (pickedObject.primitive._ignisObs) {
          setSelectedObs(pickedObject.primitive._ignisObs);
          setSelectedCluster(null);
          setSelectedHarmonizedEvent(null);
          return;
        }
      }
      setSelectedObs(null);
      setSelectedCluster(null);
      setSelectedHarmonizedEvent(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewerRef.current = viewer;
    window.__cesiumViewer = viewer;

    // Initialization complete! Dismiss loading overlay
    setInitStatus('ready');

    return () => {
      handler.destroy();
      if (viewer && !viewer.isDestroyed()) {
        try {
          viewer.scene.postRender.removeEventListener(onCameraPostRender);
        } catch (e) {}
        viewer.destroy();
      }
      viewerRef.current = null;
      window.__cesiumViewer = null;
      if (pointCollectionsRef.current) {
        pointCollectionsRef.current.forEach(col => {
          try { viewer.scene.primitives.remove(col); } catch (e) {}
        });
        pointCollectionsRef.current = [];
      }
      if (labelCollectionsRef.current) {
        labelCollectionsRef.current.forEach(col => {
          try { viewer.scene.primitives.remove(col); } catch (e) {}
        });
        labelCollectionsRef.current = [];
      }
      boundaryLayerRef.current = null;
    };
  }, [cesiumLoaded, retryTrigger]);

  // Toggle visible country boundaries & place names
  useEffect(() => {
    if (boundaryLayerRef.current) {
      boundaryLayerRef.current.show = showBoundaries;
      if (viewerRef.current) {
        viewerRef.current.scene.requestRender();
      }
    }
  }, [showBoundaries]);

  // Filter observations based on user controls
  const filteredObservations = useMemo(() => {
    return observations.filter((obs) => {
      if (sensorFilter !== 'ALL' && obs.sensor !== sensorFilter) return false;
      if (categoryFilter !== 'ALL') {
        const cat = obs.classification_code || obs.probable_source || 'UNKNOWN';
        if (cat !== categoryFilter) return false;
      }
      if (continentFilter !== 'ALL' && obs.continent !== continentFilter) return false;
      if (minFRP > 0 && (obs.frp || 0) < minFRP) return false;
      if (minConfidence > 0 && (obs.confidence_numeric || 50) < minConfidence) return false;
      return true;
    });
  }, [observations, sensorFilter, categoryFilter, continentFilter, minFRP, minConfidence]);

  // Live Statistics calculation directly from active dataset
  const liveStats = useMemo(() => {
    let modis = 0;
    let viirs = 0;
    let totalFrp = 0;
    const continents = new Set();
    const dates = new Set();

    for (let i = 0; i < filteredObservations.length; i++) {
      const o = filteredObservations[i];
      const s = (o.sensor || o.instrument || '').toUpperCase();
      if (s.includes('MODIS')) modis++;
      else if (s.includes('VIIRS')) viirs++;
      totalFrp += (o.frp || 0);
      if (o.continent) continents.add(o.continent);
      if (o.acq_date) dates.add(o.acq_date);
    }

    const sortedDates = Array.from(dates).sort();
    const dateRangeStr = sortedDates.length > 1
      ? `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`
      : (sortedDates[0] || '2026-11-14');

    return {
      displayedCount: filteredObservations.length,
      totalCount: observations.length,
      totalFrp: Math.round(totalFrp),
      continentCount: continents.size,
      modisCount: modis,
      viirsCount: viirs,
      dateRange: dateRangeStr
    };
  }, [filteredObservations, observations]);

  // Client-side Spatiotemporal Harmonization of active filtered observations
  const harmonizedDataset = useMemo(() => {
    return harmonizeObservations(filteredObservations, spatialThresholdKm, temporalThresholdHours);
  }, [filteredObservations, spatialThresholdKm, temporalThresholdHours]);

  // Dynamic Spatial Clustering of Harmonized Fire Events
  const harmonizedClusters = useMemo(() => {
    if (!enableClustering) {
      return {
        clusters: [],
        singletons: harmonizedDataset.events,
        clusterCount: 0,
        singletonCount: harmonizedDataset.events.length,
        totalCount: harmonizedDataset.events.length
      };
    }
    return computeHarmonizedClusters(harmonizedDataset.events, activeZoomTier.gridDeg);
  }, [harmonizedDataset.events, enableClustering, activeZoomTier.gridDeg]);

  // Dynamic Spatial Clustering memoized based on active zoom tier, filter state, and clustering toggle
  const spatialClusters = useMemo(() => {
    if (!enableClustering) {
      return {
        clusters: [],
        singletons: filteredObservations,
        clusterCount: 0,
        singletonCount: filteredObservations.length,
        totalCount: filteredObservations.length
      };
    }
    return computeSpatialClusters(filteredObservations, activeZoomTier.gridDeg);
  }, [filteredObservations, enableClustering, activeZoomTier.gridDeg]);

  // Render fire markers into Cesium PointPrimitiveCollection and LabelCollection instances
  useEffect(() => {
    if (!viewerRef.current || viewerRef.current.isDestroyed() || !cesiumLoaded) return;
    const Cesium = window.Cesium;
    const scene = viewerRef.current.scene;

    // Clear previous point collections
    if (pointCollectionsRef.current && pointCollectionsRef.current.length > 0) {
      pointCollectionsRef.current.forEach((col) => {
        try {
          scene.primitives.remove(col);
        } catch (e) {}
      });
      pointCollectionsRef.current = [];
    }

    // Clear previous label collections
    if (labelCollectionsRef.current && labelCollectionsRef.current.length > 0) {
      labelCollectionsRef.current.forEach((col) => {
        try {
          scene.primitives.remove(col);
        } catch (e) {}
      });
      labelCollectionsRef.current = [];
    }

    const outlineColor = Cesium.Color.fromCssColorString('#070A0F');
    const CHUNK_SIZE = 35000;

    if (globeViewMode === 'HARMONIZED') {
      // HARMONIZED EVENTS MODE: MODIS-VIIRS Spatiotemporal Matching
      const coincidentColor = Cesium.Color.fromCssColorString('#06B6D4'); // Cyan
      const coincidentGlow = Cesium.Color.fromCssColorString('#22D3EE');  // Bright Cyan Glow
      const viirsOnlyColor = Cesium.Color.fromCssColorString('#F59E0B');  // Amber
      const modisOnlyColor = Cesium.Color.fromCssColorString('#EF4444');  // Crimson

      if (enableClustering && activeZoomTier.gridDeg > 0) {
        // 1. Render Harmonized Clusters (circles + centered count labels)
        const clusters = harmonizedClusters.clusters;
        for (let c = 0; c < clusters.length; c += CHUNK_SIZE) {
          const pointCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
          const labelCol = scene.primitives.add(new Cesium.LabelCollection());
          pointCollectionsRef.current.push(pointCol);
          labelCollectionsRef.current.push(labelCol);

          const end = Math.min(c + CHUNK_SIZE, clusters.length);
          for (let i = c; i < end; i++) {
            const cluster = clusters[i];
            const pos = Cesium.Cartesian3.fromDegrees(cluster.centroidLon, cluster.centroidLat, 150);
            const badgeSize = Math.min(54, Math.max(26, Math.round(24 + Math.log10(cluster.count) * 8)));

            const hasCoincident = cluster.coincidentCount > 0;
            const clusterColor = hasCoincident ? coincidentColor : (cluster.viirsOnlyCount > 0 ? viirsOnlyColor : modisOnlyColor);
            const clusterOutline = hasCoincident ? coincidentGlow : outlineColor;

            const p = pointCol.add({
              position: pos,
              color: clusterColor,
              pixelSize: badgeSize,
              outlineColor: clusterOutline,
              outlineWidth: hasCoincident ? 3.0 : 2.0,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.15, 2.5e7, 0.75)
            });
            p._ignisCluster = cluster;

            const labelText = cluster.count >= 1000
              ? `${(cluster.count / 1000).toFixed(1)}k`
              : cluster.count.toString();

            const lbl = labelCol.add({
              position: pos,
              text: labelText,
              font: cluster.count >= 1000 ? 'bold 11px monospace' : 'bold 12px monospace',
              fillColor: Cesium.Color.WHITE,
              outlineColor: outlineColor,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.15, 2.5e7, 0.75)
            });
            lbl._ignisCluster = cluster;
          }
        }

        // 2. Render Singletons
        const singletons = harmonizedClusters.singletons;
        for (let c = 0; c < singletons.length; c += CHUNK_SIZE) {
          const pointCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
          pointCollectionsRef.current.push(pointCol);

          const end = Math.min(c + CHUNK_SIZE, singletons.length);
          for (let i = c; i < end; i++) {
            const ev = singletons[i];
            const lat = ev.latitude;
            const lon = ev.longitude;
            if (lat === undefined || lon === undefined) continue;

            const isCoincident = ev.harmonization_type === 'DUAL_SENSOR_COINCIDENT';
            const isViirsOnly = ev.harmonization_type === 'VIIRS_ONLY';
            const color = isCoincident ? coincidentColor : (isViirsOnly ? viirsOnlyColor : modisOnlyColor);
            const ringColor = isCoincident ? coincidentGlow : outlineColor;
            const size = isCoincident ? 13 : (isViirsOnly ? 8 : 11);

            const p = pointCol.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 120),
              color: color,
              pixelSize: size,
              outlineColor: ringColor,
              outlineWidth: isCoincident ? 2.5 : 1.5,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.2, 2.5e7, 0.45)
            });
            p._ignisHarmonizedEvent = ev;
          }
        }
      } else {
        // Raw Harmonized Events (Max zoom or clustering disabled)
        const events = harmonizedDataset.events;
        for (let c = 0; c < events.length; c += CHUNK_SIZE) {
          const pointCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
          pointCollectionsRef.current.push(pointCol);

          const end = Math.min(c + CHUNK_SIZE, events.length);
          for (let i = c; i < end; i++) {
            const ev = events[i];
            const lat = ev.latitude;
            const lon = ev.longitude;
            if (lat === undefined || lon === undefined) continue;

            const isCoincident = ev.harmonization_type === 'DUAL_SENSOR_COINCIDENT';
            const isViirsOnly = ev.harmonization_type === 'VIIRS_ONLY';
            const color = isCoincident ? coincidentColor : (isViirsOnly ? viirsOnlyColor : modisOnlyColor);
            const ringColor = isCoincident ? coincidentGlow : outlineColor;
            const size = isCoincident ? 14 : (isViirsOnly ? 9 : 12);

            const p = pointCol.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 120),
              color: color,
              pixelSize: size,
              outlineColor: ringColor,
              outlineWidth: isCoincident ? 2.5 : 1.5,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.2, 2.5e7, 0.45)
            });
            p._ignisHarmonizedEvent = ev;
          }
        }
      }
    } else {
      // RAW MODE: Original Satellite Observations
      const colorMap = {
        FOREST_WILDFIRE: Cesium.Color.fromCssColorString('#EF4444'),     // Deep Crimson Red
        AGRICULTURAL_BURNING: Cesium.Color.fromCssColorString('#F59E0B'),// Warm Amber / Crop Orange
        INDUSTRIAL_HEAT: Cesium.Color.fromCssColorString('#A855F7'),     // Electric Violet
        UNKNOWN: Cesium.Color.fromCssColorString('#94A3B8')              // Neutral Slate
      };

      if (enableClustering && activeZoomTier.gridDeg > 0) {
        // 1. Render Clusters (circles + centered count labels)
        const clusters = spatialClusters.clusters;
        for (let c = 0; c < clusters.length; c += CHUNK_SIZE) {
          const pointCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
          const labelCol = scene.primitives.add(new Cesium.LabelCollection());
          pointCollectionsRef.current.push(pointCol);
          labelCollectionsRef.current.push(labelCol);

          const end = Math.min(c + CHUNK_SIZE, clusters.length);
          for (let i = c; i < end; i++) {
            const cluster = clusters[i];
            const pos = Cesium.Cartesian3.fromDegrees(cluster.centroidLon, cluster.centroidLat, 150);
            const badgeSize = Math.min(54, Math.max(26, Math.round(24 + Math.log10(cluster.count) * 8)));
            const baseColor = colorMap[cluster.dominantCategory] || colorMap.FOREST_WILDFIRE;

            const p = pointCol.add({
              position: pos,
              color: baseColor,
              pixelSize: badgeSize,
              outlineColor: outlineColor,
              outlineWidth: 2.5,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.15, 2.5e7, 0.75)
            });
            p._ignisCluster = cluster;

            const labelText = cluster.count >= 1000
              ? `${(cluster.count / 1000).toFixed(1)}k`
              : cluster.count.toString();

            const lbl = labelCol.add({
              position: pos,
              text: labelText,
              font: cluster.count >= 1000 ? 'bold 11px monospace' : 'bold 12px monospace',
              fillColor: Cesium.Color.WHITE,
              outlineColor: outlineColor,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.15, 2.5e7, 0.75)
            });
            lbl._ignisCluster = cluster;
          }
        }

        // 2. Render Singletons (individual points without labels)
        const singletons = spatialClusters.singletons;
        for (let c = 0; c < singletons.length; c += CHUNK_SIZE) {
          const pointCol = scene.primitives.add(new Cesium.PointPrimitiveCollection());
          pointCollectionsRef.current.push(pointCol);

          const end = Math.min(c + CHUNK_SIZE, singletons.length);
          for (let i = c; i < end; i++) {
            const obs = singletons[i];
            const lat = obs.latitude;
            const lon = obs.longitude;
            if (lat === undefined || lon === undefined) continue;

            const code = obs.classification_code || 'UNKNOWN';
            const baseColor = colorMap[code] || colorMap.UNKNOWN;
            const frpVal = obs.frp || 1.0;
            const size = Math.max(5, Math.min(14, 5 + Math.log10(Math.max(1, frpVal)) * 3.5));

            const p = pointCol.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 100),
              color: baseColor,
              pixelSize: size,
              outlineColor: outlineColor,
              outlineWidth: 1.5,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.2, 2.5e7, 0.45)
            });
            p._ignisObs = obs;
          }
        }
      } else {
        // Raw Mode / Max Zoom: Render individual observations
        const total = filteredObservations.length;
        for (let c = 0; c < total; c += CHUNK_SIZE) {
          const col = scene.primitives.add(new Cesium.PointPrimitiveCollection());
          pointCollectionsRef.current.push(col);

          const end = Math.min(c + CHUNK_SIZE, total);
          for (let i = c; i < end; i++) {
            const obs = filteredObservations[i];
            const lat = obs.latitude;
            const lon = obs.longitude;
            if (lat === undefined || lon === undefined) continue;

            const code = obs.classification_code || 'UNKNOWN';
            const baseColor = colorMap[code] || colorMap.UNKNOWN;
            const frpVal = obs.frp || 1.0;
            const size = Math.max(5, Math.min(16, 5 + Math.log10(Math.max(1, frpVal)) * 3.8));

            const p = col.add({
              position: Cesium.Cartesian3.fromDegrees(lon, lat, 100),
              color: baseColor,
              pixelSize: size,
              outlineColor: outlineColor,
              outlineWidth: 1.5,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.2, 2.5e7, 0.45)
            });
            p._ignisObs = obs;
          }
        }
      }
    }

    scene.requestRender();
  }, [filteredObservations, spatialClusters, harmonizedDataset, harmonizedClusters, globeViewMode, enableClustering, activeZoomTier, cesiumLoaded, initStatus]);

  // Smoothly zoom in to a cluster to disperse it into child clusters or individual points
  const handleZoomToCluster = (cluster) => {
    if (!viewerRef.current || !window.Cesium || !cluster) return;
    const Cesium = window.Cesium;
    const spanLat = Math.max(0.12, (cluster.maxLat - cluster.minLat) * 1.5);
    const spanLon = Math.max(0.12, (cluster.maxLon - cluster.minLon) * 1.5);
    const spanDeg = Math.max(spanLat, spanLon);
    const targetHeight = Math.min(
      6000000,
      Math.max(90000, spanDeg * 111000 * 1.4)
    );

    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(cluster.centroidLon, cluster.centroidLat, targetHeight),
      duration: 1.4
    });
  };

  // Retry initialization on user action
  const handleRetryInit = () => {
    setInitStatus('loading');
    setInitError(null);
    setErrorCategory(null);
    setCesiumLoaded(false);
    if (viewerRef.current && !viewerRef.current.isDestroyed()) {
      try { viewerRef.current.destroy(); } catch (e) {}
    }
    viewerRef.current = null;
    window.__cesiumViewer = null;
    setRetryTrigger(prev => prev + 1);
  };

  // Handle Continent Navigation & Dataset Switching
  const handleOrbitSelect = (target) => {
    setActiveOrbit(target);

    if (target === 'ALL') {
      setContinentFilter('ALL');
      if (selectedAoiId !== 'global') {
        onSelectAoi('global');
      }
    } else if (target === 'Pantanal') {
      setContinentFilter('ALL');
      onSelectAoi('pantanal_brazil');
    } else {
      // Continent selection
      setContinentFilter(target);
      if (selectedAoiId !== 'global') {
        onSelectAoi('global');
      }
    }

    // Smoothly fly camera to continent center
    if (viewerRef.current && window.Cesium) {
      const dest = CONTINENT_CENTERS[target] || CONTINENT_CENTERS.ALL;
      viewerRef.current.camera.flyTo({
        destination: window.Cesium.Cartesian3.fromDegrees(dest.lon, dest.lat, dest.height),
        duration: 1.8
      });
    }
  };

  // Fly directly to selected fire observation
  const handleFlyToObservation = (obs) => {
    if (!viewerRef.current || !window.Cesium || !obs) return;
    viewerRef.current.camera.flyTo({
      destination: window.Cesium.Cartesian3.fromDegrees(obs.longitude, obs.latitude, 60000),
      duration: 1.5
    });
  };

  // Fly directly to selected harmonized fire event
  const handleFlyToHarmonizedEvent = (ev) => {
    if (!viewerRef.current || !window.Cesium || !ev) return;
    viewerRef.current.camera.flyTo({
      destination: window.Cesium.Cartesian3.fromDegrees(ev.longitude, ev.latitude, 60000),
      duration: 1.5
    });
  };

  // Handle mouse scroll wheel directly on the 3D globe viewport:
  // Prevents browser window scrolling while providing smooth, altitude-proportional,
  // bounded zooming that protects frustum near-planes and avoids collinear nadir lockups.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e) => {
      // Prevent browser window scrolling while interacting with the 3D globe
      e.preventDefault();
      e.stopPropagation();

      if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
      const camera = viewerRef.current.camera;
      if (!camera) return;

      const altMeters = getCameraAltitudeMeters();
      const delta = e.deltaY;

      if (delta < 0) {
        // Zoom In (towards Earth)
        if (altMeters <= 50000) return; // Prevent zooming through surface
        // Adaptive step: 25% of current altitude down to min 50km
        const step = Math.min(altMeters * 0.25, altMeters - 40000);
        if (step > 0 && !isNaN(step)) {
          camera.zoomIn(step);
          viewerRef.current.scene.requestRender();
        }
      } else if (delta > 0) {
        // Zoom Out (away from Earth)
        if (altMeters >= 35000000) return; // Cap at max orbital distance
        // Adaptive step: 30% of current altitude up to max 35,000km
        const step = Math.min(altMeters * 0.30, 35000000 - altMeters);
        if (step > 0 && !isNaN(step)) {
          camera.zoomOut(step);
          viewerRef.current.scene.requestRender();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [cesiumLoaded]);

  // Safe helper to obtain camera altitude in meters from Cesium Cartesian3
  const getCameraAltitudeMeters = () => {
    if (!viewerRef.current || viewerRef.current.isDestroyed() || !window.Cesium) return 23000000;
    try {
      const camera = viewerRef.current.camera;
      if (!camera || !camera.position) return 23000000;
      const carto = window.Cesium.Cartographic.fromCartesian(camera.position);
      if (carto && typeof carto.height === 'number' && !isNaN(carto.height)) {
        return Math.max(1000, carto.height);
      }
    } catch (e) {}
    return 23000000;
  };

  // Programmatic Zoom & View Controls
  const handleZoomIn = () => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const camera = viewerRef.current.camera;
    const currentHeight = getCameraAltitudeMeters();
    if (currentHeight <= 50000) return;
    const step = Math.min(currentHeight * 0.4, currentHeight - 40000);
    if (!isNaN(step) && step > 0) {
      camera.zoomIn(step);
    }
  };

  const handleZoomOut = () => {
    if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
    const camera = viewerRef.current.camera;
    const currentHeight = getCameraAltitudeMeters();
    if (currentHeight >= 34000000) return;
    const step = Math.min(currentHeight * 0.5, 35000000 - currentHeight);
    if (!isNaN(step) && step > 0) {
      camera.zoomOut(step);
    }
  };

  const handleResetNorth = () => {
    if (!viewerRef.current || viewerRef.current.isDestroyed() || !window.Cesium) return;
    const camera = viewerRef.current.camera;
    camera.flyTo({
      destination: camera.position,
      orientation: {
        heading: 0.0,
        pitch: camera.pitch,
        roll: 0.0
      },
      duration: 0.8
    });
  };

  const handleResetToGlobal = () => {
    handleOrbitSelect('ALL');
  };

  const isGlobalScope = selectedAoiId === 'global';

  return (
    <div className="relative w-full h-[calc(100vh-11.5rem)] min-h-[660px] rounded-2xl overflow-hidden border border-[#E5E5E5] bg-[#070A0F] shadow-xl flex flex-col font-sans">
      
      {/* 1. Top HUD: View Mode Toggle, Scope Status, and Continent Orbit Bar */}
      <div className="absolute top-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        
        {/* Left Cluster: View Mode & Orbit Selection */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          
          {/* 3D Globe / 2D Map Switcher */}
          <div className="flex items-center p-1 bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] rounded-xl shadow-sm">
            <button
              onClick={() => {}}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111111] text-white font-sans font-medium text-xs shadow-sm transition-all"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>3D Globe</span>
            </button>
            <button
              onClick={onSwitchTo2D}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[#666666] hover:text-[#111111] hover:bg-[#F0F0F0] font-sans font-medium text-xs transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>2D Fire Map</span>
            </button>
          </div>

          {/* Harmonization / Raw Observation Mode Switcher */}
          <div className="flex items-center p-1 bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] rounded-xl shadow-sm">
            <button
              onClick={() => {
                setGlobeViewMode('HARMONIZED');
                setSelectedObs(null);
              }}
              title="View Harmonized Fire Events (Spatiotemporal MODIS-VIIRS Cross-Sensor Matching)"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-sans font-medium text-xs transition-all ${
                globeViewMode === 'HARMONIZED'
                  ? 'bg-[#111111] text-cyan-400 shadow-sm'
                  : 'text-[#666666] hover:text-[#111111] hover:bg-[#F0F0F0]'
              }`}
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>Harmonized Events</span>
              {harmonizedDataset.metrics?.matched_events_count > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-800 text-[10px] font-mono tabular-nums">
                  {harmonizedDataset.metrics.matched_events_count.toLocaleString()} Coincident
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setGlobeViewMode('RAW');
                setSelectedHarmonizedEvent(null);
              }}
              title="View Raw Satellite Detections"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-sans text-xs transition-colors ${
                globeViewMode === 'RAW'
                  ? 'bg-[#111111] text-white font-medium shadow-sm'
                  : 'text-[#666666] hover:text-[#111111] hover:bg-[#F0F0F0] font-medium'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Raw Points</span>
            </button>
          </div>

          {/* AOI Scope Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] text-xs font-sans shadow-sm">
            <span className="text-[#888888] text-[10px] uppercase tracking-wider font-medium">Scope:</span>
            <span className={isGlobalScope ? "text-emerald-700 font-semibold" : "text-[#111111] font-semibold"}>
              {isGlobalScope ? "Global Active Fire Network" : (aoiMetadata?.name || "Regional Pyrome")}
            </span>
            {!isGlobalScope && (
              <button
                onClick={() => handleOrbitSelect('ALL')}
                className="text-[10px] px-2 py-0.5 rounded bg-[#111111] text-white hover:bg-[#222222] font-medium transition-all ml-1"
                title="Switch back to Global Active Fire Network"
              >
                Switch to Global
              </button>
            )}
          </div>

          {/* Quick Continent Fly-To Orbit Selector */}
          <div className="hidden xl:flex items-center gap-1 p-1 bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] rounded-xl text-xs font-sans shadow-sm">
            <span className="text-[#888888] px-2 text-[10px] uppercase tracking-wider flex items-center gap-1 font-medium">
              <Compass className="w-3 h-3 text-[#111111]" />
              Orbit:
            </span>
            {Object.keys(CONTINENT_CENTERS).map((cont) => (
              <button
                key={cont}
                onClick={() => handleOrbitSelect(cont)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  activeOrbit === cont
                    ? "bg-[#111111] text-white shadow-xs"
                    : "text-[#666666] hover:text-[#111111] hover:bg-[#F0F0F0]"
                }`}
              >
                {cont === 'ALL' ? 'Global' : cont}
              </button>
            ))}
          </div>

        </div>

        {/* Right Cluster: Borders Toggle & Telemetry HUD */}
        <div className="flex items-center gap-2 pointer-events-auto">
          
          {/* Borders & Labels Overlay Toggle */}
          <button
            onClick={() => setShowBoundaries(!showBoundaries)}
            title={boundaryStatus === 'unavailable' ? "Country Boundaries Currently Unavailable" : "Toggle Country Boundaries & Place Names"}
            disabled={boundaryStatus === 'unavailable'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-sans backdrop-blur-md transition-all shadow-sm ${
              boundaryStatus === 'unavailable'
                ? "bg-[#FAFAFA]/40 text-[#888888] border-[#E5E5E5]/40 cursor-not-allowed opacity-60"
                : showBoundaries
                  ? "bg-[#111111] text-white border-[#111111] font-medium"
                  : "bg-[#FAFAFA]/95 text-[#666666] border-[#E5E5E5] hover:text-[#111111] hover:bg-[#F5F5F5] font-medium"
            }`}
          >
            {showBoundaries && boundaryStatus !== 'unavailable' ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-[#888888]" />}
            <span className="hidden sm:inline">
              Borders & Labels {boundaryStatus === 'unavailable' ? '(Offline)' : ''}
            </span>
          </button>

          {/* Reset Camera Button */}
          <button
            onClick={() => handleOrbitSelect('ALL')}
            title="Reset to Global Earth View"
            className="p-2 rounded-xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] hover:border-[#111111] text-[#666666] hover:text-[#111111] hover:bg-[#F5F5F5] transition-all shadow-sm"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

        </div>

      </div>

      {/* 2. Top-Right Telemetry Card (Adaptive Harmonization & Observation Stream) */}
      <div className="absolute top-20 right-4 z-20 pointer-events-auto hidden md:block max-w-xs w-72">
        <div className="p-3.5 rounded-2xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] shadow-xl space-y-2.5 font-sans text-xs">
          
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5]">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${globeViewMode === 'HARMONIZED' ? 'bg-cyan-400' : 'bg-emerald-400'} opacity-75`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${globeViewMode === 'HARMONIZED' ? 'bg-cyan-500' : 'bg-emerald-500'}`} />
              </span>
              <span className="font-medium text-[#111111] uppercase text-[11px] tracking-wider font-sans">
                {globeViewMode === 'HARMONIZED' ? 'Harmonized Stream' : (isLive ? 'Active Fire Stream' : 'Sample Fire Stream')}
              </span>
            </div>
            <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-medium flex items-center gap-1 ${
              globeViewMode === 'HARMONIZED'
                ? 'bg-cyan-50 text-cyan-800 border border-cyan-200'
                : (isLive ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200')
            }`}>
              {globeViewMode === 'HARMONIZED' ? <GitMerge className="w-3 h-3" /> : null}
              {globeViewMode === 'HARMONIZED' ? 'MODIS + VIIRS (SAMPLE)' : (isLive ? 'LIVE_FIRMS' : 'SAMPLE DATA')}
            </span>
          </div>

          {/* Key Metrics Grid */}
          {globeViewMode === 'HARMONIZED' ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-white border border-[#E5E5E5]">
                <span className="text-[10px] text-[#888888] block font-sans">Harmonized Events</span>
                <strong className="text-[#111111] text-sm font-semibold font-mono tabular-nums block mt-0.5">
                  {harmonizedDataset.events.length.toLocaleString()}
                </strong>
                <span className="text-[9px] text-[#666666] font-mono tabular-nums">from {liveStats.displayedCount.toLocaleString()} obs</span>
              </div>

              <div className="p-2 rounded-lg bg-white border border-[#E5E5E5]">
                <span className="text-[10px] text-[#888888] block font-sans">Dual-Sensor Matches</span>
                <strong className="text-cyan-600 text-sm font-semibold font-mono tabular-nums block mt-0.5">
                  {harmonizedDataset.metrics?.matched_events_count?.toLocaleString() || 0}
                </strong>
                <span className="text-[9px] text-[#666666] font-mono tabular-nums">{harmonizedDataset.metrics?.match_percentage || 0}% confirmed</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-white border border-[#E5E5E5]">
                <span className="text-[10px] text-[#888888] block font-sans">Detections Rendered</span>
                <strong className="text-[#111111] text-sm font-semibold font-mono tabular-nums block mt-0.5">
                  {liveStats.displayedCount.toLocaleString()}
                </strong>
                <span className="text-[9px] text-[#666666] font-mono tabular-nums">of {totalAvailable.toLocaleString()} {isLive ? 'live' : 'in sample archive'}</span>
              </div>

              <div className="p-2 rounded-lg bg-white border border-[#E5E5E5]">
                <span className="text-[10px] text-[#888888] block font-sans">Cumulative FRP</span>
                <strong className="text-[#111111] text-sm font-semibold font-mono tabular-nums block mt-0.5">
                  {liveStats.totalFrp.toLocaleString()} <span className="text-[10px] font-normal font-sans text-[#666666]">MW</span>
                </strong>
                <span className="text-[9px] text-[#666666] font-sans">Thermal Radiative Power</span>
              </div>
            </div>
          )}

          {/* Additional Telemetry Details */}
          {globeViewMode === 'HARMONIZED' ? (
            <div className="space-y-1 pt-1 text-[11px] text-[#666666]">
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Calibration Ratio:</span>
                <span className="text-cyan-700 font-semibold font-mono tabular-nums">
                  {harmonizedDataset.metrics?.calibration_ratio?.toFixed(2) || '1.00'}x (VIIRS/MODIS)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Mean Spatiotemporal:</span>
                <span className="text-[#111111] font-mono tabular-nums text-[10px]">
                  {harmonizedDataset.metrics?.mean_spatial_offset_km?.toFixed(2) || '0.00'} km • {harmonizedDataset.metrics?.mean_temporal_delta_minutes?.toFixed(0) || '0'} min
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Composition:</span>
                <span className="text-[#111111] font-mono tabular-nums text-[10px]">
                  VIIRS: <strong className="text-amber-600 font-semibold">{harmonizedDataset.metrics?.viirs_only_count?.toLocaleString()}</strong> • MODIS: <strong className="text-red-600 font-semibold">{harmonizedDataset.metrics?.modis_only_count?.toLocaleString()}</strong>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Conservation:</span>
                <span className="text-emerald-700 font-medium font-sans">
                  100.0% Exact Conservation
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Cluster Mode:</span>
                <span className="text-emerald-700 font-medium font-mono tabular-nums text-[10px]">
                  {enableClustering ? `${harmonizedClusters.clusterCount.toLocaleString()} Clusters (${harmonizedClusters.singletonCount.toLocaleString()} Single)` : 'Individual Events'}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-1 pt-1 text-[11px] text-[#666666]">
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Cluster Mode:</span>
                <span className="text-emerald-700 font-medium font-mono tabular-nums text-[10px]">
                  {enableClustering ? `${spatialClusters.clusterCount.toLocaleString()} Clusters (${spatialClusters.singletonCount.toLocaleString()} Single)` : 'Raw Detections'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Altitude Tier:</span>
                <span className="text-[#111111] font-mono tabular-nums text-[10px]">
                  {activeZoomTier.name} ({activeZoomTier.gridDeg > 0 ? `${activeZoomTier.gridDeg}° grid` : 'Points'})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Active Continents:</span>
                <strong className="text-[#111111] font-mono tabular-nums font-semibold">{liveStats.continentCount} / 6 Continents</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Sensors:</span>
                <span className="text-[#111111] font-mono tabular-nums text-[10px]">
                  MODIS: <strong className="text-red-600 font-semibold">{liveStats.modisCount.toLocaleString()}</strong> • VIIRS: <strong className="text-amber-600 font-semibold">{liveStats.viirsCount.toLocaleString()}</strong>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#888888] font-sans">Observation Date:</span>
                <span className="text-[#111111] font-mono tabular-nums text-[10px]">{liveStats.dateRange}</span>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* 3. Cesium Canvas Container with Dynamic Initialization & Error Fallback */}
      <div className="relative w-full flex-1">
        
        {/* Loading Overlay */}
        {initStatus === 'loading' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#070A0F] text-center p-6 space-y-4">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-2 border-ignis-border" />
              <div className="absolute inset-0 rounded-full border-2 border-t-ignis-gold animate-spin" />
              <Globe className="w-6 h-6 text-ignis-gold absolute inset-0 m-auto animate-pulse" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <span className="font-mono text-base text-white font-semibold block">
                Initializing 3D Satellite Earth Engine
              </span>
              <span className="text-xs text-ignis-muted font-mono block">
                {initStep}
              </span>
            </div>
            <div className="flex items-center gap-2 pt-2 text-[11px] font-mono text-ignis-subtle">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>Streaming NASA active-fire observations ({observations.length.toLocaleString()} indexed)</span>
            </div>
          </div>
        )}

        {/* Diagnostic Error Overlay with Retry & 2D Fallback */}
        {initStatus === 'error' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#070A0F]/95 backdrop-blur-md text-center p-6 space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-rose-950/60 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-xl shadow-rose-950/30">
              <AlertCircle className="w-7 h-7" />
            </div>
            <div className="space-y-2 max-w-lg">
              <div className="flex items-center justify-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-rose-900/40 border border-rose-700/50 text-[10px] font-mono uppercase text-rose-300">
                  {errorCategory === 'cdn' ? 'CDN Network Failure' : errorCategory === 'webgl' ? 'WebGL Context Error' : 'Graphics Engine Alert'}
                </span>
                <span className="text-ignis-subtle text-[11px] font-mono">Basemap: {activeBasemap}</span>
              </div>
              <h3 className="font-mono text-lg text-white font-bold tracking-tight">
                3D Satellite Earth Initialization Failed
              </h3>
              <p className="text-xs text-ignis-muted font-mono leading-relaxed bg-ignis-card/80 p-3 rounded-xl border border-ignis-border">
                {initError}
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2 font-mono">
              <button
                onClick={handleRetryInit}
                className="flex items-center gap-2 px-4 py-2 bg-[#111111] text-white hover:bg-[#222222] font-semibold text-xs rounded-xl shadow-md active:scale-95 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry 3D Initialization</span>
              </button>
              <button
                onClick={onSwitchTo2D}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#E5E5E5] hover:border-[#111111] text-[#111111] hover:bg-[#F5F5F5] text-xs rounded-xl active:scale-95 transition-all"
              >
                <span>Switch to 2D Fire Map</span>
              </button>
            </div>
          </div>
        )}

        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* 4. Bottom-Left: Interactive Globe Filters */}
      <div className="absolute bottom-4 left-4 z-20 pointer-events-auto max-w-xl">
        <div className="p-3 rounded-2xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] shadow-xl space-y-2.5">
          
          <div className="flex items-center justify-between text-xs font-sans text-[#666666] pb-1 border-b border-[#E5E5E5]">
            <div className="flex items-center gap-1.5 text-[#111111] font-medium">
              <Sliders className="w-3.5 h-3.5 text-[#111111]" />
              <span>Globe Controls & Filters</span>
            </div>
            <span className="text-[10px] text-[#888888] font-sans">
              Left-click marker to inspect • Right-click/wheel to orbit & tilt
            </span>
          </div>

          {/* Filter Row 1: Sensor & Source Classification */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-sans">
            
            {/* Dynamic Geographic Clustering Toggle */}
            <button
              onClick={() => setEnableClustering(!enableClustering)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-sans transition-all ${
                enableClustering
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-300 font-medium shadow-xs"
                  : "bg-white text-[#666666] border border-[#E5E5E5] hover:text-[#111111] hover:bg-[#F5F5F5] font-medium"
              }`}
              title={enableClustering ? "Switch to Individual Fire Detections" : "Enable Real-Time Geographic Clustering"}
            >
              <Grid className="w-3 h-3 text-emerald-700" />
              <span>Clusters: {enableClustering ? 'ON' : 'OFF'}</span>
            </button>

            {/* Sensor Filter */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] px-1.5 uppercase font-medium">Sensor:</span>
              {['ALL', 'VIIRS', 'MODIS'].map((s) => (
                <button
                  key={s}
                  onClick={() => setSensorFilter(s)}
                  className={`px-2 py-0.5 rounded text-[11px] font-sans transition-colors ${
                    sensorFilter === s
                      ? "bg-[#111111] text-white font-medium"
                      : "text-[#666666] hover:text-[#111111] hover:bg-[#F5F5F5] font-medium"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Source Classification Filter */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] px-1.5 uppercase font-medium">Source:</span>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-transparent text-[#111111] font-medium text-xs font-sans focus:outline-none cursor-pointer pr-1"
              >
                <option value="ALL" className="bg-white text-[#111111]">All Sources</option>
                <option value="FOREST_WILDFIRE" className="bg-white text-red-600">Likely Forest Wildfire</option>
                <option value="AGRICULTURAL_BURNING" className="bg-white text-amber-600">Possible Agricultural</option>
                <option value="INDUSTRIAL_HEAT" className="bg-white text-purple-600">Possible Industrial</option>
                <option value="UNKNOWN" className="bg-white text-slate-600">Unknown Thermal</option>
              </select>
            </div>

            {/* Continent Filter */}
            <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] px-1.5 uppercase font-medium">Region:</span>
              <select
                value={continentFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setContinentFilter(val);
                  if (val !== 'ALL') {
                    handleOrbitSelect(val);
                  }
                }}
                className="bg-transparent text-[#111111] font-medium text-xs font-sans focus:outline-none cursor-pointer pr-1"
              >
                <option value="ALL" className="bg-white text-[#111111]">All Continents</option>
                <option value="Africa" className="bg-white text-[#111111]">Africa</option>
                <option value="South America" className="bg-white text-[#111111]">South America</option>
                <option value="Oceania" className="bg-white text-[#111111]">Oceania</option>
                <option value="Asia" className="bg-white text-[#111111]">Asia</option>
                <option value="North America" className="bg-white text-[#111111]">North America</option>
                <option value="Europe" className="bg-white text-[#111111]">Europe</option>
              </select>
            </div>

          </div>

          {/* Filter Row 2: FRP Slider & Point Classification Legend */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            
            {/* Minimum FRP Slider */}
            <div className="flex items-center gap-2 flex-1 min-w-[180px] max-w-[220px]">
              <span className="text-[10px] font-sans text-[#666666] whitespace-nowrap">Min FRP:</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={minFRP}
                onChange={(e) => setMinFRP(Number(e.target.value))}
                className="w-full accent-[#111111] h-1 bg-[#E5E5E5] rounded-lg cursor-pointer"
              />
              <span className="text-[10px] font-mono tabular-nums text-[#111111] font-semibold w-8">{minFRP}MW</span>
            </div>

            {/* Point Legend */}
            <div className="flex items-center gap-3 text-[10px] font-sans text-[#666666]">
              {globeViewMode === 'HARMONIZED' ? (
                <>
                  <span className="flex items-center gap-1.5 text-cyan-700 font-medium">
                    <span className="w-3 h-3 rounded-full bg-cyan-500 ring-2 ring-cyan-200" />
                    Dual-Sensor Match ({harmonizedDataset.metrics?.matched_events_count || 0})
                  </span>
                  <span className="flex items-center gap-1 text-amber-700">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    VIIRS-Only ({harmonizedDataset.metrics?.viirs_only_count?.toLocaleString() || 0})
                  </span>
                  <span className="flex items-center gap-1 text-red-700">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    MODIS-Only ({harmonizedDataset.metrics?.modis_only_count?.toLocaleString() || 0})
                  </span>
                </>
              ) : (
                <>
                  {enableClustering && (
                    <span className="flex items-center gap-1 text-emerald-700 font-medium">
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 border border-emerald-500 flex items-center justify-center text-[8px] text-emerald-900 font-mono tabular-nums font-semibold">
                        #
                      </span>
                      Clusters
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-200" />
                    Wildfire
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500 ring-2 ring-amber-200" />
                    Agri
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-purple-500 ring-2 ring-purple-200" />
                    Industrial
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-slate-400 ring-2 ring-slate-200" />
                    Unknown
                  </span>
                </>
              )}
            </div>

          </div>

        </div>
      </div>

      {/* 5. Floating Geographic Cluster Inspector Drawer */}
      {selectedCluster && (
        <div className="absolute top-20 right-4 z-30 pointer-events-auto w-84 sm:w-96 p-4 rounded-2xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] shadow-2xl animate-fade-in-up font-sans text-xs">
          
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-[#E5E5E5]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Grid className="w-4 h-4 text-[#111111]" />
                <span className="font-sans text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Geographic Fire Cluster
                </span>
              </div>
              <p className="font-mono tabular-nums text-[10px] text-[#666666] truncate max-w-[240px]">
                {selectedCluster.id} • Centroid ({selectedCluster.centroidLat?.toFixed(2)}°, {selectedCluster.centroidLon?.toFixed(2)}°)
              </p>
            </div>
            <button
              onClick={() => setSelectedCluster(null)}
              className="p-1 rounded-lg hover:bg-[#F0F0F0] text-[#666666] hover:text-[#111111] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Cluster Detection Count & Dominant Category Banner */}
          <div className={`mt-3 p-3 rounded-xl border ${
            selectedCluster.dominantCategory === 'FOREST_WILDFIRE'
              ? 'bg-red-50 border-red-200 text-red-900'
              : selectedCluster.dominantCategory === 'AGRICULTURAL_BURNING'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : selectedCluster.dominantCategory === 'INDUSTRIAL_HEAT'
              ? 'bg-purple-50 border-purple-200 text-purple-900'
              : 'bg-orange-50 border-orange-200 text-orange-900'
          }`}>
            <div className="flex items-center justify-between text-xs font-sans">
              <span className="font-semibold flex items-center gap-1.5 font-mono tabular-nums">
                <Flame className="w-4 h-4" />
                {selectedCluster.count.toLocaleString()} Fire Detections
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/80 border border-current font-medium text-[10px] uppercase font-sans">
                {selectedCluster.dominantCategory.replace('_', ' ')}
              </span>
            </div>
            <p className="text-[11px] mt-1.5 text-[#333333] font-sans leading-relaxed">
              Spatially grouped cluster spanning <span className="font-mono tabular-nums">{(selectedCluster.maxLat - selectedCluster.minLat).toFixed(2)}°</span> latitude by <span className="font-mono tabular-nums">{(selectedCluster.maxLon - selectedCluster.minLon).toFixed(2)}°</span> longitude.
            </p>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs font-sans">
            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>Total Radiative Power</span>
                <Zap className="w-3 h-3 text-[#111111]" />
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {Math.round(selectedCluster.totalFrp).toLocaleString()} <span className="text-[10px] font-normal font-sans text-[#666666]">MW</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>Mean FRP Intensity</span>
                <Flame className="w-3 h-3 text-amber-600" />
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {(selectedCluster.totalFrp / selectedCluster.count).toFixed(1)} <span className="text-[10px] font-normal font-sans text-[#666666]">MW</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="text-[#888888] text-[10px]">Sensors</div>
              <div className="text-xs font-semibold font-mono tabular-nums text-[#111111] mt-0.5 truncate">
                MODIS: <strong className="text-red-600 font-semibold">{selectedCluster.sensors.MODIS.toLocaleString()}</strong> • VIIRS: <strong className="text-amber-600 font-semibold">{selectedCluster.sensors.VIIRS.toLocaleString()}</strong>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="text-[#888888] text-[10px]">Peak Anomaly FRP</div>
              <div className="text-xs font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
                {selectedCluster.maxFrp.toFixed(1)} MW
              </div>
            </div>
          </div>

          {/* Category Breakdown Bar */}
          <div className="mt-3 p-2.5 rounded-xl bg-white border border-[#E5E5E5] space-y-1.5 text-xs font-sans">
            <div className="flex items-center justify-between text-[#888888] text-[10px]">
              <span>Category Breakdown</span>
              <span className="text-[#111111] font-mono tabular-nums">
                {Object.entries(selectedCluster.categories).filter(([_, n]) => n > 0).length} source types
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#E5E5E5] overflow-hidden flex">
              {selectedCluster.categories.FOREST_WILDFIRE > 0 && (
                <div
                  title={`Forest Wildfire: ${selectedCluster.categories.FOREST_WILDFIRE}`}
                  style={{ width: `${(selectedCluster.categories.FOREST_WILDFIRE / selectedCluster.count) * 100}%` }}
                  className="bg-red-500 h-full"
                />
              )}
              {selectedCluster.categories.AGRICULTURAL_BURNING > 0 && (
                <div
                  title={`Agricultural: ${selectedCluster.categories.AGRICULTURAL_BURNING}`}
                  style={{ width: `${(selectedCluster.categories.AGRICULTURAL_BURNING / selectedCluster.count) * 100}%` }}
                  className="bg-amber-500 h-full"
                />
              )}
              {selectedCluster.categories.INDUSTRIAL_HEAT > 0 && (
                <div
                  title={`Industrial: ${selectedCluster.categories.INDUSTRIAL_HEAT}`}
                  style={{ width: `${(selectedCluster.categories.INDUSTRIAL_HEAT / selectedCluster.count) * 100}%` }}
                  className="bg-purple-500 h-full"
                />
              )}
              {selectedCluster.categories.UNKNOWN > 0 && (
                <div
                  title={`Unknown: ${selectedCluster.categories.UNKNOWN}`}
                  style={{ width: `${(selectedCluster.categories.UNKNOWN / selectedCluster.count) * 100}%` }}
                  className="bg-slate-400 h-full"
                />
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] pt-1 font-mono tabular-nums">
              <span className="text-red-600">WF: {selectedCluster.categories.FOREST_WILDFIRE}</span>
              <span className="text-amber-600">Ag: {selectedCluster.categories.AGRICULTURAL_BURNING}</span>
              <span className="text-purple-600">Ind: {selectedCluster.categories.INDUSTRIAL_HEAT}</span>
              <span className="text-slate-600">Unk: {selectedCluster.categories.UNKNOWN}</span>
            </div>
          </div>

          {/* Harmonized Composition Breakdown */}
          {selectedCluster.coincidentCount !== undefined && (
            <div className="mt-3 p-2.5 rounded-xl bg-cyan-50 border border-cyan-200 space-y-1.5 text-xs font-sans">
              <div className="flex items-center justify-between text-cyan-900 text-[10px] font-semibold">
                <span className="flex items-center gap-1">
                  <GitMerge className="w-3 h-3 text-cyan-700" />
                  Harmonized Composition
                </span>
                <span className="font-mono tabular-nums">{selectedCluster.count} Events Total</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center pt-1 font-mono tabular-nums">
                <div className="p-1.5 rounded-lg bg-white border border-cyan-300">
                  <span className="text-[9px] text-cyan-800 block font-medium font-sans">Dual-Sensor</span>
                  <span className="text-sm font-semibold text-[#111111]">{selectedCluster.coincidentCount}</span>
                </div>
                <div className="p-1.5 rounded-lg bg-white border border-amber-300">
                  <span className="text-[9px] text-amber-800 block font-medium font-sans">VIIRS-Only</span>
                  <span className="text-sm font-semibold text-[#111111]">{selectedCluster.viirsOnlyCount}</span>
                </div>
                <div className="p-1.5 rounded-lg bg-white border border-red-300">
                  <span className="text-[9px] text-red-800 block font-medium font-sans">MODIS-Only</span>
                  <span className="text-sm font-semibold text-[#111111]">{selectedCluster.modisOnlyCount}</span>
                </div>
              </div>
            </div>
          )}

          {/* Zoom & Disperse Action Button */}
          <div className="mt-3 pt-1 flex items-center gap-2">
            <button
              onClick={() => handleZoomToCluster(selectedCluster)}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#111111] text-white hover:bg-[#222222] font-sans font-medium text-xs shadow-md active:scale-95 transition-all"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Zoom & Disperse Cluster</span>
            </button>
          </div>
        </div>
      )}

      {/* 6. Floating Fire Intelligence Detail Inspector */}
      {selectedObs && (
        <div className="absolute top-20 right-4 z-30 pointer-events-auto w-84 sm:w-96 p-4 rounded-2xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] shadow-2xl animate-fade-in-up font-sans text-xs">
          
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-[#E5E5E5]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="font-sans text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Fire Intelligence Detail
                </span>
              </div>
              <p className="font-mono tabular-nums text-[10px] text-[#666666] truncate max-w-[240px]">
                {selectedObs.id}
              </p>
            </div>
            <button
              onClick={() => setSelectedObs(null)}
              className="p-1 rounded-lg hover:bg-[#F0F0F0] text-[#666666] hover:text-[#111111] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Classification Banner */}
          <div className={`mt-3 p-3 rounded-xl border ${
            selectedObs.classification_code === 'FOREST_WILDFIRE'
              ? 'bg-red-50 border-red-200 text-red-900'
              : selectedObs.classification_code === 'AGRICULTURAL_BURNING'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : selectedObs.classification_code === 'INDUSTRIAL_HEAT'
              ? 'bg-purple-50 border-purple-200 text-purple-900'
              : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}>
            <div className="flex items-center justify-between text-xs font-sans">
              <span className="font-semibold flex items-center gap-1.5">
                <Flame className="w-4 h-4" />
                {selectedObs.probable_source || selectedObs.classification_code || 'Thermal Anomaly'}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/80 border border-current font-medium text-[11px] font-mono tabular-nums">
                {selectedObs.classification_confidence || 65}% Conf
              </span>
            </div>
            <p className="text-[11px] mt-1.5 text-[#333333] font-sans leading-relaxed">
              {selectedObs.classification_rationale || 
               `Identified via ${selectedObs.sensor} sensor observation with ${selectedObs.confidence || 'nominal'} thermal anomaly detection confidence.`}
            </p>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs font-sans">
            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>FRP Intensity</span>
                <Zap className="w-3 h-3 text-[#111111]" />
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {selectedObs.frp?.toFixed(1) || '0.0'} <span className="text-[10px] font-normal font-sans text-[#666666]">MW</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>Brightness Temp</span>
                <Flame className="w-3 h-3 text-amber-600" />
              </div>
              <div className="text-base font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {selectedObs.brightness?.toFixed(1) || '—'} <span className="text-[10px] font-normal font-sans text-[#666666]">K</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="text-[#888888] text-[10px]">Sensor / Satellite</div>
              <div className="text-xs font-semibold font-mono tabular-nums text-[#111111] mt-0.5 truncate">
                {selectedObs.sensor} ({selectedObs.satellite || 'Constellation'})
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="text-[#888888] text-[10px]">Sensor Detection Conf</div>
              <div className="text-xs font-semibold font-mono tabular-nums text-emerald-700 mt-0.5 uppercase">
                {selectedObs.confidence || 'Nominal'} ({selectedObs.confidence_numeric || 65}%)
              </div>
            </div>
          </div>

          {/* Geographic Context */}
          <div className="mt-3 p-2.5 rounded-xl bg-white border border-[#E5E5E5] space-y-1.5 text-xs font-sans">
            <div className="flex items-center justify-between text-[#888888] text-[10px]">
              <span className="flex items-center gap-1 font-medium">
                <MapPin className="w-3 h-3 text-[#111111]" />
                Geographic Context
              </span>
              <button
                onClick={() => handleFlyToObservation(selectedObs)}
                className="text-[#111111] font-medium hover:underline flex items-center gap-0.5 text-[10px]"
              >
                <ZoomIn className="w-3 h-3" />
                Zoom to Fire
              </button>
            </div>
            <div className="text-[#111111] font-medium text-[11px]">
              {selectedObs.proximity_label || `${selectedObs.country || 'Unknown'}, ${selectedObs.continent || 'Global'}`}
            </div>
            <div className="flex items-center justify-between text-[10px] text-[#888888] pt-1 border-t border-[#E5E5E5]">
              <span>Coordinates:</span>
              <span className="text-[#111111] font-mono tabular-nums">
                {selectedObs.latitude?.toFixed(4)}°, {selectedObs.longitude?.toFixed(4)}°
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[#888888]">
              <span>Acquisition:</span>
              <span className="text-[#111111] font-mono tabular-nums">
                {selectedObs.acq_date} {selectedObs.acq_time} UTC ({selectedObs.daynight === 'D' ? 'Day' : 'Night'})
              </span>
            </div>
          </div>

        </div>
      )}

      {/* 7. Floating Harmonized Fire Event Inspector Drawer */}
      {selectedHarmonizedEvent && (
        <div className="absolute top-20 right-4 z-30 pointer-events-auto w-88 sm:w-[420px] max-h-[calc(100vh-14rem)] overflow-y-auto p-4 rounded-2xl bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] shadow-2xl animate-fade-in-up text-xs font-sans">
          
          {/* Header */}
          <div className="flex items-start justify-between pb-3 border-b border-[#E5E5E5]">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <GitMerge className="w-4 h-4 text-cyan-600" />
                <span className="font-sans text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Harmonized Fire Event
                </span>
              </div>
              <p className="font-mono tabular-nums text-[10px] text-cyan-800 font-semibold truncate max-w-[260px]">
                {selectedHarmonizedEvent.event_id}
              </p>
            </div>
            <button
              onClick={() => setSelectedHarmonizedEvent(null)}
              className="p-1 rounded-lg hover:bg-[#F0F0F0] text-[#666666] hover:text-[#111111] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Event Status Banner */}
          <div className={`mt-3 p-3 rounded-xl border ${
            selectedHarmonizedEvent.harmonization_type === 'DUAL_SENSOR_COINCIDENT'
              ? 'bg-cyan-50 border-cyan-200 text-cyan-900'
              : selectedHarmonizedEvent.harmonization_type === 'VIIRS_ONLY'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                {selectedHarmonizedEvent.harmonization_type === 'DUAL_SENSOR_COINCIDENT'
                  ? 'Dual-Sensor Confirmed'
                  : selectedHarmonizedEvent.harmonization_type === 'VIIRS_ONLY'
                  ? 'VIIRS-Only Sub-Pixel Fire'
                  : 'MODIS-Only Fire Event'}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/80 border border-current font-medium text-[10px] uppercase font-mono">
                {selectedHarmonizedEvent.sensor_composition}
              </span>
            </div>
            <p className="text-[11px] mt-1.5 text-[#333333] font-sans leading-relaxed">
              {selectedHarmonizedEvent.harmonization_type === 'DUAL_SENSOR_COINCIDENT'
                ? `Confirmed by both MODIS (1000m) and VIIRS (375m) within ${selectedHarmonizedEvent.spatial_offset_km.toFixed(2)} km geodesic distance and ${selectedHarmonizedEvent.temporal_offset_min.toFixed(0)} min temporal offset.`
                : selectedHarmonizedEvent.harmonization_type === 'VIIRS_ONLY'
                ? 'High-resolution 375m VIIRS observation without coincident MODIS detection (typically sub-pixel fire below MODIS detection limits).'
                : '1000m MODIS observation without coincident VIIRS detection.'}
            </p>
          </div>

          {/* Cross-Sensor Spatiotemporal Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs font-sans">
            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>Geodesic Distance</span>
                <Compass className="w-3 h-3 text-cyan-600" />
              </div>
              <div className="text-sm font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {selectedHarmonizedEvent.harmonization_type === 'DUAL_SENSOR_COINCIDENT'
                  ? `${selectedHarmonizedEvent.spatial_offset_km.toFixed(3)} km (${(selectedHarmonizedEvent.spatial_offset_km * 1000).toFixed(0)}m)`
                  : 'N/A (Single Pass)'}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>Temporal Delta</span>
                <Clock className="w-3 h-3 text-amber-600" />
              </div>
              <div className="text-sm font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {selectedHarmonizedEvent.harmonization_type === 'DUAL_SENSOR_COINCIDENT'
                  ? `${selectedHarmonizedEvent.temporal_offset_min.toFixed(1)} min`
                  : 'N/A (Single Pass)'}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>FRP Ratio (V/M)</span>
                <Scale className="w-3 h-3 text-emerald-600" />
              </div>
              <div className="text-sm font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
                {selectedHarmonizedEvent.harmonization_type === 'DUAL_SENSOR_COINCIDENT'
                  ? `${selectedHarmonizedEvent.frp_ratio.toFixed(2)}x`
                  : '1.0x (Baseline)'}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-[#E5E5E5]">
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <span>Harmonized FRP</span>
                <Zap className="w-3 h-3 text-[#111111]" />
              </div>
              <div className="text-sm font-semibold font-mono tabular-nums text-[#111111] mt-0.5">
                {selectedHarmonizedEvent.total_frp?.toFixed(1) || '0.0'} MW
              </div>
            </div>
          </div>

          {/* Representative Coordinate Anchor */}
          <div className="mt-3 p-2.5 rounded-xl bg-white border border-[#E5E5E5] space-y-1.5 text-xs font-sans">
            <div className="flex items-center justify-between text-[#888888] text-[10px]">
              <span className="flex items-center gap-1 font-medium">
                <MapPin className="w-3 h-3 text-cyan-600" />
                Representative Coordinate
              </span>
              <button
                onClick={() => handleFlyToHarmonizedEvent(selectedHarmonizedEvent)}
                className="text-cyan-700 font-medium hover:underline flex items-center gap-0.5 text-[10px]"
              >
                <ZoomIn className="w-3 h-3" />
                Zoom to Event
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#111111]">
              <span className="font-mono tabular-nums">{selectedHarmonizedEvent.latitude?.toFixed(4)}°, {selectedHarmonizedEvent.longitude?.toFixed(4)}°</span>
              <span className="text-[10px] text-[#666666]">{selectedHarmonizedEvent.country || selectedHarmonizedEvent.continent || 'Global'}</span>
            </div>
            <div className="text-[10px] text-[#888888]">
              Anchor: {selectedHarmonizedEvent.harmonization_type === 'MODIS_ONLY' ? 'MODIS 1000m Pixel' : 'VIIRS 375m I-Band Centroid'}
            </div>
          </div>

          {/* Constituent Satellite Observations Drilldown */}
          <div className="mt-3 space-y-2 font-sans">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[#888888] block">
              Constituent Satellite Observations ({selectedHarmonizedEvent.total_pixel_count || 1})
            </span>

            {/* MODIS Observation Card if available */}
            {selectedHarmonizedEvent.modis_observation && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-red-900 flex items-center gap-1">
                    <Satellite className="w-3 h-3" />
                    MODIS {selectedHarmonizedEvent.modis_observation.satellite || 'Terra/Aqua'} (1000m)
                  </span>
                  <span className="text-[#111111] font-semibold font-mono tabular-nums">
                    {selectedHarmonizedEvent.modis_frp} MW
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#666666] font-mono tabular-nums">
                  <span>UTC: {selectedHarmonizedEvent.modis_observation.acq_date} {selectedHarmonizedEvent.modis_observation.acq_time}</span>
                  <span>Conf: {selectedHarmonizedEvent.modis_observation.confidence}%</span>
                </div>
                <div className="text-[9px] text-[#888888] font-mono tabular-nums truncate">
                  ID: {selectedHarmonizedEvent.modis_observation.id}
                </div>
              </div>
            )}

            {/* VIIRS Observation(s) */}
            {selectedHarmonizedEvent.viirs_observations && selectedHarmonizedEvent.viirs_observations.map((v, idx) => (
              <div key={v.id || idx} className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-amber-900 flex items-center gap-1">
                    <Satellite className="w-3 h-3" />
                    VIIRS {v.satellite || 'NOAA/Suomi'} (375m)
                  </span>
                  <span className="text-[#111111] font-semibold font-mono tabular-nums">
                    {v.frp?.toFixed(1) || '0.0'} MW
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#666666] font-mono tabular-nums">
                  <span>UTC: {v.acq_date} {v.acq_time}</span>
                  <span>Conf: {v.confidence || 'Nominal'} ({v.confidence_numeric || 65}%)</span>
                </div>
                <div className="text-[9px] text-[#888888] font-mono tabular-nums truncate">
                  ID: {v.id}
                </div>
              </div>
            ))}
          </div>

          {/* Zoom Action Button */}
          <div className="mt-3 pt-1">
            <button
              onClick={() => handleFlyToHarmonizedEvent(selectedHarmonizedEvent)}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#111111] text-white hover:bg-[#222222] font-sans font-medium text-xs shadow-md active:scale-95 transition-all"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Zoom to Harmonized Event</span>
            </button>
          </div>

        </div>
      )}

      {/* 6. Floating Zoom & Camera Navigation Controls (Requirement 2) */}
      <div className="absolute right-4 bottom-24 z-20 pointer-events-auto flex flex-col items-center gap-1.5 font-sans">
        
        {/* Zoom In (+) */}
        <button
          onClick={handleZoomIn}
          title="Zoom In (Close-up view)"
          aria-label="Zoom In"
          className="p-2.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E5E5] hover:border-[#111111] text-[#111111] hover:bg-[#F5F5F5] transition-all shadow-md hover:scale-105 active:scale-95"
        >
          <Plus className="w-4 h-4" />
        </button>

        {/* Zoom Out (-) */}
        <button
          onClick={handleZoomOut}
          title="Zoom Out (High altitude view)"
          aria-label="Zoom Out"
          className="p-2.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E5E5] hover:border-[#111111] text-[#111111] hover:bg-[#F5F5F5] transition-all shadow-md hover:scale-105 active:scale-95"
        >
          <Minus className="w-4 h-4" />
        </button>

        <div className="w-6 h-px bg-[#E5E5E5] my-0.5" />

        {/* Re-orient North */}
        <button
          onClick={handleResetNorth}
          title="Orient Camera to True North"
          aria-label="Orient True North"
          className="p-2.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E5E5] hover:border-[#111111] text-[#111111] hover:bg-[#F5F5F5] transition-all shadow-md hover:scale-105 active:scale-95"
        >
          <Navigation className="w-4 h-4 text-emerald-600" />
        </button>

        {/* Reset to Global Earth View */}
        <button
          onClick={handleResetToGlobal}
          title="Reset to Full Global Earth View"
          aria-label="Reset to Global View"
          className="p-2.5 rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E5E5] hover:border-[#111111] text-[#111111] hover:bg-[#F5F5F5] transition-all shadow-md hover:scale-105 active:scale-95"
        >
          <RotateCcw className="w-4 h-4 text-[#111111]" />
        </button>

        {/* Camera Altitude Indicator */}
        <div 
          title="Current Camera Altitude above Sea Level"
          className="mt-1 px-2 py-0.5 rounded-md bg-white/95 border border-[#E5E5E5] text-[9px] text-[#666666] font-mono tabular-nums shadow-sm text-center min-w-[56px] select-none"
        >
          {cameraAltitudeKm >= 1000
            ? `${(cameraAltitudeKm / 1000).toFixed(1)}k km`
            : `${cameraAltitudeKm} km`}
        </div>

      </div>

    </div>
  );
}
