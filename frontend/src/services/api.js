/**
 * IGNIS API Client
 * Interfaces with FastAPI backend for NASA FIRMS harmonization data and models.
 * Configured for production deployment on Render Free: https://ignis-backend-em0i.onrender.com
 */

const rawBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "https://ignis-backend-em0i.onrender.com";
const cleanBase = String(rawBase).trim().replace(/\/+$/, "");
export const API_BASE = cleanBase.endsWith("/api") ? cleanBase : `${cleanBase}/api`;

/**
 * Resilient fetch wrapper with timeout and cold-start retry handling.
 * Render Free instances spin down after 15m of inactivity; initial wakeup can take ~30s.
 */
async function resilientFetch(url, options = {}, retries = 2, timeoutMs = 45000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt < retries) {
        // Wait 1.5 seconds before retry (accommodates Render Free cold start)
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}

export async function fetchHealth() {
  const res = await resilientFetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return res.json();
}

export async function fetchAOIs() {
  const res = await resilientFetch(`${API_BASE}/aoi`);
  if (!res.ok) throw new Error(`Failed to load AOIs: HTTP ${res.status}`);
  return res.json();
}

export async function fetchAOIDetails(aoiId, datasetMode = "SAMPLE") {
  const res = await resilientFetch(`${API_BASE}/aoi/${aoiId}?dataset_mode=${datasetMode}`);
  if (!res.ok) throw new Error(`Failed to load AOI details: HTTP ${res.status}`);
  return res.json();
}

export async function fetchFires({ aoiId, datasetMode = "SAMPLE", startDate, endDate, sensor, minConfidence, continent, country, minFrp, bbox, limit = 100000, offset = 0 }) {
  const params = new URLSearchParams({ aoi_id: aoiId, dataset_mode: datasetMode, limit: String(limit), offset: String(offset) });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (sensor && sensor !== "ALL") params.append("sensor", sensor);
  if (minConfidence !== undefined && minConfidence !== null) params.append("min_confidence", String(minConfidence));
  if (continent && continent !== "ALL") params.append("continent", continent);
  if (country && country !== "ALL") params.append("country", country);
  if (minFrp !== undefined && minFrp !== null && minFrp > 0) params.append("min_frp", String(minFrp));
  if (bbox) params.append("bbox", bbox);

  const res = await resilientFetch(`${API_BASE}/fires?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load fires: HTTP ${res.status}`);
  return res.json();
}

export async function fetchHarmonization({ aoiId, datasetMode = "SAMPLE", startDate, endDate, spatialThresholdKm = 1.5, temporalThresholdHours = 2.5 }) {
  const params = new URLSearchParams({
    aoi_id: aoiId,
    dataset_mode: datasetMode,
    spatial_threshold_km: String(spatialThresholdKm),
    temporal_threshold_hours: String(temporalThresholdHours)
  });
  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);

  const res = await resilientFetch(`${API_BASE}/harmonization?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to run harmonization: HTTP ${res.status}`);
  return res.json();
}

export async function fetchBurningCalendar({ aoiId, datasetMode = "SAMPLE", year }) {
  const params = new URLSearchParams({ aoi_id: aoiId, dataset_mode: datasetMode });
  if (year) params.append("year", String(year));

  const res = await resilientFetch(`${API_BASE}/calendar?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load calendar: HTTP ${res.status}`);
  return res.json();
}

export async function fetchAnomalies({ aoiId, datasetMode = "SAMPLE", year }) {
  const params = new URLSearchParams({ aoi_id: aoiId, dataset_mode: datasetMode });
  if (year) params.append("year", String(year));

  const res = await resilientFetch(`${API_BASE}/anomalies?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load anomaly intelligence: HTTP ${res.status}`);
  return res.json();
}

export async function fetchReport(aoiId, datasetMode = "SAMPLE", format = "json") {
  const res = await resilientFetch(`${API_BASE}/reports?aoi_id=${aoiId}&dataset_mode=${datasetMode}&format=${format}`);
  if (!res.ok) throw new Error(`Failed to generate report: HTTP ${res.status}`);
  if (format === "csv") {
    return res.blob();
  }
  return res.json();
}

export async function fetchClassification({ aoiId, datasetMode = "SAMPLE", category }) {
  const params = new URLSearchParams({ aoi_id: aoiId, dataset_mode: datasetMode });
  if (category && category !== "ALL") params.append("category", category);

  const res = await resilientFetch(`${API_BASE}/classification?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load fire source classification: HTTP ${res.status}`);
  return res.json();
}

export function formatApiErrorMessage(errorData, fallbackStatus = "") {
  if (errorData?.message && typeof errorData.message === "string") {
    return errorData.message;
  }
  if (Array.isArray(errorData?.detail)) {
    return errorData.detail.map(d => {
      const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "field";
      const fieldName = field === "days" ? "Observation window (days)" : field;
      return `${fieldName}: ${d.msg || "invalid value"}`;
    }).join("; ");
  }
  if (typeof errorData?.detail === "string") {
    return errorData.detail;
  }
  return fallbackStatus ? `Request failed (${fallbackStatus})` : "An unexpected server error occurred.";
}

export async function refreshNASAData({ aoiId, days = 5, dateStr = null, sources = null, mapKey = "" }) {
  const headers = { "Content-Type": "application/json" };
  if (mapKey) {
    headers["X-FIRMS-MAP-KEY"] = mapKey;
  }

  const res = await resilientFetch(`${API_BASE}/firms/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      aoi_id: aoiId,
      days: Number(days),
      date_str: dateStr,
      sources: sources,
      map_key: mapKey
    })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return {
      success: false,
      authenticated: false,
      error_code: errorData.error_code || `HTTP_${res.status}`,
      message: formatApiErrorMessage(errorData, `HTTP ${res.status}`)
    };
  }
  return res.json();
}

export async function saveBackendFIRMSKey(mapKey) {
  const res = await resilientFetch(`${API_BASE}/firms/save-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ map_key: mapKey })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return {
      success: false,
      message: errorData.message || `HTTP ${res.status}`
    };
  }
  return res.json();
}

export async function validateFIRMSKey(mapKey) {
  const headers = { "Content-Type": "application/json" };
  if (mapKey) {
    headers["X-FIRMS-MAP-KEY"] = mapKey;
  }

  const res = await resilientFetch(`${API_BASE}/firms/validate-key`, {
    method: "POST",
    headers,
    body: JSON.stringify({ map_key: mapKey })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return {
      success: false,
      message: formatApiErrorMessage(errorData, `HTTP ${res.status}`)
    };
  }
  return res.json();
}

export async function queryLiveFIRMS(bbox, source = "VIIRS_NOAA20_NRT", days = 1, mapKey = "", saveToDb = false) {
  const headers = { "Content-Type": "application/json" };
  if (mapKey) {
    headers["X-FIRMS-MAP-KEY"] = mapKey;
  }

  const res = await resilientFetch(`${API_BASE}/firms/live-query`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bbox,
      source,
      days,
      save_to_db: saveToDb
    })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return {
      success: false,
      message: formatApiErrorMessage(errorData, `HTTP ${res.status}`)
    };
  }
  return res.json();
}

export async function fetchGlobalSummary(datasetMode = "SAMPLE") {
  const res = await resilientFetch(`${API_BASE}/firms/global-summary?dataset_mode=${datasetMode}`);
  if (!res.ok) throw new Error(`Failed to load global fire summary: HTTP ${res.status}`);
  return res.json();
}

export async function refreshGlobalNASAData({ days = 5, dateStr = null, sources = null, mapKey = "" }) {
  const headers = { "Content-Type": "application/json" };
  if (mapKey) {
    headers["X-FIRMS-MAP-KEY"] = mapKey;
  }

  const res = await resilientFetch(`${API_BASE}/firms/refresh-global`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      days: Number(days),
      date_str: dateStr,
      sources: sources,
      map_key: mapKey
    })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    return {
      success: false,
      authenticated: false,
      error_code: errorData.error_code || `HTTP_${res.status}`,
      message: formatApiErrorMessage(errorData, `HTTP ${res.status}`)
    };
  }
  return res.json();
}
