# IGNIS — BEYOND THE HOTSPOT
### Harmonization of NASA MODIS and VIIRS Hot Spots
**NASA Space Apps Challenge 2026**

---

## 🛰️ Project Overview & Challenge Objective
Satellite active-fire monitoring has evolved across distinct sensor generations:
1. **NASA MODIS** (Terra & Aqua, launched 1999 & 2002): 1 km nominal spatial resolution with a continuous ~25-year climate record.
2. **NASA/NOAA VIIRS** (Suomi-NPP, NOAA-20, NOAA-21, launched 2011–present): 375 m I-band spatial resolution with high radiometric sensitivity, detecting small/cool fires down to ~0.1 MW.

Because VIIRS has ~7 times higher spatial pixel density than MODIS, a single fire front that registers as 1 or 2 MODIS pixels frequently produces **10 to 20 VIIRS pixels**. Comparing raw hot-spot detection counts over time causes a severe historical bias (falsely suggesting a massive surge in wildfire frequency after 2012).

**IGNIS** resolves this scientific challenge by providing:
- **Spatial-temporal clustering** to group contiguous pixel detections into distinct **physical fire event complexes**.
- **Cross-sensor scaling** ($R_{VIIRS/MODIS}$) to normalize observation streams.
- A unified **Burning Activity Calendar** displaying multi-year Day-of-Year (DOY) matrices, climatological baselines, and seasonal burning thresholds (onset, peak, cessation).
- **Anomaly Intelligence** to detect statistical burning surges and communicate uncertainty bounds.
- **Mission Intelligence Briefings & Reports** with instant CSV data exports.

---

## 🏗️ System Architecture

```
IGNIS/
├── backend/                         # Python + FastAPI + DuckDB
│   ├── app/
│   │   ├── main.py                  # FastAPI application entrypoint & CORS
│   │   ├── config.py                # Environment & configuration management
│   │   ├── api/
│   │   │   └── routes.py            # REST API endpoints (Health, Fires, Calendar, Harmonization, Reports)
│   │   ├── services/
│   │   │   ├── db_service.py        # DuckDB columnar storage & query engine
│   │   │   ├── harmonization_engine.py # Spatial-temporal clustering & sensor scaling
│   │   │   ├── calendar_service.py  # Burning calendar & climatological baseline engine
│   │   │   ├── anomaly_service.py   # Anomaly scoring & uncertainty framework
│   │   │   └── firms_client.py      # NASA FIRMS REST API connector
│   │   └── data/
│   │       ├── reference_regions.py # Global reference AOIs (Pantanal, California, Savannas, etc.)
│   │       └── sample_datasets.py   # Real NASA FIRMS schema historical reference datasets
│   ├── requirements.txt             # Python backend dependencies
│   ├── test_backend.py              # Automated backend test suite
│   ├── .env.example                 # Example environment variables
│   └── .env                         # Local configuration
├── frontend/                        # React 19 + Vite + Tailwind CSS + Leaflet
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.jsx           # Mission navigation, AOI switch, key management, health pulse
│   │   │   ├── OverviewDashboard.jsx# Module 1: Executive metrics, sensor disparity breakdown
│   │   │   ├── InteractiveMap.jsx   # Module 2: Dark Leaflet map with MODIS, VIIRS & Cluster layers
│   │   │   ├── BurningCalendar.jsx  # Module 3: DOY matrix heatmap, climatology envelope, seasonal regimes
│   │   │   ├── HarmonizationView.jsx# Module 4: Spatial-temporal clustering laboratory with threshold slider
│   │   │   ├── AnomalyIntelligence.jsx # Module 5: Statistical surge scoring & uncertainty framework
│   │   │   ├── IntelligenceReports.jsx # Module 6: Executive briefing & CSV download
│   │   │   ├── FIRMSSettingsModal.jsx  # User NASA FIRMS API key management
│   │   │   └── EmptyState.jsx       # Graceful empty-state feedback
│   │   ├── services/
│   │   │   └── api.js               # Frontend API client
│   │   ├── App.jsx                  # Main application state & view orchestrator
│   │   └── index.css                # Aerospace dark theme styling
│   ├── tailwind.config.js           # Custom theme colors (ignis-gold, flame, modis, viirs)
│   └── package.json
├── run_backend.ps1                  # PowerShell backend launcher
├── run_frontend.ps1                 # PowerShell frontend launcher
└── README.md
```

---

## ⚡ Quickstart Guide

### 1. Prerequisites
- **Python 3.10+** (Tested on Python 3.11.9)
- **Node.js 18+** (Tested on Node v24.19.0)

### 2. Backend Setup & Startup
Open a terminal in the root `IGNIS` folder:
```powershell
# 1. Install Python packages (if not already installed)
python -m pip install -r backend/requirements.txt

# 2. Run backend test suite to verify DuckDB and scientific algorithms
python -m unittest backend/test_backend.py

# 3. Start the FastAPI backend server (Runs on port 8000)
.\run_backend.ps1
# Or: python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```
- Health Check: `http://localhost:8000/api/health`
- Interactive API Docs (Swagger): `http://localhost:8000/docs`

### 3. Frontend Setup & Startup
In a second terminal:
```powershell
# 1. Navigate to frontend
cd frontend

# 2. Start Vite development server (Runs on port 5173)
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## 🛰️ NASA FIRMS Live Data Integration & Authentication

IGNIS features a complete data pipeline connecting to official NASA FIRMS web services:

1. **Authentication & Security**:
   - Provide your free 32-character `MAP_KEY` from NASA EOSDIS: [https://firms.modaps.eosdis.nasa.gov/api/map_key/](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
   - Add it to `backend/.env` as `FIRMS_MAP_KEY=your_key`, or enter it via the **"Set FIRMS Key"** button in the web interface.
   - Keys are kept securely on the backend, verified directly against NASA EOSDIS, and never logged or exposed in client bundles.

2. **Live Ingestion Pipeline ("Refresh NASA Data")**:
   - Click the **"Refresh NASA Data"** button on the navbar or overview banner.
   - The backend connects directly to NASA FIRMS Area APIs across the satellite constellation:
     - **MODIS**: Terra & Aqua (`MODIS_NRT` or `MODIS_SP`) at 1 km nominal resolution
     - **VIIRS**: Suomi-NPP (`VIIRS_SNPP_NRT`), NOAA-20 (`VIIRS_NOAA20_NRT`), NOAA-21 (`VIIRS_NOAA21_NRT`) at 375 m resolution
   - Parsed CSV rows are validated for coordinate accuracy, FRP positivity, and brightness temperatures.
   - Deduplication: Computes deterministic stable identifiers and SHA-256 hashes to prevent duplicate insertions while preserving previously ingested historical records.

3. **Strict Separation of LIVE and SAMPLE Data**:
   - **LIVE DATA**: Flagged as `data_source = 'LIVE_FIRMS'`. Displays genuine NASA observations with acquisition date window, sensor breakdown, and last refresh timestamp.
   - **SAMPLE DATA**: Flagged as `data_source = 'SAMPLE_ARCHIVE'`. Pre-seeded reference archive clearly labeled as a demonstration benchmark.
   - Users can toggle between the live satellite feed and the demonstration archive using the dataset selector in the header.

---

## 🔬 Scientific Harmonization Principles

1. **Spatial-Temporal Clustering**:
   - Avoids treating adjacent 375m pixels on a single fire perimeter as independent fires.
   - Computes Euclidean/Haversine clustering within a 1.5–2.0 km radius on coincident diurnal passes.
   - Distinguishes raw pixel counts ($N_{MODIS}$, $N_{VIIRS}$) from physical fire event complexes ($N_{EVENTS}$).
2. **Cross-Sensor Scaling Ratio ($R_{V/M}$)**:
   - Quantifies the empirical ratio of VIIRS detections relative to MODIS detections in overlapping zones.
   - Calibrates long-term historical records (2000–present) so modern VIIRS sensitivity does not distort historical burning trends.
3. **Climatological Baseline Envelope**:
   - Computes multi-year moving window median, 75th, and 90th percentile thresholds for each Day-of-Year (DOY 1–365).
   - Flags days exceeding the 90th percentile baseline with statistical anomaly scores and confidence ratings.
