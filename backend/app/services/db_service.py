"""
DuckDB Database Service for IGNIS.
Fast columnar storage for NASA FIRMS satellite observations and harmonized fire events.
Includes deduplication, historical preservation, and clear LIVE vs SAMPLE dataset separation.
"""

import duckdb
import hashlib
import math
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import pandas as pd
from ..config import settings
from ..data.reference_regions import REFERENCE_AOIS
from ..data.sample_datasets import generate_reference_observations

class DBService:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or settings.DUCKDB_PATH
        self._init_db()

    def get_connection(self):
        return duckdb.connect(self.db_path)

    def _init_db(self):
        conn = self.get_connection()
        try:
            # 1. Create AOI Table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS aoi_registry (
                    id VARCHAR PRIMARY KEY,
                    name VARCHAR,
                    country VARCHAR,
                    country_code VARCHAR,
                    bbox_west DOUBLE,
                    bbox_south DOUBLE,
                    bbox_east DOUBLE,
                    bbox_north DOUBLE,
                    center_lat DOUBLE,
                    center_lon DOUBLE,
                    ecozone VARCHAR,
                    peak_season VARCHAR,
                    fire_type VARCHAR,
                    description VARCHAR,
                    typical_ratio DOUBLE
                );
            """)

            count_res = conn.execute("SELECT count(*) FROM aoi_registry").fetchall()
            existing_aoi_ids = [r[0] for r in conn.execute("SELECT id FROM aoi_registry").fetchall()] if count_res else []
            for aoi in REFERENCE_AOIS:
                if aoi["id"] not in existing_aoi_ids:
                    conn.execute("""
                        INSERT INTO aoi_registry VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, [
                        aoi["id"], aoi["name"], aoi["country"], aoi["country_code"],
                        aoi["bbox"][0], aoi["bbox"][1], aoi["bbox"][2], aoi["bbox"][3],
                        aoi["center"][0], aoi["center"][1], aoi["ecozone"],
                        aoi["peak_season"], aoi["fire_type"], aoi["description"],
                        aoi["typical_viirs_to_modis_ratio"]
                    ])

            # 2. Raw observations table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS raw_observations (
                    id VARCHAR PRIMARY KEY,
                    sensor VARCHAR,
                    satellite VARCHAR,
                    instrument VARCHAR,
                    latitude DOUBLE,
                    longitude DOUBLE,
                    brightness DOUBLE,
                    scan DOUBLE,
                    track DOUBLE,
                    acq_date VARCHAR,
                    acq_time VARCHAR,
                    confidence VARCHAR,
                    confidence_numeric INTEGER,
                    version VARCHAR,
                    bright_t31 DOUBLE,
                    frp DOUBLE,
                    daynight VARCHAR,
                    aoi_id VARCHAR,
                    resolution_m INTEGER,
                    data_source VARCHAR DEFAULT 'SAMPLE_ARCHIVE',
                    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    raw_hash VARCHAR
                );
            """)

            # Schema migration check: ensure columns exist if database was initialized previously
            existing_cols = [c[0] for c in conn.execute("DESCRIBE raw_observations").fetchall()]
            new_cols = [
                ("data_source", "VARCHAR DEFAULT 'SAMPLE_ARCHIVE'"),
                ("ingested_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
                ("raw_hash", "VARCHAR"),
                ("country", "VARCHAR"),
                ("country_code", "VARCHAR"),
                ("continent", "VARCHAR"),
                ("continent_code", "VARCHAR"),
                ("proximity_label", "VARCHAR"),
                ("nearest_city", "VARCHAR")
            ]
            for col_name, col_type in new_cols:
                if col_name not in existing_cols:
                    conn.execute(f"ALTER TABLE raw_observations ADD COLUMN {col_name} {col_type}")
            if "data_source" in existing_cols:
                conn.execute("UPDATE raw_observations SET data_source = 'SAMPLE_ARCHIVE' WHERE data_source IS NULL")

            # 3. Ingestion audit log table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ingestion_history (
                    id VARCHAR PRIMARY KEY,
                    aoi_id VARCHAR,
                    ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    status VARCHAR,
                    records_received INTEGER,
                    records_validated INTEGER,
                    records_inserted INTEGER,
                    duplicates_skipped INTEGER,
                    invalid_rejected INTEGER,
                    modis_count INTEGER,
                    viirs_count INTEGER,
                    date_range_start VARCHAR,
                    date_range_end VARCHAR,
                    sensors_queried VARCHAR,
                    error_message VARCHAR
                );
            """)

            # Pre-seed default reference datasets only if completely empty
            res = conn.execute("SELECT count(*) FROM raw_observations").fetchall()
            obs_count = res[0][0] if res else 0
            if obs_count == 0:
                print("Seeding initial NASA FIRMS reference sample archive into DuckDB...")
                for aoi in REFERENCE_AOIS:
                    obs_list = generate_reference_observations(aoi["id"])
                    if obs_list:
                        for item in obs_list:
                            item["data_source"] = "SAMPLE_ARCHIVE"
                            item["ingested_at"] = datetime.utcnow()
                            item["raw_hash"] = self.compute_hash(item)
                        df = pd.DataFrame(obs_list)
                        cursor = conn.cursor()
                        cursor.register("df_temp", df)
                        cursor.execute("INSERT OR REPLACE INTO raw_observations SELECT * FROM df_temp")
                        cursor.unregister("df_temp")
                        cursor.close()
                print("DuckDB reference sample archive seeded.")

        finally:
            conn.close()

    @staticmethod
    def compute_hash(obs: Dict[str, Any]) -> str:
        """Generates a stable SHA-256 hash from observation attributes to prevent duplicates."""
        lat = round(float(obs.get("latitude", 0.0)), 4)
        lon = round(float(obs.get("longitude", 0.0)), 4)
        acq_d = str(obs.get("acq_date", ""))
        acq_t = str(obs.get("acq_time", "")).zfill(4)
        sensor = str(obs.get("sensor", "")).upper()
        sat = str(obs.get("satellite", "")).upper()
        raw_key = f"{sensor}_{sat}_{acq_d}_{acq_t}_{lat}_{lon}"
        return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

    def get_aois(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            df = conn.execute("SELECT * FROM aoi_registry").fetchdf()
            return df.to_dict(orient="records")
        finally:
            conn.close()

    def get_aoi(self, aoi_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            res = conn.execute("SELECT * FROM aoi_registry WHERE id = ?", [aoi_id]).fetchdf()
            if len(res) > 0:
                return res.to_dict(orient="records")[0]
            return None
        finally:
            conn.close()

    def has_live_data(self, aoi_id: str) -> bool:
        """Returns True if genuine LIVE_FIRMS records exist."""
        conn = self.get_connection()
        try:
            if aoi_id.lower() in ("global", "all"):
                cnt = conn.execute(
                    "SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'"
                ).fetchone()[0]
            else:
                cnt = conn.execute(
                    "SELECT COUNT(*) FROM raw_observations WHERE (aoi_id = ? OR aoi_id = 'global') AND data_source = 'LIVE_FIRMS'",
                    [aoi_id]
                ).fetchone()[0]
            return cnt > 0
        finally:
            conn.close()

    def resolve_dataset_mode(self, aoi_id: str, requested_mode: Optional[str] = None) -> Tuple[str, bool]:
        """
        Resolves effective dataset mode.
        Returns: (mode: 'LIVE' or 'SAMPLE', is_live: bool)
        """
        has_live = self.has_live_data(aoi_id)
        req = (requested_mode or "AUTO").upper()

        if req == "LIVE":
            return "LIVE", has_live
        if req == "SAMPLE":
            return "SAMPLE", False
        # AUTO mode: prefer LIVE if present, otherwise SAMPLE
        return ("LIVE", True) if has_live else ("SAMPLE", False)

    def get_observations(self, aoi_id: str, dataset_mode: Optional[str] = "AUTO",
                         start_date: Optional[str] = None, end_date: Optional[str] = None,
                         sensor: Optional[str] = None, min_confidence: Optional[int] = None, 
                         continent: Optional[str] = None, country: Optional[str] = None,
                         min_frp: Optional[float] = None, bbox: Optional[List[float]] = None,
                         limit: int = 100000, offset: int = 0) -> List[Dict[str, Any]]:
        effective_mode, _ = self.resolve_dataset_mode(aoi_id, dataset_mode)
        db_source = "LIVE_FIRMS" if effective_mode == "LIVE" else "SAMPLE_ARCHIVE"

        conn = self.get_connection()
        try:
            params: list[Any] = [db_source]
            if aoi_id.lower() in ("global", "all"):
                query = "SELECT * FROM raw_observations WHERE data_source = ?"
            else:
                aoi_meta = self.get_aoi(aoi_id)
                if aoi_meta and "bbox_west" in aoi_meta:
                    w, s, e, n = aoi_meta["bbox_west"], aoi_meta["bbox_south"], aoi_meta["bbox_east"], aoi_meta["bbox_north"]
                    query = "SELECT * FROM raw_observations WHERE data_source = ? AND longitude >= ? AND latitude >= ? AND longitude <= ? AND latitude <= ?"
                    params = [db_source, w, s, e, n]
                else:
                    query = "SELECT * FROM raw_observations WHERE (aoi_id = ? OR aoi_id = 'global') AND data_source = ?"
                    params = [aoi_id, db_source]

            if continent and continent != "ALL":
                query += " AND continent = ?"
                params.append(continent)
            if country and country != "ALL":
                query += " AND country = ?"
                params.append(country)
            if min_frp is not None and min_frp > 0:
                query += " AND frp >= ?"
                params.append(min_frp)
            if bbox and len(bbox) == 4:
                query += " AND longitude >= ? AND latitude >= ? AND longitude <= ? AND latitude <= ?"
                params.extend([bbox[0], bbox[1], bbox[2], bbox[3]])
            if start_date:
                query += " AND acq_date >= ?"
                params.append(start_date)
            if end_date:
                query += " AND acq_date <= ?"
                params.append(end_date)
            if sensor and sensor != "ALL":
                query += " AND sensor = ?"
                params.append(sensor)
            if min_confidence is not None:
                query += " AND confidence_numeric >= ?"
                params.append(min_confidence)

            query += f" ORDER BY acq_date DESC, acq_time DESC, frp DESC LIMIT {limit} OFFSET {offset}"
            df = conn.execute(query, params).fetchdf()
            records = df.to_dict(orient="records")
            for r in records:
                for k, v in list(r.items()):
                    if isinstance(v, float) and (v != v):
                        r[k] = None
                    elif hasattr(v, "isoformat"):
                        r[k] = v.isoformat()
            return records
        finally:
            conn.close()

    def get_observation_counts(self, aoi_id: str, dataset_mode: Optional[str] = "AUTO") -> Dict[str, Any]:
        effective_mode, is_live = self.resolve_dataset_mode(aoi_id, dataset_mode)
        db_source = "LIVE_FIRMS" if effective_mode == "LIVE" else "SAMPLE_ARCHIVE"

        conn = self.get_connection()
        try:
            if aoi_id.lower() in ("global", "all"):
                res = conn.execute("""
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis_count,
                        SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs_count,
                        COALESCE(SUM(frp), 0.0) as total_frp,
                        MIN(acq_date) as earliest_date,
                        MAX(acq_date) as latest_date,
                        MAX(ingested_at) as last_ingested
                    FROM raw_observations
                    WHERE data_source = ?
                """, [db_source]).fetchone()

                live_total = conn.execute(
                    "SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'"
                ).fetchone()[0]

                sample_total = conn.execute(
                    "SELECT COUNT(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'"
                ).fetchone()[0]
            else:
                aoi_meta = self.get_aoi(aoi_id)
                if aoi_meta and "bbox_west" in aoi_meta:
                    w, s, e, n = aoi_meta["bbox_west"], aoi_meta["bbox_south"], aoi_meta["bbox_east"], aoi_meta["bbox_north"]
                    res = conn.execute("""
                        SELECT 
                            COUNT(*) as total,
                            SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis_count,
                            SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs_count,
                            COALESCE(SUM(frp), 0.0) as total_frp,
                            MIN(acq_date) as earliest_date,
                            MAX(acq_date) as latest_date,
                            MAX(ingested_at) as last_ingested
                        FROM raw_observations
                        WHERE data_source = ? AND longitude >= ? AND latitude >= ? AND longitude <= ? AND latitude <= ?
                    """, [db_source, w, s, e, n]).fetchone()

                    live_total = conn.execute(
                        "SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS' AND longitude >= ? AND latitude >= ? AND longitude <= ? AND latitude <= ?",
                        [w, s, e, n]
                    ).fetchone()[0]

                    sample_total = conn.execute(
                        "SELECT COUNT(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE' AND longitude >= ? AND latitude >= ? AND longitude <= ? AND latitude <= ?",
                        [w, s, e, n]
                    ).fetchone()[0]
                else:
                    res = conn.execute("""
                        SELECT 
                            COUNT(*) as total,
                            SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis_count,
                            SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs_count,
                            COALESCE(SUM(frp), 0.0) as total_frp,
                            MIN(acq_date) as earliest_date,
                            MAX(acq_date) as latest_date,
                            MAX(ingested_at) as last_ingested
                        FROM raw_observations
                        WHERE (aoi_id = ? OR aoi_id = 'global') AND data_source = ?
                    """, [aoi_id, db_source]).fetchone()

                    live_total = conn.execute(
                        "SELECT COUNT(*) FROM raw_observations WHERE (aoi_id = ? OR aoi_id = 'global') AND data_source = 'LIVE_FIRMS'",
                        [aoi_id]
                    ).fetchone()[0]

                    sample_total = conn.execute(
                        "SELECT COUNT(*) FROM raw_observations WHERE (aoi_id = ? OR aoi_id = 'global') AND data_source = 'SAMPLE_ARCHIVE'",
                        [aoi_id]
                    ).fetchone()[0]

            last_history = self.get_latest_ingestion_log(aoi_id)

            return {
                "total": res[0] or 0,
                "modis_count": res[1] or 0,
                "viirs_count": res[2] or 0,
                "total_frp": round(res[3] or 0.0, 1),
                "earliest_date": res[4],
                "latest_date": res[5],
                "last_ingested": str(res[6]) if res[6] else None,
                "dataset_mode": effective_mode,
                "is_live": is_live and (res[0] or 0) > 0,
                "live_records_available": live_total,
                "sample_records_available": sample_total,
                "latest_ingestion_history": last_history
            }
        finally:
            conn.close()

    def insert_observations(self, observations: List[Dict[str, Any]], data_source: str = "LIVE_FIRMS") -> Dict[str, Any]:
        """
        Inserts observations into DuckDB with validation and deduplication.
        Preserves previously ingested historical records without destructive overwrites.
        """
        if not observations:
            return {
                "received": 0,
                "validated": 0,
                "inserted": 0,
                "duplicates_skipped": 0,
                "invalid_rejected": 0
            }

        conn = self.get_connection()
        try:
            # Global deduplication: fetch existing IDs and hashes across all records
            existing_df = conn.execute(
                "SELECT id, raw_hash FROM raw_observations WHERE data_source = ?",
                [data_source]
            ).fetchdf()

            existing_ids = set(existing_df["id"].dropna()) if not existing_df.empty else set()
            existing_hashes = set(existing_df["raw_hash"].dropna()) if not existing_df.empty else set()

            valid_records = []
            duplicates_count = 0
            invalid_count = 0
            now_ts = datetime.utcnow()

            for obs in observations:
                # 1. Validate coordinates
                try:
                    lat = float(obs.get("latitude"))
                    lon = float(obs.get("longitude"))
                    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                        invalid_count += 1
                        continue
                except (ValueError, TypeError):
                    invalid_count += 1
                    continue

                # 2. Validate essential fields
                acq_d = str(obs.get("acq_date", "")).strip()
                if not acq_d or len(acq_d) != 10:
                    invalid_count += 1
                    continue

                # 3. Compute hash and stable ID
                h = obs.get("raw_hash") or self.compute_hash(obs)
                obs_id = obs.get("id")
                if not obs_id or obs_id.startswith("FIRMS_temp"):
                    obs_id = f"FIRMS_{obs.get('sensor')}_{obs.get('satellite', 'SAT')}_{acq_d}_{obs.get('acq_time', '0000')}_{lat:.4f}_{lon:.4f}"

                # 4. Deduplication check
                if obs_id in existing_ids or h in existing_hashes:
                    duplicates_count += 1
                    continue

                existing_ids.add(obs_id)
                existing_hashes.add(h)

                valid_records.append({
                    "id": obs_id,
                    "sensor": str(obs.get("sensor", "UNKNOWN")).upper(),
                    "satellite": str(obs.get("satellite", "UNKNOWN")),
                    "instrument": str(obs.get("instrument", obs.get("sensor", "UNKNOWN"))),
                    "latitude": lat,
                    "longitude": lon,
                    "brightness": float(obs.get("brightness", 300.0)),
                    "scan": float(obs.get("scan", 1.0)),
                    "track": float(obs.get("track", 1.0)),
                    "acq_date": acq_d,
                    "acq_time": str(obs.get("acq_time", "0000")).zfill(4),
                    "confidence": str(obs.get("confidence", "nominal")),
                    "confidence_numeric": int(obs.get("confidence_numeric", 50)),
                    "version": str(obs.get("version", "NRT")),
                    "bright_t31": float(obs.get("bright_t31", 295.0)),
                    "frp": max(0.0, float(obs.get("frp", 0.0))),
                    "daynight": str(obs.get("daynight", "D")).upper()[:1],
                    "aoi_id": str(obs.get("aoi_id", "global")),
                    "resolution_m": int(obs.get("resolution_m", 1000 if obs.get("sensor") == "MODIS" else 375)),
                    "data_source": data_source,
                    "ingested_at": now_ts,
                    "raw_hash": h,
                    "country": str(obs.get("country", "Unknown")),
                    "country_code": str(obs.get("country_code", "UNK")),
                    "continent": str(obs.get("continent", "Unknown")),
                    "continent_code": str(obs.get("continent_code", "UNK")),
                    "proximity_label": str(obs.get("proximity_label", "")),
                    "nearest_city": str(obs.get("nearest_city", "")) if obs.get("nearest_city") else None
                })

            inserted_count = len(valid_records)
            if inserted_count > 0:
                df = pd.DataFrame(valid_records)
                cursor = conn.cursor()
                cursor.register("df_insert", df)
                cursor.execute("""
                    INSERT OR REPLACE INTO raw_observations (
                        id, sensor, satellite, instrument, latitude, longitude, brightness,
                        scan, track, acq_date, acq_time, confidence, confidence_numeric,
                        version, bright_t31, frp, daynight, aoi_id, resolution_m,
                        data_source, ingested_at, raw_hash, country, country_code,
                        continent, continent_code, proximity_label, nearest_city
                    ) SELECT 
                        id, sensor, satellite, instrument, latitude, longitude, brightness,
                        scan, track, acq_date, acq_time, confidence, confidence_numeric,
                        version, bright_t31, frp, daynight, aoi_id, resolution_m,
                        data_source, ingested_at, raw_hash, country, country_code,
                        continent, continent_code, proximity_label, nearest_city
                    FROM df_insert
                """)
                cursor.unregister("df_insert")
                cursor.close()

            return {
                "received": len(observations),
                "validated": len(valid_records) + duplicates_count,
                "inserted": inserted_count,
                "duplicates_skipped": duplicates_count,
                "invalid_rejected": invalid_count
            }

        finally:
            conn.close()

    def get_global_breakdown(self, dataset_mode: Optional[str] = "AUTO") -> Dict[str, Any]:
        effective_mode, is_live = self.resolve_dataset_mode("global", dataset_mode)
        db_source = "LIVE_FIRMS" if effective_mode == "LIVE" else "SAMPLE_ARCHIVE"
        conn = self.get_connection()
        try:
            # By Continent
            cont_rows = conn.execute("""
                SELECT 
                    COALESCE(continent, 'Other') as name,
                    COUNT(*) as count,
                    COALESCE(SUM(frp), 0.0) as total_frp,
                    SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis,
                    SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs
                FROM raw_observations
                WHERE data_source = ?
                GROUP BY continent
                ORDER BY count DESC
            """, [db_source]).fetchall()

            # By Country (Top 15)
            country_rows = conn.execute("""
                SELECT 
                    COALESCE(country, 'Unknown') as name,
                    COUNT(*) as count,
                    COALESCE(SUM(frp), 0.0) as total_frp
                FROM raw_observations
                WHERE data_source = ?
                GROUP BY country
                ORDER BY count DESC
                LIMIT 15
            """, [db_source]).fetchall()

            # Total Summary
            total_stats = conn.execute("""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis,
                    SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs,
                    COALESCE(SUM(frp), 0.0) as total_frp,
                    MIN(acq_date) as earliest,
                    MAX(acq_date) as latest,
                    MAX(ingested_at) as last_ingested
                FROM raw_observations
                WHERE data_source = ?
            """, [db_source]).fetchone()

            return {
                "dataset_mode": effective_mode,
                "is_live": is_live,
                "total_observations": total_stats[0] or 0,
                "modis_count": total_stats[1] or 0,
                "viirs_count": total_stats[2] or 0,
                "total_frp_mw": round(total_stats[3] or 0.0, 1),
                "earliest_date": total_stats[4],
                "latest_date": total_stats[5],
                "last_ingested": str(total_stats[6]) if total_stats[6] else None,
                "continents": [
                    {"name": r[0], "count": r[1], "total_frp": round(r[2], 1), "modis": r[3], "viirs": r[4]}
                    for r in cont_rows
                ],
                "top_countries": [
                    {"name": r[0], "count": r[1], "total_frp": round(r[2], 1)}
                    for r in country_rows
                ]
            }
        finally:
            conn.close()

    def record_ingestion_log(self, aoi_id: str, status: str, result_stats: Dict[str, Any],
                             date_start: str, date_end: str, sensors: List[str], error_msg: Optional[str] = None):
        """Records metadata in ingestion_history for scientific auditability."""
        conn = self.get_connection()
        try:
            log_id = f"INGEST_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}"
            conn.execute("""
                INSERT INTO ingestion_history VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                log_id,
                aoi_id,
                status,
                result_stats.get("received", 0),
                result_stats.get("validated", 0),
                result_stats.get("inserted", 0),
                result_stats.get("duplicates_skipped", 0),
                result_stats.get("invalid_rejected", 0),
                result_stats.get("modis_count", 0),
                result_stats.get("viirs_count", 0),
                date_start,
                date_end,
                ", ".join(sensors),
                error_msg
            ])
        finally:
            conn.close()

    def get_latest_ingestion_log(self, aoi_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            res = conn.execute("""
                SELECT * FROM ingestion_history 
                WHERE aoi_id = ? 
                ORDER BY ingested_at DESC 
                LIMIT 1
            """, [aoi_id]).fetchdf()
            if not res.empty:
                rec = res.to_dict(orient="records")[0]
                for k, v in list(rec.items()):
                    if hasattr(v, "isoformat"):
                        rec[k] = v.isoformat()
                    elif isinstance(v, float) and (v != v):
                        rec[k] = None
                return rec
            return None
        finally:
            conn.close()

db_service = DBService()
