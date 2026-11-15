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

# Configure CORS for local development and satellite frontend UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")

@app.get("/")
def root():
    return {
        "project": "IGNIS — BEYOND THE HOTSPOT",
        "description": "Harmonization of MODIS and VIIRS Hot Spots",
        "nasa_challenge": "NASA Space Apps Challenge 2026",
        "documentation": "/docs",
        "health_endpoint": "/api/health"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
