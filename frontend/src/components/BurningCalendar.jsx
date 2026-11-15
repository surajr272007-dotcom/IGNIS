import React, { useState, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Flame, 
  TrendingUp, 
  AlertTriangle, 
  ChevronRight, 
  Filter,
  Info,
  Clock,
  Layers
} from 'lucide-react';

export default function BurningCalendar({
  calendarData,
  aoiMetadata,
  onSelectDate
}) {
  const [selectedYear, setSelectedYear] = useState("ALL");
  const [metricMode, setMetricMode] = useState("harmonized"); // harmonized, viirs, modis, frp
  const [hoveredCell, setHoveredCell] = useState(null);

  const years = calendarData?.years_available || [2022, 2023, 2024, 2025];
  const doyMatrix = calendarData?.doy_matrix || {};
  const baselines = calendarData?.doy_baselines || {};
  const season = calendarData?.season_profile || {};
  const dailyTimeline = calendarData?.daily_timeline || [];
  const monthlySummary = calendarData?.monthly_summary || [];

  // Filter daily timeline by selected year if needed
  const activeTimeline = useMemo(() => {
    if (selectedYear === "ALL") {
      // Return 2024 or latest year for timeline chart
      const targetYear = years[years.length - 1] || 2024;
      return dailyTimeline.filter(d => d.year === targetYear);
    }
    return dailyTimeline.filter(d => d.year === Number(selectedYear));
  }, [dailyTimeline, selectedYear, years]);

  // Color mapper for heatmap cells (light theme compliant)
  const getCellColor = (val, maxVal) => {
    if (!val || val <= 0) return "#F0F0F0"; // subtle off-white / light grey
    const intensity = Math.min(1.0, val / Math.max(1, maxVal));
    if (intensity < 0.2) return "#FDE68A";  // light amber
    if (intensity < 0.45) return "#F59E0B"; // amber
    if (intensity < 0.75) return "#EA580C"; // flame orange
    return "#DC2626";                       // surge red
  };

  // Calculate max values for color scaling
  const maxMetricVal = useMemo(() => {
    let maxV = 1;
    Object.values(doyMatrix).forEach(yearDict => {
      Object.values(yearDict).forEach(rec => {
        const val = metricMode === "harmonized" ? rec.index : (
          metricMode === "viirs" ? rec.viirs : (
            metricMode === "modis" ? rec.modis : rec.frp
          )
        );
        if (val > maxV) maxV = val;
      });
    });
    return maxV;
  }, [doyMatrix, metricMode]);

  // Month names and approximate starting day of year (non-leap year)
  const monthMarkers = [
    { name: "Jan", startDoy: 1, days: 31 },
    { name: "Feb", startDoy: 32, days: 28 },
    { name: "Mar", startDoy: 60, days: 31 },
    { name: "Apr", startDoy: 91, days: 30 },
    { name: "May", startDoy: 121, days: 31 },
    { name: "Jun", startDoy: 152, days: 30 },
    { name: "Jul", startDoy: 182, days: 31 },
    { name: "Aug", startDoy: 213, days: 31 },
    { name: "Sep", startDoy: 244, days: 30 },
    { name: "Oct", startDoy: 274, days: 31 },
    { name: "Nov", startDoy: 305, days: 30 },
    { name: "Dec", startDoy: 335, days: 31 }
  ];

  return (
    <div className="space-y-6">
      
      {/* Module Header & Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-[#111111]" />
            <h2 className="text-xl font-semibold text-[#111111] tracking-tight font-sans">
              Harmonized Burning Activity Calendar
            </h2>
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono font-medium">
              SAMPLE BENCHMARK
            </span>
          </div>
          <p className="text-xs text-[#666666] mt-1 max-w-2xl font-sans">
            Reconciles disparate NASA MODIS and VIIRS satellite active fire cycles into a consistent climatological burning calendar across years.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Year select */}
          <div className="flex items-center gap-1.5 text-xs font-sans">
            <span className="text-[#888888] font-sans text-[10px] uppercase font-medium">Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-white text-[#111111] border border-[#E5E5E5] rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-[#111111] font-mono tabular-nums"
            >
              <option value="ALL">All Multi-Year Years</option>
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Metric mode toggle */}
          <div className="flex items-center gap-1.5 text-xs font-sans">
            <span className="text-[#888888] font-sans text-[10px] uppercase font-medium">Metric:</span>
            <div className="inline-flex rounded-lg bg-white border border-[#E5E5E5] p-0.5">
              {[
                { id: "harmonized", label: "Harmonized" },
                { id: "viirs", label: "VIIRS 375m" },
                { id: "modis", label: "MODIS 1km" }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setMetricMode(m.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-all ${
                    metricMode === m.id
                      ? "bg-[#111111] text-white shadow-xs"
                      : "text-[#666666] hover:text-[#111111]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* 1. Multi-Year Day-of-Year (DOY 1-365) Heatmap Matrix */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-sm font-sans">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h3 className="font-medium text-sm text-[#111111] font-sans flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#111111]" />
              <span>Multi-Year Day-of-Year Burning Matrix (DOY 1 – 365)</span>
            </h3>
            <p className="text-[11px] text-[#666666] font-sans">
              Inspect historical seasonal fire cycles, annual recurrence patterns, and anomalous fire shifts.
            </p>
          </div>

          {/* Heatmap Legend */}
          <div className="flex items-center gap-2 text-[10px] font-sans text-[#888888]">
            <span>Zero Burning</span>
            <div className="flex items-center gap-0.5">
              <span className="w-2.5 h-2.5 rounded-xs border border-[#E5E5E5]" style={{ backgroundColor: "#F0F0F0" }} />
              <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: "#FDE68A" }} />
              <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: "#F59E0B" }} />
              <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: "#EA580C" }} />
              <span className="w-2.5 h-2.5 rounded-xs" style={{ backgroundColor: "#DC2626" }} />
            </div>
            <span className="text-red-600 font-medium font-sans">Severe Surge</span>
          </div>
        </div>

        {/* Matrix Container */}
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[850px]">
            
            {/* Month header labels */}
            <div className="grid grid-cols-12 text-[10px] font-sans text-[#888888] pb-1 border-b border-[#E5E5E5] pl-16">
              {monthMarkers.map(m => (
                <div key={m.name} className="text-center font-medium font-sans">
                  {m.name}
                </div>
              ))}
            </div>

            {/* Matrix rows (one per year) */}
            <div className="space-y-1.5 pt-2">
              {years.map(year => {
                if (selectedYear !== "ALL" && Number(selectedYear) !== year) return null;

                return (
                  <div key={year} className="flex items-center gap-2">
                    <span className="w-14 text-xs font-mono tabular-nums text-[#666666] font-medium shrink-0">
                      {year}
                    </span>
                    <div className="flex-1 flex gap-[1.5px] h-7 bg-white p-0.5 rounded border border-[#E5E5E5]">
                      {Array.from({ length: 365 }, (_, idx) => {
                        const doy = idx + 1;
                        const cellData = doyMatrix[doy]?.[year];
                        const val = cellData ? (
                          metricMode === "harmonized" ? cellData.index : (
                            metricMode === "viirs" ? cellData.viirs : (
                              metricMode === "modis" ? cellData.modis : cellData.frp
                            )
                          )
                        ) : 0;
                        const bgColor = getCellColor(val, maxMetricVal);

                        return (
                          <div
                            key={doy}
                            onMouseEnter={() => setHoveredCell({ doy, year, data: cellData, val })}
                            onMouseLeave={() => setHoveredCell(null)}
                            style={{ backgroundColor: bgColor }}
                            className="flex-1 rounded-[1px] hover:ring-2 hover:ring-[#111111] transition-all cursor-pointer"
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        </div>

        {/* Interactive Cell Hover Inspector Card */}
        {hoveredCell && (
          <div className="p-3 bg-white border border-[#E5E5E5] rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs font-mono tabular-nums shadow-md animate-fade-in-up">
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 bg-[#111111] text-white rounded font-medium font-sans text-xs">
                Year {hoveredCell.year} • DOY {hoveredCell.doy}
              </span>
              <span className="text-[#111111]">
                Metric Value: <strong className="text-[#111111] text-sm font-semibold">{hoveredCell.val || 0}</strong>
              </span>
            </div>
            {hoveredCell.data ? (
              <div className="flex items-center gap-4 text-[#666666]">
                <span>Harmonized Events: <strong className="text-emerald-700 font-semibold">{hoveredCell.data.events}</strong></span>
                <span>MODIS: <strong className="text-red-600 font-semibold">{hoveredCell.data.modis}</strong></span>
                <span>VIIRS: <strong className="text-amber-600 font-semibold">{hoveredCell.data.viirs}</strong></span>
                <span>Total FRP: <strong className="text-[#111111] font-semibold">{hoveredCell.data.frp} MW</strong></span>
              </div>
            ) : (
              <span className="text-[#888888] font-sans">No active fire observations detected on this day.</span>
            )}
          </div>
        )}
      </div>

      {/* 2. Seasonal Fire Regime Markers */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 shadow-sm">
          <span className="text-[10px] font-sans text-[#888888] uppercase block font-medium">Fire Season Onset</span>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            DOY {season.onset_doy || 215}
          </div>
          <p className="text-[11px] text-[#666666] mt-1 font-sans">
            Climatological 10% annual cumulative fire threshold.
          </p>
        </div>

        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 shadow-sm">
          <span className="text-[10px] font-sans text-[#111111] uppercase block font-medium">Peak Burning Window</span>
          <div className="text-xl font-semibold font-mono tabular-nums text-amber-600 mt-1">
            DOY {season.peak_doy || 256} ({season.peak_month_name || "Sept"})
          </div>
          <p className="text-[11px] text-[#666666] mt-1 font-sans">
            Historical maximum diurnal fire count and radiant heat.
          </p>
        </div>

        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 shadow-sm">
          <span className="text-[10px] font-sans text-emerald-700 uppercase block font-medium">Season Cessation</span>
          <div className="text-xl font-semibold font-mono tabular-nums text-emerald-700 mt-1">
            DOY {season.cessation_doy || 312}
          </div>
          <p className="text-[11px] text-[#666666] mt-1 font-sans">
            Climatological 90% annual cumulative fire threshold.
          </p>
        </div>

        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 shadow-sm">
          <span className="text-[10px] font-sans text-[#888888] uppercase block font-medium">Annual Active Burning Days</span>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {season.total_active_days || 95} Days
          </div>
          <p className="text-[11px] text-[#666666] mt-1 font-sans">
            Days with at least 1 verified fire complex.
          </p>
        </div>

      </div>

      {/* 3. Daily Harmonized Fire Index vs Climatological Baseline Envelope */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-sm font-sans">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-medium text-sm text-[#111111] font-sans flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-700" />
              <span>Daily Harmonized Fire Activity vs Climatological Baseline</span>
            </h3>
            <p className="text-[11px] text-[#666666] font-sans">
              Solid emerald line shows harmonized fire index for {selectedYear === "ALL" ? "2024 / Recent Cycle" : selectedYear}; dashed line is 5-year climatological median; shaded area is 90th percentile envelope.
            </p>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-sans font-medium">
            <span className="flex items-center gap-1.5 text-emerald-700">
              <span className="w-3 h-0.5 bg-emerald-600" /> Harmonized Activity
            </span>
            <span className="flex items-center gap-1.5 text-amber-700">
              <span className="w-3 h-0.5 bg-amber-500 border-b border-dashed" /> Baseline Median
            </span>
            <span className="flex items-center gap-1.5 text-[#888888]">
              <span className="w-3 h-2 bg-[#E5E5E5] rounded-xs" /> 90th Percentile
            </span>
          </div>
        </div>

        {/* SVG Timeline Chart */}
        <div className="h-64 w-full bg-white rounded-lg border border-[#E5E5E5] p-4 relative flex flex-col justify-end shadow-xs">
          <div className="w-full h-48 relative flex items-end">
            {activeTimeline.length === 0 ? (
              <div className="w-full text-center text-xs text-[#888888] self-center font-sans">
                No observations found for selected year filter.
              </div>
            ) : (
              activeTimeline.slice(0, 120).map((d, idx) => {
                const maxChartH = 180;
                const hVal = Math.min(maxChartH, Math.max(2, (d.harmonized_fire_index / 20.0) * maxChartH));
                const bVal = Math.min(maxChartH, Math.max(2, ((d.baseline_median || 0) / 20.0) * maxChartH));
                const isAnomaly = d.anomaly_level === "SEVERE" || d.anomaly_level === "ELEVATED";

                return (
                  <div
                    key={d.date}
                    className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  >
                    {/* Tooltip on hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 z-30 pointer-events-none p-2 bg-white border border-[#E5E5E5] rounded shadow-xl text-[10px] font-mono tabular-nums whitespace-nowrap text-[#111111]">
                      <div className="font-semibold text-[#111111]">{d.date} (DOY {d.day_of_year})</div>
                      <div className="text-emerald-700">Harmonized Index: {d.harmonized_fire_index}</div>
                      <div className="text-amber-700">Baseline: {d.baseline_median}</div>
                      <div className="text-[#666666]">Events: {d.harmonized_event_count} | FRP: {d.harmonized_frp_mw} MW</div>
                      {isAnomaly && (
                        <div className="text-red-600 font-semibold mt-1">ANOMALY: {d.anomaly_level}</div>
                      )}
                    </div>

                    {/* Baseline indicator tick */}
                    <div
                      style={{ height: `${bVal}px` }}
                      className="absolute bottom-0 w-full border-t border-amber-500/70 border-dashed pointer-events-none"
                    />

                    {/* Activity Bar */}
                    <div
                      style={{ height: `${hVal}px` }}
                      className={`w-full rounded-t-xs transition-all ${
                        isAnomaly ? "bg-red-500 shadow-xs" : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    />
                  </div>
                );
              })
            )}
          </div>
          
          <div className="flex justify-between items-center text-[10px] font-sans text-[#888888] pt-2 border-t border-[#E5E5E5] mt-1">
            <span>Fire Season Start</span>
            <span>Mid-Season Peak</span>
            <span>Fire Season End</span>
          </div>
        </div>
      </div>

      {/* 4. Monthly Sensor Contribution Comparison */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-sm font-sans">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm text-[#111111] font-sans flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#111111]" />
            <span>Monthly Fire Detections by Sensor</span>
          </h3>
          <span className="text-[10px] font-sans text-[#888888] uppercase font-medium">MODIS vs VIIRS vs Harmonized</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {monthlySummary.slice(-6).map((m) => (
            <div key={m.year_month} className="p-3 rounded-lg bg-white border border-[#E5E5E5] text-xs space-y-2 shadow-xs">
              <span className="font-mono tabular-nums text-[#111111] font-semibold block text-[11px] border-b border-[#E5E5E5] pb-1">
                {m.year_month}
              </span>
              <div className="space-y-1 font-mono tabular-nums text-[10px]">
                <div className="flex justify-between text-red-600">
                  <span className="font-sans">MODIS:</span>
                  <strong className="font-semibold">{m.modis_count}</strong>
                </div>
                <div className="flex justify-between text-amber-600">
                  <span className="font-sans">VIIRS:</span>
                  <strong className="font-semibold">{m.viirs_count}</strong>
                </div>
                <div className="flex justify-between text-emerald-700 pt-1 border-t border-[#E5E5E5] font-semibold">
                  <span className="font-sans">Events:</span>
                  <strong className="font-semibold">{m.event_count}</strong>
                </div>
                <div className="flex justify-between text-[#666666]">
                  <span className="font-sans">FRP:</span>
                  <span>{m.total_frp_mw} MW</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
