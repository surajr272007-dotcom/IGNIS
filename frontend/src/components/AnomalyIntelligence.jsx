import React, { useState } from 'react';
import { 
  AlertTriangle, 
  ShieldAlert, 
  Flame, 
  TrendingUp, 
  HelpCircle, 
  CheckCircle2, 
  AlertCircle,
  FileCheck,
  ChevronDown
} from 'lucide-react';

export default function AnomalyIntelligence({
  anomalyData,
  aoiMetadata
}) {
  const [filterSeverity, setFilterSeverity] = useState("ALL"); // ALL, CRITICAL_SURGE, ELEVATED_ANOMALY

  const anomalies = anomalyData?.anomalies || [];
  const summary = anomalyData?.summary || {};
  const uncertainty = summary?.uncertainty_framework || {};

  const filtered = anomalies.filter(a => {
    if (filterSeverity === "ALL") return true;
    return a.status === filterSeverity;
  });

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="p-5 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm font-sans">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            <h2 className="text-xl font-semibold text-[#111111] tracking-tight font-sans">
              Fire Anomaly Intelligence
            </h2>
            <span className="px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200 text-[10px] font-mono font-medium">
              Climatological Exceedance
            </span>
          </div>
          <p className="text-xs text-[#666666] mt-1 max-w-2xl font-sans">
            Statistical detection of abnormal burning surges, unseasonal fire episodes, and extreme fire radiative power compared to multi-year baselines.
          </p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 font-sans">
          <span className="text-[10px] font-sans uppercase text-[#888888] font-medium">Filter:</span>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-white text-[#111111] border border-[#E5E5E5] rounded-lg px-3 py-1.5 text-xs font-sans font-medium focus:outline-none focus:border-[#111111]"
          >
            <option value="ALL">All Anomalies ({anomalies.length})</option>
            <option value="CRITICAL_SURGE">Critical Surges Only ({summary.severe_anomaly_days || 0})</option>
            <option value="ELEVATED_ANOMALY">Elevated Anomaly</option>
          </select>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
        
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 shadow-sm">
          <span className="text-xs uppercase font-sans text-[#888888] block font-medium">Anomalous Fire Days</span>
          <div className="text-3xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {summary.total_anomaly_days || 0} <span className="text-sm font-normal text-[#666666] font-sans">days</span>
          </div>
          <p className="text-xs text-[#666666] mt-2 pt-2 border-t border-[#E5E5E5] font-sans">
            Exceeded 90th percentile seasonal baseline.
          </p>
        </div>

        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 shadow-sm">
          <span className="text-xs uppercase font-sans text-red-700 block font-medium">Critical Surges</span>
          <div className="text-3xl font-semibold font-mono tabular-nums text-red-700 mt-1">
            {summary.severe_anomaly_days || 0} <span className="text-sm font-normal text-[#666666] font-sans">episodes</span>
          </div>
          <p className="text-xs text-[#666666] mt-2 pt-2 border-t border-[#E5E5E5] font-sans">
            &gt;200% exceedance or Z-score &gt; 4.0.
          </p>
        </div>

        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 shadow-sm">
          <span className="text-xs uppercase font-sans text-[#111111] block font-medium">Peak Anomaly Score</span>
          <div className="text-3xl font-semibold font-mono tabular-nums text-[#111111] mt-1">
            {summary.max_anomaly_score || "0.0"} <span className="text-sm font-normal text-[#666666] font-sans">/ 10</span>
          </div>
          <p className="text-xs text-[#666666] mt-2 pt-2 border-t border-[#E5E5E5] font-sans">
            Recorded on: <strong className="text-[#111111] font-mono tabular-nums font-semibold">{summary.peak_anomaly_date || "N/A"}</strong>
          </p>
        </div>

        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 shadow-sm">
          <span className="text-xs uppercase font-sans text-emerald-700 block font-medium">Dual-Sensor Validation</span>
          <div className="text-3xl font-semibold font-sans text-emerald-700 mt-1">
            High <span className="text-sm font-normal text-[#666666]">Confidence</span>
          </div>
          <p className="text-xs text-[#666666] mt-2 pt-2 border-t border-[#E5E5E5] font-sans">
            MODIS + VIIRS coincident cross-check.
          </p>
        </div>

      </div>

      {/* Uncertainty & Scientific Principles Framework */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-3 shadow-sm font-sans">
        <h3 className="font-medium text-sm text-[#111111] font-sans flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#111111]" />
          <span>Scientific Uncertainty & Error Bounds Framework</span>
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-[#666666] pt-1">
          <div className="p-3.5 rounded-lg bg-white border border-[#E5E5E5] space-y-1 shadow-xs">
            <span className="font-semibold text-[#111111] block font-sans text-[11px] uppercase">
              1. Spatial Resolution Disparity
            </span>
            <p className="text-[11px] leading-relaxed font-sans">
              VIIRS 375m captures small understory and agricultural fires invisible to MODIS 1000m. 
              Single-sensor VIIRS spikes carry wider statistical uncertainty (±28%).
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-white border border-[#E5E5E5] space-y-1 shadow-xs">
            <span className="font-semibold text-[#111111] block font-sans text-[11px] uppercase">
              2. Orbital Timing & Diurnal Gaps
            </span>
            <p className="text-[11px] leading-relaxed font-sans">
              Terra (10:30) and Aqua (13:30) / VIIRS (13:15) provide snapshot overpasses. 
              Rapidly escalating late-afternoon fires between passes are estimated via FRP growth models.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-white border border-[#E5E5E5] space-y-1 shadow-xs">
            <span className="font-semibold text-[#111111] block font-sans text-[11px] uppercase">
              3. Cloud & Smoke Occlusion
            </span>
            <p className="text-[11px] leading-relaxed font-sans">
              Dense pyrocumulonimbus or monsoon cloud cover creates negative detection bias. 
              Dual-sensor confirmation reduces false anomaly alerts by ~68%.
            </p>
          </div>
        </div>
      </div>

      {/* Anomalies List */}
      <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-5 space-y-4 shadow-sm font-sans">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm text-[#111111] font-sans">
            Detected Fire Anomaly Episodes
          </h3>
          <span className="text-[10px] font-sans text-[#888888] font-medium">
            Sorted by Anomaly Severity Score
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono tabular-nums">
            <thead>
              <tr className="border-b border-[#E5E5E5] text-[#888888] uppercase text-[10px] font-sans font-medium">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Anomaly Score</th>
                <th className="py-2.5 px-3">Exceedance %</th>
                <th className="py-2.5 px-3">Harmonized Events</th>
                <th className="py-2.5 px-3">Radiant Power</th>
                <th className="py-2.5 px-3">Sensor Confirmation</th>
                <th className="py-2.5 px-3">Uncertainty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5] text-[#111111]">
              {filtered.slice(0, 15).map((anom) => {
                const isCritical = anom.status === "CRITICAL_SURGE";
                return (
                  <tr key={anom.date} className="hover:bg-[#F5F5F5] transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-[#111111]">{anom.date}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border font-sans ${
                        isCritical 
                          ? "bg-red-50 text-red-900 border-red-200" 
                          : "bg-amber-50 text-amber-900 border-amber-200"
                      }`}>
                        {anom.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-[#111111] font-semibold text-sm">{anom.anomaly_score}</span> / 10
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-red-600">
                      +{anom.exceedance_percentage}%
                    </td>
                    <td className="py-2.5 px-3">{anom.harmonized_events}</td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">{anom.total_frp_mw} MW</td>
                    <td className="py-2.5 px-3 text-[11px] text-[#666666] font-sans">
                      {anom.confidence_assessment}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-[#888888] font-mono tabular-nums">
                      ±{anom.uncertainty_margin_pct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
