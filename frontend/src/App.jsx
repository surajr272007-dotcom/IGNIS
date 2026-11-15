import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import OverviewDashboard from './components/OverviewDashboard';
import InteractiveMap from './components/InteractiveMap';
import EarthGlobe3D from './components/EarthGlobe3D';
import BurningCalendar from './components/BurningCalendar';
import HarmonizationView from './components/HarmonizationView';
import AnomalyIntelligence from './components/AnomalyIntelligence';
import IntelligenceReports from './components/IntelligenceReports';
import FIRMSSettingsModal from './components/FIRMSSettingsModal';
import RefreshDataModal from './components/RefreshDataModal';
import EmptyState from './components/EmptyState';
import { 
  fetchHealth, 
  fetchAOIs, 
  fetchAOIDetails, 
  fetchFires, 
  fetchHarmonization, 
  fetchBurningCalendar, 
  fetchAnomalies 
} from './services/api';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [aois, setAois] = useState([]);
  const [selectedAoiId, setSelectedAoiId] = useState('global');
  const [aoiMetadata, setAoiMetadata] = useState(null);
  
  // Data states
  const [summary, setSummary] = useState(null);
  const [observations, setObservations] = useState([]);
  const [sampleEvents, setSampleEvents] = useState([]);
  const [harmonizationMetrics, setHarmonizationMetrics] = useState(null);
  const [classificationSummary, setClassificationSummary] = useState(null);
  const [calendarData, setCalendarData] = useState(null);
  const [anomalyData, setAnomalyData] = useState(null);
  const [health, setHealth] = useState(null);

  // Dataset Provenance state ('LIVE', 'SAMPLE', 'AUTO') - defaults strictly to SAMPLE DATA
  const [datasetMode, setDatasetMode] = useState('SAMPLE');

  // Status & modal states
  const [loading, setLoading] = useState(true);
  const [isColdStart, setIsColdStart] = useState(false);
  const [error, setError] = useState(null);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [isRefreshModalOpen, setIsRefreshModalOpen] = useState(false);
  const [mapKey, setMapKey] = useState(() => localStorage.getItem("IGNIS_FIRMS_MAP_KEY") || "");

  // Render Free cold start notification watcher (triggers if loading takes >2.5s)
  useEffect(() => {
    let timer;
    if (loading) {
      timer = setTimeout(() => setIsColdStart(true), 2500);
    } else {
      setIsColdStart(false);
    }
    return () => clearTimeout(timer);
  }, [loading]);

  // Load initial health and AOI registry
  useEffect(() => {
    async function initApp() {
      try {
        const [healthRes, aoiRes] = await Promise.all([
          fetchHealth().catch(err => ({ status: "degraded", error: err.message })),
          fetchAOIs().catch(() => ({ aois: [] }))
        ]);
        setHealth(healthRes);
        if (aoiRes.aois && aoiRes.aois.length > 0) {
          setAois(aoiRes.aois);
        }
      } catch (err) {
        console.error("Initialization error:", err);
      }
    }
    initApp();
  }, []);

  // Fetch all domain data when AOI or dataset mode changes
  const loadAoiData = async (aoiId = selectedAoiId, spatialThreshold = 1.5, targetMode = 'SAMPLE', temporalThreshold = 2.5) => {
    try {
      setLoading(true);
      setError(null);

      // Fast initial resolution: Fetch AOI details & counts immediately (<200ms)
      fetchAOIDetails(aoiId, targetMode)
        .then((detailsRes) => {
          if (detailsRes?.metadata) setAoiMetadata(detailsRes.metadata);
          if (detailsRes?.observations_summary) {
            setSummary(detailsRes.observations_summary);
            if (detailsRes.observations_summary.dataset_mode) {
              setDatasetMode(detailsRes.observations_summary.dataset_mode);
            }
          }
        })
        .catch((err) => console.warn("AOI details non-fatal error:", err));

      // Asynchronously fetch domain intelligence (harmonization, calendar, anomalies, health)
      fetchHarmonization({ aoiId, datasetMode: targetMode, spatialThresholdKm: spatialThreshold, temporalThresholdHours: temporalThreshold })
        .then((harmRes) => {
          if (harmRes?.metrics) setHarmonizationMetrics(harmRes.metrics);
          if (harmRes?.sample_events) setSampleEvents(harmRes.sample_events);
          if (harmRes?.classification_summary) setClassificationSummary(harmRes.classification_summary);
        })
        .catch((err) => console.warn("Harmonization non-fatal error:", err));

      fetchBurningCalendar({ aoiId, datasetMode: targetMode })
        .then((calRes) => {
          if (calRes?.calendar) setCalendarData(calRes.calendar);
        })
        .catch((err) => console.warn("Calendar non-fatal error:", err));

      fetchAnomalies({ aoiId, datasetMode: targetMode })
        .then((anomRes) => {
          if (anomRes?.analysis) setAnomalyData(anomRes.analysis);
        })
        .catch((err) => console.warn("Anomalies non-fatal error:", err));

      fetchHealth()
        .then((healthRes) => {
          if (healthRes) setHealth(healthRes);
        })
        .catch(() => {});

      // Fetch primary observation fire stream for map and 3D globe rendering
      const firesRes = await fetchFires({ aoiId, datasetMode: targetMode, limit: aoiId === 'global' ? 100000 : 5000 });
      if (firesRes) {
        setObservations(firesRes.observations || []);
        if (firesRes.summary) setSummary(firesRes.summary);
        if (firesRes.harmonization_metrics) setHarmonizationMetrics(firesRes.harmonization_metrics);
        if (firesRes.classification_summary) setClassificationSummary(firesRes.classification_summary);
        if (firesRes.harmonized_events?.length) setSampleEvents(firesRes.harmonized_events);
      }

    } catch (err) {
      console.error("Failed to load AOI data:", err);
      setError(err.message || "Failed to load satellite fire data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAoiId) {
      loadAoiData(selectedAoiId, 1.5, datasetMode, 2.5);
    }
  }, [selectedAoiId]);

  const handleToggleDatasetMode = (newMode) => {
    setDatasetMode(newMode);
    loadAoiData(selectedAoiId, 1.5, newMode, 2.5);
  };

  const handleSaveMapKey = (newKey) => {
    setMapKey(newKey);
    localStorage.setItem("IGNIS_FIRMS_MAP_KEY", newKey);
  };

  const handleUpdateSpatialThreshold = (newRadius, newTemporal = 2.5) => {
    loadAoiData(selectedAoiId, newRadius, datasetMode, newTemporal);
  };

  const handleRefreshComplete = (refreshResult) => {
    // Switch to LIVE mode and reload all data
    setDatasetMode("LIVE");
    loadAoiData(selectedAoiId, 1.5, "LIVE", 2.5);
  };

  const isLive = summary?.is_live || false;

  return (
    <div className="min-h-screen bg-white text-[#111111] flex flex-col font-sans selection:bg-[#E5E5E5] selection:text-[#111111]">
      
      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        aois={aois}
        selectedAoiId={selectedAoiId}
        onSelectAoi={setSelectedAoiId}
        health={health}
        onOpenKeyModal={() => setIsKeyModalOpen(true)}
        onOpenRefreshModal={() => setIsRefreshModalOpen(true)}
        hasKey={Boolean(mapKey || health?.nasa_firms?.has_configured_map_key)}
        datasetMode={datasetMode}
        onToggleDatasetMode={handleToggleDatasetMode}
        isLive={isLive}
        liveCount={summary?.live_records_available || 0}
        sampleCount={summary?.sample_records_available || 0}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        
        {/* Error Notification Banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start justify-between gap-4 animate-fade-in">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-rose-900">Observation Stream Notification</h4>
                <p className="text-xs text-rose-700 mt-0.5">{error}</p>
              </div>
            </div>
            <button
              onClick={() => loadAoiData(selectedAoiId, 1.5, datasetMode, 2.5)}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-100 border border-rose-300 text-rose-800 text-xs font-mono font-medium flex items-center gap-1.5 transition-all shadow-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Global Loading Spinner with Cold-Start Notice */}
        {loading && !observations.length && (
          <div className="py-24 flex flex-col items-center justify-center text-center space-y-4 animate-fade-in">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-2 border-[#E5E5E5]" />
              <div className="absolute inset-0 rounded-full border-2 border-t-[#111111] animate-spin" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <span className="font-mono text-sm text-[#111111] font-semibold block">
                Synchronizing Satellite Constellation
              </span>
              <span className="text-xs text-[#666666] font-mono block">
                Loading observations from cloud DuckDB warehouse ({datasetMode} mode)...
              </span>
              {isColdStart && (
                <div className="mt-3 p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5] text-[11px] font-mono text-[#666666] animate-fade-in shadow-2xs">
                  <span className="text-[#111111] font-semibold block mb-0.5">Connecting to Render Free Cloud Backend</span>
                  <span>If waking up from sleep, Render spin-up may take ~30s. Observations will display automatically.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Render Active View with Smooth Fade Transition */}
        {!loading && observations.length === 0 ? (
          <EmptyState
            title={datasetMode === 'LIVE' ? "No Live Satellite Observations Found" : "No Fire Observations Detected"}
            message={
              datasetMode === 'LIVE'
                ? `Zero live NASA FIRMS detections currently indexed for ${aoiMetadata?.name || 'this area'}. Click 'Refresh NASA Data' to query the live satellite feed, or switch to Demo Archive mode.`
                : `No satellite fire detections match the selected spatio-temporal filter for ${aoiMetadata?.name || 'this area'}.`
            }
            actionLabel={datasetMode === 'LIVE' ? "Refresh NASA Data" : "Switch to Live Feed"}
            onAction={datasetMode === 'LIVE' ? () => setIsRefreshModalOpen(true) : () => handleToggleDatasetMode('LIVE')}
          />
        ) : (
          <div key={activeTab} className="animate-fade-in-up">
            {activeTab === 'overview' && (
              <OverviewDashboard
                aoiMetadata={aoiMetadata}
                summary={summary}
                harmonizationMetrics={harmonizationMetrics}
                classificationSummary={classificationSummary}
                calendarData={calendarData}
                onNavigate={setActiveTab}
                onOpenRefreshModal={() => setIsRefreshModalOpen(true)}
                datasetMode={datasetMode}
                isLive={isLive}
              />
            )}

            {activeTab === 'globe' && (
              <EarthGlobe3D
                observations={observations}
                sampleEvents={sampleEvents}
                classificationSummary={classificationSummary}
                loading={loading}
                isLive={isLive}
                onSwitchTo2D={() => setActiveTab('map')}
                selectedAoiId={selectedAoiId}
                onSelectAoi={setSelectedAoiId}
                aoiMetadata={aoiMetadata}
                totalAvailable={summary?.total || 69430}
              />
            )}

            {activeTab === 'map' && (
              <InteractiveMap
                aoiMetadata={aoiMetadata}
                observations={observations}
                sampleEvents={sampleEvents}
                classificationSummary={classificationSummary}
                loading={loading}
                onSwitchTo3D={() => setActiveTab('globe')}
              />
            )}

            {activeTab === 'calendar' && (
              <BurningCalendar
                calendarData={calendarData}
                aoiMetadata={aoiMetadata}
              />
            )}

            {activeTab === 'harmonization' && (
              <HarmonizationView
                harmonizationMetrics={harmonizationMetrics}
                sampleEvents={sampleEvents}
                classificationSummary={classificationSummary}
                aoiMetadata={aoiMetadata}
                onUpdateThreshold={handleUpdateSpatialThreshold}
                loading={loading}
              />
            )}

            {activeTab === 'anomalies' && (
              <AnomalyIntelligence
                anomalyData={anomalyData}
                aoiMetadata={aoiMetadata}
              />
            )}

            {activeTab === 'reports' && (
              <IntelligenceReports
                aoiMetadata={aoiMetadata}
                summary={summary}
                harmonizationMetrics={harmonizationMetrics}
                classificationSummary={classificationSummary}
                calendarData={calendarData}
                anomalyData={anomalyData}
                selectedAoiId={selectedAoiId}
              />
            )}
          </div>
        )}

      </main>

      {/* NASA FIRMS Live Ingestion Modal */}
      <RefreshDataModal
        isOpen={isRefreshModalOpen}
        onClose={() => setIsRefreshModalOpen(false)}
        aoi={aoiMetadata}
        mapKey={mapKey}
        onRefreshComplete={handleRefreshComplete}
      />

      {/* NASA FIRMS API Key Settings Modal */}
      <FIRMSSettingsModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        mapKey={mapKey}
        onSaveKey={handleSaveMapKey}
        hasEnvKey={Boolean(health?.nasa_firms?.has_configured_map_key)}
      />

      {/* Minimal Footer */}
      <footer className="border-t border-[#E5E5E5] py-4 px-4 sm:px-6 lg:px-8 bg-[#FAFAFA] text-xs font-mono text-[#666666] flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[#111111] font-bold">IGNIS</span>
          <span>•</span>
          <span>NASA Space Apps Challenge 2026</span>
          <span>•</span>
          <span className="flex items-center gap-1.5 font-semibold text-[#111111]">
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500 live-pulse' : 'bg-amber-500'}`} />
            {isLive ? "LIVE SATELLITE STREAM" : "SAMPLE DATA (REFERENCE ARCHIVE)"}
          </span>
        </div>
        <div className="text-[11px] text-[#888888]">
          NASA FIRMS MCD14DL (MODIS) & VNP14IMGTDL/VJ114IMGTDL (VIIRS)
        </div>
      </footer>

    </div>
  );
}
