import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Rectangle, AttributionControl, useMap } from 'react-leaflet';
import { Layers, Filter, Eye, Flame, ShieldAlert, Sparkles, MapPin, Factory, Sprout, Trees, HelpCircle, Globe } from 'lucide-react';

// Subcomponent to smoothly pan and zoom when AOI or center updates
function MapUpdater({ center, bbox }) {
  const map = useMap();
  useEffect(() => {
    if (bbox && bbox.length === 4) {
      if (bbox[0] <= -170 && bbox[2] >= 170) {
        map.setView([15, 0], 2);
      } else {
        // Leaflet bounds: [[south, west], [north, east]]
        map.fitBounds([
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]]
        ], { padding: [24, 24], maxZoom: 8 });
      }
    } else if (center) {
      map.setView(center, 7);
    }
  }, [center, bbox, map]);
  return null;
}

// Reliable, openly accessible tile providers complying with usage policies
const TILE_CONFIG = {
  dark: {
    id: "dark",
    name: "Dark OSM",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    isDark: true
  },
  osm: {
    id: "osm",
    name: "Street OSM",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    isDark: false
  },
  satellite: {
    id: "satellite",
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, GIS Community',
    maxZoom: 18,
    isDark: false
  }
};

// Fire Source Classification Metadata
const SOURCE_CATEGORIES = {
  FOREST_WILDFIRE: {
    id: "FOREST_WILDFIRE",
    name: "Likely Forest Wildfire",
    color: "#f97316", // Flame Orange-Red
    icon: Trees,
    badgeBg: "bg-orange-950/40 border-orange-800/60 text-orange-400"
  },
  AGRICULTURAL_BURNING: {
    id: "AGRICULTURAL_BURNING",
    name: "Possible Agricultural Burning",
    color: "#eab308", // Crop Amber-Yellow
    icon: Sprout,
    badgeBg: "bg-yellow-950/40 border-yellow-800/60 text-yellow-400"
  },
  INDUSTRIAL_HEAT: {
    id: "INDUSTRIAL_HEAT",
    name: "Possible Industrial Heat",
    color: "#a855f7", // Industrial Violet-Purple
    icon: Factory,
    badgeBg: "bg-purple-950/40 border-purple-800/60 text-purple-400"
  },
  UNKNOWN: {
    id: "UNKNOWN",
    name: "Unknown Thermal Anomaly",
    color: "#94a3b8", // Slate-Gray
    icon: HelpCircle,
    badgeBg: "bg-slate-900/40 border-slate-700/60 text-slate-400"
  }
};

export default function InteractiveMap({
  aoiMetadata,
  observations = [],
  sampleEvents = [],
  classificationSummary = null,
  loading = false,
  onSwitchTo3D = null
}) {
  const [sensorFilter, setSensorFilter] = useState("ALL"); // ALL, MODIS, VIIRS
  const [sourceFilter, setSourceFilter] = useState("ALL"); // ALL, FOREST_WILDFIRE, AGRICULTURAL_BURNING, INDUSTRIAL_HEAT, UNKNOWN
  const [colorMode, setColorMode] = useState("source"); // "source" or "sensor"
  const [minConf, setMinConf] = useState(0); // 0, 30, 80
  const [showHarmonized, setShowHarmonized] = useState(true);
  const [showRaw, setShowRaw] = useState(true);
  const [baseMap, setBaseMap] = useState("dark"); // dark, osm, satellite

  // Derive robust Pantanal center and bounding coordinates
  const center = aoiMetadata?.center || (
    aoiMetadata?.center_lat != null
      ? [aoiMetadata.center_lat, aoiMetadata.center_lon]
      : [-18.25, -56.5]
  );

  const bbox = aoiMetadata?.bbox || (
    aoiMetadata?.bbox_west != null
      ? [aoiMetadata.bbox_west, aoiMetadata.bbox_south, aoiMetadata.bbox_east, aoiMetadata.bbox_north]
      : [-58.0, -20.5, -55.0, -16.0]
  );

  // Leaflet rectangle bounds: [[south, west], [north, east]]
  const bounds = [
    [bbox[1], bbox[0]],
    [bbox[3], bbox[2]]
  ];

  // Filter observations based on user controls
  const filteredObs = observations.filter(o => {
    if (sensorFilter !== "ALL" && o.sensor !== sensorFilter) return false;
    if (o.confidence_numeric < minConf) return false;
    if (sourceFilter !== "ALL" && o.classification_code !== sourceFilter) return false;
    return true;
  });

  // Filter harmonized events based on source filter
  const filteredEvents = sampleEvents.filter(ev => {
    if (sourceFilter !== "ALL" && ev.classification_code !== sourceFilter) return false;
    return true;
  });

  const modisPlotted = filteredObs.filter(o => o.sensor === "MODIS").length;
  const viirsPlotted = filteredObs.filter(o => o.sensor === "VIIRS").length;
  const currentTile = TILE_CONFIG[baseMap] || TILE_CONFIG.dark;

  // Compute category counts from sampleEvents
  const catCounts = {
    FOREST_WILDFIRE: sampleEvents.filter(e => e.classification_code === "FOREST_WILDFIRE").length,
    AGRICULTURAL_BURNING: sampleEvents.filter(e => e.classification_code === "AGRICULTURAL_BURNING").length,
    INDUSTRIAL_HEAT: sampleEvents.filter(e => e.classification_code === "INDUSTRIAL_HEAT").length,
    UNKNOWN: sampleEvents.filter(e => e.classification_code === "UNKNOWN").length
  };

  return (
    <div className="space-y-4">
      
      {/* 1. Fire Source Classification Summary Bar */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-3 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs font-sans">
        <div className="flex items-center gap-2">
          <span className="text-[#888888] uppercase font-sans text-[10px] tracking-wider font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#111111]" />
            Fire Source Classification:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setSourceFilter("ALL")}
              className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-all ${
                sourceFilter === "ALL"
                  ? "bg-[#111111] text-white shadow-xs"
                  : "text-[#666666] hover:text-[#111111] bg-white border border-[#E5E5E5]"
              }`}
            >
              All Sources (<span className="font-mono tabular-nums">{sampleEvents.length}</span>)
            </button>

            {Object.entries(SOURCE_CATEGORIES).map(([code, meta]) => {
              const count = catCounts[code] || 0;
              const isSelected = sourceFilter === code;
              return (
                <button
                  key={code}
                  onClick={() => setSourceFilter(isSelected ? "ALL" : code)}
                  className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-all flex items-center gap-1.5 border ${
                    isSelected
                      ? "bg-[#111111] text-white border-[#111111] shadow-xs"
                      : "bg-white text-[#666666] hover:text-[#111111] border-[#E5E5E5]"
                  }`}
                  title={`Filter by ${meta.name}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span>{meta.name.replace("Likely ", "").replace("Possible ", "")}:</span>
                  <strong className={isSelected ? "text-white font-mono tabular-nums font-semibold" : "text-[#111111] font-mono tabular-nums font-semibold"}>{count}</strong>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Mode Switcher */}
        <div className="flex items-center gap-2 font-sans">
          <span className="text-[#888888] uppercase font-sans text-[10px] tracking-wider font-medium">Color Markers By:</span>
          <div className="inline-flex rounded-lg bg-white border border-[#E5E5E5] p-0.5">
            <button
              onClick={() => setColorMode("source")}
              className={`px-2.5 py-0.5 rounded text-xs font-sans font-medium transition-all ${
                colorMode === "source"
                  ? "bg-[#111111] text-white shadow-xs"
                  : "text-[#666666] hover:text-[#111111]"
              }`}
            >
              Probable Source
            </button>
            <button
              onClick={() => setColorMode("sensor")}
              className={`px-2.5 py-0.5 rounded text-xs font-sans font-medium transition-all ${
                colorMode === "sensor"
                  ? "bg-[#111111] text-white shadow-xs"
                  : "text-[#666666] hover:text-[#111111]"
              }`}
            >
              Sensor
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Map Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl text-xs font-sans">
        
        {/* Sensor toggles */}
        <div className="flex items-center gap-2">
          <span className="text-[#888888] uppercase font-sans text-[10px] tracking-wider font-medium">Sensors:</span>
          <div className="inline-flex rounded-lg bg-white border border-[#E5E5E5] p-0.5">
            {["ALL", "MODIS", "VIIRS"].map(s => (
              <button
                key={s}
                onClick={() => setSensorFilter(s)}
                className={`px-3 py-1 rounded-md text-xs font-sans font-medium transition-all ${
                  sensorFilter === s 
                    ? "bg-[#111111] text-white shadow-xs" 
                    : "text-[#666666] hover:text-[#111111]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Confidence filter */}
        <div className="flex items-center gap-2">
          <span className="text-[#888888] uppercase font-sans text-[10px] tracking-wider font-medium">Confidence:</span>
          <select
            value={minConf}
            onChange={(e) => setMinConf(Number(e.target.value))}
            className="bg-white text-[#111111] border border-[#E5E5E5] rounded-lg px-2.5 py-1 text-xs font-sans font-medium focus:outline-none focus:border-[#111111]"
          >
            <option value={0}>All Confidence</option>
            <option value={30}>Nominal & High (≥30%)</option>
            <option value={80}>High Confidence Only (≥80%)</option>
          </select>
        </div>

        {/* Observation & Cluster Counter Status Pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 bg-white border border-[#E5E5E5] rounded-lg font-mono tabular-nums text-xs shadow-xs">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-[10px] font-sans font-medium text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">SAMPLE DATA</span>
          <span className="text-[#111111] font-semibold">
            {filteredObs.length > 3000 ? `3,000 / ${filteredObs.length.toLocaleString()}` : filteredObs.length.toLocaleString()}
          </span>
          <span className="text-[#666666] font-sans">obs •</span>
          <span className="text-emerald-700 font-semibold">{filteredEvents.length.toLocaleString()}</span>
          <span className="text-[#666666] font-sans">harmonized events</span>
        </div>

        {/* Layer Visibility & Basemap Toggles */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer text-[#666666] hover:text-[#111111]">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="accent-[#111111] rounded cursor-pointer"
            />
            <span className="flex items-center gap-1 font-sans font-medium text-xs text-[#111111]">
              <span className="w-2 h-2 rounded-full bg-red-500" /> Raw Detections
            </span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-[#666666] hover:text-[#111111]">
            <input
              type="checkbox"
              checked={showHarmonized}
              onChange={(e) => setShowHarmonized(e.target.checked)}
              className="accent-[#111111] rounded cursor-pointer"
            />
            <span className="flex items-center gap-1 font-mono text-xs text-[#111111]">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Harmonized Clusters
            </span>
          </label>

          {/* OpenStreetMap & Satellite Basemap Switcher */}
          <div className="inline-flex rounded-lg bg-white border border-[#E5E5E5] p-0.5">
            {Object.values(TILE_CONFIG).map(t => (
              <button
                key={t.id}
                onClick={() => setBaseMap(t.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-all ${
                  baseMap === t.id 
                    ? "bg-[#111111] text-white shadow-xs" 
                    : "text-[#666666] hover:text-[#111111]"
                }`}
                title={t.name}
              >
                {t.name}
              </button>
            ))}
          </div>

          {/* 3D Globe Mode Switcher */}
          {onSwitchTo3D && (
            <button
              onClick={onSwitchTo3D}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#111111] hover:bg-[#222222] text-white font-sans font-medium text-xs shadow-md transition-all active:scale-95"
              title="Switch to Interactive 3D Earth Globe"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>3D Globe</span>
            </button>
          )}
        </div>

      </div>

      {/* Map Viewport Container */}
      <div className={`relative h-[620px] rounded-xl overflow-hidden border border-ignis-border bg-ignis-bg shadow-2xl ${currentTile.isDark ? "dark-tiles" : ""}`}>
        {loading && (
          <div className="absolute inset-0 z-[1000] bg-black/60 backdrop-blur-xs flex items-center justify-center">
            <div className="flex items-center gap-2.5 px-4 py-2 bg-ignis-card border border-ignis-border rounded-lg text-xs font-mono text-ignis-gold shadow-2xl">
              <span className="animate-spin">◓</span>
              <span>Querying NASA Satellite Constellation...</span>
            </div>
          </div>
        )}

        <MapContainer
          center={center}
          zoom={7}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
          attributionControl={false}
        >
          <MapUpdater center={center} bbox={bbox} />
          
          {/* Compliant OpenStreetMap & Imagery Tile Layer */}
          <TileLayer
            key={baseMap}
            url={currentTile.url}
            attribution={currentTile.attribution}
            maxZoom={currentTile.maxZoom}
          />

          {/* Clean Bottom-Left Attribution Control */}
          <AttributionControl position="bottomleft" prefix={false} />

          {/* Area of Interest Boundary Box (Pantanal) */}
          <Rectangle
            bounds={bounds}
            pathOptions={{
              color: "#f59e0b",
              weight: 1.5,
              dashArray: "4, 6",
              fillOpacity: 0.03,
              fillColor: "#f59e0b"
            }}
          />

          {/* Raw Satellite Detections (Optimized for Leaflet SVG rendering) */}
          {showRaw && filteredObs.slice(0, 3000).map((obs) => {
            const isModis = obs.sensor === "MODIS";
            
            // Marker color depends on active colorMode
            let markerColor;
            if (colorMode === "source") {
              markerColor = obs.classification_color || (obs.classification_code && SOURCE_CATEGORIES[obs.classification_code]?.color) || "#94a3b8";
            } else {
              markerColor = isModis ? "#fbbf24" : "#f43f5e";
            }

            // Scale radius proportionally with Fire Radiative Power (MW)
            const radius = Math.min(10, Math.max(3.5, Math.sqrt(obs.frp || 1.0) * 1.5));

            return (
              <CircleMarker
                key={obs.id}
                center={[obs.latitude, obs.longitude]}
                radius={radius}
                pathOptions={{
                  color: markerColor,
                  fillColor: markerColor,
                  fillOpacity: 0.8,
                  weight: 1
                }}
              >
                <Popup>
                  <div className="text-xs space-y-2 p-1 font-sans max-w-xs text-[#111111]">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-1.5 gap-2">
                      <span className={`font-mono font-bold uppercase ${isModis ? 'text-red-600' : 'text-amber-600'}`}>
                        {obs.sensor} ({obs.satellite})
                      </span>
                      <span className="font-mono text-[10px] text-[#666666]">
                        {obs.acq_date} {obs.acq_time} UTC
                      </span>
                    </div>

                    {/* Probable Source Badge on Observation */}
                    {obs.probable_source && (
                      <div className="p-1.5 rounded bg-[#FAFAFA] border border-[#E5E5E5] text-[11px] font-mono flex items-center justify-between gap-1">
                        <span className="text-[#888888] text-[9px] uppercase">Probable Source:</span>
                        <span className="font-bold text-[10px]" style={{ color: obs.classification_color || '#f97316' }}>
                          {obs.probable_source}
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Fire Radiative Power</span>
                        <strong className="text-[#111111] font-mono text-sm">{obs.frp} MW</strong>
                      </div>
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Brightness Temp</span>
                        <strong className="text-[#111111] font-mono text-sm">{obs.brightness} K</strong>
                      </div>
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Confidence</span>
                        <span className="capitalize font-mono text-[#111111]">{obs.confidence} ({obs.confidence_numeric}%)</span>
                      </div>
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Nominal Resolution</span>
                        <span className="font-mono text-[#111111]">{obs.resolution_m} m</span>
                      </div>
                    </div>

                    <div className="text-[10px] text-[#888888] border-t border-[#E5E5E5] pt-1 font-mono">
                      Lat: {Number(obs.latitude).toFixed(4)}°, Lon: {Number(obs.longitude).toFixed(4)}° • Pass: {obs.daynight === 'D' ? 'Day' : 'Night'}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Harmonized Fire Events (Centroid Clusters with Classification) */}
          {showHarmonized && filteredEvents.map((ev) => {
            const radius = Math.min(22, Math.max(7, Math.sqrt(ev.total_frp) * 1.8));
            const clusterColor = colorMode === "source" 
              ? (ev.classification_color || SOURCE_CATEGORIES[ev.classification_code]?.color || "#10b981")
              : "#10b981";

            const sourceMeta = SOURCE_CATEGORIES[ev.classification_code] || SOURCE_CATEGORIES.UNKNOWN;

            return (
              <CircleMarker
                key={ev.event_id}
                center={[ev.latitude, ev.longitude]}
                radius={radius}
                pathOptions={{
                  color: clusterColor,
                  fillColor: clusterColor,
                  fillOpacity: 0.25,
                  weight: 2,
                  dashArray: "3, 4"
                }}
              >
                <Popup>
                  <div className="text-xs space-y-2.5 p-1 font-sans max-w-sm text-[#111111]">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-1.5 gap-2">
                      <span className="font-mono font-bold text-emerald-700">
                        HARMONIZED FIRE COMPLEX
                      </span>
                      <span className="font-mono text-[10px] text-[#666666]">
                        {ev.date}
                      </span>
                    </div>

                    {/* Fire Source Classification Card */}
                    <div className="p-2.5 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] uppercase font-mono tracking-wider text-[#888888]">
                          Probable Source:
                        </span>
                        <span 
                          className="px-2 py-0.5 rounded text-[11px] font-mono font-bold border"
                          style={{ 
                            color: sourceMeta.color, 
                            borderColor: `${sourceMeta.color}60`,
                            backgroundColor: `${sourceMeta.color}15`
                          }}
                        >
                          {ev.probable_source || sourceMeta.name}
                        </span>
                      </div>

                      <div className="space-y-1 py-1 border-t border-b border-[#E5E5E5] font-mono text-[10px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[#666666]">Classification Confidence:</span>
                          <strong className="text-[#111111]">
                            {ev.classification_confidence ?? ev.confidence_score}% ({ev.classification_tier ?? ev.confidence_tier} Tier)
                          </strong>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#666666]">NASA Sensor Detection Conf:</span>
                          <strong className="text-[#111111]">
                            {ev.sensor_detection_confidence ?? ev.mean_confidence}% ({ev.sensor_detection_tier || (ev.mean_confidence >= 80 ? 'High' : (ev.mean_confidence >= 50 ? 'Nominal' : 'Low'))})
                          </strong>
                        </div>
                        <div className="flex items-center justify-between text-[9px] text-[#888888]">
                          <span>Cross-Sensor Verification:</span>
                          <span className={ev.cross_sensor_corroborated || ev.sensor_composition === 'COINCIDENT' ? "text-emerald-700 font-semibold" : "text-amber-700 font-medium"}>
                            {ev.cross_sensor_corroborated || ev.sensor_composition === 'COINCIDENT' ? "Dual-Sensor Verified" : "Single-Sensor (Unconfirmed)"}
                          </span>
                        </div>
                      </div>

                      {/* Evidence / Reasons List */}
                      {ev.classification_reasons && ev.classification_reasons.length > 0 && (
                        <div className="pt-1.5 border-t border-[#E5E5E5] space-y-1">
                          <span className="text-[9px] uppercase font-mono tracking-wider text-[#888888] block">
                            Evidence & Supporting Factors:
                          </span>
                          <ul className="space-y-0.5 text-[10px] text-[#666666] list-disc list-inside">
                            {ev.classification_reasons.map((r, i) => (
                              <li key={i} className="leading-tight text-[#111111]">{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Industrial Proximity Warning if close */}
                      {ev.industrial_proximity && (
                        <div className="text-[10px] text-purple-900 bg-purple-50 p-1.5 rounded border border-purple-200 font-mono">
                          ⚡ Near {ev.industrial_proximity.nearest_facility} ({ev.industrial_proximity.distance_km} km away)
                        </div>
                      )}
                    </div>

                    {/* Scientific Measurements Grid */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Total Complex FRP</span>
                        <strong className="text-emerald-700 font-mono text-sm">{ev.total_frp} MW</strong>
                      </div>
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Estimated Footprint</span>
                        <strong className="text-[#111111] font-mono text-sm">{ev.estimated_area_km2} km²</strong>
                      </div>
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Sensor Blend</span>
                        <span className="font-mono text-[#111111] font-semibold">{ev.sensor_composition}</span>
                      </div>
                      <div>
                        <span className="text-[#888888] block font-mono text-[9px] uppercase">Pixels Condensed</span>
                        <span className="font-mono text-[#111111]">
                          {ev.modis_pixel_count} MODIS / {ev.viirs_pixel_count} VIIRS
                        </span>
                      </div>
                    </div>

                    {/* Scientific Disclaimer */}
                    <p className="text-[9px] text-[#888888] border-t border-[#E5E5E5] pt-1 leading-tight font-mono">
                      Probabilistic estimate based on satellite thermal signatures, land-cover ecoregions, and infrastructure buffers. Not an on-the-ground verified fire cause.
                    </p>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        </MapContainer>

        {/* Floating Map Legend Overlay */}
        <div className="absolute bottom-4 right-4 z-[500] bg-[#FAFAFA]/95 backdrop-blur-md border border-[#E5E5E5] rounded-xl p-3.5 shadow-xl text-[11px] font-sans space-y-2.5 max-w-xs">
          <div className="flex items-center justify-between border-b border-[#E5E5E5] pb-1.5">
            <span className="font-medium text-[#111111] uppercase text-[10px] tracking-wider font-sans">
              {colorMode === "source" ? "Source Classification Legend" : "Satellite Sensor Legend"}
            </span>
            <span className="text-[10px] text-[#111111] font-semibold font-mono tabular-nums">
              {filteredObs.length} Active
            </span>
          </div>

          {colorMode === "source" ? (
            /* Source Mode Legend */
            <div className="space-y-1.5 font-sans">
              {Object.entries(SOURCE_CATEGORIES).map(([code, meta]) => {
                const count = catCounts[code] || 0;
                return (
                  <div key={code} className="flex items-center justify-between text-[#666666]">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                      <span className="truncate">{meta.name}</span>
                    </span>
                    <span className="font-semibold text-[#111111] font-mono tabular-nums">{count}</span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 text-[#666666] pt-1 border-t border-[#E5E5E5]">
                <span className="w-3.5 h-2 border border-dashed border-[#111111] shrink-0" />
                <span>Pantanal AOI Boundary</span>
              </div>
            </div>
          ) : (
            /* Sensor Mode Legend */
            <div className="space-y-1.5 font-sans">
              <div className="flex items-center justify-between text-[#666666]">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
                  <span>MODIS 1km (Terra / Aqua)</span>
                </span>
                <span className="font-semibold text-[#111111] font-mono tabular-nums">{modisPlotted}</span>
              </div>

              <div className="flex items-center justify-between text-[#666666]">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span>VIIRS 375m (S-NPP / N20 / N21)</span>
                </span>
                <span className="font-semibold text-[#111111] font-mono tabular-nums">{viirsPlotted}</span>
              </div>

              <div className="flex items-center justify-between text-[#666666]">
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-emerald-500 bg-emerald-100 shrink-0" />
                  <span>Harmonized Clusters</span>
                </span>
                <span className="font-semibold text-emerald-700 font-mono tabular-nums">{filteredEvents.length}</span>
              </div>

              <div className="flex items-center gap-2 text-[#666666] pt-1 border-t border-[#E5E5E5]">
                <span className="w-3.5 h-2 border border-dashed border-[#111111] shrink-0" />
                <span>Pantanal AOI Boundary</span>
              </div>
            </div>
          )}

          <div className="text-[9px] text-[#888888] pt-1 border-t border-[#E5E5E5] flex items-center justify-between">
            <span>Size scales with Radiative Power.</span>
            <button 
              onClick={() => setColorMode(colorMode === "source" ? "sensor" : "source")}
              className="text-[#111111] font-medium hover:underline font-sans text-[10px]"
            >
              Toggle Colors
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
