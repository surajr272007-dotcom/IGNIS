import React, { useState } from 'react';
import { 
  FileText, 
  Download, 
  Printer, 
  CheckCircle2, 
  AlertTriangle, 
  Calendar, 
  Layers, 
  Flame,
  Globe
} from 'lucide-react';
import { fetchReport } from '../services/api';

export default function IntelligenceReports({
  aoiMetadata,
  summary,
  harmonizationMetrics,
  classificationSummary,
  calendarData,
  anomalyData,
  selectedAoiId
}) {
  const [downloading, setDownloading] = useState(false);

  const metrics = harmonizationMetrics || {};
  const season = calendarData?.season_profile || {};
  const anomSummary = anomalyData?.summary || {};
  const topAnomalies = (anomalyData?.anomalies || []).slice(0, 5);
  const classCategories = classificationSummary?.categories || {};

  const handleDownloadCsv = async () => {
    try {
      setDownloading(true);
      const blob = await fetchReport(selectedAoiId, "csv");
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IGNIS_Harmonization_Report_${selectedAoiId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download CSV: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      
      {/* Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl print:hidden shadow-sm font-sans">
        <div>
          <h2 className="text-lg font-semibold text-[#111111] flex items-center gap-2 font-sans">
            <FileText className="w-5 h-5 text-[#111111]" />
            <span>Mission Intelligence Briefing & Export</span>
          </h2>
          <p className="text-xs text-[#666666] mt-0.5 font-sans">
            Official synthesized report for NASA Space Apps Challenge 2026 submission and disaster mitigation planning.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleDownloadCsv}
            disabled={downloading}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#111111] hover:bg-[#222222] text-white text-xs font-medium rounded-lg shadow-sm transition-all font-sans active:scale-95 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? "Exporting..." : "Download CSV Data"}</span>
          </button>
          
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-[#E5E5E5] hover:border-[#111111] text-[#111111] hover:bg-[#F5F5F5] text-xs font-medium rounded-lg transition-all shadow-xs font-sans"
          >
            <Printer className="w-4 h-4" />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      {/* Formal Document Preview Paper Container */}
      <div className="bg-white border border-[#E5E5E5] rounded-xl p-8 space-y-6 shadow-md print:border-none print:shadow-none print:p-0 font-sans">
        
        {/* Document Header */}
        <div className="border-b border-[#E5E5E5] pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#888888] font-mono text-xs uppercase tracking-widest mb-1">
              <span>IGNIS SATELLITE INTELLIGENCE ASSESSMENT</span>
              <span>•</span>
              <span>NASA SPACE APPS 2026</span>
            </div>
            <h1 className="text-2xl font-semibold text-[#111111] tracking-tight font-sans">
              {aoiMetadata?.name || "Global AOI"} ({aoiMetadata?.country})
            </h1>
            <p className="text-xs text-[#666666] font-mono tabular-nums mt-1">
              Geographic Scope: [{aoiMetadata?.bbox?.join(', ')}] • Primary Ecozone: {aoiMetadata?.ecozone}
            </p>
          </div>

          <div className="text-left md:text-right text-xs font-sans text-[#666666] space-y-0.5">
            <div>Harmonization Standard: <strong className="text-[#111111] font-mono">V2.4 Diurnal Cluster</strong></div>
            <div>Active Sensors: <strong className="text-[#111111] font-mono">MODIS + VIIRS</strong></div>
            <div>Generated: <strong className="text-[#111111] font-mono tabular-nums">2026-11-15 UTC</strong></div>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="space-y-2 font-sans">
          <h3 className="text-xs font-sans uppercase tracking-wider text-[#111111] font-medium">
            1. Executive Synthesis
          </h3>
          <p className="text-xs text-[#666666] leading-relaxed font-sans">
            Over the multi-year observation period, satellite monitoring registered a gross total of{" "}
            <strong className="text-[#111111] font-mono tabular-nums font-semibold">{summary?.total?.toLocaleString()}</strong> raw active-fire detections across the {aoiMetadata?.name} domain.
            Applying IGNIS’s spatial-temporal harmonization reconciled this high-density detection stream into{" "}
            <strong className="text-emerald-700 font-semibold font-mono tabular-nums">{metrics?.total_fire_events?.toLocaleString()}</strong> discrete physical fire event complexes, 
            achieving an effective spatial clustering factor of{" "}
            <strong className="text-[#111111] font-mono tabular-nums font-semibold">{metrics?.spatial_reduction_factor}x</strong>.
            The empirical VIIRS-to-MODIS observation ratio was calculated at{" "}
            <strong className="text-amber-700 font-semibold font-mono tabular-nums">{metrics?.viirs_to_modis_ratio}x</strong>, reflecting the heightened sensitivity of VIIRS 375m I-bands for small and smoldering burns.
          </p>
        </div>

        {/* Key Metrics Comparison Table */}
        <div className="space-y-2 font-sans">
          <h3 className="text-xs font-sans uppercase tracking-wider text-[#111111] font-medium">
            2. Multi-Sensor Accounting
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] uppercase block font-sans">Raw MODIS Detections</span>
              <strong className="text-red-600 text-lg font-semibold block mt-0.5">{summary?.modis_count?.toLocaleString()}</strong>
              <span className="text-[10px] text-[#666666] font-sans">1000m resolution</span>
            </div>

            <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] uppercase block font-sans">Raw VIIRS Detections</span>
              <strong className="text-amber-600 text-lg font-semibold block mt-0.5">{summary?.viirs_count?.toLocaleString()}</strong>
              <span className="text-[10px] text-[#666666] font-sans">375m resolution</span>
            </div>

            <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] uppercase block font-sans">Harmonized Fire Events</span>
              <strong className="text-emerald-700 text-lg font-semibold block mt-0.5">{metrics?.total_fire_events?.toLocaleString()}</strong>
              <span className="text-[10px] text-[#666666] font-sans">Discrete burn clusters</span>
            </div>

            <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5]">
              <span className="text-[#888888] text-[10px] uppercase block font-sans">Gross Radiative Energy</span>
              <strong className="text-[#111111] text-lg font-semibold block mt-0.5">{summary?.total_frp?.toLocaleString()} MW</strong>
              <span className="text-[10px] text-[#666666] font-sans">Fire Radiative Power</span>
            </div>
          </div>
        </div>

        {/* Burning Activity Calendar Findings */}
        <div className="space-y-2 font-sans">
          <h3 className="text-xs font-sans uppercase tracking-wider text-[#111111] font-medium">
            3. Burning Season Climatology & Thresholds
          </h3>
          <div className="p-4 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5] text-xs space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <span className="text-[#888888] block text-[10px] font-sans">Season Onset:</span>
                <strong className="text-[#111111] font-mono tabular-nums font-semibold">DOY {season.onset_doy || 215}</strong>
              </div>
              <div>
                <span className="text-[#888888] block text-[10px] font-sans">Peak Burning Window:</span>
                <strong className="text-amber-700 font-mono tabular-nums font-semibold">DOY {season.peak_doy || 256} ({season.peak_month_name || "September"})</strong>
              </div>
              <div>
                <span className="text-[#888888] block text-[10px] font-sans">Season Cessation:</span>
                <strong className="text-emerald-700 font-mono tabular-nums font-semibold">DOY {season.cessation_doy || 312}</strong>
              </div>
            </div>
            <p className="text-[11px] text-[#666666] pt-2 border-t border-[#E5E5E5] font-sans">
              Typical burning regime consists of surface grass fires and peat drying. 
              Fire weather conditions escalate sharply during late dry season (Aug–Oct) in drought years.
            </p>
          </div>
        </div>

        {/* Top Critical Anomaly Incidents */}
        <div className="space-y-2 font-sans">
          <h3 className="text-xs font-sans uppercase tracking-wider text-red-700 font-medium">
            4. Critical Fire Anomaly Incidents
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-[#E5E5E5] text-[#888888] text-[10px] uppercase font-sans font-medium">
                  <th className="py-2 px-2">Date</th>
                  <th className="py-2 px-2">Anomaly Score</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Exceedance</th>
                  <th className="py-2 px-2">FRP</th>
                  <th className="py-2 px-2">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E5] text-[#111111]">
                {topAnomalies.map((anom) => (
                  <tr key={anom.date}>
                    <td className="py-2 px-2 font-semibold">{anom.date}</td>
                    <td className="py-2 px-2 text-[#111111] font-semibold">{anom.anomaly_score} / 10</td>
                    <td className="py-2 px-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-50 text-red-800 border border-red-200 font-sans font-medium">
                        {anom.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-red-600 font-semibold">+{anom.exceedance_percentage}%</td>
                    <td className="py-2 px-2">{anom.total_frp_mw} MW</td>
                    <td className="py-2 px-2 text-[#666666] text-[10px] font-sans">{anom.confidence_assessment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fire Source Classification Assessment */}
        {classificationSummary && (
          <div className="space-y-2 font-sans">
            <h3 className="text-xs font-sans uppercase tracking-wider text-[#111111] font-medium">
              5. Probable Fire Source Attribution
            </h3>
            <div className="p-4 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5] text-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[#666666] font-sans">Predominant Activity Regime:</span>
                <span className="font-semibold text-[#111111] font-sans px-2 py-0.5 rounded bg-white text-red-700 border border-red-200">
                  {classificationSummary.predominant_source || "Likely Forest Wildfire"}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono tabular-nums">
                {Object.entries(classCategories).map(([code, cat]) => (
                  <div key={code} className="p-2.5 rounded bg-white border border-[#E5E5E5] space-y-0.5 shadow-xs">
                    <div className="flex items-center gap-1.5 text-[11px] text-[#666666] font-sans">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                      <span className="truncate">{cat.name.replace("Likely ", "").replace("Possible ", "")}</span>
                    </div>
                    <div className="text-sm font-semibold text-[#111111]">{cat.count} <span className="text-[10px] font-normal text-[#888888] font-sans">({cat.pct}%)</span></div>
                    <div className="text-[10px] text-red-600 font-semibold">{cat.total_frp_mw} MW</div>
                  </div>
                ))}
              </div>

              <p className="text-[10px] text-[#888888] border-t border-[#E5E5E5] pt-2 leading-relaxed font-sans">
                Source attribution derived from multi-criteria evidence scoring integrating MODIS/VIIRS radiant heat, spatio-temporal cluster size, diurnal overpass signatures, and ecoregion land cover. Distinguishes between NASA instrument radiometric detection confidence (sensor algorithm quality) and environmental source classification confidence (probabilistic attribution). Hotspots lacking decisive evidence are conservatively designated as Unknown.
              </p>
            </div>
          </div>
        )}

        {/* Sign-off footer */}
        <div className="border-t border-[#E5E5E5] pt-4 flex items-center justify-between text-[10px] font-mono text-[#888888]">
          <span>Prepared with NASA FIRMS Science Data Products (MCD14DL & VNP14IMGTDL)</span>
          <span>IGNIS — Beyond the Hotspot</span>
        </div>

      </div>

    </div>
  );
}
