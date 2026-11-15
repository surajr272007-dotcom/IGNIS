"""
IGNIS Sensor Harmonization Engine Unit & Verification Test Suite
Tests:
1. Spatiotemporal matching (geodesic distance + UTC timestamp coincidence)
2. Spatial non-matching (> threshold distance)
3. Temporal non-matching (> threshold hours)
4. Duplicate prevention (mutually exclusive assignment of VIIRS to closest MODIS)
5. Unmatched observation preservation (MODIS-only and VIIRS-only)
6. 100% exact mathematical conservation of raw observations
7. Real NASA FIRMS dataset harmonization (Pantanal and Global)
"""

import unittest
import sys
import os
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))

from backend.app.services.harmonization_engine import HarmonizationEngine, haversine_distance_km
from backend.app.services.db_service import db_service

class TestSensorHarmonization(unittest.TestCase):
    def setUp(self):
        self.engine = HarmonizationEngine(spatial_threshold_km=1.5, temporal_threshold_hours=2.5)

    def test_01_geodesic_distance_accuracy(self):
        # Known geodesic distance: -16.0, -56.0 to -16.01, -56.01 is 1.542 km
        dist = haversine_distance_km(-16.0, -56.0, -16.01, -56.01)
        self.assertAlmostEqual(dist, 1.542, places=2)
        # Same point
        self.assertEqual(haversine_distance_km(-16.0, -56.0, -16.0, -56.0), 0.0)

    def test_02_spatiotemporal_match_success(self):
        # MODIS at 13:00 UTC, VIIRS at 13:30 UTC, 0.4 km apart -> MUST MATCH
        obs = [
            {
                "id": "M1", "sensor": "MODIS", "satellite": "Aqua", "latitude": -16.500, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1300", "frp": 25.0, "confidence": "85"
            },
            {
                "id": "V1", "sensor": "VIIRS", "satellite": "NOAA-20", "latitude": -16.503, "longitude": -56.502,
                "acq_date": "2026-11-14", "acq_time": "1330", "frp": 15.0, "confidence": "high"
            }
        ]
        events, metrics = self.engine.harmonize_observations(obs)
        self.assertEqual(len(events), 1)
        ev = events[0]
        self.assertEqual(ev["harmonization_type"], "DUAL_SENSOR_COINCIDENT")
        self.assertEqual(ev["modis_pixel_count"], 1)
        self.assertEqual(ev["viirs_pixel_count"], 1)
        self.assertEqual(ev["primary_modis_id"], "M1")
        self.assertEqual(ev["primary_viirs_id"], "V1")
        self.assertLessEqual(ev["spatial_offset_km"], 0.6)
        self.assertEqual(ev["temporal_offset_min"], 30.0)
        self.assertEqual(metrics["coincident_events"], 1)
        self.assertEqual(metrics["exact_conservation_verified"], True)

    def test_03_spatial_non_match(self):
        # Same time (13:00 UTC), but 5.0 km apart (> 1.5 km) -> MUST NOT MATCH
        obs = [
            {
                "id": "M1", "sensor": "MODIS", "satellite": "Aqua", "latitude": -16.500, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1300", "frp": 25.0, "confidence": "85"
            },
            {
                "id": "V1", "sensor": "VIIRS", "satellite": "NOAA-20", "latitude": -16.545, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1300", "frp": 15.0, "confidence": "high"
            }
        ]
        events, metrics = self.engine.harmonize_observations(obs)
        self.assertEqual(len(events), 2)
        types = {e["harmonization_type"] for e in events}
        self.assertEqual(types, {"MODIS_ONLY", "VIIRS_ONLY"})
        self.assertEqual(metrics["coincident_events"], 0)
        self.assertEqual(metrics["modis_only_events"], 1)
        self.assertEqual(metrics["viirs_only_events"], 1)
        self.assertEqual(metrics["exact_conservation_verified"], True)

    def test_04_temporal_non_match(self):
        # Same location, but 4.0 hours apart (> 2.5 hours) -> MUST NOT MATCH
        obs = [
            {
                "id": "M1", "sensor": "MODIS", "satellite": "Aqua", "latitude": -16.500, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1000", "frp": 25.0, "confidence": "85"
            },
            {
                "id": "V1", "sensor": "VIIRS", "satellite": "NOAA-20", "latitude": -16.500, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1400", "frp": 15.0, "confidence": "high"
            }
        ]
        events, metrics = self.engine.harmonize_observations(obs)
        self.assertEqual(len(events), 2)
        types = {e["harmonization_type"] for e in events}
        self.assertEqual(types, {"MODIS_ONLY", "VIIRS_ONLY"})
        self.assertEqual(metrics["coincident_events"], 0)
        self.assertEqual(metrics["exact_conservation_verified"], True)

    def test_05_duplicate_prevention_nearest_neighbor(self):
        # 1 VIIRS pixel close to 2 MODIS pixels: M1 at 0.3 km, M2 at 1.1 km.
        # VIIRS must match ONLY to M1. M2 becomes MODIS_ONLY. No double-counting!
        obs = [
            {
                "id": "M1", "sensor": "MODIS", "satellite": "Aqua", "latitude": -16.500, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1300", "frp": 30.0, "confidence": "85"
            },
            {
                "id": "M2", "sensor": "MODIS", "satellite": "Aqua", "latitude": -16.510, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1300", "frp": 20.0, "confidence": "70"
            },
            {
                "id": "V1", "sensor": "VIIRS", "satellite": "NOAA-20", "latitude": -16.502, "longitude": -56.500,
                "acq_date": "2026-11-14", "acq_time": "1305", "frp": 12.0, "confidence": "high"
            }
        ]
        events, metrics = self.engine.harmonize_observations(obs)
        self.assertEqual(len(events), 2)
        
        coincident_events = [e for e in events if e["harmonization_type"] == "DUAL_SENSOR_COINCIDENT"]
        modis_only_events = [e for e in events if e["harmonization_type"] == "MODIS_ONLY"]
        
        self.assertEqual(len(coincident_events), 1)
        self.assertEqual(len(modis_only_events), 1)
        
        # Coincident event has M1 and V1
        self.assertEqual(coincident_events[0]["primary_modis_id"], "M1")
        self.assertEqual(coincident_events[0]["primary_viirs_id"], "V1")
        # MODIS-only event has M2
        self.assertEqual(modis_only_events[0]["primary_modis_id"], "M2")
        
        # Verify conservation: 2 MODIS + 1 VIIRS = 3 observations accounted for exactly once
        self.assertEqual(metrics["matched_modis_count"], 1)
        self.assertEqual(metrics["matched_viirs_count"], 1)
        self.assertEqual(metrics["modis_only_events"], 1)
        self.assertEqual(metrics["exact_conservation_verified"], True)

    def test_06_exact_conservation_real_pantanal_data(self):
        # Test on genuine NASA FIRMS Live observations in Pantanal
        live_obs = db_service.get_observations("pantanal_brazil", dataset_mode="LIVE")
        self.assertGreater(len(live_obs), 0)
        
        events, metrics = self.engine.harmonize_observations(live_obs)
        self.assertEqual(metrics["exact_conservation_verified"], True)
        
        modis_raw_count = sum(1 for o in live_obs if o.get("sensor") == "MODIS")
        viirs_raw_count = sum(1 for o in live_obs if o.get("sensor") == "VIIRS")
        self.assertEqual(modis_raw_count, 18)
        self.assertEqual(viirs_raw_count, 159)
        
        self.assertEqual(metrics["modis_observations"], modis_raw_count)
        self.assertEqual(metrics["viirs_observations"], viirs_raw_count)
        self.assertEqual(metrics["matched_modis_count"] + metrics["modis_only_events"], modis_raw_count)
        self.assertEqual(metrics["matched_viirs_count"] + metrics["viirs_only_events"], viirs_raw_count)
        
        print("✓ Pantanal LIVE FIRMS exact conservation verified:")
        print(f"   Coincident: {metrics['coincident_events']}, MODIS-only: {metrics['modis_only_events']}, VIIRS-only: {metrics['viirs_only_events']}")
        print(f"   Mean spatial offset: {metrics['sensor_agreement']['mean_spatial_offset_km']} km, Mean temporal delta: {metrics['sensor_agreement']['mean_temporal_offset_min']} min")

    def test_07_configurable_thresholds(self):
        # Test with tight thresholds (0.5 km, 30 min) vs wide thresholds (3.0 km, 6 hours)
        tight_engine = HarmonizationEngine(spatial_threshold_km=0.5, temporal_threshold_hours=0.5)
        wide_engine = HarmonizationEngine(spatial_threshold_km=3.0, temporal_threshold_hours=6.0)
        
        live_obs = db_service.get_observations("pantanal_brazil", dataset_mode="LIVE")
        _, tight_metrics = tight_engine.harmonize_observations(live_obs)
        _, wide_metrics = wide_engine.harmonize_observations(live_obs)
        
        self.assertLessEqual(tight_metrics["coincident_events"], wide_metrics["coincident_events"])
        self.assertEqual(tight_metrics["exact_conservation_verified"], True)
        self.assertEqual(wide_metrics["exact_conservation_verified"], True)
        print(f"✓ Configurable thresholds verified: Coincident events range from {tight_metrics['coincident_events']} (tight) to {wide_metrics['coincident_events']} (wide).")

if __name__ == "__main__":
    unittest.main()
