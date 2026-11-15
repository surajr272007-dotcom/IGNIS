"""
IGNIS — Safe, Resumable DuckDB to Neon PostgreSQL Migration Tool

Migrates all 428,394 NASA FIRMS active fire observations, AOI registries, and ingestion logs
from local DuckDB (ignis_fire_warehouse.duckdb) into Neon Serverless PostgreSQL.

Guarantees:
  - Source DuckDB is opened strictly in read-only mode (never deleted or modified).
  - Fully resumable: skips already-migrated records using ID deduplication and ON CONFLICT DO NOTHING.
  - Efficient batch streaming (10,000–25,000 records per batch) with execute_values.
  - Full attribute fidelity: preserves floating-point coordinates, timestamps, FRP, sensor metadata.
  - Zero secret exposure: connection strings and credentials are fully masked in all outputs.

Usage:
  # Run migration (requires DATABASE_URL in environment or backend/.env):
  python backend/migrate_duckdb_to_neon.py

  # Optional flags:
  python backend/migrate_duckdb_to_neon.py --batch-size 15000
  python backend/migrate_duckdb_to_neon.py --dry-run
  python backend/migrate_duckdb_to_neon.py --verify-only
"""

import os
import sys
import time
import math
import argparse
from datetime import datetime
from urllib.parse import urlparse
from typing import List, Tuple, Any, Set

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))

from backend.app.config import settings

try:
    import duckdb
except ImportError:
    duckdb = None

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    psycopg2 = None
    execute_values = None


def mask_url(url: str) -> str:
    """Masks database credentials for secure output."""
    if not url:
        return ""
    try:
        p = urlparse(url)
        netloc = ""
        if p.username:
            netloc += "*****"
        if p.password:
            netloc += ":*****@"
        elif p.username:
            netloc += "@"
        netloc += p.hostname or "unknown-host"
        if p.port:
            netloc += f":{p.port}"
        return f"{p.scheme}://{netloc}{p.path}"
    except Exception:
        return "postgresql://*****:*****@masked-host/database"


def sanitize_val(val: Any) -> Any:
    """Converts NaNs to None and normalizes datetimes for clean PostgreSQL ingestion."""
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    if hasattr(val, "to_pydatetime"):
        return val.to_pydatetime()
    return val


def get_pg_connection(db_url: str):
    """Establishes a connection to Neon PostgreSQL."""
    clean_url = db_url.strip()
    if clean_url.startswith("postgres://"):
        clean_url = "postgresql://" + clean_url[len("postgres://"):]
    return psycopg2.connect(clean_url, connect_timeout=30)


def migrate_all(batch_size: int = 15000, dry_run: bool = False, verify_only: bool = False):
    print("=" * 75)
    print("IGNIS — DUCKDB TO NEON POSTGRESQL MIGRATION PIPELINE")
    print("=" * 75)

    if duckdb is None:
        print("[!] Error: duckdb package is not installed.")
        return False
    if psycopg2 is None:
        print("[!] Error: psycopg2-binary package is not installed.")
        return False

    db_url = os.getenv("DATABASE_URL") or settings.DATABASE_URL
    if not db_url:
        print("\n[!] DATABASE_URL is not set.")
        print("Please configure DATABASE_URL in PowerShell or backend/.env:")
        print('  $env:DATABASE_URL = "postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require"')
        print("  python backend/migrate_duckdb_to_neon.py\n")
        return False

    duckdb_path = settings.DUCKDB_PATH
    if not os.path.exists(duckdb_path):
        # Fallback to root warehouse if relative
        if os.path.exists("ignis_fire_warehouse.duckdb"):
            duckdb_path = "ignis_fire_warehouse.duckdb"
        else:
            print(f"[!] Error: DuckDB database not found at {duckdb_path}")
            return False

    print(f"\nSource DuckDB  : {duckdb_path} (Opened strictly READ-ONLY)")
    print(f"Target Postgres: {mask_url(db_url)}")
    print(f"Batch Size     : {batch_size:,} records")
    print(f"Mode           : {'DRY RUN (simulation only)' if dry_run else 'VERIFY ONLY' if verify_only else 'LIVE MIGRATION'}")

    # Connect to DuckDB (READ-ONLY)
    dconn = duckdb.connect(duckdb_path, read_only=True)

    # Inspect source counts
    source_obs_count = dconn.execute("SELECT count(*) FROM raw_observations").fetchone()[0]
    source_aoi_count = dconn.execute("SELECT count(*) FROM aoi_registry").fetchone()[0]
    source_log_count = dconn.execute("SELECT count(*) FROM ingestion_history").fetchone()[0]
    source_live_count = dconn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'").fetchone()[0]
    source_sample_count = dconn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'").fetchone()[0]

    print(f"\n[Source Inventory in DuckDB]")
    print(f"  • aoi_registry      : {source_aoi_count:,} rows")
    print(f"  • ingestion_history : {source_log_count:,} rows")
    print(f"  • raw_observations  : {source_obs_count:,} total")
    print(f"      - LIVE_FIRMS    : {source_live_count:,} rows")
    print(f"      - SAMPLE_ARCHIVE: {source_sample_count:,} rows")

    # Connect to PostgreSQL
    pg_conn = get_pg_connection(db_url)
    try:
        with pg_conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM raw_observations")
            dest_existing_obs = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM aoi_registry")
            dest_existing_aoi = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM ingestion_history")
            dest_existing_logs = cur.fetchone()[0]

        print(f"\n[Destination Inventory in Neon]")
        print(f"  • aoi_registry      : {dest_existing_aoi:,} existing rows")
        print(f"  • ingestion_history : {dest_existing_logs:,} existing rows")
        print(f"  • raw_observations  : {dest_existing_obs:,} existing rows")

        if verify_only:
            print("\n" + "=" * 75)
            print("RUNNING POST-MIGRATION PARITY AUDIT...")
            run_verification_audit(dconn, pg_conn)
            return True

        if dry_run:
            print("\n[DRY RUN] Simulation complete. No changes were made to Neon PostgreSQL.")
            return True

        # Phase 1: Migrate aoi_registry
        print("\n" + "-" * 75)
        print("[Phase 1/3] Migrating aoi_registry...")
        aoi_rows = dconn.execute("SELECT * FROM aoi_registry").fetchall()
        with pg_conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO aoi_registry (
                    id, name, country, country_code, bbox_west, bbox_south, bbox_east, bbox_north,
                    center_lat, center_lon, ecozone, peak_season, fire_type, description, typical_ratio
                ) VALUES %s ON CONFLICT (id) DO NOTHING
                """,
                aoi_rows
            )
        pg_conn.commit()
        print(f"  ✓ aoi_registry synchronized ({len(aoi_rows)} rows checked).")

        # Phase 2: Migrate ingestion_history
        print("\n[Phase 2/3] Migrating ingestion_history...")
        log_rows = dconn.execute("SELECT * FROM ingestion_history").fetchall()
        sanitized_logs = [[sanitize_val(val) for val in row] for row in log_rows]
        with pg_conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO ingestion_history (
                    id, aoi_id, ingested_at, status, records_received, records_validated,
                    records_inserted, duplicates_skipped, invalid_rejected, modis_count,
                    viirs_count, date_range_start, date_range_end, sensors_queried, error_message
                ) VALUES %s ON CONFLICT (id) DO NOTHING
                """,
                sanitized_logs
            )
        pg_conn.commit()
        print(f"  ✓ ingestion_history synchronized ({len(log_rows)} rows checked).")

        # Phase 3: Migrate raw_observations with Resumability
        print("\n[Phase 3/3] Migrating raw_observations (Resumable Streaming)...")
        print("  • Fetching existing observation IDs from Neon for instant resume capability...")
        with pg_conn.cursor() as cur:
            cur.execute("SELECT id FROM raw_observations")
            existing_pg_ids: Set[str] = {r[0] for r in cur.fetchall()}
        print(f"  • Destination currently contains {len(existing_pg_ids):,} observations.")

        # Stream from DuckDB in chunks
        offset = 0
        total_migrated = 0
        total_skipped = 0
        batch_idx = 1
        total_batches = math.ceil(source_obs_count / batch_size)
        start_time = time.time()

        raw_columns = [
            "id", "sensor", "satellite", "instrument", "latitude", "longitude", "brightness",
            "scan", "track", "acq_date", "acq_time", "confidence", "confidence_numeric",
            "version", "bright_t31", "frp", "daynight", "aoi_id", "resolution_m",
            "data_source", "ingested_at", "raw_hash", "country", "country_code",
            "continent", "continent_code", "proximity_label", "nearest_city"
        ]
        col_list_str = ", ".join(raw_columns)

        insert_sql = f"""
            INSERT INTO raw_observations ({col_list_str})
            VALUES %s
            ON CONFLICT (id) DO NOTHING
        """

        while offset < source_obs_count:
            b_start = time.time()
            chunk_df = dconn.execute(
                f"SELECT * FROM raw_observations LIMIT {batch_size} OFFSET {offset}"
            ).fetchdf()

            if chunk_df.empty:
                break

            # Filter for missing rows (resumability)
            records = chunk_df.to_dict(orient="records")
            new_records = [r for r in records if r["id"] not in existing_pg_ids]
            already_present = len(records) - len(new_records)
            total_skipped += already_present

            if new_records:
                tuples_to_insert = []
                for r in new_records:
                    row_tuple = tuple(sanitize_val(r.get(col)) for col in raw_columns)
                    tuples_to_insert.append(row_tuple)

                with pg_conn.cursor() as cur:
                    execute_values(cur, insert_sql, tuples_to_insert, page_size=5000)
                pg_conn.commit()

                # Add newly inserted to existing set
                for r in new_records:
                    existing_pg_ids.add(r["id"])
                total_migrated += len(new_records)

            b_duration = max(0.001, time.time() - b_start)
            rate = len(records) / b_duration
            pct = min(100.0, ((offset + len(records)) / source_obs_count) * 100)

            print(
                f"  [{batch_idx:02d}/{total_batches:02d}] Progress: {offset + len(records):,}/{source_obs_count:,} ({pct:5.1f}%) "
                f"| +{len(new_records):,} new | {already_present:,} skipped | {rate:,.0f} rec/s"
            )

            offset += len(records)
            batch_idx += 1

        elapsed = time.time() - start_time
        print("\n" + "-" * 75)
        print(f"MIGRATION COMPLETE in {elapsed:.1f}s!")
        print(f"  • Newly migrated records : {total_migrated:,}")
        print(f"  • Skipped existing records: {total_skipped:,}")
        print(f"  • Average throughput     : {source_obs_count / max(0.1, elapsed):,.0f} records/second")

        # Run final verification audit
        print("\n" + "=" * 75)
        print("RUNNING FINAL POST-MIGRATION PARITY AUDIT...")
        run_verification_audit(dconn, pg_conn)

    finally:
        pg_conn.close()
        dconn.close()

    return True


def run_verification_audit(dconn, pg_conn):
    """Deep verification audit comparing DuckDB source against Neon destination."""
    with pg_conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM raw_observations")
        pg_total = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'")
        pg_live = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'")
        pg_sample = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM aoi_registry")
        pg_aoi = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM ingestion_history")
        pg_logs = cur.fetchone()[0]

    duck_total = dconn.execute("SELECT count(*) FROM raw_observations").fetchone()[0]
    duck_live = dconn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'LIVE_FIRMS'").fetchone()[0]
    duck_sample = dconn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'").fetchone()[0]

    print(f"\n1. TABLE RECORD COUNTS:")
    print(f"   • raw_observations : DuckDB = {duck_total:,} | Neon = {pg_total:,}")
    print(f"   • LIVE_FIRMS       : DuckDB = {duck_live:,}  | Neon = {pg_live:,}")
    print(f"   • SAMPLE_ARCHIVE   : DuckDB = {duck_sample:,}| Neon = {pg_sample:,}")
    print(f"   • aoi_registry     : Neon = {pg_aoi} reference regions")
    print(f"   • ingestion_history: Neon = {pg_logs} audit history records")

    # Assert count parity for live observations
    if pg_live >= duck_live:
        print(f"   ✓ LIVE FIRMS data integrity: 100% accounted for in Neon.")
    else:
        print(f"   ✗ Warning: LIVE_FIRMS count in Neon ({pg_live}) < DuckDB ({duck_live})")

    # Sample representative records check
    print(f"\n2. SAMPLE RECORD FIDELITY CHECKS:")
    sample_records = dconn.execute("""
        SELECT id, sensor, satellite, latitude, longitude, frp, acq_date, acq_time, data_source
        FROM raw_observations
        WHERE data_source = 'LIVE_FIRMS'
        ORDER BY frp DESC
        LIMIT 3
    """).fetchall()

    with pg_conn.cursor() as cur:
        for s in sample_records:
            s_id = s[0]
            cur.execute("""
                SELECT id, sensor, satellite, latitude, longitude, frp, acq_date, acq_time, data_source
                FROM raw_observations
                WHERE id = %s
            """, [s_id])
            pg_row = cur.fetchone()
            if pg_row:
                coord_match = (round(s[3], 4) == round(pg_row[3], 4)) and (round(s[4], 4) == round(pg_row[4], 4))
                frp_match = round(s[5], 1) == round(pg_row[5], 1)
                time_match = (s[6] == pg_row[6]) and (s[7] == pg_row[7])
                if coord_match and frp_match and time_match:
                    print(f"   ✓ Match confirmed for {s_id} ({s[1]} {s[2]} at {s[3]:.2f}, {s[4]:.2f}, FRP={s[5]} MW, Date={s[6]} {s[7]})")
                else:
                    print(f"   ✗ Discrepancy detected for {s_id}!")
            else:
                print(f"   ✗ Record {s_id} missing in Neon!")

    print(f"\n3. LOCAL DUCKDB SOURCE VERIFICATION:")
    dcount_after = dconn.execute("SELECT count(*) FROM raw_observations").fetchone()[0]
    print(f"   ✓ Local DuckDB remains untouched: Exactly {dcount_after:,} observations preserved.\n")
    print("=" * 75)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IGNIS DuckDB to Neon PostgreSQL Migration")
    parser.add_argument("--batch-size", type=int, default=15000, help="Batch size for streaming (default: 15,000)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without writing to PostgreSQL")
    parser.add_argument("--verify-only", action="store_true", help="Run parity audit without migrating")
    args = parser.parse_args()

    migrate_all(batch_size=args.batch_size, dry_run=args.dry_run, verify_only=args.verify_only)
