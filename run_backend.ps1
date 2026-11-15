# Run IGNIS FastAPI Backend
Write-Host "Starting IGNIS Backend Server on http://localhost:8000..." -ForegroundColor Cyan
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
