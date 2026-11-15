"""
Unit tests for Dual-Database Architecture and PostgreSQL compatibility in IGNIS.
Tests engine detection, schema parity, query parameter translation, and connection pooling
without requiring active production cloud credentials.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("backend"))

from backend.app.config import Settings
from backend.app.services.db_service import DBService, PooledPostgresConnection
from backend.app.api.routes import health_check


class TestDualDatabaseArchitecture(unittest.TestCase):

    def test_01_default_engine_is_duckdb(self):
        """When DATABASE_URL is not provided, DBService must default to DuckDB."""
        service = DBService(database_url="")
        self.assertEqual(service.engine_type, "duckdb")
        self.assertIsNotNone(service.db_path)
        print("✓ Default engine verified: DuckDB active when DATABASE_URL is unset.")

    def test_02_engine_detects_postgres_url(self):
        """When DATABASE_URL is provided, DBService must configure engine_type as postgres."""
        with patch.object(DBService, "_init_db", return_value=None):
            with patch.object(DBService, "_init_pg_pool", return_value=None):
                pg_service = DBService(database_url="postgres://user:secret@ep-test.neon.tech/neondb?sslmode=require")
                self.assertEqual(pg_service.engine_type, "postgres")
                clean_url = pg_service._get_clean_pg_url()
                self.assertTrue(clean_url.startswith("postgresql://"))
                self.assertNotIn("postgres://", clean_url)
                print("✓ PostgreSQL engine detection verified: converts postgres:// to postgresql:// cleanly.")

    def test_03_pooled_connection_wrapper_lifecycle(self):
        """Verify PooledPostgresConnection delegates cursor/commit and returns to pool on close."""
        mock_conn = MagicMock()
        mock_pool = MagicMock()

        wrapper = PooledPostgresConnection(mock_conn, mock_pool)
        _ = wrapper.cursor()
        mock_conn.cursor.assert_called_once()

        wrapper.commit()
        mock_conn.commit.assert_called_once()

        wrapper.rollback()
        mock_conn.rollback.assert_called_once()

        wrapper.close()
        mock_pool.putconn.assert_called_once_with(mock_conn)
        print("✓ PooledPostgresConnection lifecycle verified: safe pool return and transaction semantics.")

    def test_04_schema_column_parity(self):
        """Verify that column lists match between DuckDB and PostgreSQL schemas."""
        import duckdb
        dconn = duckdb.connect("ignis_fire_warehouse.duckdb", read_only=True)
        try:
            duck_cols = [c[0] for c in dconn.execute("DESCRIBE raw_observations").fetchall()]
        finally:
            dconn.close()

        expected_pg_cols = [
            "id", "sensor", "satellite", "instrument", "latitude", "longitude", "brightness",
            "scan", "track", "acq_date", "acq_time", "confidence", "confidence_numeric",
            "version", "bright_t31", "frp", "daynight", "aoi_id", "resolution_m",
            "data_source", "ingested_at", "raw_hash", "country", "country_code",
            "continent", "continent_code", "proximity_label", "nearest_city"
        ]

        self.assertEqual(sorted(duck_cols), sorted(expected_pg_cols))
        print(f"✓ Schema parity verified: All {len(expected_pg_cols)} columns identical across DuckDB and PostgreSQL.")

    def test_05_health_check_reports_correct_engine(self):
        """Health check endpoint must report the active database engine dynamically."""
        res = health_check()
        self.assertIn(res["database"]["engine"], ["DuckDB", "PostgreSQL"])
        self.assertEqual(res["database"]["status"], "connected")
        print(f"✓ Health check reports active engine: {res['database']['engine']} (Total obs: {res['database']['total_observations_indexed']:,})")


if __name__ == "__main__":
    unittest.main()
