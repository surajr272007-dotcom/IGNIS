import React, { useState } from 'react';
import { 
  Layers, 
  Sliders, 
  HelpCircle, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Radio, 
  Cpu, 
  Maximize2,
  Trees,
  Sprout,
  Factory,
  ShieldCheck,
  Info,
  Clock,
  Compass,
  Zap,
  ChevronDown,
  ChevronUp,
  Satellite,
  Flame
} from 'lucide-react';

const SOURCE_META = {
  FOREST_WILDFIRE: {
    name: "Likely Forest Wildfire",
    color: "#EF4444",
    badge: "bg-red-950/60 text-red-400 border-red-800/60",
    icon: Trees,
    desc: "Sprawling, high-energy burning in native wetland, riparian gallery forests, or wooded reserves."
  },
  AGRICULTURAL_BURNING: {
    name: "Possible Agricultural Burning",
    color: "#F59E0B",
    badge: "bg-amber-950/60 text-amber-400 border-amber-800/60",
    icon: Sprout,
    desc: "Confined, diurnal burning on managed pastureland, crop stubble, or agro-pastoral margins."
  },
  INDUSTRIAL_HEAT: {
    name: "Possible Industrial Heat",
    color: "#A855F7",
    badge: "bg-purple-950/60 text-purple-400 border-purple-800/60",
    icon: Factory,
    desc: "Persistent stationary thermal emissions near refineries, power plants, cement kilns, or flaring stacks."
  },
  UNKNOWN: {
    name: "Unknown Thermal Anomaly",
    color: "#94A3B8",
    badge: "bg-slate-900/60 text-slate-400 border-slate-700/60",
    icon: HelpCircle,
    desc: "Faint or ambiguous single-pixel anomalies lacking decisive evidence to establish probable source."
  }
};

export default function HarmonizationView({
  harmonizationMetrics,
  sampleEvents = [],
  classificationSummary = null,
  aoiMetadata,
  onUpdateThreshold,
  loading = false
}) {
  const [spatialRadiusKm, setSpatialRadiusKm] = useState(1.5);
  const [temporalWindowHours, setTemporalWindowHours] = useState(2.5);
  const [selectedCompositionFilter, setSelectedCompositionFilter] = useState("ALL");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("ALL");
  const [expandedEventId, setExpandedEventId] = useState(null);

  const metrics = harmonizationMetrics || {};
  const totalObs = metrics.total_observations || 0;
  const modisObs = metrics.modis_observations || 0;
  const viirsObs = metrics.viirs_observations || 0;
  const totalEvents = metrics.total_fire_events || 0;
  const ratio = metrics.viirs_to_modis_ratio || 1.0;
  const reduction = metrics.spatial_reduction_factor || 1.0;

  const coincident = metrics.coincident_events || 0;
  const viirsOnly = metrics.viirs_only_events || 0;
  const modisOnly = metrics.modis_only_events || 0;

  const matchedModis = metrics.matched_modis_count || coincident;
  const matchedViirs = metrics.matched_viirs_count || 0;
  const modisMatchRate = metrics.modis_match_rate_pct || 0.0;
  const viirsMatchRate = metrics.viirs_match_rate_pct || 0.0;

  const agreement = metrics.sensor_agreement || {};
  const meanSpatialOffset = agreement.mean_spatial_offset_km || 0.0;
  const meanTemporalDelta = agreement.mean_temporal_offset_min || 0.0;
  const meanFrpRatio = agreement.mean_frp_ratio || 1.0;
  const exactConservation = metrics.exact_conservation_verified ?? true;

  const handleApplyThresholds = () => {
    if (onUpdateThreshold) {
      onUpdateThreshold(spatialRadiusKm, temporalWindowHours);
    }
  };

  const classCategories = classificationSummary?.categories || {};

  // Filter events based on composition and category
  const filteredEvents = sampleEvents.filter(ev => {
    if (selectedCompositionFilter !== "ALL") {
      const comp = ev.harmonization_type || ev.sensor_composition;
      if (comp !== selectedCompositionFilter) return false;
    }
    if (selectedCategoryFilter !== "ALL") {
      if (ev.classification_code !== selectedCategoryFilter) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 font-sans">
      
      {/* 1. Header & Interactive Matching Controls */}
      <div className="p-5 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-5 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#111111]" />
            <h2 className="text-xl font-semibold text-[#111111] tracking-tight font-sans">
              MODIS–VIIRS Sensor Harmonization Engine
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono font-medium">
              SAMPLE BENCHMARK
            </span>
          </div>
          <p className="text-xs text-[#666666] max-w-2xl leading-relaxed font-sans">
            Reconciles MODIS (1000m) and VIIRS (375m) thermal hotspots via geodesic distance and UTC acquisition coincidence into unified physical fire events, solving sensor resolution and diurnal overpass disparities.
          </p>
        </div>

        {/* Configurable Threshold Sliders */}
        <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-[#E5E5E5] shadow-xs">
          
          {/* Spatial Matching Radius */}
          <div className="space-y-1 min-w-[140px]">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-[#888888] uppercase flex items-center gap-1 font-sans font-medium text-[10px]">
                <Compass className="w-3 h-3 text-[#111111]" />
                Distance:
              </span>
              <strong className="text-[#111111] font-mono tabular-nums font-semibold">{spatialRadiusKm} km</strong>
            </div>
            <input
              type="range"
              min="0.5"
              max="5.0"
              step="0.5"
              value={spatialRadiusKm}
              onChange={(e) => setSpatialRadiusKm(parseFloat(e.target.value))}
              className="w-full accent-[#111111] cursor-pointer h-1 bg-[#E5E5E5] rounded"
            />
          </div>

          <div className="w-px h-8 bg-[#E5E5E5] hidden sm:block" />

          {/* Temporal Coincidence Window */}
          <div className="space-y-1 min-w-[140px]">
            <div className="flex justify-between text-[11px] font-mono">
              <span className="text-[#888888] uppercase flex items-center gap-1 font-sans font-medium text-[10px]">
                <Clock className="w-3 h-3 text-cyan-600" />
                Time Window:
              </span>
              <strong className="text-cyan-800 font-mono tabular-nums font-semibold">{temporalWindowHours} hrs</strong>
            </div>
            <input
              type="range"
              min="0.5"
              max="6.0"
              step="0.5"
              value={temporalWindowHours}
              onChange={(e) => setTemporalWindowHours(parseFloat(e.target.value))}
              className="w-full accent-cyan-600 cursor-pointer h-1 bg-[#E5E5E5] rounded"
            />
          </div>

          <button
            onClick={handleApplyThresholds}
            disabled={loading}
            className="px-3.5 py-2 bg-[#111111] hover:bg-[#222222] text-white font-medium rounded-lg text-xs font-sans transition-all active:scale-95 disabled:opacity-50 shadow-sm"
          >
            {loading ? "Harmonizing..." : "Reharmonize"}
          </button>
        </div>
      </div>

      {/* 2. Sensor Identification Comparison (Requirement 1) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* MODIS Sensor Profile */}
        <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5] space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5]">
            <div className="flex items-center gap-2">
              <Satellite className="w-4 h-4 text-red-600" />
              <h3 className="font-medium text-sm text-[#111111] font-sans">MODIS <span className="text-[#666666] font-normal text-xs">(Moderate Resolution Imaging Spectroradiometer)</span></h3>
            </div>
            <span className="px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-800 font-mono text-[10px] font-medium">
              1000m Native
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1 tabular-nums">
            <div>
              <span className="text-[#888888] text-[10px] block font-sans">Satellites</span>
              <strong className="text-[#111111] font-semibold">Terra / Aqua</strong>
            </div>
            <div>
              <span className="text-[#888888] text-[10px] block font-sans">Raw Observations</span>
              <strong className="text-red-600 text-sm font-semibold">{modisObs.toLocaleString()}</strong>
            </div>
            <div>
              <span className="text-[#888888] text-[10px] block font-sans">Overpass Phasing</span>
              <strong className="text-[#111111] font-semibold">~10:30 & ~13:30</strong>
            </div>
          </div>
          <p className="text-[11px] text-[#666666] leading-relaxed font-sans">
            Coarse 1000m resolution pixel footprint (1.0 km² nadir). Detection threshold ~8-10 MW FRP. Excellent baseline record spanning 2000 to present.
          </p>
        </div>

        {/* VIIRS Sensor Profile */}
        <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5] space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5]">
            <div className="flex items-center gap-2">
              <Satellite className="w-4 h-4 text-amber-600" />
              <h3 className="font-medium text-sm text-[#111111] font-sans">VIIRS <span className="text-[#666666] font-normal text-xs">(Visible Infrared Imaging Radiometer Suite)</span></h3>
            </div>
            <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-mono text-[10px] font-medium">
              375m High-Res
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono pt-1 tabular-nums">
            <div>
              <span className="text-[#888888] text-[10px] block font-sans">Satellites</span>
              <strong className="text-[#111111] font-semibold">S-NPP / NOAA-20 / N21</strong>
            </div>
            <div>
              <span className="text-[#888888] text-[10px] block font-sans">Raw Observations</span>
              <strong className="text-amber-600 text-sm font-semibold">{viirsObs.toLocaleString()}</strong>
            </div>
            <div>
              <span className="text-[#888888] text-[10px] block font-sans">Overpass Phasing</span>
              <strong className="text-[#111111] font-semibold">~13:30 (50m separation)</strong>
            </div>
          </div>
          <p className="text-[11px] text-[#666666] leading-relaxed font-sans">
            High spatial resolution (0.14 km² nadir, 7.1x smaller area). Sub-pixel fire detection down to 0.5 MW FRP. Detects smaller, cooler, and fragmented fires.
          </p>
        </div>

      </div>

      {/* 3. Harmonization Analytics (Requirement 6) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Dual-Sensor Confirmed */}
        <div 
          onClick={() => setSelectedCompositionFilter(selectedCompositionFilter === "DUAL_SENSOR_COINCIDENT" ? "ALL" : "DUAL_SENSOR_COINCIDENT")}
          className={`p-4 rounded-xl border transition-all cursor-pointer shadow-sm ${
            selectedCompositionFilter === "DUAL_SENSOR_COINCIDENT"
              ? "bg-cyan-50 border-cyan-400 ring-1 ring-cyan-400"
              : "bg-[#FAFAFA] border-[#E5E5E5] hover:border-cyan-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-cyan-800">
            <span className="font-medium font-sans uppercase tracking-wider text-[10px]">Dual-Sensor Confirmed</span>
            <CheckCircle className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {coincident.toLocaleString()} <span className="text-xs font-normal text-cyan-700 font-sans">events</span>
          </div>
          <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#666666] pt-2 border-t border-[#E5E5E5]">
            <div className="flex justify-between">
              <span className="font-sans">MODIS Match Rate:</span>
              <strong className="text-[#111111] font-semibold">{modisMatchRate}% ({matchedModis})</strong>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">VIIRS Encompassed:</span>
              <strong className="text-[#111111] font-semibold">{matchedViirs.toLocaleString()} pixels</strong>
            </div>
          </div>
        </div>

        {/* VIIRS-Only Detections */}
        <div 
          onClick={() => setSelectedCompositionFilter(selectedCompositionFilter === "VIIRS_ONLY" ? "ALL" : "VIIRS_ONLY")}
          className={`p-4 rounded-xl border transition-all cursor-pointer shadow-sm ${
            selectedCompositionFilter === "VIIRS_ONLY"
              ? "bg-amber-50 border-amber-400 ring-1 ring-amber-400"
              : "bg-[#FAFAFA] border-[#E5E5E5] hover:border-amber-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-amber-800">
            <span className="font-medium font-sans uppercase tracking-wider text-[10px]">VIIRS-Only Detections</span>
            <Radio className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {viirsOnly.toLocaleString()} <span className="text-xs font-normal text-amber-700 font-sans">events</span>
          </div>
          <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#666666] pt-2 border-t border-[#E5E5E5]">
            <div className="flex justify-between">
              <span className="font-sans">Share of Total Events:</span>
              <strong className="text-[#111111] font-semibold">{totalEvents > 0 ? ((viirsOnly / totalEvents) * 100).toFixed(1) : 0}%</strong>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">Sub-Kilometer Fires:</span>
              <strong className="text-[#111111] font-semibold">&lt;8 MW / High-Res</strong>
            </div>
          </div>
        </div>

        {/* MODIS-Only Detections */}
        <div 
          onClick={() => setSelectedCompositionFilter(selectedCompositionFilter === "MODIS_ONLY" ? "ALL" : "MODIS_ONLY")}
          className={`p-4 rounded-xl border transition-all cursor-pointer shadow-sm ${
            selectedCompositionFilter === "MODIS_ONLY"
              ? "bg-red-50 border-red-400 ring-1 ring-red-400"
              : "bg-[#FAFAFA] border-[#E5E5E5] hover:border-red-400"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-mono text-red-800">
            <span className="font-medium font-sans uppercase tracking-wider text-[10px]">MODIS-Only Detections</span>
            <Radio className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {modisOnly.toLocaleString()} <span className="text-xs font-normal text-red-700 font-sans">events</span>
          </div>
          <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#666666] pt-2 border-t border-[#E5E5E5]">
            <div className="flex justify-between">
              <span className="font-sans">Share of Total Events:</span>
              <strong className="text-[#111111] font-semibold">{totalEvents > 0 ? ((modisOnly / totalEvents) * 100).toFixed(1) : 0}%</strong>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">Temporal Origin:</span>
              <strong className="text-[#111111] font-semibold">Terra Morning / Wide</strong>
            </div>
          </div>
        </div>

        {/* Sensor Disparity & Calibration Ratio */}
        <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5] space-y-2 shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#888888]">
            <span className="font-medium font-sans uppercase tracking-wider text-[10px]">Calibration Ratio</span>
            <Maximize2 className="w-4 h-4 text-[#111111]" />
          </div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {ratio}x <span className="text-xs font-normal text-[#666666] font-sans">VIIRS / MODIS</span>
          </div>
          <div className="space-y-1 text-[11px] font-mono tabular-nums text-[#666666] pt-2 border-t border-[#E5E5E5]">
            <div className="flex justify-between">
              <span className="font-sans">Spatial Reduction:</span>
              <strong className="text-emerald-700 font-semibold">{reduction}x compression</strong>
            </div>
            <div className="flex justify-between">
              <span className="font-sans">Cumulative FRP:</span>
              <strong className="text-[#111111] font-semibold">{metrics.total_frp_mw?.toLocaleString() || 0} MW</strong>
            </div>
          </div>
        </div>

      </div>

      {/* 4. Sensor Agreement & Disagreement Panel */}
      <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5] space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E5E5E5] pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <h3 className="font-medium text-sm text-[#111111] font-sans">
              Sensor Agreement & Cross-Validation Metrics
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {exactConservation ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-mono text-emerald-800 font-medium flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-emerald-600" />
                100% Observation Conservation Verified
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-mono text-rose-800 font-medium">
                Conservation Discrepancy Detected
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono tabular-nums pt-1">
          <div className="p-3 rounded-lg bg-white border border-[#E5E5E5]">
            <span className="text-[#888888] text-[10px] block font-sans">Mean Geodesic Spatial Offset</span>
            <strong className="text-[#111111] text-base font-semibold block mt-0.5">{meanSpatialOffset} km</strong>
            <span className="text-[10px] text-[#666666] font-sans">Threshold: &le; {spatialRadiusKm} km</span>
          </div>

          <div className="p-3 rounded-lg bg-white border border-[#E5E5E5]">
            <span className="text-[#888888] text-[10px] block font-sans">Mean Overpass Time Difference</span>
            <strong className="text-[#111111] text-base font-semibold block mt-0.5">{meanTemporalDelta} min</strong>
            <span className="text-[10px] text-[#666666] font-sans">Threshold: &le; {temporalWindowHours * 60} min</span>
          </div>

          <div className="p-3 rounded-lg bg-white border border-[#E5E5E5]">
            <span className="text-[#888888] text-[10px] block font-sans">Mean Radiative Power Agreement (FRP Ratio)</span>
            <strong className="text-[#111111] text-base font-semibold block mt-0.5">{meanFrpRatio}x</strong>
            <span className="text-[10px] text-[#666666] font-sans">VIIRS Total FRP / MODIS FRP</span>
          </div>
        </div>
      </div>

      {/* 5. Harmonized Fire Event Registry Table */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E5E5] pb-3">
          <div>
            <h3 className="font-medium text-sm text-[#111111] font-sans flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-600" />
              <span>Harmonized Fire Event Complexes</span>
            </h3>
            <p className="text-xs text-[#666666] mt-0.5 font-sans">
              Unified fire events formed through mutually exclusive spatiotemporal matching. Click any event to inspect sensor details.
            </p>
          </div>

          {/* Composition Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-sans">
            {[
              { id: "ALL", label: "All Events" },
              { id: "DUAL_SENSOR_COINCIDENT", label: "Dual-Confirmed" },
              { id: "VIIRS_ONLY", label: "VIIRS Only" },
              { id: "MODIS_ONLY", label: "MODIS Only" }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedCompositionFilter(f.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  selectedCompositionFilter === f.id
                    ? "bg-[#111111] text-white shadow-xs"
                    : "bg-white border border-[#E5E5E5] text-[#666666] hover:text-[#111111]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Event List Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-[#E5E5E5] text-[#888888] uppercase text-[10px] font-sans font-medium">
                <th className="py-2.5 px-3">Event ID</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Date / UTC</th>
                <th className="py-2.5 px-3">Representative Coordinates</th>
                <th className="py-2.5 px-3">Spatial Offset</th>
                <th className="py-2.5 px-3">Time Delta</th>
                <th className="py-2.5 px-3">FRP (MW)</th>
                <th className="py-2.5 px-3">Pixels</th>
                <th className="py-2.5 px-3 text-right font-sans">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5] text-[#111111]">
              {filteredEvents.slice(0, 20).map((ev) => {
                const isCoincident = (ev.harmonization_type || ev.sensor_composition) === "DUAL_SENSOR_COINCIDENT" || ev.sensor_composition === "COINCIDENT";
                const isViirsOnly = ev.harmonization_type === "VIIRS_ONLY" || ev.sensor_composition === "VIIRS_ONLY";
                const isExpanded = expandedEventId === ev.event_id;

                return (
                  <React.Fragment key={ev.event_id}>
                    <tr 
                      onClick={() => setExpandedEventId(isExpanded ? null : ev.event_id)}
                      className="hover:bg-[#F5F5F5] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-3 text-[#111111] font-semibold">{ev.event_id}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap font-sans ${
                          isCoincident 
                            ? "bg-cyan-50 text-cyan-900 border-cyan-200"
                            : isViirsOnly
                            ? "bg-amber-50 text-amber-900 border-amber-200"
                            : "bg-red-50 text-red-900 border-red-200"
                        }`}>
                          {isCoincident ? "Dual Confirmed" : (isViirsOnly ? "VIIRS Only" : "MODIS Only")}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[#666666]">
                        {ev.date} {ev.acq_time ? `${ev.acq_time} UTC` : ""}
                      </td>
                      <td className="py-2.5 px-3">
                        {Number(ev.latitude).toFixed(3)}°, {Number(ev.longitude).toFixed(3)}°
                      </td>
                      <td className="py-2.5 px-3 text-[#111111]">
                        {isCoincident ? `${ev.spatial_offset_km || 0.0} km` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-cyan-700">
                        {isCoincident ? `${ev.temporal_offset_min || 0.0} min` : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-[#111111]">
                        {ev.total_frp} MW
                        {isCoincident && (
                          <span className="text-[10px] text-[#888888] font-normal ml-1">
                            (M: {ev.modis_frp} / V: {ev.viirs_total_frp})
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-[#888888]">
                        {ev.total_pixel_count || 1} px
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button className="text-[#111111] hover:text-[#666666] p-1">
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>

                    {/* Drill-down expanded view showing original observations */}
                    {isExpanded && (
                      <tr className="bg-white font-sans">
                        <td colSpan={9} className="p-4 space-y-3 border-t border-b border-[#E5E5E5]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            
                            {/* MODIS Observation Record */}
                            <div className="p-3 rounded-lg bg-[#FAFAFA] border border-red-200 space-y-1.5">
                              <span className="font-medium text-red-700 flex items-center gap-1.5 text-[11px]">
                                <Satellite className="w-3 h-3" />
                                MODIS Observation Reference
                              </span>
                              {ev.modis_observation || ev.primary_modis_id ? (
                                <div className="space-y-1 text-[#666666] text-[11px]">
                                  <div>ID: <strong className="text-[#111111] font-mono tabular-nums">{ev.primary_modis_id || ev.modis_observation?.id}</strong></div>
                                  <div>Satellite: <strong className="text-[#111111] font-mono">{ev.modis_observation?.satellite || "Aqua/Terra"}</strong></div>
                                  <div>FRP: <strong className="text-[#111111] font-mono tabular-nums">{ev.modis_frp || ev.modis_observation?.frp} MW</strong></div>
                                  <div>Centroid: <span className="font-mono tabular-nums">{ev.modis_latitude || ev.modis_observation?.latitude}°, {ev.modis_longitude || ev.modis_observation?.longitude}°</span></div>
                                </div>
                              ) : (
                                <span className="text-[#888888] text-[11px] italic">No coincident MODIS detection (VIIRS sub-pixel sensitivity).</span>
                              )}
                            </div>

                            {/* VIIRS Observation Record */}
                            <div className="p-3 rounded-lg bg-[#FAFAFA] border border-amber-200 space-y-1.5">
                              <span className="font-medium text-amber-700 flex items-center gap-1.5 text-[11px]">
                                <Satellite className="w-3 h-3" />
                                VIIRS Observation Reference(s) ({ev.viirs_pixel_count || 1} pixels)
                              </span>
                              {ev.viirs_observations?.length > 0 || ev.primary_viirs_id ? (
                                <div className="space-y-1 text-[#666666] text-[11px]">
                                  <div>Primary ID: <strong className="text-[#111111] font-mono tabular-nums">{ev.primary_viirs_id || ev.viirs_observations?.[0]?.id}</strong></div>
                                  <div>Total VIIRS FRP: <strong className="text-[#111111] font-mono tabular-nums">{ev.viirs_total_frp || ev.total_frp} MW</strong></div>
                                  <div>Representative Coords: <span className="font-mono tabular-nums text-emerald-700">{ev.latitude}°, {ev.longitude}°</span></div>
                                  <div>Concordance: <strong className="text-[#111111]">{ev.concordance_status || "Standard"}</strong></div>
                                </div>
                              ) : (
                                <span className="text-[#888888] text-[11px] italic">No coincident VIIRS detection (MODIS wide-scan morning overpass).</span>
                              )}
                            </div>

                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
