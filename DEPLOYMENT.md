# IGNIS — Production Deployment Guide

This guide describes how to deploy the **IGNIS** FastAPI backend to production on a hosted Python platform (such as Render, Railway, Fly.io, or AWS/GCP with persistent volumes) and connect it to the production frontend deployed on Vercel (`https://frontend-umber-seven-wx9eyyluh5.vercel.app`).

---

## 1. Architecture Overview

- **Backend Framework**: FastAPI (Python 3.11+)
- **Application Entry Point**: `backend.app.main:app`
- **Database Engine**: Embedded DuckDB (Columnar OLAP with spatial and temporal queries)
- **Frontend Target**: Vercel (`https://frontend-umber-seven-wx9eyyluh5.vercel.app`)

---

## 2. Production Start Command

Because DuckDB is an embedded database that manages its own file locks, the production server should run with **1 worker** (`--workers 1`). This allows asynchronous concurrency via Uvicorn while preventing multi-process lock contention on the `.duckdb` database file:

### Standard Uvicorn Start Command
```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
```

### Alternatively with Gunicorn (Process Manager with Uvicorn Worker)
```bash
gunicorn -w 1 -k uvicorn.workers.UvicornWorker backend.app.main:app --bind 0.0.0.0:${PORT:-8000}
```

---

## 3. Required Environment Variables

Configure these environment variables in your hosting provider's dashboard:

| Variable | Required | Default Value | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | Auto | `8000` | Port assigned by hosting provider (Render, Railway, etc.). |
| `ENVIRONMENT` | Yes | `production` | Sets runtime mode to production. |
| `FIRMS_MAP_KEY` | Yes | *(Secret)* | Your 32-character NASA FIRMS MAP KEY for live satellite queries. |
| `NASA_FIRMS_BASE_URL` | No | `https://firms.modaps.eosdis.nasa.gov` | Base URL for the NASA FIRMS API. |
| `DUCKDB_PATH` | **Critical** | `/data/ignis_warehouse.duckdb` | Path to the DuckDB database file on a **persistent disk volume**. |
| `CORS_ORIGINS` | No | `https://frontend-umber-seven-wx9eyyluh5.vercel.app` | Comma-separated or JSON list of additional allowed CORS origins. |

> **Security Note**: Never commit or print the `FIRMS_MAP_KEY` value in code or repository logs. Configure it strictly as an encrypted secret in the host dashboard.

---

## 4. Database Persistence Requirements

### Why Persistent Disk Storage is Required
DuckDB stores all tabular fire observations in a local file (`.duckdb`). In cloud environments:
1. **Ephemeral Containers (Default Cloud Run, Heroku dynos, serverless functions)**: 
   - Filesystem changes are discarded when the container restarts or scales to zero.
   - Any live NASA FIRMS observations ingested by users would be lost upon restart.
2. **Persistent Disk Volumes (Render Disks, Railway Volumes, Fly.io Volumes, EBS/Persistent Disks)**:
   - Preserves all ingested observations across deploys, reboots, and restarts.
   - Mount a persistent volume at a dedicated mount path (e.g., `/data`).
   - Set the environment variable: `DUCKDB_PATH=/data/ignis_warehouse.duckdb`.

### Automatic Schema & Seed Initialization
If deployed to a brand-new persistent disk where the database file does not yet exist:
- The backend's `db_service._init_db()` automatically provisions all tables (`aoi_registry`, `raw_observations`, `ingestion_history`).
- It automatically seeds the baseline reference fire archive so the dashboard is immediately operational.
- Existing databases uploaded or transferred will be migrated automatically if new columns are present.

---

## 5. Health Check Endpoints

The backend provides two health endpoints:

1. **Root Health Check (`/health`)**:
   - `GET https://<your-backend-domain>/health`
   - Lightweight status check returning HTTP 200:
     ```json
     {
       "status": "healthy",
       "service": "IGNIS — Beyond the Hotspot",
       "version": "1.0.0",
       "api_health": "/api/health"
     }
     ```
   - Ideal for cloud provider health probes (Render, Railway, AWS ALB, Kubernetes).

2. **Diagnostic API Health Check (`/api/health`)**:
   - `GET https://<your-backend-domain>/api/health`
   - Returns detailed database status, observation index counts, and NASA FIRMS configuration state.

---

## 6. Frontend Configuration on Vercel

In your Vercel Project Settings for `frontend-umber-seven-wx9eyyluh5.vercel.app`:

1. Navigate to **Project Settings** → **Environment Variables**.
2. Add:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://<your-backend-domain>/api` (e.g., `https://ignis-backend.onrender.com/api`)
3. Redeploy the Vercel frontend so it builds with the production backend endpoint.

---

## 7. Recommended Hosting Providers

### Option A: Render (Web Service + Disk)
1. Create a **Web Service** connected to your GitHub repository:
   - **Root Directory**: `backend` (or root with `backend.app.main:app`)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT --workers 1`
2. Under **Disks**, add a Persistent Disk:
   - **Name**: `ignis-data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB – 5 GB
3. Set Environment Variables:
   - `DUCKDB_PATH`: `/data/ignis_warehouse.duckdb`
   - `FIRMS_MAP_KEY`: `[Your NASA FIRMS Key]`
   - `ENVIRONMENT`: `production`

### Option B: Railway (Service + Volume)
1. Deploy from GitHub repo.
2. Add a **Volume** mounted at `/data`.
3. Set variables:
   - `DUCKDB_PATH`: `/data/ignis_warehouse.duckdb`
   - `FIRMS_MAP_KEY`: `[Your NASA FIRMS Key]`
   - `PORT`: (provided by Railway)
4. Start Command: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT --workers 1`.
