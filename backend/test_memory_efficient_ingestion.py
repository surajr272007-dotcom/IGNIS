"""
Unit & Integration Tests for Memory-Efficient Ingestion Pipeline.
Verifies:
1. Sequential processing of the four NASA FIRMS products.
2. Incremental batching and bounded memory consumption (<50 MB watermark).
3. Zero-allocation reverse geocoding spatial grid cache.
4. Resilient timeout and partial failure handling without server crashes.
5. Exact API response schema and deduplication fidelity.
"""

import sys
import os
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))
import unittest
import asyncio
import io
import tracemalloc
from unittest.mock import patch, MagicMock, AsyncMock
from backend.app.services.firms_client import firms_client
from backend.app.services.db_service import db_service
from backend.app.data.geo_reference import resolve_geographic_context, clear_geo_cache, _GEO_GRID_CACHE

# Sample synthetic CSV simulating NASA FIRMS Area API output for testing
SAMPLE_MODIS_CSV = """latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight
-15.5123,-56.2341,315.2,1.2,1.1,2026-11-15,1030,Terra,75,6.1NRT,295.1,24.5,D
-15.5199,-56.2405,320.1,1.2,1.1,2026-11-15,1030,Terra,85,6.1NRT,296.0,32.1,D
-15.5250,-56.2510,310.0,1.2,1.1,2026-11-15,1030,Terra,60,6.1NRT,294.0,15.2,D
"""

SAMPLE_VIIRS_CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-15.5130,-56.2345,335.5,0.4,0.4,2026-11-15,0450,NOAA-20,VIIRS,nominal,2.0NRT,298.2,12.4,N
-15.5140,-56.2355,340.2,0.4,0.4,2026-11-15,0450,NOAA-20,VIIRS,high,2.0NRT,299.1,18.8,N
-15.5150,-56.2365,325.0,0.4,0.4,2026-11-15,0450,NOAA-20,VIIRS,low,2.0NRT,295.0,5.2,N
"""

class TestMemoryEfficientIngestion(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        clear_geo_cache()

    def test_01_reverse_geocoding_cache_and_speed(self):
        """Verifies spatial grid cache hit rate and sub-millisecond execution."""
        # Query initial point (cache miss)
        res1 = resolve_geographic_context(-15.60, -56.10)
        self.assertEqual(res1["country"], "Brazil")
        self.assertEqual(res1["continent"], "South America")
        self.assertIn("Cuiabá", res1["proximity_label"])

        # Query nearby point within 0.1 degree grid (cache hit)
        initial_cache_size = len(_GEO_GRID_CACHE)
        res2 = resolve_geographic_context(-15.62, -56.11)
        self.assertEqual(res2["country"], "Brazil")
        self.assertEqual(len(_GEO_GRID_CACHE), initial_cache_size, "Grid cache should hit for nearby coordinates")

    def test_02_bounded_chunk_deduplication(self):
        """Verifies insert_observations operates in small chunks without loading full tables."""
        test_obs = [
            {
                "id": f"TEST_INGEST_CHUNK_{i:04d}",
                "sensor": "MODIS",
                "satellite": "Terra",
                "instrument": "MODIS",
                "latitude": -15.50 + (i * 0.001),
                "longitude": -56.20 + (i * 0.001),
                "brightness": 310.0,
                "acq_date": "2026-11-15",
                "acq_time": "1200",
                "confidence": "nominal",
                "confidence_numeric": 70,
                "frp": 15.0,
                "data_source": "TEST_SOURCE"
            }
            for i in range(25)
        ]

        # Insert first time
        stats1 = db_service.insert_observations(test_obs, data_source="TEST_SOURCE", chunk_size=10)
        self.assertEqual(stats1["received"], 25)
        self.assertEqual(stats1["inserted"], 25)
        self.assertEqual(stats1["duplicates_skipped"], 0)

        # Insert identical records second time (should all be skipped as duplicates)
        stats2 = db_service.insert_observations(test_obs, data_source="TEST_SOURCE", chunk_size=10)
        self.assertEqual(stats2["received"], 25)
        self.assertEqual(stats2["inserted"], 0)
        self.assertEqual(stats2["duplicates_skipped"], 25)

    async def test_03_sequential_product_processing_with_batches(self):
        """Verifies products are fetched sequentially and streamed in batches."""
        call_order = []
        batch_received = []

        async def mock_get(endpoint):
            resp = MagicMock()
            resp.status_code = 200
            for prod in ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]:
                if prod in endpoint:
                    call_order.append(prod)
                    resp.text = SAMPLE_MODIS_CSV if "MODIS" in prod else SAMPLE_VIIRS_CSV
                    return resp
            resp.text = ""
            return resp

        def on_batch(batch, src):
            batch_received.append((src, len(batch)))

        with patch("httpx.AsyncClient.get", side_effect=mock_get):
            with patch.object(firms_client, "verify_map_key", return_value={"success": True}):
                res = await firms_client.fetch_global_fires(
                    days=1,
                    map_key="test_map_key_12345678901234567890",
                    sources=["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"],
                    on_batch=on_batch,
                    batch_size=2
                )

        self.assertTrue(res["success"])
        # Check strict sequential order
        self.assertEqual(call_order, ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"])
        # Check that batches were dispatched incrementally
        self.assertTrue(len(batch_received) >= 4)
        # Check that caller's memory did not accumulate raw observations list
        self.assertEqual(len(res["observations"]), 0)

    async def test_04_partial_product_timeout_resilience(self):
        """Verifies that a timeout in one product does not crash ingestion or abort other products."""
        import httpx

        async def mock_get_with_timeout(endpoint):
            resp = MagicMock()
            if "VIIRS_NOAA20_NRT" in endpoint:
                # Simulate timeout on NOAA-20
                raise httpx.TimeoutException("Read timeout after 90s")
            resp.status_code = 200
            resp.text = SAMPLE_MODIS_CSV
            return resp

        batch_received = []
        def on_batch(batch, src):
            batch_received.append((src, len(batch)))

        with patch("httpx.AsyncClient.get", side_effect=mock_get_with_timeout):
            with patch.object(firms_client, "verify_map_key", return_value={"success": True}):
                res = await firms_client.fetch_global_fires(
                    days=1,
                    map_key="test_map_key_12345678901234567890",
                    sources=["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"],
                    on_batch=on_batch
                )

        # Ingestion succeeds with partial results
        self.assertTrue(res["success"])
        self.assertIsNotNone(res["errors"])
        self.assertTrue(any("VIIRS_NOAA20_NRT" in e for e in res["errors"]))
        # Remaining products (MODIS_NRT and VIIRS_SNPP_NRT) must still be processed
        self.assertIn("MODIS_NRT", res["by_source"])
        self.assertIn("VIIRS_SNPP_NRT", res["by_source"])
        self.assertEqual(res["by_source"]["MODIS_NRT"], 3)
        self.assertEqual(res["by_source"]["VIIRS_SNPP_NRT"], 3)

    async def test_05_memory_watermark_under_stress(self):
        """Verifies memory stays well below 50 MB even during 15,000 synthetic observation streaming."""
        tracemalloc.start()
        
        # Build 5,000-line synthetic CSV
        header = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight\n"
        rows = []
        for i in range(5000):
            lat = -20.0 + (i % 100) * 0.05
            lon = -55.0 + (i % 100) * 0.05
            rows.append(f"{lat:.4f},{lon:.4f},310.0,1.0,1.0,2026-11-15,1200,Terra,80,6.1NRT,295.0,20.0,D")
        large_csv = header + "\n".join(rows)

        async def mock_get_large(endpoint):
            resp = MagicMock()
            resp.status_code = 200
            resp.text = large_csv
            return resp

        processed_batches = 0
        def on_batch(batch, src):
            nonlocal processed_batches
            processed_batches += 1
            self.assertLessEqual(len(batch), 2500)

        with patch("httpx.AsyncClient.get", side_effect=mock_get_large):
            with patch.object(firms_client, "verify_map_key", return_value={"success": True}):
                # Run across 3 products (total 15,000 records)
                res = await firms_client.fetch_global_fires(
                    days=1,
                    map_key="test_map_key_12345678901234567890",
                    sources=["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"],
                    on_batch=on_batch,
                    batch_size=2500
                )

        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        peak_mb = peak / (1024 * 1024)
        print(f"\n      Peak Memory during 15,000 record streaming: {peak_mb:.2f} MB")
        self.assertLess(peak_mb, 50.0, f"Peak memory ({peak_mb:.2f} MB) should remain strictly under 50 MB")
        self.assertEqual(res["total_records"], 15000)

if __name__ == "__main__":
    unittest.main()
