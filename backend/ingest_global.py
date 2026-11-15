"""
IGNIS - Global NASA FIRMS Live Ingestion Runner
Fetches genuine 24h global fire detections from NASA EOSDIS and populates DuckDB warehouse.
"""
import asyncio
import sys
import time
from app.services.firms_client import firms_client
from app.services.db_service import db_service

async def main():
    print("=" * 65)
    print("IGNIS GLOBAL NASA FIRMS LIVE INGESTION")
    print("=" * 65)
    
    t0 = time.time()
    print("[1/4] Authenticating and requesting global fire data from NASA EOSDIS...")
    res = await firms_client.fetch_global_fires(days=1)
    
    if not res.get("success"):
        print(f"❌ Failed to fetch global fires: {res.get('message')}")
        sys.exit(1)
        
    obs = res.get("observations", [])
    print(f"[2/4] Retrieved {len(obs)} validated global fire observations in {time.time() - t0:.2f}s.")
    print("      Product breakdown:")
    for src, cnt in res.get("by_source", {}).items():
        print(f"      - {src}: {cnt:,} detections")
    print(f"      MODIS total: {res.get('modis_count', 0):,}")
    print(f"      VIIRS total: {res.get('viirs_count', 0):,}")
    
    print("\n[3/4] Storing observations into DuckDB warehouse (LIVE_FIRMS table)...")
    t1 = time.time()
    insert_stats = db_service.insert_observations(obs, data_source="LIVE_FIRMS")
    print(f"      Inserted: {insert_stats['inserted']:,}")
    print(f"      Duplicates skipped: {insert_stats['duplicates_skipped']:,}")
    print(f"      Validated: {insert_stats['validated']:,}")
    print(f"      Time taken: {time.time() - t1:.2f}s")
    
    print("\n[4/4] Ingestion log & Global breakdown:")
    db_service.record_ingestion_log(
        aoi_id="global",
        status="SUCCESS",
        result_stats=insert_stats,
        date_start="Recent 1d",
        date_end="NOW",
        sensors=res.get("sensors_queried", [])
    )
    
    breakdown = db_service.get_global_breakdown(dataset_mode="LIVE")
    print("      Active fires by continent:")
    for c in breakdown.get("continents", []):
        print(f"      - {c['name']}: {c['count']:,} fires | FRP: {c['total_frp']:,.1f} MW")
        
    print("\n      Top 10 countries by fire activity:")
    for c in breakdown.get("top_countries", [])[:10]:
        print(f"      - {c['name']}: {c['count']:,} fires | FRP: {c['total_frp']:,.1f} MW")

    counts = db_service.get_observation_counts("global", dataset_mode="LIVE")
    print("\n" + "=" * 65)
    print(f"SUCCESS: {counts['total']:,} total genuine live observations in DuckDB warehouse.")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(main())
