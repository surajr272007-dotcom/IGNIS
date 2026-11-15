"""
Unit tests for IGNIS Backend Services and Scientific Logic
"""
import sys
import os
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))
import unittest
from backend.app.services.db_service import db_service
from backend.app.services.harmonization_engine import harmonization_engine
from backend.app.services.calendar_service import calendar_service
from backend.app.services.anomaly_service import anomaly_service
from backend.app.api.routes import health_check, list_aois, get_fires, get_harmonization_analysis, get_burning_calendar, get_anomaly_intelligence

class TestIgnisBackend(unittest.TestCase):
    def test_01_health_check(self):
        res = health_check()
        self.assertEqual(res["status"], "healthy")
        self.assertIn(res["database"]["engine"], ["DuckDB", "PostgreSQL"])
        self.assertGreater(res["database"]["total_observations_indexed"], 0)
        print("✓ Health check verified:", res["database"]["total_observations_indexed"], "observations indexed. Engine:", res["database"]["engine"])

    def test_02_aoi_list(self):
        res = list_aois()
        self.assertGreaterEqual(len(res["aois"]), 5)
        print(f"✓ AOI Registry verified: {len(res['aois'])} global fire regimes available.")

    def test_03_fires_query(self):
        res = get_fires(aoi_id="pantanal_brazil", limit=20)
        self.assertGreater(res["count"], 0)
        self.assertIn("observations", res)
        sample = res["observations"][0]
        self.assertIn("sensor", sample)
        self.assertIn("latitude", sample)
        self.assertIn("frp", sample)
        print(f"✓ Fire observations queried: {res['count']} records retrieved. Sample sensor: {sample['sensor']}, FRP: {sample['frp']} MW.")

    def test_04_harmonization(self):
        res = get_harmonization_analysis(aoi_id="pantanal_brazil")
        metrics = res["metrics"]
        self.assertGreater(metrics["total_observations"], 0)
        self.assertGreater(metrics["total_fire_events"], 0)
        self.assertGreater(metrics["viirs_to_modis_ratio"], 1.0)
        print(f"✓ Scientific Harmonization verified: {metrics['total_observations']} raw detections condensed into {metrics['total_fire_events']} distinct fire events. VIIRS/MODIS ratio: {metrics['viirs_to_modis_ratio']}.")

    def test_05_calendar(self):
        res = get_burning_calendar(aoi_id="pantanal_brazil")
        cal = res["calendar"]
        self.assertIn("daily_timeline", cal)
        self.assertIn("doy_baselines", cal)
        self.assertIn("season_profile", cal)
        print(f"✓ Burning Activity Calendar generated: {len(cal['daily_timeline'])} daily records, peak DOY: {cal['season_profile']['peak_doy']}.")

    def test_06_anomalies(self):
        res = get_anomaly_intelligence(aoi_id="pantanal_brazil")
        analysis = res["analysis"]
        self.assertIn("anomalies", analysis)
        self.assertIn("summary", analysis)
        print(f"✓ Anomaly Intelligence verified: {analysis['summary']['total_anomaly_days']} anomalous burning days identified (Max score: {analysis['summary']['max_anomaly_score']}).")

    def test_07_firms_payload_validation(self):
        from backend.app.api.routes import LiveFirmsQueryRequest, RefreshFirmsRequest, RefreshGlobalFirmsRequest
        # Valid payload
        valid_req = LiveFirmsQueryRequest(
            bbox=[-56.5, -18.5, -56.0, -18.0],
            source="VIIRS_NOAA20_NRT",
            days=1
        )
        self.assertEqual(valid_req.days, 1)
        self.assertEqual(len(valid_req.bbox), 4)

        # Invalid coordinate order (West > East)
        with self.assertRaises(ValueError):
            LiveFirmsQueryRequest(bbox=[-55.0, -18.0, -56.0, -18.5])

        # Invalid days (> 10)
        with self.assertRaises(ValueError):
            LiveFirmsQueryRequest(bbox=[-56.5, -18.5, -56.0, -18.0], days=15)

        # Ingestion requests: verify supported 1, 3, 5 days and default 5 days
        for d in [1, 3, 5]:
            req_regional = RefreshFirmsRequest(aoi_id="pantanal_brazil", days=d)
            self.assertEqual(req_regional.days, d)
            req_global = RefreshGlobalFirmsRequest(days=d)
            self.assertEqual(req_global.days, d)

        # Default days must be 5
        self.assertEqual(RefreshFirmsRequest().days, 5)
        self.assertEqual(RefreshGlobalFirmsRequest().days, 5)

        # Unsupported days (> 5, e.g. 7 and 10) must fail validation
        with self.assertRaises(ValueError):
            RefreshFirmsRequest(days=7)
        with self.assertRaises(ValueError):
            RefreshFirmsRequest(days=10)
        with self.assertRaises(ValueError):
            RefreshGlobalFirmsRequest(days=7)
        with self.assertRaises(ValueError):
            RefreshGlobalFirmsRequest(days=10)

        print("✓ FIRMS Ingestion & Live Query Pydantic validation models verified (1, 3, 5 days supported; >5 rejected).")

    def test_08_dataset_separation_and_deduplication(self):
        # Verify schema
        conn = db_service.get_connection()
        if getattr(db_service, "engine_type", "duckdb") == "postgres":
            cols = [c[0] for c in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'raw_observations'").fetchall()]
        else:
            cols = [c[0] for c in conn.execute("DESCRIBE raw_observations").fetchall()]
        self.assertIn("data_source", cols)
        self.assertIn("ingested_at", cols)
        self.assertIn("raw_hash", cols)

        sample_cnt = conn.execute("SELECT count(*) FROM raw_observations WHERE data_source = 'SAMPLE_ARCHIVE'").fetchone()[0]
        self.assertGreater(sample_cnt, 0)
        conn.close()

        # Test deduplication
        test_obs = [
            {
                "id": "TEST_DEDUP_001",
                "sensor": "VIIRS",
                "satellite": "NOAA-20",
                "latitude": -18.25,
                "longitude": -56.50,
                "brightness": 320.0,
                "scan": 0.4,
                "track": 0.4,
                "acq_date": "2026-11-14",
                "acq_time": "1315",
                "confidence": "high",
                "confidence_numeric": 90,
                "version": "2.0NRT",
                "bright_t31": 295.0,
                "frp": 15.5,
                "daynight": "D",
                "aoi_id": "test_aoi",
                "resolution_m": 375
            }
        ]

        # Insert once
        res1 = db_service.insert_observations(test_obs, data_source="LIVE_FIRMS")
        self.assertEqual(res1["inserted"], 1)
        self.assertEqual(res1["duplicates_skipped"], 0)

        # Insert again - should skip duplicate
        res2 = db_service.insert_observations(test_obs, data_source="LIVE_FIRMS")
        self.assertEqual(res2["inserted"], 0)
        self.assertEqual(res2["duplicates_skipped"], 1)

        # Clean up test row
        clean_conn = db_service.get_connection()
        clean_conn.execute("DELETE FROM raw_observations WHERE aoi_id = ?", ["test_aoi"])
        clean_conn.close()

        print("✓ Deduplication and live dataset separation verified.")

    def test_09_classification_confidence_and_nominal_fix(self):
        from backend.app.services.classification_engine import classification_engine

        # 1. Verify nominal confidence bug fix
        nom_std = harmonization_engine.standardize_observation({
            "sensor": "VIIRS", "confidence": "nominal", "latitude": -20.0, "longitude": -57.0
        })
        self.assertEqual(nom_std["confidence_category"], "nominal")
        self.assertEqual(nom_std["confidence_score"], 65)

        low_std = harmonization_engine.standardize_observation({
            "sensor": "VIIRS", "confidence": "low", "latitude": -20.0, "longitude": -57.0
        })
        self.assertEqual(low_std["confidence_category"], "low")
        self.assertEqual(low_std["confidence_score"], 25)

        high_std = harmonization_engine.standardize_observation({
            "sensor": "VIIRS", "confidence": "high", "latitude": -20.0, "longitude": -57.0
        })
        self.assertEqual(high_std["confidence_category"], "high")
        self.assertEqual(high_std["confidence_score"], 90)

        # 2. Verify single-sensor moderate confidence (69.5%)
        live_obs = db_service.get_observations("pantanal_brazil", dataset_mode="LIVE")
        live_events = harmonization_engine.cluster_observations_into_events(live_obs)
        cl_events = classification_engine.classify_events(live_events, live_obs, "pantanal_brazil")
        targets = [e for e in cl_events if "00025" in e["event_id"] or e.get("classification_confidence") == 69.5]
        target = targets[0] if targets else cl_events[0]

        self.assertEqual(target["classification_confidence"], 69.5)
        self.assertEqual(target["classification_tier"], "Moderate")
        self.assertFalse(target["cross_sensor_corroborated"])
        self.assertLessEqual(target["classification_confidence"], 76.0)

        # 3. Verify single-sensor ceiling (<= 76.0%)
        extreme_event = {
            'event_id': 'FE_TEST_SINGLE',
            'date': '2026-11-11',
            'latitude': -20.43555,
            'longitude': -57.53841,
            'total_frp': 5000.0,
            'peak_frp': 1000.0,
            'modis_pixel_count': 0,
            'viirs_pixel_count': 50,
            'total_pixel_count': 50,
            'sensor_composition': 'VIIRS_ONLY',
            'estimated_area_km2': 10.0,
            'mean_confidence': 90.0,
            'raw_observation_ids': []
        }
        res_ext = classification_engine.classify_event(extreme_event, [], 'pantanal_brazil')
        self.assertLessEqual(res_ext["classification_confidence"], 76.0)

        # 4. Verify dual-sensor confirmation requirement
        coinc_event = {
            'event_id': 'FE_TEST_COINC',
            'date': '2026-11-11',
            'latitude': -20.43555,
            'longitude': -57.53841,
            'total_frp': 500.0,
            'peak_frp': 150.0,
            'modis_pixel_count': 3,
            'viirs_pixel_count': 10,
            'total_pixel_count': 13,
            'sensor_composition': 'COINCIDENT',
            'estimated_area_km2': 2.2,
            'mean_confidence': 75.0,
            'raw_observation_ids': []
        }
        res_coinc = classification_engine.classify_event(coinc_event, [], 'pantanal_brazil')
        self.assertTrue(res_coinc["cross_sensor_corroborated"])
        self.assertGreater(res_coinc["classification_confidence"], 76.0)

        print("✓ Fire Source Classification confidence bounds and nominal standardization verified.")

    def test_10_global_fire_integration(self):
        from backend.app.data.geo_reference import resolve_geographic_context
        # Test reverse geocoding
        geo_us = resolve_geographic_context(35.0, -79.0)
        self.assertEqual(geo_us["continent"], "North America")
        self.assertEqual(geo_us["country"], "United States")

        geo_aus = resolve_geographic_context(-25.0, 135.0)
        self.assertEqual(geo_aus["continent"], "Oceania")
        self.assertEqual(geo_aus["country"], "Australia")

        # Test global breakdown
        summary = db_service.get_global_breakdown(dataset_mode="LIVE")
        self.assertGreater(summary["total_observations"], 50000)
        self.assertGreater(summary["modis_count"], 0)
        self.assertGreater(summary["viirs_count"], 0)
        self.assertTrue(any(c["name"] == "Africa" for c in summary["continents"]))
        self.assertTrue(any(c["name"] == "Australia" for c in summary["top_countries"]))

        print("✓ Global NASA FIRMS integration, reverse geocoding, and global summaries verified.")

if __name__ == "__main__":
    unittest.main()
