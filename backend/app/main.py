"""
IGNIS — Beyond the Hotspot
NASA Space Apps Challenge 2026
FastAPI Backend Application Entrypoint
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .api.routes import api_router

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description=(
        "Harmonization of NASA MODIS and VIIRS Active-Fire Observations "
        "into a consistent, scientifically responsible burning-activity calendar."
    )
)

# Configure CORS for local development, production Vercel frontend, and configurable origins
cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://frontend-umber-seven-wx9eyyluh5.vercel.app"
]

if isinstance(settings.CORS_ORIGINS, list):
    for origin in settings.CORS_ORIGINS:
        if origin and origin not in cors_origins:
            cors_origins.append(origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .services.db_service import db_service

app.include_router(api_router, prefix="/api")

@app.get("/")
def root():
    return {
        "project": "IGNIS — BEYOND THE HOTSPOT",
        "description": "Harmonization of MODIS and VIIRS Hot Spots",
        "nasa_challenge": "NASA Space Apps Challenge 2026",
        "documentation": "/docs",
        "health_endpoint": "/health",
        "api_health_endpoint": "/api/health"
    }

@app.get("/health")
def health_check_root():
    """Safe root health check endpoint for cloud load balancers and container probes."""
    engine_name = "PostgreSQL" if getattr(db_service, "engine_type", "duckdb") == "postgres" else "DuckDB"
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "version": settings.VERSION,
        "database_engine": engine_name,
        "api_health": "/api/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
