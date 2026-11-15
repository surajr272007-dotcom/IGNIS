import React, { useState } from 'react';
import { 
  RefreshCw, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Satellite, 
  Radio, 
  Layers, 
  Calendar,
  Flame,
  Check
} from 'lucide-react';
import { refreshNASAData, refreshGlobalNASAData } from '../services/api';

export default function RefreshDataModal({
  isOpen,
  onClose,
  aoi,
  mapKey,
  onRefreshComplete
}) {
  const [days, setDays] = useState(5);
  const [sources, setSources] = useState([
    "MODIS_NRT",
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT"
  ]);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState(null);

  if (!isOpen) return null;

  const toggleSource = (src) => {
    if (sources.includes(src)) {
      if (sources.length > 1) {
        setSources(sources.filter(s => s !== src));
      }
    } else {
      setSources([...sources, src]);
    }
  };

  const handleStartRefresh = async () => {
    // Frontend validation strictly matching backend limits (1-5 days)
    if (!days || days < 1 || days > 5) {
      setResult({
        success: false,
        message: "Observation window must be between 1 and 5 days as supported by the NASA FIRMS API."
      });
      return;
    }

    if (!sources || sources.length === 0) {
      setResult({
        success: false,
        message: "Please select at least one satellite sensor channel."
      });
      return;
    }

    setRefreshing(true);
    setResult(null);

    try {
      let res;
      if (aoi?.id === "global") {
        res = await refreshGlobalNASAData({
          days: Number(days),
          sources: sources,
          mapKey: mapKey
        });
      } else {
        res = await refreshNASAData({
          aoiId: aoi?.id || "pantanal_brazil",
          days: Number(days),
          sources: sources,
          mapKey: mapKey
        });
      }

      setResult(res);
      if (res.success && onRefreshComplete) {
        onRefreshComplete(res);
      }
    } catch (err) {
      setResult({
        success: false,
        message: err.message || "Failed to communicate with NASA FIRMS ingestion service."
      });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white border border-[#E5E5E5] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-fade-in-up">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5] bg-[#FAFAFA]">
          <div className="flex items-center gap-2 text-[#111111]">
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            <h3 className="font-semibold text-[#111111] text-base">
              Live NASA FIRMS Data Ingestion
            </h3>
          </div>
          <button 
            onClick={onClose}
            disabled={refreshing}
            className="text-[#666666] hover:text-[#111111] transition-colors p-1 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          
          {/* Target Region */}
          <div className="p-3 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl flex items-center justify-between text-xs shadow-xs">
            <div>
              <span className="text-[#888888] uppercase text-[10px] font-mono block">Target Pyrome / AOI:</span>
              <strong className="text-[#111111] text-sm font-semibold">{aoi?.name} ({aoi?.country})</strong>
            </div>
            <div className="text-right font-mono text-[11px] text-[#666666]">
              <span>BBox: [{aoi?.bbox?.join(', ')}]</span>
            </div>
          </div>

          {/* Days Selection: 1, 3, 5 Days */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-[#888888] uppercase font-mono tracking-wider">
                Recent Observation Window (Days)
              </label>
              <span className="text-[10px] font-mono text-[#888888]">NASA FIRMS Max: 5 Days</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 3, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={refreshing}
                  onClick={() => {
                    setResult(null);
                    setDays(d);
                  }}
                  className={`py-2 text-xs font-sans font-medium rounded-lg border transition-all ${
                    days === d
                      ? "bg-[#111111] border-[#111111] text-white shadow-xs font-semibold"
                      : "bg-white border-[#E5E5E5] text-[#666666] hover:text-[#111111]"
                  }`}
                >
                  Last {d} Day{d > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Satellite Sensors */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#888888] uppercase font-sans tracking-wider">
              Satellite Constellation Channels
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-sans">
              {[
                { id: "MODIS_NRT", label: "MODIS (Terra & Aqua 1km)", sub: "MCD14DL NRT" },
                { id: "VIIRS_SNPP_NRT", label: "VIIRS (Suomi-NPP 375m)", sub: "VNP14IMGTDL" },
                { id: "VIIRS_NOAA20_NRT", label: "VIIRS (NOAA-20 375m)", sub: "VJ114IMGTDL" },
                { id: "VIIRS_NOAA21_NRT", label: "VIIRS (NOAA-21 375m)", sub: "JPSS-2 NRT" }
              ].map((s) => {
                const selected = sources.includes(s.id);
                return (
                  <div
                    key={s.id}
                    onClick={() => !refreshing && toggleSource(s.id)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-start gap-2.5 ${
                      selected
                        ? "bg-[#FAFAFA] border-[#111111] text-[#111111] shadow-xs"
                        : "bg-white border-[#E5E5E5] text-[#666666] hover:text-[#111111]"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center border ${
                      selected ? "bg-[#111111] border-[#111111] text-white" : "border-[#E5E5E5]"
                    }`}>
                      {selected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                    <div>
                      <div className="font-medium text-xs text-[#111111] font-sans">{s.label}</div>
                      <div className="text-[10px] text-[#888888] font-mono">{s.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Results or Loading Feedback */}
          {refreshing && (
            <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E5E5E5] flex items-center gap-3.5 shadow-xs">
              <div className="relative w-6 h-6 shrink-0">
                <div className="absolute inset-0 rounded-full border-2 border-[#E5E5E5]" />
                <div className="absolute inset-0 rounded-full border-2 border-t-[#111111] animate-spin" />
              </div>
              <div className="space-y-0.5 text-xs font-mono">
                <span className="text-[#111111] font-medium block">
                  Querying NASA FIRMS Active Fire Services...
                </span>
                <span className="text-[#666666] text-[11px] block">
                  Validating credentials, parsing CSV observation streams, deduplicating DuckDB records.
                </span>
              </div>
            </div>
          )}

          {result && (
            <div className={`p-4 rounded-xl border text-xs font-mono space-y-2 ${
              result.success
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}>
              <div className="flex items-start gap-2 font-semibold">
                {result.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                )}
                <span>{result.message}</span>
              </div>

              {result.success && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200 text-[11px] font-mono tabular-nums">
                  <div>
                    <span className="text-emerald-700 block text-[9px] uppercase font-sans">Retrieved:</span>
                    <strong className="text-[#111111] text-sm font-semibold">{result.records_received}</strong>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[9px] uppercase font-sans">New Inserted:</span>
                    <strong className="text-emerald-700 text-sm font-semibold">+{result.records_inserted}</strong>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[9px] uppercase font-sans">Duplicates Skipped:</span>
                    <strong className="text-[#666666] text-sm font-semibold">{result.duplicates_skipped}</strong>
                  </div>
                  <div>
                    <span className="text-emerald-700 block text-[9px] uppercase font-sans">Breakdown:</span>
                    <strong className="text-[#111111]">{result.modis_count} MOD / {result.viirs_count} VRS</strong>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E5E5E5] bg-[#FAFAFA] font-sans">
          <span className="text-[10px] text-[#888888] font-sans">
            Direct connection to NASA EOSDIS FIRMS API.
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={refreshing}
              className="px-4 py-2 text-xs font-medium font-sans text-[#666666] hover:text-[#111111] transition-colors"
            >
              {result?.success ? "Close & View" : "Cancel"}
            </button>
            <button
              onClick={handleStartRefresh}
              disabled={refreshing}
              className="px-4 py-2 bg-[#111111] hover:bg-[#222222] disabled:opacity-50 text-white font-medium text-xs rounded-lg shadow-sm transition-all flex items-center gap-2 font-sans"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? "Ingesting..." : "Fetch Genuine NASA Data"}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
