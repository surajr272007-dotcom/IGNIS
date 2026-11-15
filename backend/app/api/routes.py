"""
IGNIS REST API Endpoints
Comprehensive routing for AOIs, raw observations, harmonization, burning calendars,
anomaly intelligence, reporting, and live NASA FIRMS API queries.
"""

from fastapi import APIRouter, Query, HTTPException, Header, Response
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
import json
import csv
import io
from ..services.db_service import db_service
from ..services.harmonization_engine import harmonization_engine
from ..services.calendar_service import calendar_service
from ..services.anomaly_service import anomaly_service
from ..services.classification_engine import classification_engine, CATEGORY_METADATA, SourceCategory, SourceCode
from ..services.firms_client import firms_client
from ..data.reference_regions import get_aoi_by_id
from ..config import update_env_map_key

api_router = APIRouter()

def _resolve_param(val):
    from fastapi.params import Query as QueryParam
    if isinstance(val, QueryParam):
        return val.default
    return val

@api_router.get("/health")
def health_check():
    """System health check endpoint verifying database and service readiness."""
    try:
        conn = db_service.get_connection()
        total_obs = conn.execute("SELECT count(*) FROM raw_observations").fetchone()[0]
        live_obs = conn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'").fetchone()[0]
        sample_obs = conn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'").fetchone()[0]
        conn.close()
        db_status = "connected"
    except Exception as e:
        total_obs, live_obs, sample_obs = 0, 0, 0
        db_status = f"degraded: {str(e)}"

    has_env_key = bool(firms_client.get_effective_map_key())

    return {
        "status": "healthy",
        "service": "IGNIS Active Fire Harmonization API",
        "version": "1.1.0",
        "database": {
            "engine": "DuckDB",
            "status": db_status,
            "total_observations_indexed": total_obs,
            "live_observations_indexed": live_obs,
            "sample_observations_indexed": sample_obs
        },
        "nasa_firms": {
            "api_endpoint": firms_client.base_url,
            "has_configured_map_key": has_env_key,
            "supported_sensors": [
                "MODIS (Terra/Aqua 1km MCD14DL)", 
                "VIIRS (Suomi-NPP 375m VNP14IMGTDL)", 
                "VIIRS (NOAA-20 375m VJ114IMGTDL)",
                "VIIRS (NOAA-21 375m)"
            ]
        }
    }

@api_router.get("/aoi")
def list_aois():
    """List all registered Areas of Interest with fire regime descriptions and bounding boxes."""
    aois = db_service.get_aois()
    return {"aois": aois}

@api_router.get("/aoi/{aoi_id}")
def get_aoi_details(
    aoi_id: str,
    dataset_mode: Optional[str] = Query("AUTO", description="'LIVE', 'SAMPLE', or 'AUTO'")
):
    """Get metadata and historical summary for a specific Area of Interest."""
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    aoi = db_service.get_aoi(aoi_id)
    if not aoi:
        raise HTTPException(status_code=404, detail=f"AOI '{aoi_id}' not found.")
    
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    return {
        "metadata": aoi,
        "observations_summary": counts
    }

@api_router.get("/fires")
def get_fires(
    aoi_id: str = Query("global", description="Area of Interest identifier (use 'global' for world)"),
    dataset_mode: Optional[str] = Query("AUTO", description="Dataset mode: 'LIVE', 'SAMPLE', or 'AUTO'"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
    sensor: Optional[str] = Query("ALL", description="Sensor filter: MODIS, VIIRS, or ALL"),
    min_confidence: Optional[int] = Query(None, description="Minimum confidence (0-100)"),
    continent: Optional[str] = Query(None, description="Continent filter"),
    country: Optional[str] = Query(None, description="Country filter"),
    min_frp: Optional[float] = Query(None, description="Minimum Fire Radiative Power (MW)"),
    bbox: Optional[str] = Query(None, description="Optional bounding box 'west,south,east,north'"),
    limit: int = Query(100000, description="Maximum points to return for map rendering"),
    offset: int = Query(0, description="Pagination offset for chunked retrieval")
):
    """Retrieve raw NASA satellite fire observations for map rendering and timeline inspection."""
    aoi_id = _resolve_param(aoi_id) or "global"
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    start_date = _resolve_param(start_date)
    end_date = _resolve_param(end_date)
    sensor = _resolve_param(sensor) or "ALL"
    min_confidence = _resolve_param(min_confidence)
    continent = _resolve_param(continent)
    country = _resolve_param(country)
    min_frp = _resolve_param(min_frp)
    bbox_str = _resolve_param(bbox)
    limit = _resolve_param(limit) or 100000
    offset = _resolve_param(offset) or 0

    parsed_bbox = None
    if bbox_str:
        try:
            parts = [float(x.strip()) for x in bbox_str.split(",")]
            if len(parts) == 4:
                parsed_bbox = parts
        except Exception:
            pass

    obs = db_service.get_observations(
        aoi_id=aoi_id,
        dataset_mode=dataset_mode,
        start_date=start_date,
        end_date=end_date,
        sensor=sensor,
        min_confidence=min_confidence,
        continent=continent,
        country=country,
        min_frp=min_frp,
        bbox=parsed_bbox,
        limit=limit,
        offset=offset
    )
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    
    # Enrich observations with Fire Source Classification attributes
    events, harm_metrics = harmonization_engine.harmonize_observations(obs)
    classified_events = classification_engine.classify_events(events, obs, aoi_id)
    enriched_obs = classification_engine.classify_observations(obs, classified_events, aoi_id)
    classification_summary = classification_engine.get_classification_summary(classified_events)

    is_live = counts["is_live"]
    notice = (
        "Displaying genuine NASA FIRMS active-fire satellite stream."
        if is_live else
        "Displaying NASA reference sample archive. Click 'Refresh NASA Data' to fetch live satellite observations."
    )

    # Exclude internal DB hashes to ensure high-speed transmission to frontend
    EXCLUDE_OBS_FIELDS = {"raw_hash", "ingested_at"}
    compact_obs = [
        {k: v for k, v in o.items() if k not in EXCLUDE_OBS_FIELDS}
        for o in enriched_obs
    ]

    payload = {
        "aoi_id": aoi_id,
        "dataset_mode": counts["dataset_mode"],
        "is_live": is_live,
        "notice": notice,
        "count": len(compact_obs),
        "total_available": counts["total"],
        "summary": counts,
        "classification_summary": classification_summary,
        "harmonization_metrics": harm_metrics,
        "harmonized_events": classified_events[:500],
        "observations": compact_obs
    }

    return payload

@api_router.get("/harmonization")
def get_harmonization_analysis(
    aoi_id: str = Query("pantanal_brazil"),
    dataset_mode: Optional[str] = Query("AUTO"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    continent: Optional[str] = Query(None, description="Continent filter"),
    country: Optional[str] = Query(None, description="Country filter"),
    spatial_threshold_km: float = Query(1.5, description="Spatial matching radius in km"),
    temporal_threshold_hours: float = Query(2.5, description="Temporal coincidence window in hours")
):
    """
    Performs scientific multi-sensor harmonization and fire source classification.
    Applies geodesic distance and temporal matching to reconcile MODIS and VIIRS into unified fire events.
    """
    aoi_id = _resolve_param(aoi_id) or "pantanal_brazil"
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    start_date = _resolve_param(start_date)
    end_date = _resolve_param(end_date)
    continent = _resolve_param(continent)
    country = _resolve_param(country)
    spatial_threshold_km = float(_resolve_param(spatial_threshold_km) or 1.5)
    temporal_threshold_hours = float(_resolve_param(temporal_threshold_hours) or 2.5)

    obs = db_service.get_observations(
        aoi_id=aoi_id, 
        dataset_mode=dataset_mode, 
        start_date=start_date, 
        end_date=end_date, 
        continent=continent,
        country=country,
        limit=15000
    )
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    
    from ..services.harmonization_engine import HarmonizationEngine
    engine = HarmonizationEngine(
        spatial_threshold_km=spatial_threshold_km,
        temporal_threshold_hours=temporal_threshold_hours
    )

    events, metrics = engine.harmonize_observations(obs)

    # Apply Fire Source Classification
    classified_events = classification_engine.classify_events(events, obs, aoi_id)
    classification_summary = classification_engine.get_classification_summary(classified_events)

    return {
        "aoi_id": aoi_id,
        "dataset_mode": counts["dataset_mode"],
        "is_live": counts["is_live"],
        "parameters": {
            "spatial_threshold_km": spatial_threshold_km,
            "temporal_threshold_hours": temporal_threshold_hours,
            "matching_algorithm": "Bipartite Spatiotemporal Nearest-Neighbor Harmonization",
            "distance_metric": "WGS84 Great-Circle Geodesic (Haversine)"
        },
        "metrics": metrics,
        "classification_summary": classification_summary,
        "events_count": len(classified_events),
        "sample_events": classified_events[:500]
    }

@api_router.get("/classification")
def get_fire_source_classification(
    aoi_id: str = Query("pantanal_brazil"),
    dataset_mode: Optional[str] = Query("AUTO"),
    category: Optional[str] = Query(None, description="Category filter: FOREST_WILDFIRE, AGRICULTURAL_BURNING, INDUSTRIAL_HEAT, UNKNOWN, or ALL")
):
    """
    Classifies NASA FIRMS active fire events into probable source categories:
    1. Likely Forest Wildfire
    2. Possible Agricultural Burning
    3. Possible Industrial Heat
    4. Unknown Thermal Anomaly
    """
    aoi_id = _resolve_param(aoi_id) or "pantanal_brazil"
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    category = _resolve_param(category)

    obs = db_service.get_observations(aoi_id=aoi_id, dataset_mode=dataset_mode, limit=15000)
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    events = harmonization_engine.cluster_observations_into_events(obs)
    classified_events = classification_engine.classify_events(events, obs, aoi_id)
    summary = classification_engine.get_classification_summary(classified_events)

    filtered_events = classified_events
    if category and category.upper() != "ALL":
        cat_upper = category.upper()
        filtered_events = [
            e for e in classified_events 
            if e.get("classification_code") == cat_upper or e.get("probable_source", "").upper() == cat_upper
        ]

    return {
        "aoi_id": aoi_id,
        "dataset_mode": counts["dataset_mode"],
        "is_live": counts["is_live"],
        "summary": summary,
        "total_classified_events": len(filtered_events),
        "events": filtered_events[:200],
        "categories_metadata": CATEGORY_METADATA
    }

@api_router.get("/calendar")
def get_burning_calendar(
    aoi_id: str = Query("pantanal_brazil"),
    dataset_mode: Optional[str] = Query("AUTO"),
    year: Optional[int] = Query(None, description="Filter for a specific year in the calendar")
):
    """
    Generates the scientific Burning Activity Calendar.
    Provides daily timeline, climatological baselines, anomaly flags, and seasonal regimes.
    """
    aoi_id = _resolve_param(aoi_id) or "pantanal_brazil"
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    year = _resolve_param(year)

    obs = db_service.get_observations(aoi_id=aoi_id, dataset_mode=dataset_mode, limit=25000)
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    events = harmonization_engine.cluster_observations_into_events(obs)
    calendar_data = calendar_service.build_burning_calendar(obs, events)

    if year:
        calendar_data["daily_timeline"] = [
            d for d in calendar_data["daily_timeline"] if d["year"] == year
        ]

    return {
        "aoi_id": aoi_id,
        "dataset_mode": counts["dataset_mode"],
        "is_live": counts["is_live"],
        "calendar": calendar_data
    }

@api_router.get("/anomalies")
def get_anomaly_intelligence(
    aoi_id: str = Query("pantanal_brazil"),
    dataset_mode: Optional[str] = Query("AUTO"),
    year: Optional[int] = Query(None)
):
    """
    Evaluates fire activity against multi-year historical baselines to flag unusual surges.
    Returns anomaly scores, supporting statistics, and uncertainty assessments.
    """
    aoi_id = _resolve_param(aoi_id) or "pantanal_brazil"
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    year = _resolve_param(year)

    aoi_meta = db_service.get_aoi(aoi_id)
    obs = db_service.get_observations(aoi_id=aoi_id, dataset_mode=dataset_mode, limit=25000)
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    events = harmonization_engine.cluster_observations_into_events(obs)
    cal = calendar_service.build_burning_calendar(obs, events)

    daily = cal["daily_timeline"]
    if year:
        daily = [d for d in daily if d["year"] == year]

    anomaly_data = anomaly_service.analyze_anomalies(daily, aoi_meta)
    return {
        "aoi_id": aoi_id,
        "dataset_mode": counts["dataset_mode"],
        "is_live": counts["is_live"],
        "analysis": anomaly_data
    }

@api_router.get("/reports")
def get_intelligence_report(
    aoi_id: str = Query("pantanal_brazil"),
    dataset_mode: Optional[str] = Query("AUTO"),
    format: str = Query("json", description="json or csv")
):
    """
    Generates an executive Intelligence Report for the selected Area of Interest.
    Includes fire trends, sensor comparison, anomaly findings, and data export.
    """
    aoi_id = _resolve_param(aoi_id) or "pantanal_brazil"
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    format = _resolve_param(format) or "json"

    aoi_meta = db_service.get_aoi(aoi_id)
    obs = db_service.get_observations(aoi_id=aoi_id, dataset_mode=dataset_mode, limit=25000)
    counts = db_service.get_observation_counts(aoi_id, dataset_mode=dataset_mode)
    events = harmonization_engine.cluster_observations_into_events(obs)
    metrics = harmonization_engine.compute_harmonization_metrics(obs, events)
    classified_events = classification_engine.classify_events(events, obs, aoi_id)
    class_summary = classification_engine.get_classification_summary(classified_events)
    cal = calendar_service.build_burning_calendar(obs, events)
    anom = anomaly_service.analyze_anomalies(cal["daily_timeline"], aoi_meta)

    report_payload = {
        "report_title": f"IGNIS Satellite Intelligence Assessment: {aoi_meta['name'] if aoi_meta else aoi_id}",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "aoi_metadata": aoi_meta,
        "dataset_mode": counts["dataset_mode"],
        "is_live": counts["is_live"],
        "data_provenance": "NASA FIRMS (MCD14DL & VNP14IMGTDL)" if counts["is_live"] else "NASA Reference Sample Archive",
        "harmonization_overview": metrics,
        "fire_source_classification": class_summary,
        "burning_regime": cal["season_profile"],
        "anomaly_summary": anom["summary"],
        "top_anomalous_events": anom["anomalies"][:10],
        "monthly_trend": cal["monthly_summary"]
    }

    if format.lower() == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Date", "Year", "Month", "DayOfYear", "MODIS_Raw", "VIIRS_Raw", "Harmonized_Events", "FRP_MW", "Harmonized_Index", "Anomaly_Level", "Dataset_Type"])
        for d in cal["daily_timeline"]:
            writer.writerow([
                d["date"], d["year"], d["month"], d["day_of_year"],
                d["modis_count"], d["viirs_count"], d["harmonized_event_count"],
                d["harmonized_frp_mw"], d["harmonized_fire_index"], d.get("anomaly_level", "NORMAL"),
                counts["dataset_mode"]
            ])
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=IGNIS_Report_{aoi_id}_{counts['dataset_mode']}.csv"}
        )

    return report_payload

# ----------------- NASA FIRMS Live Integration Endpoints -----------------

class RefreshFirmsRequest(BaseModel):
    aoi_id: str = Field(default="pantanal_brazil", description="Area of Interest identifier")
    days: int = Field(default=5, ge=1, le=5, description="Recent observation days to fetch (1-5)")
    date_str: Optional[str] = Field(default=None, description="Optional starting date YYYY-MM-DD")
    sources: Optional[List[str]] = Field(default=None, description="Specific NASA sources or None for standard constellation")
    map_key: Optional[str] = Field(default=None, description="Optional map key if not provided via X-FIRMS-MAP-KEY header")

class RefreshGlobalFirmsRequest(BaseModel):
    days: int = Field(default=5, ge=1, le=5, description="Recent observation days to fetch (1-5)")
    date_str: Optional[str] = Field(default=None, description="Optional starting date YYYY-MM-DD")
    sources: Optional[List[str]] = Field(default=None, description="Specific NASA sources or None for standard constellation")
    map_key: Optional[str] = Field(default=None, description="Optional map key if not provided via X-FIRMS-MAP-KEY header")

class SaveKeyRequest(BaseModel):
    map_key: str = Field(..., min_length=10, description="32-character NASA FIRMS map key")

class LiveFirmsQueryRequest(BaseModel):
    bbox: List[float] = Field(
        ...,
        description="Bounding box [west, south, east, north] in decimal degrees (WGS84)",
        min_length=4,
        max_length=4,
        examples=[[-58.0, -20.5, -55.0, -16.0]]
    )
    source: str = Field(
        default="VIIRS_NOAA20_NRT",
        description="NASA FIRMS satellite product (e.g. VIIRS_NOAA20_NRT, MODIS_NRT)"
    )
    days: int = Field(
        default=1,
        ge=1,
        le=10,
        description="Number of days to query (1 to 10)"
    )
    date_str: Optional[str] = Field(
        default=None,
        description="Optional date in YYYY-MM-DD format"
    )
    save_to_db: bool = Field(
        default=False,
        description="Whether to persist the fetched observations into DuckDB"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v: List[float]) -> List[float]:
        if len(v) != 4:
            raise ValueError("Bounding box must contain exactly 4 coordinates: [west, south, east, north]")
        west, south, east, north = v
        if not (-180.0 <= west <= 180.0 and -180.0 <= east <= 180.0):
            raise ValueError("Longitude coordinates (west, east) must be between -180.0 and 180.0 degrees")
        if not (-90.0 <= south <= 90.0 and -90.0 <= north <= 90.0):
            raise ValueError("Latitude coordinates (south, north) must be between -90.0 and 90.0 degrees")
        if west > east:
            raise ValueError(f"West longitude ({west}) must be <= East longitude ({east})")
        if south > north:
            raise ValueError(f"South latitude ({south}) must be <= North latitude ({north})")
        return v

class ValidateKeyRequest(BaseModel):
    map_key: Optional[str] = Field(
        default=None,
        description="Optional NASA FIRMS map key if not provided via X-FIRMS-MAP-KEY header"
    )

@api_router.post("/firms/validate-key")
async def validate_firms_key(
    payload: Optional[ValidateKeyRequest] = None,
    x_firms_map_key: Optional[str] = Header(None, alias="X-FIRMS-MAP-KEY")
):
    """
    Directly tests key validity against NASA EOSDIS data availability API.
    Never exposes or logs the MAP_KEY.
    """
    effective_key = x_firms_map_key or (payload.map_key if payload else None)
    return await firms_client.verify_map_key(map_key=effective_key)

@api_router.post("/firms/save-key")
async def save_firms_key(
    payload: SaveKeyRequest
):
    """
    Validates the provided NASA MAP_KEY against NASA EOSDIS and securely persists it into backend/.env.
    Never exposes the key in logs.
    """
    val_res = await firms_client.verify_map_key(payload.map_key)
    if not val_res["success"]:
        return {
            "success": False,
            "error_code": val_res.get("error_code", "INVALID_MAP_KEY"),
            "message": val_res.get("message", "Key validation failed.")
        }
    
    update_env_map_key(payload.map_key)
    return {
        "success": True,
        "message": "Valid NASA FIRMS Map Key! Verified with NASA EOSDIS and securely configured in backend."
    }

@api_router.post("/firms/refresh")
async def refresh_nasa_data(
    payload: RefreshFirmsRequest,
    x_firms_map_key: Optional[str] = Header(None, alias="X-FIRMS-MAP-KEY")
):
    """
    Live Ingestion Pipeline:
    Fetches genuine NASA FIRMS active fire observations across MODIS and VIIRS,
    validates rows, prevents duplicates, stores in DuckDB, and recalculates analytics.
    """
    aoi = db_service.get_aoi(payload.aoi_id)
    if not aoi:
        raise HTTPException(status_code=404, detail=f"AOI '{payload.aoi_id}' not found.")

    effective_key = x_firms_map_key or payload.map_key or firms_client.get_effective_map_key()
    if not effective_key:
        return {
            "success": False,
            "authenticated": False,
            "error_code": "NO_MAP_KEY",
            "message": (
                "NASA FIRMS Map Key is required. Please provide a key in the request "
                "or configure FIRMS_MAP_KEY in backend/.env."
            )
        }

    # Query official NASA FIRMS multi-sensor pipeline
    bbox = [aoi["bbox_west"], aoi["bbox_south"], aoi["bbox_east"], aoi["bbox_north"]]
    query_res = await firms_client.fetch_aoi_multi_sensor(
        aoi_id=payload.aoi_id,
        bbox=bbox,
        days=payload.days,
        date_str=payload.date_str,
        map_key=effective_key,
        sources=payload.sources
    )

    if not query_res["success"]:
        db_service.record_ingestion_log(
            aoi_id=payload.aoi_id,
            status="AUTH_ERROR" if query_res.get("error_code") == "INVALID_MAP_KEY" else "FAILED",
            result_stats={},
            date_start=payload.date_str or "RECENT",
            date_end=f"+{payload.days}d",
            sensors=payload.sources or ["MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"],
            error_msg=query_res.get("message")
        )
        return {
            "success": False,
            "authenticated": False,
            "error_code": query_res.get("error_code"),
            "message": query_res.get("message")
        }

    raw_observations = query_res.get("observations", [])

    # Store into DuckDB with deduplication and validation
    insert_stats = db_service.insert_observations(raw_observations, data_source="LIVE_FIRMS")
    insert_stats["modis_count"] = query_res.get("modis_count", 0)
    insert_stats["viirs_count"] = query_res.get("viirs_count", 0)

    # Record audit log
    db_service.record_ingestion_log(
        aoi_id=payload.aoi_id,
        status="SUCCESS",
        result_stats=insert_stats,
        date_start=payload.date_str or f"Recent {payload.days}d",
        date_end=datetime.utcnow().strftime("%Y-%m-%d"),
        sensors=query_res.get("sensors_queried", [])
    )

    # Recalculate live observation counts
    updated_counts = db_service.get_observation_counts(payload.aoi_id, dataset_mode="LIVE")

    return {
        "success": True,
        "authenticated": True,
        "message": (
            f"Successfully refreshed NASA FIRMS satellite feed for {aoi['name']}. "
            f"Retrieved {insert_stats['received']} observations ({insert_stats['inserted']} new inserted, "
            f"{insert_stats['duplicates_skipped']} duplicates skipped)."
        ),
        "aoi_id": payload.aoi_id,
        "aoi_name": aoi["name"],
        "records_received": insert_stats["received"],
        "records_validated": insert_stats["validated"],
        "records_inserted": insert_stats["inserted"],
        "duplicates_skipped": insert_stats["duplicates_skipped"],
        "invalid_rejected": insert_stats["invalid_rejected"],
        "modis_count": query_res.get("modis_count", 0),
        "viirs_count": query_res.get("viirs_count", 0),
        "by_source": query_res.get("by_source", {}),
        "sensors_queried": query_res.get("sensors_queried", []),
        "updated_live_totals": updated_counts,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

@api_router.post("/firms/live-query")
async def query_live_firms(
    payload: LiveFirmsQueryRequest,
    x_firms_map_key: Optional[str] = Header(None, alias="X-FIRMS-MAP-KEY")
):
    """
    Direct Area query against NASA FIRMS API.
    """
    res = await firms_client.fetch_area_fires_raw(
        bbox=payload.bbox,
        source=payload.source,
        days=payload.days,
        date_str=payload.date_str,
        map_key=x_firms_map_key
    )

    if res.get("success") and payload.save_to_db and res.get("data"):
        db_service.insert_observations(res["data"], data_source="LIVE_FIRMS")

    return res

@api_router.post("/firms/refresh-global")
async def refresh_global_nasa_data(
    payload: Optional[RefreshGlobalFirmsRequest] = None,
    x_firms_map_key: Optional[str] = Header(None, alias="X-FIRMS-MAP-KEY")
):
    """
    Global NASA Ingestion Pipeline:
    Fetches genuine global NASA FIRMS active fire observations across all 4 products
    (MODIS_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, VIIRS_SNPP_NRT) using the /world endpoint,
    reverse-geocodes to continents and countries, deduplicates via SHA-256 hashes,
    and stores in DuckDB under LIVE_FIRMS.
    """
    if payload is None:
        payload = RefreshGlobalFirmsRequest()

    effective_key = x_firms_map_key or payload.map_key or firms_client.get_effective_map_key()
    if not effective_key:
        return {
            "success": False,
            "authenticated": False,
            "error_code": "NO_MAP_KEY",
            "message": "NASA FIRMS Map Key is required. Please configure FIRMS_MAP_KEY in backend/.env."
        }

    query_res = await firms_client.fetch_global_fires(
        days=payload.days,
        date_str=payload.date_str,
        map_key=effective_key,
        sources=payload.sources
    )

    if not query_res["success"]:
        db_service.record_ingestion_log(
            aoi_id="global",
            status="AUTH_ERROR" if query_res.get("error_code") == "INVALID_MAP_KEY" else "FAILED",
            result_stats={},
            date_start=payload.date_str or "RECENT",
            date_end=f"+{payload.days}d",
            sensors=payload.sources or ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"],
            error_msg=query_res.get("message")
        )
        return {
            "success": False,
            "authenticated": False,
            "error_code": query_res.get("error_code"),
            "message": query_res.get("message")
        }

    raw_observations = query_res.get("observations", [])

    # Store into DuckDB with deduplication and validation
    insert_stats = db_service.insert_observations(raw_observations, data_source="LIVE_FIRMS")
    insert_stats["modis_count"] = query_res.get("modis_count", 0)
    insert_stats["viirs_count"] = query_res.get("viirs_count", 0)

    # Record audit log
    db_service.record_ingestion_log(
        aoi_id="global",
        status="SUCCESS",
        result_stats=insert_stats,
        date_start=payload.date_str or f"Recent {payload.days}d",
        date_end=datetime.utcnow().strftime("%Y-%m-%d"),
        sensors=query_res.get("sensors_queried", [])
    )

    # Recalculate live observation counts
    updated_counts = db_service.get_observation_counts("global", dataset_mode="LIVE")

    return {
        "success": True,
        "authenticated": True,
        "message": (
            f"Successfully ingested global NASA FIRMS active fire feed. "
            f"Retrieved {insert_stats['received']} observations ({insert_stats['inserted']} new inserted, "
            f"{insert_stats['duplicates_skipped']} duplicates skipped)."
        ),
        "aoi_id": "global",
        "aoi_name": "Global Active Fire Network",
        "records_received": insert_stats["received"],
        "records_validated": insert_stats["validated"],
        "records_inserted": insert_stats["inserted"],
        "duplicates_skipped": insert_stats["duplicates_skipped"],
        "invalid_rejected": insert_stats["invalid_rejected"],
        "modis_count": query_res.get("modis_count", 0),
        "viirs_count": query_res.get("viirs_count", 0),
        "by_source": query_res.get("by_source", {}),
        "sensors_queried": query_res.get("sensors_queried", []),
        "updated_live_totals": updated_counts,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

@api_router.get("/firms/global-summary")
def get_global_fire_summary(
    dataset_mode: Optional[str] = Query("AUTO", description="'LIVE', 'SAMPLE', or 'AUTO'")
):
    """
    Returns global breakdown of active fire observations grouped by continent and top countries.
    """
    dataset_mode = _resolve_param(dataset_mode) or "AUTO"
    breakdown = db_service.get_global_breakdown(dataset_mode=dataset_mode)
    counts = db_service.get_observation_counts("global", dataset_mode=dataset_mode)
    return {
        "dataset_mode": counts["dataset_mode"],
        "is_live": counts["is_live"],
        "total_global_observations": counts["total"],
        "by_sensor": {
            "modis": counts.get("modis_count", 0),
            "viirs": counts.get("viirs_count", 0)
        },
        "continents": breakdown["continents"],
        "top_countries": breakdown["top_countries"],
        "total_continents_active": len(breakdown["continents"]),
        "total_countries_active": len(breakdown["top_countries"])
    }
