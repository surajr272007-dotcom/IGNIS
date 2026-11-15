# IGNIS — Production Deployment Guide

This guide describes how to deploy the **IGNIS** FastAPI backend to production on **Render Free** using **Neon Serverless PostgreSQL** (100% Free Cloud Tier, no paid persistent disks required) and connect it to the production frontend deployed on Vercel (`https://frontend-umber-seven-wx9eyyluh5.vercel.app`).

---

## 1. Architecture Overview

- **Backend Framework**: FastAPI (Python 3.11+)
- **Application Entry Point**: `backend.app.main:app`
- **Database Engine**:
  - **Production**: Neon Serverless PostgreSQL (loaded dynamically via `DATABASE_URL`)
  - **Local Development**: Embedded DuckDB (fallback when `DATABASE_URL` is unset)
- **Frontend Target**: Vercel (`https://frontend-umber-seven-wx9eyyluh5.vercel.app`)

---

## 2. Production Start Command

Because production connects to Neon PostgreSQL with connection pooling (`psycopg2.pool.ThreadedConnectionPool`), Render can run cleanly with Uvicorn:

### Render Build & Start Commands
- **Build Command**:
  ```bash
  pip install -r backend/requirements.txt
  ```
- **Start Command**:
  ```bash
  uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT --workers 1
  ```

---

## 3. Required Environment Variables on Render

Configure these environment variables in your Render Web Service dashboard (**Environment** tab):

| Variable | Required | Default Value | Description |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | **Critical** | *(Secret)* | Your Neon PostgreSQL connection string (`postgresql://neondb_owner:...@ep-...neon.tech/neondb?sslmode=require`). Automatically switches backend from DuckDB to PostgreSQL. |
| `FIRMS_MAP_KEY` | Yes | *(Secret)* | Your 32-character NASA FIRMS MAP KEY for live satellite queries. |
| `ENVIRONMENT` | Yes | `production` | Sets runtime mode to production. |
| `NASA_FIRMS_BASE_URL` | No | `https://firms.modaps.eosdis.nasa.gov` | Base URL for the NASA FIRMS API. |
| `CORS_ORIGINS` | No | `https://frontend-umber-seven-wx9eyyluh5.vercel.app` | Allowed CORS origins for the Vercel frontend. |

> **Security Note**: Never commit, log, or print `DATABASE_URL` or `FIRMS_MAP_KEY`. Configure them strictly as encrypted Environment Variables in the Render dashboard.

---

## 4. Render Free Deployment Steps (100% Free)

1. **Log in to [Render](https://render.com/)** and click **New +** → **Web Service**.
2. **Connect your GitHub repository**: `surajr272007-dotcom/IGNIS`.
3. Configure the service settings:
   - **Name**: `ignis-backend` (or your choice)
   - **Region**: Closest to your Neon project (e.g., Oregon, Frankfurt, or Singapore)
   - **Branch**: `main`
   - **Root Directory**: Leave blank (root of repository)
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT --workers 1`
   - **Instance Type**: `Free`
4. Add the **Environment Variables**:
   - `DATABASE_URL` = *(Your Neon PostgreSQL connection string)*
   - `FIRMS_MAP_KEY` = *(Your NASA FIRMS key)*
   - `ENVIRONMENT` = `production`
   - `CORS_ORIGINS` = `https://frontend-umber-seven-wx9eyyluh5.vercel.app`
5. Click **Create Web Service**. Render will automatically clone, install dependencies, and launch IGNIS.
6. Verify your live backend health:
   - Root Health Probe: `https://<your-render-app>.onrender.com/health`
   - Diagnostic API Probe: `https://<your-render-app>.onrender.com/api/health`
   Both should report `"database_engine": "PostgreSQL"` and HTTP 200 OK.

---

## 5. Connecting Frontend on Vercel

Once Render provides your backend URL (e.g. `https://ignis-backend.onrender.com`):

1. Go to your **[Vercel Dashboard](https://vercel.com/)** → Project: `frontend` (`frontend-umber-seven-wx9eyyluh5`).
2. Navigate to **Settings** → **Environment Variables**.
3. Add / Edit the following variable:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://<your-render-app>.onrender.com/api`
4. Go to the **Deployments** tab, click **...** on the latest deployment, and click **Redeploy** (or trigger a new build).
5. Open `https://frontend-umber-seven-wx9eyyluh5.vercel.app` — the 3D globe, live fire hotspots, AOI filters, and harmonization queries will now stream live from the cloud Neon database.

---

## 6. Health Check Endpoints

The backend provides two health endpoints for cloud monitoring:

1. **Root Health Check (`/health`)**:
   - `GET https://<your-backend-domain>/health`
   - Returns:
     ```json
     {
       "status": "healthy",
       "service": "IGNIS — Beyond the Hotspot",
       "version": "1.0.0",
       "database_engine": "PostgreSQL",
       "api_health": "/api/health"
     }
     ```
2. **Detailed Health Check (`/api/health`)**:
   - `GET https://<your-backend-domain>/api/health`
   - Returns total observation counts, dataset mode, active database connection, and NASA FIRMS API status.
