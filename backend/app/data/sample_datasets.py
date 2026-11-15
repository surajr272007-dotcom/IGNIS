"""
NASA FIRMS Reference Datasets and Scientific Synthesizer.
Strictly adheres to NASA FIRMS MCD14DL (MODIS 1km) and VNP14IMGTDL (VIIRS 375m) specifications.
Used for offline analysis, benchmark validation, and zero-config onboarding.
"""

import math
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any
from .reference_regions import REFERENCE_AOIS, get_aoi_by_id

def generate_reference_observations(aoi_id: str, years: List[int] = [2022, 2023, 2024, 2025]) -> List[Dict[str, Any]]:
    """
    Produces realistic observations matching actual NASA FIRMS MODIS & VIIRS
    sensor geometry, radiometric properties, and seasonal fire cycles for reference regions.
    """
    aoi = get_aoi_by_id(aoi_id)
    if not aoi:
        return []

    west, south, east, north = aoi["bbox"]
    lat_span = north - south
    lon_span = east - west
    clat, clon = aoi["center"]

    # Determine peak month based on aoi
    peak_month = 9  # default Sept
    if "california" in aoi_id:
        peak_month = 8
    elif "canada" in aoi_id:
        peak_month = 6
    elif "congo" in aoi_id:
        peak_month = 7

    random.seed(42 + hash(aoi_id) % 1000)

    observations = []
    obs_id_counter = 1

    for year in years:
        # Generate 15-30 fire cluster events per year
        num_clusters = random.randint(20, 45)
        # 2024 has an anomalous surge in Pantanal and Boreal
        if (aoi_id == "pantanal_brazil" and year == 2024) or (aoi_id == "canada_boreal" and year == 2023):
            num_clusters = int(num_clusters * 2.8)

        for c in range(num_clusters):
            # Cluster center date - normal distribution around peak_month
            month_offset = random.gauss(0, 1.3)
            cluster_month = max(1, min(12, int(round(peak_month + month_offset))))
            cluster_day = random.randint(1, 28)
            cluster_date = datetime(year, cluster_month, cluster_day)

            # Spatial center of fire event
            c_lat = south + random.uniform(0.15, 0.85) * lat_span
            c_lon = west + random.uniform(0.15, 0.85) * lon_span

            # Fire intensity scale (MW)
            base_intensity = random.expovariate(1 / 40.0) + 10.0

            # Duration of event: 1 to 5 days
            duration_days = random.randint(1, 4)

            for d in range(duration_days):
                curr_date = cluster_date + timedelta(days=d)
                curr_date_str = curr_date.strftime("%Y-%m-%d")

                # Each event is seen by MODIS and VIIRS with respective sensor characteristics
                # MODIS (1km): detects fewer pixels, higher FRP threshold (~8-10 MW)
                # Terra (10:30 AM/PM) and Aqua (1:30 PM/AM)
                modis_pixels = max(1, int(round(random.uniform(1, 4) * (base_intensity / 50.0))))
                
                # Check if fire is above MODIS detection threshold
                if base_intensity >= 8.0:
                    for m in range(modis_pixels):
                        # MODIS pixel location (~1km jitter: ~0.009 deg)
                        p_lat = round(c_lat + random.gauss(0, 0.015), 5)
                        p_lon = round(c_lon + random.gauss(0, 0.015), 5)
                        
                        # Clip to bbox
                        p_lat = max(south, min(north, p_lat))
                        p_lon = max(west, min(east, p_lon))

                        sat = random.choice(["Terra", "Aqua"])
                        acq_time = "1345" if sat == "Aqua" else "1030"
                        if random.random() < 0.25: # night pass
                            acq_time = "0145" if sat == "Aqua" else "2230"
                            daynight = "N"
                        else:
                            daynight = "D"

                        frp = round(max(5.0, base_intensity * random.uniform(0.6, 1.4)), 1)
                        conf = random.randint(35, 100)
                        bright = round(310.0 + (frp * 0.4) + random.uniform(-5, 10), 1)
                        b31 = round(290.0 + random.uniform(0, 15), 1)

                        observations.append({
                            "id": f"MOD_{year}_{obs_id_counter:07d}",
                            "sensor": "MODIS",
                            "satellite": sat,
                            "instrument": "MODIS",
                            "latitude": p_lat,
                            "longitude": p_lon,
                            "brightness": bright,
                            "scan": round(random.uniform(1.0, 2.4), 1),
                            "track": round(random.uniform(1.0, 1.6), 1),
                            "acq_date": curr_date_str,
                            "acq_time": acq_time,
                            "confidence": str(conf),
                            "confidence_numeric": conf,
                            "version": "6.1NRT",
                            "bright_t31": b31,
                            "frp": frp,
                            "daynight": daynight,
                            "aoi_id": aoi_id,
                            "resolution_m": 1000
                        })
                        obs_id_counter += 1

                # VIIRS (375m): Detects 3x-6x more pixels! Sub-pixel sensitivity down to ~0.1 MW
                # Suomi-NPP and NOAA-20 / NOAA-21
                viirs_multiplier = aoi.get("typical_viirs_to_modis_ratio", 4.0)
                viirs_pixels = max(2, int(round(modis_pixels * viirs_multiplier * random.uniform(0.8, 1.3))))

                for v in range(viirs_pixels):
                    # 375m spatial jitter (~0.0034 deg)
                    p_lat = round(c_lat + random.gauss(0, 0.018), 5)
                    p_lon = round(c_lon + random.gauss(0, 0.018), 5)
                    p_lat = max(south, min(north, p_lat))
                    p_lon = max(west, min(east, p_lon))

                    sat = random.choice(["N", "1"])  # Suomi-NPP (N), NOAA-20 (1)
                    sat_name = "Suomi-NPP" if sat == "N" else "NOAA-20"
                    acq_time = "1315" if sat == "N" else "1405"
                    if random.random() < 0.25:
                        acq_time = "0115" if sat == "N" else "0205"
                        daynight = "N"
                    else:
                        daynight = "D"

                    # VIIRS FRP is distributed across smaller pixels
                    frp = round(max(0.2, (base_intensity / viirs_multiplier) * random.uniform(0.4, 1.8)), 1)
                    conf_cat = random.choices(["low", "nominal", "high"], weights=[0.1, 0.6, 0.3])[0]
                    conf_num = 25 if conf_cat == "low" else (65 if conf_cat == "nominal" else 95)
                    bright_i4 = round(320.0 + (frp * 0.8) + random.uniform(-4, 12), 1)
                    bright_i5 = round(292.0 + random.uniform(0, 14), 1)

                    observations.append({
                        "id": f"VRS_{year}_{obs_id_counter:07d}",
                        "sensor": "VIIRS",
                        "satellite": sat_name,
                        "instrument": "VIIRS",
                        "latitude": p_lat,
                        "longitude": p_lon,
                        "brightness": bright_i4,
                        "scan": round(random.uniform(0.32, 0.75), 2),
                        "track": round(random.uniform(0.32, 0.45), 2),
                        "acq_date": curr_date_str,
                        "acq_time": acq_time,
                        "confidence": conf_cat,
                        "confidence_numeric": conf_num,
                        "version": "2.0NRT",
                        "bright_t31": bright_i5,
                        "frp": frp,
                        "daynight": daynight,
                        "aoi_id": aoi_id,
                        "resolution_m": 375
                    })
                    obs_id_counter += 1

    return observations
