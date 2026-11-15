"""
Database Service for IGNIS.
Dual-backend architecture supporting:
  1. DuckDB (Embedded columnar storage for local development and fast analytics)
  2. PostgreSQL (Serverless cloud storage, e.g. Neon, for production deployment)

Deduplication, historical preservation, and LIVE vs SAMPLE dataset separation
are strictly maintained across both engines.
"""

import hashlib
import math
import os
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import pandas as pd

from ..config import settings
from ..data.reference_regions import REFERENCE_AOIS
from ..data.sample_datasets import generate_reference_observations

try:
    import duckdb
except ImportError:
    duckdb = None

try:
    import psycopg2
    import psycopg2.pool
    from psycopg2.extras import execute_values
except ImportError:
    psycopg2 = None
    execute_values = None


class PooledPostgresConnection:
    """Wrapper around psycopg2 connection that safely returns to pool upon close()."""
    def __init__(self, conn, pool):
        self._conn = conn
        self._pool = pool

    def cursor(self, *args, **kwargs):
        return self._conn.cursor(*args, **kwargs)

    def execute(self, query: str, params: Optional[Any] = None):
        """Convenience method providing DuckDB-compatible conn.execute(...) on PostgreSQL."""
        cur = self._conn.cursor()
        if params is not None and "?" in query:
            query = query.replace("?", "%s")
        cur.execute(query, params)
        if query.strip().upper().startswith(("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE")):
            self._conn.commit()
        return cur

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        if self._pool and self._conn:
            try:
                if self._conn.closed == 0:
                    try:
                        self._conn.rollback()
                    except Exception:
                        pass
                self._pool.putconn(self._conn)
            except Exception:
                pass
            self._conn = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            try:
                self._conn.rollback()
            except Exception:
                pass
        self.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


class DBService:
    def __init__(self, db_path: Optional[str] = None, database_url: Optional[str] = None):
        self.db_path = db_path or settings.DUCKDB_PATH
        self.database_url = database_url if database_url is not None else settings.DATABASE_URL
        self._pg_pool = None

        if self.database_url:
            self.engine_type = "postgres"
            self._init_pg_pool()
        else:
            self.engine_type = "duckdb"

        self._init_db()

    def _get_clean_pg_url(self) -> str:
        url = (self.database_url or "").strip()
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        return url

    def _init_pg_pool(self):
        url = self._get_clean_pg_url()
        if not url or psycopg2 is None:
            return
        try:
            self._pg_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=10,
                dsn=url,
                connect_timeout=15
            )
        except Exception as e:
            self._pg_pool = None

    def _get_postgres_connection(self):
        if self._pg_pool is None:
            self._init_pg_pool()
        if self._pg_pool is None:
            # Fallback to direct connect if pool failed to initialize
            conn = psycopg2.connect(self._get_clean_pg_url(), connect_timeout=15)
            return PooledPostgresConnection(conn, None)

        conn = self._pg_pool.getconn()
        is_alive = False
        try:
            if conn.closed == 0:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                is_alive = True
        except Exception:
            is_alive = False

        if not is_alive:
            try:
                self._pg_pool.putconn(conn, close=True)
            except Exception:
                pass
            conn = psycopg2.connect(self._get_clean_pg_url(), connect_timeout=15)

        return PooledPostgresConnection(conn, self._pg_pool)

    def get_connection(self):
        """Returns a connection for the active database engine."""
        if self.engine_type == "postgres":
            return self._get_postgres_connection()
        if duckdb is None:
            raise RuntimeError("DuckDB module is not installed.")
        return duckdb.connect(self.db_path)

    def _init_db(self):
        """Initializes tables and metadata for the active database."""
        if self.engine_type == "postgres":
            self._init_postgres_db()
        else:
            self._init_duckdb_db()

    def _init_postgres_db(self):
        """Creates PostgreSQL schemas, indexes, and reference AOIs."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS aoi_registry (
                        id VARCHAR(64) PRIMARY KEY,
                        name VARCHAR(255),
                        country VARCHAR(255),
                        country_code VARCHAR(32),
                        bbox_west DOUBLE PRECISION,
                        bbox_south DOUBLE PRECISION,
                        bbox_east DOUBLE PRECISION,
                        bbox_north DOUBLE PRECISION,
                        center_lat DOUBLE PRECISION,
                        center_lon DOUBLE PRECISION,
                        ecozone VARCHAR(255),
                        peak_season VARCHAR(255),
                        fire_type VARCHAR(255),
                        description TEXT,
                        typical_ratio DOUBLE PRECISION
                    );
                """)

                cur.execute("""
                    CREATE TABLE IF NOT EXISTS raw_observations (
                        id VARCHAR(128) PRIMARY KEY,
                        sensor VARCHAR(32),
                        satellite VARCHAR(64),
                        instrument VARCHAR(64),
                        latitude DOUBLE PRECISION,
                        longitude DOUBLE PRECISION,
                        brightness DOUBLE PRECISION,
                        scan DOUBLE PRECISION,
                        track DOUBLE PRECISION,
                        acq_date VARCHAR(16),
                        acq_time VARCHAR(16),
                        confidence VARCHAR(32),
                        confidence_numeric INTEGER,
                        version VARCHAR(32),
                        bright_t31 DOUBLE PRECISION,
                        frp DOUBLE PRECISION,
                        daynight VARCHAR(8),
                        aoi_id VARCHAR(64),
                        resolution_m INTEGER,
                        data_source VARCHAR(32) DEFAULT 'SAMPLE_ARCHIVE',
                        ingested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        raw_hash VARCHAR(64),
                        country VARCHAR(128),
                        country_code VARCHAR(32),
                        continent VARCHAR(128),
                        continent_code VARCHAR(32),
                        proximity_label VARCHAR(128),
                        nearest_city VARCHAR(128)
                    );
                """)

                cur.execute("""
                    CREATE TABLE IF NOT EXISTS ingestion_history (
                        id VARCHAR(128) PRIMARY KEY,
                        aoi_id VARCHAR(64),
                        ingested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        status VARCHAR(64),
                        records_received INTEGER,
                        records_validated INTEGER,
                        records_inserted INTEGER,
                        duplicates_skipped INTEGER,
                        invalid_rejected INTEGER,
                        modis_count INTEGER,
                        viirs_count INTEGER,
                        date_range_start VARCHAR(32),
                        date_range_end VARCHAR(32),
                        sensors_queried TEXT,
                        error_message TEXT
                    );
                """)

                cur.execute("CREATE INDEX IF NOT EXISTS idx_raw_obs_source ON raw_observations (data_source);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_raw_obs_coords ON raw_observations (data_source, longitude, latitude);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_raw_obs_aoi ON raw_observations (aoi_id, data_source);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_raw_obs_hash ON raw_observations (raw_hash);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_raw_obs_date ON raw_observations (acq_date, acq_time);")

                cur.execute("SELECT id FROM aoi_registry")
                existing_ids = {r[0] for r in cur.fetchall()}
                for aoi in REFERENCE_AOIS:
                    if aoi["id"] not in existing_ids:
                        cur.execute("""
                            INSERT INTO aoi_registry VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO NOTHING
                        """, [
                            aoi["id"], aoi["name"], aoi["country"], aoi["country_code"],
                            aoi["bbox"][0], aoi["bbox"][1], aoi["bbox"][2], aoi["bbox"][3],
                            aoi["center"][0], aoi["center"][1], aoi["ecozone"],
                            aoi["peak_season"], aoi["fire_type"], aoi["description"],
                            aoi["typical_viirs_to_modis_ratio"]
                        ])

                cur.execute("SELECT COUNT(*) FROM raw_observations")
                obs_count = cur.fetchone()[0]
                if obs_count == 0 and execute_values is not None:
                    print("Seeding initial NASA FIRMS reference sample archive into PostgreSQL...")
                    all_samples = []
                    for aoi in REFERENCE_AOIS:
                        obs_list = generate_reference_observations(aoi["id"])
                        if obs_list:
                            for item in obs_list:
                                item["data_source"] = "SAMPLE_ARCHIVE"
                                item["ingested_at"] = datetime.utcnow()
                                item["raw_hash"] = self.compute_hash(item)
                                for col in ["country", "country_code", "continent", "continent_code", "proximity_label", "nearest_city"]:
                                    if col not in item:
                                        item[col] = aoi.get(col, None)
                                all_samples.append((
                                    item["id"], item.get("sensor", "UNKNOWN"), item.get("satellite", "UNKNOWN"),
                                    item.get("instrument", "UNKNOWN"), item["latitude"], item["longitude"],
                                    item.get("brightness", 300.0), item.get("scan", 1.0), item.get("track", 1.0),
                                    item["acq_date"], item.get("acq_time", "0000"), item.get("confidence", "nominal"),
                                    item.get("confidence_numeric", 50), item.get("version", "NRT"),
                                    item.get("bright_t31", 295.0), max(0.0, float(item.get("frp", 0.0))),
                                    item.get("daynight", "D"), item.get("aoi_id", "global"),
                                    item.get("resolution_m", 1000), item["data_source"], item["ingested_at"],
                                    item["raw_hash"], item.get("country", "Unknown"), item.get("country_code", "UNK"),
                                    item.get("continent", "Unknown"), item.get("continent_code", "UNK"),
                                    item.get("proximity_label", ""), item.get("nearest_city", None)
                                ))
                    if all_samples:
                        execute_values(
                            cur,
                            """
                            INSERT INTO raw_observations (
                                id, sensor, satellite, instrument, latitude, longitude, brightness,
                                scan, track, acq_date, acq_time, confidence, confidence_numeric,
                                version, bright_t31, frp, daynight, aoi_id, resolution_m,
                                data_source, ingested_at, raw_hash, country, country_code,
                                continent, continent_code, proximity_label, nearest_city
                            ) VALUES %s ON CONFLICT (id) DO NOTHING
                            """,
                            all_samples,
                            page_size=5000
                        )
                    print("PostgreSQL reference sample archive seeded.")

            conn.commit()
        finally:
            conn.close()

    def _init_duckdb_db(self):
        """Creates DuckDB tables, indexes, and reference AOIs."""
        conn = self.get_connection()
        try:
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

            res = conn.execute("SELECT count(*) FROM raw_observations").fetchall()
            obs_count = res[0][0] if res else 0
            if obs_count == 0:
                print("Seeding initial NASA FIRMS reference sample archive into DuckDB...")
                table_cols = [c[0] for c in conn.execute("DESCRIBE raw_observations").fetchall()]
                for aoi in REFERENCE_AOIS:
                    obs_list = generate_reference_observations(aoi["id"])
                    if obs_list:
                        for item in obs_list:
                            item["data_source"] = "SAMPLE_ARCHIVE"
                            item["ingested_at"] = datetime.utcnow()
                            item["raw_hash"] = self.compute_hash(item)
                            for col in ["country", "country_code", "continent", "continent_code", "proximity_label", "nearest_city"]:
                                if col not in item:
                                    item[col] = aoi.get(col, None)
                        df = pd.DataFrame(obs_list)
                        for col in table_cols:
                            if col not in df.columns:
                                df[col] = None
                        df = df[table_cols]
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
            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM aoi_registry ORDER BY name ASC")
                    cols = [d[0] for d in cur.description]
                    return [dict(zip(cols, r)) for r in cur.fetchall()]
            df = conn.execute("SELECT * FROM aoi_registry ORDER BY name ASC").fetchdf()
            return df.to_dict(orient="records")
        finally:
            conn.close()

    def get_aoi(self, aoi_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM aoi_registry WHERE id = %s", [aoi_id])
                    row = cur.fetchone()
                    if row:
                        cols = [d[0] for d in cur.description]
                        return dict(zip(cols, row))
                    return None
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
            is_global = aoi_id.lower() in ("global", "all")
            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    if is_global:
                        cur.execute("SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'")
                    else:
                        cur.execute(
                            "SELECT COUNT(*) FROM raw_observations WHERE (aoi_id = %s OR aoi_id = 'global') AND data_source = 'LIVE_FIRMS'",
                            [aoi_id]
                        )
                    cnt = cur.fetchone()[0]
                return cnt > 0

            if is_global:
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
        return ("LIVE", True) if has_live else ("SAMPLE", False)

    def get_observations(self, aoi_id: str, dataset_mode: Optional[str] = "AUTO",
                         start_date: Optional[str] = None, end_date: Optional[str] = None,
                         sensor: Optional[str] = None, min_confidence: Optional[int] = None, 
                         continent: Optional[str] = None, country: Optional[str] = None,
                         min_frp: Optional[float] = None, bbox: Optional[List[float]] = None,
                         limit: int = 100000, offset: int = 0) -> List[Dict[str, Any]]:
        effective_mode, _ = self.resolve_dataset_mode(aoi_id, dataset_mode)
        db_source = "LIVE_FIRMS" if effective_mode == "LIVE" else "SAMPLE_ARCHIVE"
        ph = "%s" if self.engine_type == "postgres" else "?"

        conn = self.get_connection()
        try:
            params: list[Any] = [db_source]
            if aoi_id.lower() in ("global", "all"):
                query = f"SELECT * FROM raw_observations WHERE data_source = {ph}"
            else:
                aoi_meta = self.get_aoi(aoi_id)
                if aoi_meta and "bbox_west" in aoi_meta:
                    w, s, e, n = aoi_meta["bbox_west"], aoi_meta["bbox_south"], aoi_meta["bbox_east"], aoi_meta["bbox_north"]
                    query = f"SELECT * FROM raw_observations WHERE data_source = {ph} AND longitude >= {ph} AND latitude >= {ph} AND longitude <= {ph} AND latitude <= {ph}"
                    params = [db_source, w, s, e, n]
                else:
                    query = f"SELECT * FROM raw_observations WHERE (aoi_id = {ph} OR aoi_id = 'global') AND data_source = {ph}"
                    params = [aoi_id, db_source]

            if continent and continent != "ALL":
                query += f" AND continent = {ph}"
                params.append(continent)
            if country and country != "ALL":
                query += f" AND country = {ph}"
                params.append(country)
            if min_frp is not None and min_frp > 0:
                query += f" AND frp >= {ph}"
                params.append(min_frp)
            if bbox and len(bbox) == 4:
                query += f" AND longitude >= {ph} AND latitude >= {ph} AND longitude <= {ph} AND latitude <= {ph}"
                params.extend([bbox[0], bbox[1], bbox[2], bbox[3]])
            if start_date:
                query += f" AND acq_date >= {ph}"
                params.append(start_date)
            if end_date:
                query += f" AND acq_date <= {ph}"
                params.append(end_date)
            if sensor and sensor != "ALL":
                query += f" AND sensor = {ph}"
                params.append(sensor)
            if min_confidence is not None:
                query += f" AND confidence_numeric >= {ph}"
                params.append(min_confidence)

            query += f" ORDER BY acq_date DESC, acq_time DESC, frp DESC LIMIT {limit} OFFSET {offset}"

            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute(query, params)
                    cols = [d[0] for d in cur.description]
                    records = [dict(zip(cols, r)) for r in cur.fetchall()]
            else:
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
        ph = "%s" if self.engine_type == "postgres" else "?"

        conn = self.get_connection()
        try:
            if aoi_id.lower() in ("global", "all"):
                sql = f"""
                    SELECT 
                        COUNT(*) as total,
                        SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis_count,
                        SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs_count,
                        COALESCE(SUM(frp), 0.0) as total_frp,
                        MIN(acq_date) as earliest_date,
                        MAX(acq_date) as latest_date,
                        MAX(ingested_at) as last_ingested
                    FROM raw_observations
                    WHERE data_source = {ph}
                """
                if self.engine_type == "postgres":
                    with conn.cursor() as cur:
                        cur.execute(sql, [db_source])
                        res = cur.fetchone()
                        cur.execute("SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'")
                        live_total = cur.fetchone()[0]
                        cur.execute("SELECT COUNT(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'")
                        sample_total = cur.fetchone()[0]
                else:
                    res = conn.execute(sql, [db_source]).fetchone()
                    live_total = conn.execute("SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'").fetchone()[0]
                    sample_total = conn.execute("SELECT COUNT(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'").fetchone()[0]
            else:
                aoi_meta = self.get_aoi(aoi_id)
                if aoi_meta and "bbox_west" in aoi_meta:
                    w, s, e, n = aoi_meta["bbox_west"], aoi_meta["bbox_south"], aoi_meta["bbox_east"], aoi_meta["bbox_north"]
                    sql = f"""
                        SELECT 
                            COUNT(*) as total,
                            SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis_count,
                            SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs_count,
                            COALESCE(SUM(frp), 0.0) as total_frp,
                            MIN(acq_date) as earliest_date,
                            MAX(acq_date) as latest_date,
                            MAX(ingested_at) as last_ingested
                        FROM raw_observations
                        WHERE data_source = {ph} AND longitude >= {ph} AND latitude >= {ph} AND longitude <= {ph} AND latitude <= {ph}
                    """
                    sql_live = f"SELECT COUNT(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS' AND longitude >= {ph} AND latitude >= {ph} AND longitude <= {ph} AND latitude <= {ph}"
                    sql_sample = f"SELECT COUNT(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE' AND longitude >= {ph} AND latitude >= {ph} AND longitude <= {ph} AND latitude <= {ph}"
                    geo_params = [w, s, e, n]
                    if self.engine_type == "postgres":
                        with conn.cursor() as cur:
                            cur.execute(sql, [db_source] + geo_params)
                            res = cur.fetchone()
                            cur.execute(sql_live, geo_params)
                            live_total = cur.fetchone()[0]
                            cur.execute(sql_sample, geo_params)
                            sample_total = cur.fetchone()[0]
                    else:
                        res = conn.execute(sql, [db_source] + geo_params).fetchone()
                        live_total = conn.execute(sql_live, geo_params).fetchone()[0]
                        sample_total = conn.execute(sql_sample, geo_params).fetchone()[0]
                else:
                    sql = f"""
                        SELECT 
                            COUNT(*) as total,
                            SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis_count,
                            SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs_count,
                            COALESCE(SUM(frp), 0.0) as total_frp,
                            MIN(acq_date) as earliest_date,
                            MAX(acq_date) as latest_date,
                            MAX(ingested_at) as last_ingested
                        FROM raw_observations
                        WHERE (aoi_id = {ph} OR aoi_id = 'global') AND data_source = {ph}
                    """
                    sql_live = f"SELECT COUNT(*) FROM raw_observations WHERE (aoi_id = {ph} OR aoi_id = 'global') AND data_source = 'LIVE_FIRMS'"
                    sql_sample = f"SELECT COUNT(*) FROM raw_observations WHERE (aoi_id = {ph} OR aoi_id = 'global') AND data_source = 'SAMPLE_ARCHIVE'"
                    if self.engine_type == "postgres":
                        with conn.cursor() as cur:
                            cur.execute(sql, [aoi_id, db_source])
                            res = cur.fetchone()
                            cur.execute(sql_live, [aoi_id])
                            live_total = cur.fetchone()[0]
                            cur.execute(sql_sample, [aoi_id])
                            sample_total = cur.fetchone()[0]
                    else:
                        res = conn.execute(sql, [aoi_id, db_source]).fetchone()
                        live_total = conn.execute(sql_live, [aoi_id]).fetchone()[0]
                        sample_total = conn.execute(sql_sample, [aoi_id]).fetchone()[0]

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
        Inserts observations with deduplication and validation.
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
            ph = "%s" if self.engine_type == "postgres" else "?"
            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute(f"SELECT id, raw_hash FROM raw_observations WHERE data_source = {ph}", [data_source])
                    rows = cur.fetchall()
                    existing_ids = {r[0] for r in rows if r[0]}
                    existing_hashes = {r[1] for r in rows if r[1]}
            else:
                existing_df = conn.execute(
                    f"SELECT id, raw_hash FROM raw_observations WHERE data_source = {ph}",
                    [data_source]
                ).fetchdf()
                existing_ids = set(existing_df["id"].dropna()) if not existing_df.empty else set()
                existing_hashes = set(existing_df["raw_hash"].dropna()) if not existing_df.empty else set()

            valid_records = []
            duplicates_count = 0
            invalid_count = 0
            now_ts = datetime.utcnow()

            for obs in observations:
                try:
                    lat = float(obs.get("latitude"))
                    lon = float(obs.get("longitude"))
                    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                        invalid_count += 1
                        continue
                except (ValueError, TypeError):
                    invalid_count += 1
                    continue

                acq_d = str(obs.get("acq_date", "")).strip()
                if not acq_d or len(acq_d) != 10:
                    invalid_count += 1
                    continue

                h = obs.get("raw_hash") or self.compute_hash(obs)
                obs_id = obs.get("id")
                if not obs_id or obs_id.startswith("FIRMS_temp"):
                    obs_id = f"FIRMS_{obs.get('sensor')}_{obs.get('satellite', 'SAT')}_{acq_d}_{obs.get('acq_time', '0000')}_{lat:.4f}_{lon:.4f}"

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
                if self.engine_type == "postgres":
                    with conn.cursor() as cur:
                        tuples = [
                            (
                                r["id"], r["sensor"], r["satellite"], r["instrument"], r["latitude"], r["longitude"],
                                r["brightness"], r["scan"], r["track"], r["acq_date"], r["acq_time"], r["confidence"],
                                r["confidence_numeric"], r["version"], r["bright_t31"], r["frp"], r["daynight"],
                                r["aoi_id"], r["resolution_m"], r["data_source"], r["ingested_at"], r["raw_hash"],
                                r["country"], r["country_code"], r["continent"], r["continent_code"],
                                r["proximity_label"], r["nearest_city"]
                            )
                            for r in valid_records
                        ]
                        insert_sql = """
                            INSERT INTO raw_observations (
                                id, sensor, satellite, instrument, latitude, longitude, brightness,
                                scan, track, acq_date, acq_time, confidence, confidence_numeric,
                                version, bright_t31, frp, daynight, aoi_id, resolution_m,
                                data_source, ingested_at, raw_hash, country, country_code,
                                continent, continent_code, proximity_label, nearest_city
                            ) VALUES %s
                            ON CONFLICT (id) DO UPDATE SET
                                brightness = EXCLUDED.brightness,
                                confidence = EXCLUDED.confidence,
                                confidence_numeric = EXCLUDED.confidence_numeric,
                                frp = EXCLUDED.frp,
                                ingested_at = EXCLUDED.ingested_at
                        """
                        execute_values(cur, insert_sql, tuples, page_size=5000)
                    conn.commit()
                else:
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
        ph = "%s" if self.engine_type == "postgres" else "?"
        conn = self.get_connection()
        try:
            sql_cont = f"""
                SELECT 
                    COALESCE(continent, 'Other') as name,
                    COUNT(*) as count,
                    COALESCE(SUM(frp), 0.0) as total_frp,
                    SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis,
                    SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs
                FROM raw_observations
                WHERE data_source = {ph}
                GROUP BY continent
                ORDER BY count DESC
            """
            sql_country = f"""
                SELECT 
                    COALESCE(country, 'Unknown') as name,
                    COUNT(*) as count,
                    COALESCE(SUM(frp), 0.0) as total_frp
                FROM raw_observations
                WHERE data_source = {ph}
                GROUP BY country
                ORDER BY count DESC
                LIMIT 15
            """
            sql_total = f"""
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN sensor = 'MODIS' THEN 1 ELSE 0 END) as modis,
                    SUM(CASE WHEN sensor = 'VIIRS' THEN 1 ELSE 0 END) as viirs,
                    COALESCE(SUM(frp), 0.0) as total_frp,
                    MIN(acq_date) as earliest,
                    MAX(acq_date) as latest,
                    MAX(ingested_at) as last_ingested
                FROM raw_observations
                WHERE data_source = {ph}
            """

            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute(sql_cont, [db_source])
                    cont_rows = cur.fetchall()
                    cur.execute(sql_country, [db_source])
                    country_rows = cur.fetchall()
                    cur.execute(sql_total, [db_source])
                    total_stats = cur.fetchone()
            else:
                cont_rows = conn.execute(sql_cont, [db_source]).fetchall()
                country_rows = conn.execute(sql_country, [db_source]).fetchall()
                total_stats = conn.execute(sql_total, [db_source]).fetchone()

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
            ph = "%s" if self.engine_type == "postgres" else "?"
            sql = f"""
                INSERT INTO ingestion_history VALUES ({ph}, {ph}, CURRENT_TIMESTAMP, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """
            args = [
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
            ]
            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute(sql, args)
                conn.commit()
            else:
                conn.execute(sql, args)
        finally:
            conn.close()

    def get_latest_ingestion_log(self, aoi_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            ph = "%s" if self.engine_type == "postgres" else "?"
            sql = f"""
                SELECT * FROM ingestion_history 
                WHERE aoi_id = {ph} 
                ORDER BY ingested_at DESC 
                LIMIT 1
            """
            if self.engine_type == "postgres":
                with conn.cursor() as cur:
                    cur.execute(sql, [aoi_id])
                    row = cur.fetchone()
                    if row:
                        cols = [d[0] for d in cur.description]
                        rec = dict(zip(cols, row))
                        for k, v in list(rec.items()):
                            if hasattr(v, "isoformat"):
                                rec[k] = v.isoformat()
                            elif isinstance(v, float) and (v != v):
                                rec[k] = None
                        return rec
                    return None
            res = conn.execute(sql, [aoi_id]).fetchdf()
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
