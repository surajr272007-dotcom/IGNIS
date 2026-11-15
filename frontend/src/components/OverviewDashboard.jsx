import React from 'react';
import { 
  Flame, 
  Layers, 
  Radio, 
  Calendar, 
  TrendingUp, 
  AlertCircle, 
  ArrowUpRight,
  ShieldAlert,
  Info,
  RefreshCw,
  CheckCircle2,
  Database,
  Globe
} from 'lucide-react';
import AnimatedCounter from './AnimatedCounter';

export default function OverviewDashboard({
  aoiMetadata,
  summary,
  harmonizationMetrics,
  classificationSummary = null,
  calendarData,
  onNavigate,
  onOpenRefreshModal,
  datasetMode,
  isLive
}) {
  const modisCount = summary?.modis_count || 0;
  const viirsCount = summary?.viirs_count || 0;
  const totalObs = summary?.total || 0;
  const totalEvents = harmonizationMetrics?.total_fire_events || 0;
  const ratio = harmonizationMetrics?.viirs_to_modis_ratio || (modisCount > 0 ? (viirsCount / modisCount).toFixed(2) : '1.0');
  const reductionFactor = harmonizationMetrics?.spatial_reduction_factor || (totalEvents > 0 ? (totalObs / totalEvents).toFixed(1) : '1.0');

  const effectiveClassification = 
    classificationSummary || 
    harmonizationMetrics?.classification_summary || 
    summary?.classification_summary || 
    null;

  const season = calendarData?.season_profile;

  return (
    <div className="space-y-6 font-sans">
      
      {/* Live Data vs Sample Archive Callout Banner */}
      <div className="p-4 rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] text-[#111111] flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all animate-enter">
        <div className="flex items-start sm:items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full mt-1 sm:mt-0 shrink-0 ${
            isLive ? 'bg-emerald-500 live-pulse' : 'bg-amber-500'
          }`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs uppercase font-mono tracking-wider text-[#111111]">
                {isLive ? "LIVE SATELLITE FEED (NASA FIRMS)" : "ACTIVE APPLICATION DATASET: SAMPLE DATA"}
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white border border-[#E5E5E5] text-[#666666] font-medium">
                {isLive ? "Genuine Active Detections" : "NASA Reference Archive"}
              </span>
            </div>
            <p className="text-xs text-[#666666] mt-0.5 font-normal">
              {isLive ? (
                <>Acquisition Window: <strong className="text-[#111111] font-mono tabular-nums font-medium">{summary?.earliest_date}</strong> to <strong className="text-[#111111] font-mono tabular-nums font-medium">{summary?.latest_date}</strong> • Active Sensors: MODIS (Terra/Aqua) + VIIRS (S-NPP/NOAA-20/NOAA-21)</>
              ) : (
                <>Displaying reference sample observations for MODIS MCD14DL (1km) & VIIRS VNP14IMGTDL (375m). Benchmarked across multi-year fire regimes for scientific harmonization validation.</>
              )}
            </p>
          </div>
        </div>

        <button
          onClick={onOpenRefreshModal}
          className="flex items-center gap-2 px-3.5 py-2 bg-[#111111] hover:bg-[#222222] text-white text-xs font-sans font-medium rounded-lg shadow-xs transition-all shrink-0 active:scale-95 btn-interactive"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh NASA Data</span>
        </button>
      </div>

      {/* Region Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-[#E5E5E5] bg-[#FAFAFA] p-6 shadow-xs animate-enter stagger-1">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded-md bg-white text-[#111111] border border-[#E5E5E5] text-[10px] font-mono uppercase tracking-wider font-medium">
                {aoiMetadata?.country} • {aoiMetadata?.country_code}
              </span>
              <span className="text-[#888888] text-xs font-mono tabular-nums">
                BBox: [{aoiMetadata?.bbox?.join(', ')}]
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-semibold text-[#111111] tracking-tight">
              {aoiMetadata?.name || "Global Fire Regime"}
            </h1>
            <p className="text-xs sm:text-sm text-[#666666] mt-1 max-w-2xl leading-relaxed font-normal">
              {aoiMetadata?.description}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onNavigate('globe')}
              className="px-4 py-2 bg-[#111111] hover:bg-[#222222] text-white font-medium text-xs rounded-lg transition-all shadow-xs flex items-center gap-1.5 btn-interactive"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Launch 3D Globe</span>
            </button>
            <button
              onClick={() => onNavigate('map')}
              className="px-4 py-2 bg-white border border-[#E5E5E5] hover:border-[#111111] text-[#111111] text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 shadow-2xs btn-interactive"
            >
              <span>2D Fire Map</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[#666666]" />
            </button>
          </div>
        </div>

        {/* Ecozone & Regime Metadata Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 pt-5 border-t border-[#E5E5E5] text-xs">
          <div>
            <span className="text-[#888888] block uppercase text-[10px] tracking-wider font-mono">Ecozone</span>
            <span className="font-medium text-[#111111] mt-0.5 block">{aoiMetadata?.ecozone || "Global Savanna"}</span>
          </div>
          <div>
            <span className="text-[#888888] block uppercase text-[10px] tracking-wider font-mono">Peak Fire Window</span>
            <span className="font-medium text-[#111111] mt-0.5 block">{aoiMetadata?.peak_season || "August - October"}</span>
          </div>
          <div>
            <span className="text-[#888888] block uppercase text-[10px] tracking-wider font-mono">Typical Sensor Ratio</span>
            <span className="font-mono tabular-nums text-[#111111] mt-0.5 block font-medium">{aoiMetadata?.typical_viirs_to_modis_ratio}x pixel density</span>
          </div>
          <div>
            <span className="text-[#888888] block uppercase text-[10px] tracking-wider font-mono">Primary Burning Regime</span>
            <span className="font-medium text-[#111111] mt-0.5 block truncate" title={aoiMetadata?.fire_type}>
              {aoiMetadata?.fire_type || "Surface vegetation fire"}
            </span>
          </div>
        </div>
      </div>

      {/* Core Intelligence Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Observations */}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 hover:border-[#CCCCCC] transition-all hover:-translate-y-0.5 shadow-2xs animate-enter stagger-2">
          <div className="flex items-center justify-between text-[#888888] mb-3">
            <span className="text-xs uppercase tracking-wider font-mono font-medium">Raw Detections</span>
            <Radio className="w-4 h-4 text-[#111111]" />
          </div>
          <div className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#111111] tracking-tight">
            <AnimatedCounter value={totalObs} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[#666666] pt-3 border-t border-[#E5E5E5] font-mono tabular-nums">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
              MODIS: <strong className="text-[#111111] font-medium"><AnimatedCounter value={modisCount} /></strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
              VIIRS: <strong className="text-[#111111] font-medium"><AnimatedCounter value={viirsCount} /></strong>
            </span>
          </div>
        </div>

        {/* Card 2: Harmonized Fire Events */}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 hover:border-[#CCCCCC] transition-all hover:-translate-y-0.5 shadow-2xs animate-enter stagger-3">
          <div className="flex items-center justify-between text-[#888888] mb-3">
            <span className="text-xs uppercase tracking-wider font-mono font-medium">Harmonized Events</span>
            <Layers className="w-4 h-4 text-[#111111]" />
          </div>
          <div className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#111111] tracking-tight">
            <AnimatedCounter value={totalEvents} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[#666666] pt-3 border-t border-[#E5E5E5] font-mono tabular-nums">
            <span>Spatial Compression:</span>
            <span className="text-[#111111] font-medium">{reductionFactor}x clustered</span>
          </div>
        </div>

        {/* Card 3: VIIRS to MODIS Sensor Ratio */}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 hover:border-[#CCCCCC] transition-all hover:-translate-y-0.5 shadow-2xs animate-enter stagger-4">
          <div className="flex items-center justify-between text-[#888888] mb-3">
            <span className="text-xs uppercase tracking-wider font-mono font-medium">Sensor Scaling Factor</span>
            <TrendingUp className="w-4 h-4 text-[#111111]" />
          </div>
          <div className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#111111] tracking-tight">
            {ratio}x
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[#666666] pt-3 border-t border-[#E5E5E5] font-mono">
            <span>Resolution Bias:</span>
            <span className="text-[#111111] font-medium">375m vs 1000m</span>
          </div>
        </div>

        {/* Card 4: Historical Span & Energy */}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 hover:border-[#CCCCCC] transition-all hover:-translate-y-0.5 shadow-2xs animate-enter stagger-5">
          <div className="flex items-center justify-between text-[#888888] mb-3">
            <span className="text-xs uppercase tracking-wider font-mono font-medium">Radiative Power</span>
            <Flame className="w-4 h-4 text-[#EF4444]" />
          </div>
          <div className="text-2xl sm:text-3xl font-semibold font-mono tabular-nums text-[#111111] tracking-tight">
            <AnimatedCounter value={summary?.total_frp || 0} /> <span className="text-xs font-normal font-sans text-[#666666]">MW</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-[#666666] pt-3 border-t border-[#E5E5E5] font-mono tabular-nums">
            <span>Active Span:</span>
            <span className="text-[#111111] font-medium">
              {summary?.earliest_date || 'N/A'} – {summary?.latest_date || 'N/A'}
            </span>
          </div>
        </div>

      </div>

      {/* Fire Source Classification Breakdown Bar */}
      {effectiveClassification && effectiveClassification.categories && (
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 shadow-2xs space-y-3 animate-enter stagger-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E5E5E5] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#111111]" />
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-[#111111]">
                Fire Source Classification Telemetry
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white border border-[#E5E5E5] text-[#111111] font-medium">
                Predominant: {effectiveClassification.predominant_source || "Likely Forest Wildfire"}
              </span>
            </div>
            <button
              onClick={() => onNavigate('map')}
              className="text-xs font-mono text-[#111111] hover:underline flex items-center gap-1 self-start sm:self-auto font-medium"
            >
              <span>View Classified Sources on Fire Map</span>
              <ArrowUpRight className="w-3 h-3 text-[#666666]" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            {Object.entries(effectiveClassification.categories).map(([code, cat]) => (
              <div 
                key={code}
                onClick={() => onNavigate('map')}
                className="p-3 rounded-lg bg-white border border-[#E5E5E5] hover:border-[#111111] cursor-pointer transition-all space-y-1.5 shadow-2xs btn-interactive"
              >
                <div className="flex items-center justify-between text-[#666666]">
                  <span className="flex items-center gap-1.5 truncate text-[11px]" title={cat.name}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="truncate text-[#111111] font-medium">{cat.name.replace("Likely ", "").replace("Possible ", "")}</span>
                  </span>
                  <strong className="text-[#111111] text-xs"><AnimatedCounter value={cat.count} /></strong>
                </div>
                <div className="flex justify-between text-[10px] text-[#888888] pt-1 border-t border-[#F0F0F0]">
                  <span>{cat.pct}%</span>
                  <span className="text-[#111111] font-semibold">{cat.total_frp_mw} MW</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Critical Scientific Harmonization Callout */}
      <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5] flex items-start gap-3.5 shadow-2xs">
        <Info className="w-5 h-5 text-[#111111] shrink-0 mt-0.5" />
        <div className="text-xs text-[#666666] leading-relaxed space-y-1">
          <span className="font-semibold text-[#111111] block">
            Why Sensor Harmonization Matters (NASA Space Apps Challenge 2026 Core Principle):
          </span>
          <p>
            NASA’s VIIRS instrument operates at <strong>375 m resolution</strong> with high sub-pixel radiometric sensitivity, 
            detecting small, cool fires down to ~0.1 MW. In contrast, MODIS operates at <strong>1000 m resolution</strong> with a typical detection threshold around 8–10 MW. 
            Because of this 7-fold spatial resolution difference, VIIRS naturally records <strong>{ratio} times more fire pixels</strong> over the same fire front. 
            IGNIS applies spatial-temporal clustering and empirical scaling to prevent false historical trends and provide a unified burning calendar.
          </p>
        </div>
      </div>

      {/* Two Column Layout: Seasonal Breakdown & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Seasonal Regime Profile */}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-[#111111] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#111111]" />
              <span>Seasonal Burning Regime Profile</span>
            </h3>
            <span className="text-[10px] font-mono text-[#888888] uppercase">
              {isLive ? "Live Window" : "Multi-Year Climatology"}
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-[#E5E5E5] text-xs">
              <div>
                <span className="text-[#888888] block text-[10px] uppercase font-mono">Fire Season Onset</span>
                <span className="font-semibold text-[#111111] mt-0.5 block">
                  DOY {season?.onset_doy || "210"}
                </span>
              </div>
              <span className="px-2 py-1 rounded bg-[#FAFAFA] text-[#111111] font-mono text-[11px] border border-[#E5E5E5] font-medium">
                10% Cumulative Burn
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-[#E5E5E5] text-xs">
              <div>
                <span className="text-[#888888] block text-[10px] uppercase font-mono">Peak Burning Window</span>
                <span className="font-semibold text-[#111111] mt-0.5 block">
                  DOY {season?.peak_doy || "256"} ({season?.peak_month_name || "September"})
                </span>
              </div>
              <span className="px-2 py-1 rounded bg-[#111111] text-white font-mono text-[11px] font-medium">
                Max Fire Intensity
              </span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-white border border-[#E5E5E5] text-xs">
              <div>
                <span className="text-[#888888] block text-[10px] uppercase font-mono">Fire Season Cessation</span>
                <span className="font-semibold text-[#111111] mt-0.5 block">
                  DOY {season?.cessation_doy || "310"}
                </span>
              </div>
              <span className="px-2 py-1 rounded bg-[#FAFAFA] text-[#111111] font-mono text-[11px] border border-[#E5E5E5] font-medium">
                90% Cumulative Burn
              </span>
            </div>
          </div>
        </div>

        {/* Sensor Comparison Summary */}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-[#111111] flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#111111]" />
              <span>Sensor Resolution & Coverage Balance</span>
            </h3>
            <span className="text-[10px] font-mono text-[#888888] uppercase">MODIS vs VIIRS</span>
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="p-3 rounded-lg bg-white border border-[#E5E5E5] text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-[#111111] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
                  NASA MODIS (Terra & Aqua)
                </span>
                <span className="font-mono text-[#111111] font-semibold">
                  <AnimatedCounter value={modisCount} /> pts ({totalObs > 0 ? (modisCount/totalObs*100).toFixed(1) : 0}%)
                </span>
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                1 km nominal resolution. Proven 25+ year climate baseline (2000–present). 
                Captures high-intensity flaming fronts.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-white border border-[#E5E5E5] text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-[#111111] flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                  NASA / NOAA VIIRS (S-NPP, NOAA-20, NOAA-21)
                </span>
                <span className="font-mono text-[#111111] font-semibold">
                  <AnimatedCounter value={viirsCount} /> pts ({totalObs > 0 ? (viirsCount/totalObs*100).toFixed(1) : 0}%)
                </span>
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                375 m I-band resolution. Captures small agricultural, smoldering peat, and fragmented perimeter fires. 
                Higher spatial resolution across swath edge.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
