import React from 'react';
import { 
  Flame, 
  Map as MapIcon, 
  Calendar as CalendarIcon, 
  Layers, 
  AlertTriangle, 
  FileText, 
  Globe, 
  Key, 
  Activity,
  ChevronDown,
  RefreshCw,
  Database
} from 'lucide-react';

export default function Navbar({
  activeTab,
  setActiveTab,
  aois,
  selectedAoiId,
  onSelectAoi,
  health,
  onOpenKeyModal,
  onOpenRefreshModal,
  hasKey,
  datasetMode,
  onToggleDatasetMode,
  isLive,
  liveCount,
  sampleCount,
  refreshing = false
}) {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'globe', label: '3D Earth Globe', icon: Globe, badge: 'Cesium 3D' },
    { id: 'map', label: '2D Fire Map', icon: MapIcon },
    { id: 'calendar', label: 'Burning Calendar', icon: CalendarIcon, badge: 'Core' },
    { id: 'harmonization', label: 'Harmonization', icon: Layers },
    { id: 'anomalies', label: 'Anomaly Intel', icon: AlertTriangle },
    { id: 'reports', label: 'Reports', icon: FileText }
  ];

  const currentAoi = aois.find(a => a.id === selectedAoiId);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#E5E5E5] transition-colors">
      {/* Top Banner: Mission Branding */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Logo & Subtitle */}
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-[#111111] text-white shadow-xs">
              <Flame className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-wider text-base text-[#111111] font-mono">IGNIS</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FAFAFA] border border-[#E5E5E5] text-[#666666] font-mono font-medium tracking-tight">
                  NASA 2026
                </span>
              </div>
              <p className="text-[10px] tracking-wide text-[#666666] font-sans hidden sm:block">
                Beyond the Hotspot • MODIS & VIIRS Harmonization
              </p>
            </div>
          </div>

          {/* Controls Cluster */}
          <div className="flex items-center gap-2">
            
            {/* Area of Interest Selector */}
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E5E5E5] hover:border-[#CCCCCC] rounded-lg text-xs transition-colors shadow-2xs">
                <Globe className="w-3.5 h-3.5 text-[#111111]" />
                <span className="text-[#888888] uppercase text-[10px] font-mono tracking-wider hidden md:inline">AOI:</span>
                <select
                  value={selectedAoiId}
                  onChange={(e) => onSelectAoi(e.target.value)}
                  className="bg-transparent text-[#111111] font-medium text-xs focus:outline-none cursor-pointer pr-4 appearance-none"
                >
                  {aois.map((a) => (
                    <option key={a.id} value={a.id} className="bg-white text-[#111111]">
                      {a.name} ({a.country})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-[#666666] pointer-events-none absolute right-2.5" />
              </div>
            </div>

            {/* Refresh NASA Data Button (Primary Black Button) */}
            <button
              onClick={onOpenRefreshModal}
              disabled={refreshing}
              title="Fetch Genuine Active-Fire Observations from NASA FIRMS"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111111] hover:bg-[#222222] text-white font-sans text-xs font-medium shadow-xs transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Ingesting...' : 'Refresh NASA Data'}</span>
            </button>

            {/* FIRMS Key button */}
            <button
              onClick={onOpenKeyModal}
              title="NASA FIRMS API Key Settings"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-sans font-medium transition-all ${
                hasKey 
                  ? "bg-[#FAFAFA] text-[#111111] border-[#E5E5E5] hover:bg-[#F5F5F5]" 
                  : "bg-white text-[#666666] border-[#E5E5E5] hover:border-[#111111] hover:text-[#111111]"
              }`}
            >
              <Key className="w-3.5 h-3.5 text-[#666666]" />
              <span className="hidden xl:inline">{hasKey ? "FIRMS Key: Active" : "Set FIRMS Key"}</span>
            </button>

            {/* Backend Health & DuckDB Indicator */}
            <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5] text-[11px] font-mono tabular-nums">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  health?.status === 'healthy' ? 'bg-emerald-400' : 'bg-red-400'
                }`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${
                  health?.status === 'healthy' ? 'bg-emerald-500' : 'bg-red-500'
                }`} />
              </span>
              <span className="text-[#666666]">
                {health?.status === 'healthy' ? `DuckDB: ${health?.database?.total_observations_indexed?.toLocaleString()} Obs` : 'Connecting...'}
              </span>
            </div>

          </div>
        </div>

        {/* Navigation Tabs and Dataset Provenance Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-[#E5E5E5] py-1.5 gap-2">
          
          {/* Module Tabs: Inter Medium */}
          <nav className="flex space-x-1 overflow-x-auto scrollbar-none font-sans">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap btn-interactive ${
                    isActive
                      ? "bg-[#111111] text-white shadow-xs"
                      : "text-[#666666] hover:text-[#111111] hover:bg-[#F5F5F5]"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : "text-[#888888]"}`} />
                  <span>{tab.label}</span>
                  {tab.badge && (
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono tabular-nums ${
                      isActive ? "bg-white/20 text-white" : "bg-[#F0F0F0] text-[#666666]"
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Dataset Provenance Pill */}
          <div className="flex items-center gap-2 text-xs font-sans shrink-0">
            <span className="text-[10px] text-[#888888] uppercase tracking-wider font-mono">Active Dataset:</span>
            <div className="inline-flex rounded-lg bg-[#FAFAFA] border border-[#E5E5E5] p-0.5">
              <button
                onClick={() => onToggleDatasetMode('SAMPLE')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-medium transition-all flex items-center gap-1.5 ${
                  datasetMode === 'SAMPLE'
                    ? "bg-[#111111] text-white shadow-xs"
                    : "text-[#666666] hover:text-[#111111]"
                }`}
                title="NASA FIRMS Reference Sample Archive (MCD14DL & VNP14IMGTDL)"
              >
                <Database className="w-3 h-3 text-amber-500" />
                <span>Sample Archive <span className="font-mono tabular-nums font-normal">({sampleCount?.toLocaleString() || 0})</span></span>
              </button>

              <button
                onClick={() => onToggleDatasetMode('LIVE')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-sans font-medium transition-all flex items-center gap-1.5 ${
                  datasetMode === 'LIVE'
                    ? "bg-[#111111] text-white shadow-xs"
                    : "text-[#666666] hover:text-[#111111]"
                }`}
                title="Live satellite feed from NASA FIRMS"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 live-pulse' : 'bg-[#888888]'}`} />
                <span>Live Feed <span className="font-mono tabular-nums font-normal">({liveCount?.toLocaleString() || 0})</span></span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </header>
  );
}
