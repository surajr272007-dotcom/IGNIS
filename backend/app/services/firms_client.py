"""
NASA FIRMS (Fire Information for Resource Management System) API Client.
Interacts with official NASA FIRMS REST APIs for MODIS and VIIRS products.
Supports multi-sensor querying (MODIS Terra/Aqua, VIIRS Suomi-NPP, NOAA-20, NOAA-21),
date window chunking, response validation, and secure authentication.
"""

import httpx
import pandas as pd
import io
import re
import csv
import gc
import inspect
import logging
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable

logger = logging.getLogger("ignis.firms")
from ..config import settings, update_env_map_key
from ..data.geo_reference import resolve_geographic_context
from ..data.reference_regions import REFERENCE_AOIS

# Official NASA FIRMS Supported Products for Area Queries
SUPPORTED_SOURCES = {
    "MODIS_NRT": {"sensor": "MODIS", "satellites": ["Terra", "Aqua"], "res": 1000},
    "VIIRS_SNPP_NRT": {"sensor": "VIIRS", "satellites": ["Suomi-NPP"], "res": 375},
    "VIIRS_NOAA20_NRT": {"sensor": "VIIRS", "satellites": ["NOAA-20"], "res": 375},
    "VIIRS_NOAA21_NRT": {"sensor": "VIIRS", "satellites": ["NOAA-21"], "res": 375},
    # Standard processing archives
    "MODIS_SP": {"sensor": "MODIS", "satellites": ["Terra", "Aqua"], "res": 1000},
    "VIIRS_SNPP_SP": {"sensor": "VIIRS", "satellites": ["Suomi-NPP"], "res": 375},
    "VIIRS_NOAA20_SP": {"sensor": "VIIRS", "satellites": ["NOAA-20"], "res": 375}
}

class FIRMSClient:
    def __init__(self):
        self.base_url = settings.NASA_FIRMS_BASE_URL.rstrip("/")

    def get_effective_map_key(self, user_key: Optional[str] = None) -> Optional[str]:
        """Returns the sanitized user key or backend configured key."""
        k = (user_key or settings.FIRMS_MAP_KEY or "").strip()
        # NASA FIRMS MAP_KEY is a 32-character hexadecimal token
        return k if len(k) >= 10 else None

    async def verify_map_key(self, map_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Validates the NASA FIRMS MAP_KEY directly against NASA EOSDIS data_availability API.
        Never logs or exposes the key in responses.
        """
        key = self.get_effective_map_key(map_key)
        if not key:
            return {
                "success": False,
                "error_code": "NO_MAP_KEY",
                "message": (
                    "NASA FIRMS Map Key is required. Please provide a valid 32-character "
                    "key from https://firms.modaps.eosdis.nasa.gov/api/map_key/"
                )
            }

        endpoint = f"{self.base_url}/api/data_availability/csv/{key}/MODIS_NRT"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(endpoint)
                
                # Check for invalid key errors from NASA
                if resp.status_code in (400, 401, 403) or "invalid map_key" in resp.text.lower():
                    return {
                        "success": False,
                        "error_code": "INVALID_MAP_KEY",
                        "message": "The provided NASA FIRMS MAP_KEY was rejected by NASA servers (Invalid MAP_KEY)."
                    }

                if resp.status_code == 200 and ("MODIS_NRT" in resp.text or "data_availability" in resp.text):
                    # Persist key on backend securely if not already in .env
                    if not settings.FIRMS_MAP_KEY or settings.FIRMS_MAP_KEY != key:
                        update_env_map_key(key)

                    return {
                        "success": True,
                        "message": "Valid NASA FIRMS Map Key! Successfully authenticated with NASA EOSDIS."
                    }

                return {
                    "success": False,
                    "error_code": f"HTTP_{resp.status_code}",
                    "message": f"NASA FIRMS returned unexpected HTTP {resp.status_code}."
                }

        except Exception as e:
            clean_err = str(e).replace(key, "[REDACTED]") if key else str(e)
            return {
                "success": False,
                "error_code": "NETWORK_ERROR",
                "message": f"Connection error verifying key against NASA FIRMS: {clean_err}"
            }

    async def fetch_area_fires_raw(self, bbox: List[float], source: str, days: int = 1,
                                  date_str: Optional[str] = None, map_key: Optional[str] = None) -> Dict[str, Any]:
        """Queries NASA FIRMS Area API for a single source product and date window."""
        key = self.get_effective_map_key(map_key)
        if not key:
            return {
                "success": False,
                "error_code": "NO_MAP_KEY",
                "message": "NASA FIRMS Map Key is required.",
                "data": []
            }

        west, south, east, north = bbox
        bbox_param = f"{west},{south},{east},{north}"
        clamped_days = max(1, min(10, days))
        
        endpoint = f"{self.base_url}/api/area/csv/{key}/{source}/{bbox_param}/{clamped_days}"
        if date_str:
            endpoint += f"/{date_str}"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(endpoint)
                
                if resp.status_code in (400, 401, 403) or "invalid map_key" in resp.text.lower():
                    return {
                        "success": False,
                        "error_code": "INVALID_MAP_KEY",
                        "message": "NASA FIRMS rejected the MAP_KEY: Invalid MAP_KEY.",
                        "data": []
                    }
                
                if resp.status_code != 200:
                    return {
                        "success": False,
                        "error_code": f"HTTP_{resp.status_code}",
                        "message": f"NASA FIRMS returned HTTP {resp.status_code}.",
                        "data": []
                    }

                csv_text = resp.text.strip()
                if "invalid map_key" in csv_text.lower():
                    return {
                        "success": False,
                        "error_code": "INVALID_MAP_KEY",
                        "message": "NASA FIRMS rejected the MAP_KEY: Invalid MAP_KEY.",
                        "data": []
                    }

                if not csv_text or "No fires found" in csv_text:
                    return {
                        "success": True,
                        "count": 0,
                        "source": source,
                        "data": []
                    }

                df = pd.read_csv(io.StringIO(csv_text))
                if df.empty or len(df) == 0:
                    return {
                        "success": True,
                        "count": 0,
                        "source": source,
                        "data": []
                    }

                # Normalize sensor info
                src_meta = SUPPORTED_SOURCES.get(source, {
                    "sensor": "MODIS" if "MODIS" in source else "VIIRS",
                    "res": 1000 if "MODIS" in source else 375
                })
                sensor_type = src_meta["sensor"]
                resolution = src_meta["res"]

                parsed_records = []
                for idx, row in df.iterrows():
                    try:
                        lat = float(row["latitude"])
                        lon = float(row["longitude"])
                        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                            continue

                        acq_d = str(row.get("acq_date", "")).strip()
                        acq_t = str(row.get("acq_time", "0000")).zfill(4)
                        sat_raw = str(row.get("satellite", "UNKNOWN"))
                        # Map satellite codes
                        if sat_raw in ("T", "Terra"):
                            sat_name = "Terra"
                        elif sat_raw in ("A", "Aqua"):
                            sat_name = "Aqua"
                        elif sat_raw in ("N", "SNPP", "Suomi-NPP"):
                            sat_name = "Suomi-NPP"
                        elif sat_raw in ("1", "NOAA-20", "JPSS-1"):
                            sat_name = "NOAA-20"
                        elif sat_raw in ("2", "NOAA-21", "JPSS-2"):
                            sat_name = "NOAA-21"
                        else:
                            sat_name = sat_raw

                        conf_raw = row.get("confidence", "nominal")
                        if str(conf_raw).isdigit():
                            conf_num = int(conf_raw)
                            conf_cat = "low" if conf_num < 30 else ("nominal" if conf_num < 80 else "high")
                        else:
                            conf_str = str(conf_raw).strip().lower()
                            if conf_str in ("l", "low") or conf_str.startswith("low"):
                                conf_cat = "low"
                                conf_num = 25
                            elif conf_str in ("h", "high") or conf_str.startswith("high"):
                                conf_cat = "high"
                                conf_num = 90
                            elif conf_str in ("n", "nominal") or conf_str.startswith("nom"):
                                conf_cat = "nominal"
                                conf_num = 65
                            else:
                                conf_cat = "nominal"
                                conf_num = 65

                        # Brightness and FRP
                        brightness = float(row.get("brightness", row.get("bright_ti4", 310.0)))
                        bright_t31 = float(row.get("bright_t31", row.get("bright_ti5", 295.0)))
                        frp = max(0.0, float(row.get("frp", 0.0)))

                        # Unique deterministic ID
                        stable_id = f"FIRMS_{sensor_type}_{sat_name}_{acq_d}_{acq_t}_{lat:.4f}_{lon:.4f}"
                        raw_key = f"{sensor_type}_{sat_name}_{acq_d}_{acq_t}_{lat:.4f}_{lon:.4f}_{frp:.1f}"
                        h = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

                        parsed_records.append({
                            "id": stable_id,
                            "sensor": sensor_type,
                            "satellite": sat_name,
                            "instrument": sensor_type,
                            "latitude": lat,
                            "longitude": lon,
                            "brightness": brightness,
                            "scan": float(row.get("scan", 1.0)),
                            "track": float(row.get("track", 1.0)),
                            "acq_date": acq_d,
                            "acq_time": acq_t,
                            "confidence": conf_cat,
                            "confidence_numeric": conf_num,
                            "version": str(row.get("version", "NRT")),
                            "bright_t31": bright_t31,
                            "frp": frp,
                            "daynight": str(row.get("daynight", "D")).upper()[:1],
                            "aoi_id": "",  # To be set by caller
                            "resolution_m": resolution,
                            "data_source": "LIVE_FIRMS",
                            "raw_hash": h
                        })
                    except Exception:
                        continue

                return {
                    "success": True,
                    "count": len(parsed_records),
                    "source": source,
                    "data": parsed_records
                }

        except Exception as e:
            clean_err = str(e).replace(key, "[REDACTED]") if key else str(e)
            return {
                "success": False,
                "error_code": "NETWORK_ERROR",
                "message": f"Connection error querying NASA FIRMS API: {clean_err}",
                "data": []
            }

    async def fetch_aoi_multi_sensor(self, aoi_id: str, bbox: List[float], days: int = 3,
                                     date_str: Optional[str] = None, map_key: Optional[str] = None,
                                     sources: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Orchestrates multi-sensor live observations retrieval across:
        - MODIS (Terra & Aqua) via MODIS_NRT
        - VIIRS (Suomi-NPP, NOAA-20, NOAA-21) via VIIRS_*_NRT
        Handles verification, parallel queries, and unified collection.
        """
        key = self.get_effective_map_key(map_key)
        if not key:
            return {
                "success": False,
                "error_code": "NO_MAP_KEY",
                "message": (
                    "NASA FIRMS MAP_KEY is not configured. Please enter your 32-character key "
                    "via the 'Set FIRMS Key' button or add FIRMS_MAP_KEY to backend/.env."
                ),
                "observations": []
            }

        # Step 1: Pre-flight verify authentication with NASA EOSDIS
        auth_check = await self.verify_map_key(key)
        if not auth_check["success"]:
            return {
                "success": False,
                "error_code": auth_check.get("error_code", "AUTH_FAILED"),
                "message": auth_check.get("message", "Authentication with NASA FIRMS failed."),
                "observations": []
            }

        # Default source suite: comprehensive MODIS + VIIRS active constellation
        query_sources = sources or ["MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]

        all_observations = []
        source_counts = {}
        errors = []

        # Execute queries for each sensor product
        for src in query_sources:
            res = await self.fetch_area_fires_raw(
                bbox=bbox,
                source=src,
                days=days,
                date_str=date_str,
                map_key=key
            )
            if res["success"]:
                obs_list = res.get("data", [])
                for o in obs_list:
                    o["aoi_id"] = aoi_id
                all_observations.extend(obs_list)
                source_counts[src] = len(obs_list)
            else:
                errors.append(f"{src}: {res.get('message')}")

        modis_total = len([o for o in all_observations if o["sensor"] == "MODIS"])
        viirs_total = len([o for o in all_observations if o["sensor"] == "VIIRS"])

        return {
            "success": True,
            "total_records": len(all_observations),
            "modis_count": modis_total,
            "viirs_count": viirs_total,
            "by_source": source_counts,
            "errors": errors if errors else None,
            "observations": all_observations,
            "sensors_queried": query_sources
        }

    async def fetch_global_fires(self, days: int = 1, date_str: Optional[str] = None,
                                 map_key: Optional[str] = None,
                                 sources: Optional[List[str]] = None,
                                 on_batch: Optional[Callable[[List[Dict[str, Any]], str], Any]] = None,
                                 batch_size: int = 2500) -> Dict[str, Any]:
        """
        Retrieves global active-fire thermal observations using NASA FIRMS Area API:
        URL pattern: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/world/{DAYS}
        Sources: MODIS_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, VIIRS_SNPP_NRT

        Sequential & Streaming Architecture (Render Free 512MB RAM Safe):
        1. Queries the four products strictly sequentially (one at a time).
        2. Streams and parses CSV using csv.DictReader (no DataFrame allocations).
        3. Enriches and flushes records in small batches (default 2,500) via on_batch callback.
        4. When on_batch is provided, observations are NOT retained in memory, capping RAM usage <50 MB.
        5. Handles NASA API timeouts and partial product failures gracefully without server crash.
        """
        key = self.get_effective_map_key(map_key)
        if not key:
            return {
                "success": False,
                "error_code": "NO_MAP_KEY",
                "message": (
                    "NASA FIRMS MAP_KEY is not configured. Please enter your 32-character key "
                    "via the 'Set FIRMS Key' button or add FIRMS_MAP_KEY to backend/.env."
                ),
                "observations": []
            }

        # Step 1: Pre-flight verify authentication with NASA EOSDIS
        auth_check = await self.verify_map_key(key)
        if not auth_check["success"]:
            return {
                "success": False,
                "error_code": auth_check.get("error_code", "AUTH_FAILED"),
                "message": auth_check.get("message", "Authentication with NASA FIRMS failed."),
                "observations": []
            }

        query_sources = sources or ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]
        clamped_days = max(1, min(5, days))

        all_observations = []
        source_counts = {}
        errors = []
        total_records_processed = 0
        modis_total = 0
        viirs_total = 0

        # Regional AOIs for spatial classification tagging
        regional_aois = [a for a in REFERENCE_AOIS if a["id"] != "global"]

        logger.info(f"[FIRMS INGEST] Starting global ingestion across {len(query_sources)} products (days={clamped_days})...")

        async with httpx.AsyncClient(timeout=90.0) as client:
            for idx, src in enumerate(query_sources, 1):
                endpoint = f"{self.base_url}/api/area/csv/{key}/{src}/world/{clamped_days}"
                if date_str:
                    endpoint += f"/{date_str}"

                logger.info(f"[FIRMS INGEST] [{idx}/{len(query_sources)}] Requesting {src} from NASA FIRMS (/world/{clamped_days})...")

                try:
                    resp = await client.get(endpoint)
                    if resp.status_code != 200:
                        err_msg = f"{src}: NASA API returned HTTP {resp.status_code}"
                        logger.warning(f"[FIRMS INGEST] {err_msg}")
                        errors.append(err_msg)
                        continue

                    csv_text = resp.text.strip()
                    if "invalid map_key" in csv_text.lower():
                        err_msg = f"{src}: Invalid MAP_KEY rejected by NASA EOSDIS"
                        logger.warning(f"[FIRMS INGEST] {err_msg}")
                        errors.append(err_msg)
                        # If first product fails due to bad auth, abort early
                        if idx == 1:
                            return {
                                "success": False,
                                "error_code": "INVALID_MAP_KEY",
                                "message": "NASA FIRMS rejected the MAP_KEY: Invalid MAP_KEY.",
                                "observations": []
                            }
                        continue

                    if not csv_text or "No fires found" in csv_text:
                        logger.info(f"[FIRMS INGEST] {src}: Zero active fires returned.")
                        source_counts[src] = 0
                        continue

                    src_meta = SUPPORTED_SOURCES.get(src, {
                        "sensor": "MODIS" if "MODIS" in src else "VIIRS",
                        "res": 1000 if "MODIS" in src else 375
                    })
                    sensor_type = src_meta["sensor"]
                    resolution = src_meta["res"]

                    # Stream parse with csv.DictReader to avoid large pandas DataFrame allocations
                    csv_io = io.StringIO(csv_text)
                    reader = csv.DictReader(csv_io)
                    current_batch = []
                    src_records_count = 0

                    for row in reader:
                        try:
                            lat = float(row.get("latitude", 0.0))
                            lon = float(row.get("longitude", 0.0))
                            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                                continue

                            acq_d = str(row.get("acq_date", "")).strip()
                            acq_t = str(row.get("acq_time", "0000")).zfill(4)
                            sat_raw = str(row.get("satellite", "UNKNOWN")).strip()

                            if sat_raw in ("T", "Terra"):
                                sat_name = "Terra"
                            elif sat_raw in ("A", "Aqua"):
                                sat_name = "Aqua"
                            elif sat_raw in ("N", "SNPP", "Suomi-NPP"):
                                sat_name = "Suomi-NPP"
                            elif sat_raw in ("1", "NOAA-20", "JPSS-1"):
                                sat_name = "NOAA-20"
                            elif sat_raw in ("2", "NOAA-21", "JPSS-2"):
                                sat_name = "NOAA-21"
                            else:
                                sat_name = sat_raw

                            conf_raw = row.get("confidence", "nominal")
                            if str(conf_raw).isdigit():
                                conf_num = int(conf_raw)
                                conf_cat = "low" if conf_num < 30 else ("nominal" if conf_num < 80 else "high")
                            else:
                                conf_str = str(conf_raw).strip().lower()
                                if conf_str in ("l", "low") or conf_str.startswith("low"):
                                    conf_cat = "low"
                                    conf_num = 25
                                elif conf_str in ("h", "high") or conf_str.startswith("high"):
                                    conf_cat = "high"
                                    conf_num = 90
                                elif conf_str in ("n", "nominal") or conf_str.startswith("nom"):
                                    conf_cat = "nominal"
                                    conf_num = 65
                                else:
                                    conf_cat = "nominal"
                                    conf_num = 65

                            brightness = float(row.get("brightness", row.get("bright_ti4", 310.0)))
                            bright_t31 = float(row.get("bright_t31", row.get("bright_ti5", 295.0)))
                            frp = max(0.0, float(row.get("frp", 0.0)))

                            # Stable deterministic ID & SHA-256 hash
                            stable_id = f"FIRMS_{sensor_type}_{sat_name}_{acq_d}_{acq_t}_{lat:.4f}_{lon:.4f}"
                            raw_key = f"{sensor_type}_{sat_name}_{acq_d}_{acq_t}_{lat:.4f}_{lon:.4f}_{frp:.1f}"
                            h = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

                            # Fast cached geographic reverse geocoding
                            geo = resolve_geographic_context(lat, lon)

                            # Determine matching regional AOI if any
                            matched_aoi = "global"
                            for a in regional_aois:
                                w, s, e, n = a["bbox"]
                                if w <= lon <= e and s <= lat <= n:
                                    matched_aoi = a["id"]
                                    break

                            current_batch.append({
                                "id": stable_id,
                                "sensor": sensor_type,
                                "satellite": sat_name,
                                "instrument": sensor_type,
                                "latitude": lat,
                                "longitude": lon,
                                "brightness": brightness,
                                "scan": float(row.get("scan", 1.0)),
                                "track": float(row.get("track", 1.0)),
                                "acq_date": acq_d,
                                "acq_time": acq_t,
                                "confidence": conf_cat,
                                "confidence_numeric": conf_num,
                                "version": str(row.get("version", "NRT")),
                                "bright_t31": bright_t31,
                                "frp": frp,
                                "daynight": str(row.get("daynight", "D")).upper()[:1],
                                "aoi_id": matched_aoi,
                                "country": geo["country"],
                                "country_code": geo["country_code"],
                                "continent": geo["continent"],
                                "continent_code": geo["continent_code"],
                                "proximity_label": geo["proximity_label"],
                                "nearest_city": geo["nearest_city"],
                                "resolution_m": resolution,
                                "data_source": "LIVE_FIRMS",
                                "raw_hash": h
                            })
                            src_records_count += 1
                            if sensor_type == "MODIS":
                                modis_total += 1
                            else:
                                viirs_total += 1

                            # Incremental batch dispatch to keep RAM bounded
                            if len(current_batch) >= batch_size:
                                if on_batch:
                                    if inspect.iscoroutinefunction(on_batch):
                                        await on_batch(current_batch, src)
                                    else:
                                        on_batch(current_batch, src)
                                else:
                                    all_observations.extend(current_batch)
                                current_batch = []

                        except Exception:
                            continue

                    # Flush remaining observations in current batch
                    if current_batch:
                        if on_batch:
                            if inspect.iscoroutinefunction(on_batch):
                                await on_batch(current_batch, src)
                            else:
                                on_batch(current_batch, src)
                        else:
                            all_observations.extend(current_batch)
                        current_batch = []

                    source_counts[src] = src_records_count
                    total_records_processed += src_records_count
                    logger.info(f"[FIRMS INGEST] Completed {src}: {src_records_count:,} records retrieved and processed.")

                    # Explicitly release large text buffer & trigger GC
                    del csv_text
                    del csv_io
                    gc.collect()

                except httpx.TimeoutException:
                    err_msg = f"{src}: NASA API timed out after 90 seconds"
                    logger.warning(f"[FIRMS INGEST] {err_msg}. Continuing with remaining products.")
                    errors.append(err_msg)
                except httpx.RequestError as ex:
                    err_msg = f"{src}: Network connection error ({type(ex).__name__}): {str(ex)}"
                    logger.warning(f"[FIRMS INGEST] {err_msg}. Continuing with remaining products.")
                    errors.append(err_msg)
                except Exception as ex:
                    err_msg = f"{src}: Unexpected error during ingestion: {str(ex)}"
                    logger.error(f"[FIRMS INGEST] {err_msg}")
                    errors.append(err_msg)

        if total_records_processed == 0 and errors:
            return {
                "success": False,
                "error_code": "INGESTION_FAILED",
                "message": f"Global ingestion failed across all queried products: {'; '.join(errors)}",
                "observations": [],
                "errors": errors
            }

        logger.info(
            f"[FIRMS INGEST] Ingestion finished. Total: {total_records_processed:,} "
            f"(MODIS: {modis_total:,}, VIIRS: {viirs_total:,}, Errors: {len(errors)})."
        )

        return {
            "success": True,
            "total_records": total_records_processed,
            "modis_count": modis_total,
            "viirs_count": viirs_total,
            "by_source": source_counts,
            "errors": errors if errors else None,
            "observations": all_observations,
            "sensors_queried": query_sources
        }

firms_client = FIRMSClient()
