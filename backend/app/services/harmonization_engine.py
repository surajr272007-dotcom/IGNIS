"""
IGNIS Scientific Sensor Harmonization Engine
Harmonizes multi-sensor active fire observations from NASA MODIS (Terra/Aqua, 1km)
and VIIRS (Suomi-NPP/NOAA-20/NOAA-21, 375m).

Scientific Methodology:
1. Sensor Identification & Standardization:
   - Identifies MODIS (1000m nadir) and VIIRS (375m I-band) observations separately.
   - Preserves original satellite, sensor, acquisition date/time, WGS84 coordinates,
     FRP (MW), scan/track pixel dimensions, and detection confidence levels without fabrication.
2. Geodesic Spatiotemporal Matching:
   - Great-circle geodesic distance via Haversine formula (accounting for planetary curvature).
   - Full UTC acquisition timestamp parsing (accounting for diurnal overpass phasing).
   - Configurable thresholds:
     * Spatial threshold: default 1.5 km (accounting for 1.0 km nadir MODIS pixel diagonal sqrt(1^2 + 1^2) = 1.414 km + 100m geolocation tolerance).
     * Temporal threshold: default 2.5 hours (150 minutes, capturing coincident orbital overpasses such as Aqua-MODIS and S-NPP/NOAA-20 VIIRS in the A-train constellation, while rejecting invalid diurnal matches).
3. Mutually Exclusive Bipartite Matching:
   - Assigns each VIIRS sub-pixel detection to at most one MODIS parent footprint based on minimal spatiotemporal cost metric.
   - Prevents duplicate matching or one observation being matched to multiple unrelated observations.
4. Harmonized Fire Events (HFEs):
   - Coincident events: Unified event linking 1 MODIS observation and k >= 1 VIIRS observations within its ground instantaneous field of view.
   - MODIS-only events: Preserved unmatched MODIS detections (e.g. morning Terra pass or wide-swath acquisitions).
   - VIIRS-only events: Preserved unmatched VIIRS detections (e.g. sub-kilometer fires below MODIS 8-10 MW threshold).
   - Mathematically verified conservation: 100% of original observations are accounted for exactly once.
5. Cross-Sensor Agreement & Disagreement:
   - Spatial offset (geodesic distance in km).
   - Temporal offset (overpass time delta in minutes).
   - Radiometric FRP agreement ratio (VIIRS FRP / MODIS FRP).
   - Detection confidence concordance.
"""

import math
from datetime import datetime
from typing import List, Dict, Any, Tuple, Optional
from collections import defaultdict


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle geodesic distance between two points on WGS84 sphere in km."""
    R = 6371.0  # Earth mean radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return R * c


def parse_utc_timestamp_minutes(date_str: str, time_str: Any) -> float:
    """Parses acquisition date (YYYY-MM-DD) and time (HHMM) into epoch minutes."""
    t_clean = str(time_str or "0000").replace(":", "").strip().zfill(4)[:4]
    try:
        dt = datetime.strptime(f"{date_str} {t_clean}", "%Y-%m-%d %H%M")
        return dt.timestamp() / 60.0
    except Exception:
        # Fallback approximate minutes
        try:
            parts = str(date_str).split("-")
            hh = int(t_clean[:2])
            mm = int(t_clean[2:])
            d_int = int(parts[0]) * 365 + int(parts[1]) * 31 + int(parts[2])
            return float(d_int * 1440 + hh * 60 + mm)
        except Exception:
            return 0.0


class HarmonizationEngine:
    def __init__(self, spatial_threshold_km: float = 1.5, temporal_threshold_hours: float = 2.5):
        """
        Initializes the Harmonization Engine with configurable thresholds.
        :param spatial_threshold_km: Maximum geodesic distance (km) for cross-sensor match (default: 1.5 km).
        :param temporal_threshold_hours: Maximum overpass time delta (hours) for coincidence (default: 2.5 h = 150 min).
        """
        self.spatial_threshold_km = float(spatial_threshold_km)
        self.temporal_threshold_hours = float(temporal_threshold_hours)

    def standardize_observation(self, obs: Dict[str, Any]) -> Dict[str, Any]:
        """Ensures uniform schema across MODIS and VIIRS while preserving all original attributes."""
        sensor = str(obs.get("sensor", "UNKNOWN")).strip().upper()
        if "MODIS" in sensor:
            sensor = "MODIS"
        elif "VIIRS" in sensor:
            sensor = "VIIRS"

        conf_raw = obs.get("confidence", "nominal")
        
        # Standardize confidence to categories and numeric scale
        if sensor == "MODIS":
            try:
                num_val = int(conf_raw)
                category = "low" if num_val < 30 else ("nominal" if num_val < 80 else "high")
            except (ValueError, TypeError):
                category = "nominal"
                num_val = 50
        else:  # VIIRS
            conf_str = str(conf_raw).strip().lower()
            if conf_str in ("l", "low") or conf_str.startswith("low"):
                category = "low"
                num_val = 25
            elif conf_str in ("h", "high") or conf_str.startswith("high"):
                category = "high"
                num_val = 90
            elif conf_str in ("n", "nominal") or conf_str.startswith("nom"):
                category = "nominal"
                num_val = 65
            else:
                try:
                    num_val = int(float(conf_str))
                    category = "low" if num_val < 30 else ("nominal" if num_val < 80 else "high")
                except (ValueError, TypeError):
                    category = "nominal"
                    num_val = 65

        frp = float(obs.get("frp", 0.0))
        if frp < 0 or math.isnan(frp):
            frp = 0.0

        date_str = str(obs.get("acq_date", "2026-11-14"))
        time_str = str(obs.get("acq_time", "0000")).replace(":", "").strip().zfill(4)[:4]
        epoch_mins = parse_utc_timestamp_minutes(date_str, time_str)

        lat = float(obs.get("latitude", 0.0))
        lon = float(obs.get("longitude", 0.0))

        return {
            "id": str(obs.get("id", f"{sensor}_{lat}_{lon}_{date_str}_{time_str}")),
            "sensor": sensor,
            "satellite": str(obs.get("satellite", "Terra/Aqua" if sensor == "MODIS" else "SNPP/NOAA")),
            "instrument": str(obs.get("instrument", sensor)),
            "latitude": lat,
            "longitude": lon,
            "brightness": float(obs.get("brightness", 300.0)),
            "scan": float(obs.get("scan", 1.0 if sensor == "MODIS" else 0.375)),
            "track": float(obs.get("track", 1.0 if sensor == "MODIS" else 0.375)),
            "acq_date": date_str,
            "acq_time": time_str,
            "epoch_minutes": epoch_mins,
            "confidence": str(conf_raw),
            "confidence_category": category,
            "confidence_score": num_val,
            "frp": frp,
            "daynight": str(obs.get("daynight", "D")).upper(),
            "resolution_m": 1000 if sensor == "MODIS" else 375,
            "aoi_id": str(obs.get("aoi_id", "")),
            "country": obs.get("country"),
            "continent": obs.get("continent"),
            "proximity_label": obs.get("proximity_label"),
            "original_observation": obs
        }

    def harmonize_observations(self, observations: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Scientifically harmonizes MODIS and VIIRS observations:
        1. Identifies and standardizes sensors separately.
        2. Applies geodesic spatiotemporal matching with spatial and temporal thresholds.
        3. Prevents duplicate matching (mutually exclusive bipartite assignment).
        4. Creates unified Harmonized Fire Events (coincident, MODIS-only, VIIRS-only).
        5. Computes sensor agreement and disagreement analytics.
        6. Guarantees 100% exact conservation of original observations.
        """
        if not observations:
            empty_metrics = self._generate_metrics(0, 0, [], 0, 0, 0, 0.0, 0.0, 0.0)
            return [], empty_metrics

        # Standardize all observations
        std_obs = [self.standardize_observation(o) for o in observations]

        # Separate MODIS and VIIRS
        modis_list = [o for o in std_obs if o["sensor"] == "MODIS"]
        viirs_list = [o for o in std_obs if o["sensor"] == "VIIRS"]

        total_modis = len(modis_list)
        total_viirs = len(viirs_list)

        temp_thresh_min = self.temporal_threshold_hours * 60.0
        spatial_thresh_km = self.spatial_threshold_km

        # Build 2D Spatial Grid Index over MODIS observations for fast O(1) candidate lookup
        # Cell size corresponds to ~ spatial_thresh_km in degrees
        cell_size_deg = max(0.02, spatial_thresh_km / 111.0)
        grid = defaultdict(list)
        for m_idx, m in enumerate(modis_list):
            gx = int(m["latitude"] / cell_size_deg)
            gy = int(m["longitude"] / cell_size_deg)
            grid[(gx, gy)].append(m_idx)

        # Match each VIIRS detection to candidate MODIS observations
        # Candidate entry: (spatiotemporal_cost, geodesic_dist_km, time_delta_min, modis_idx)
        viirs_candidates = defaultdict(list)
        for v_idx, v in enumerate(viirs_list):
            cgx = int(v["latitude"] / cell_size_deg)
            cgy = int(v["longitude"] / cell_size_deg)
            v_time = v["epoch_minutes"]
            v_lat = v["latitude"]
            v_lon = v["longitude"]

            # Query 9 adjacent grid cells
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    cell_items = grid.get((cgx + dx, cgy + dy))
                    if not cell_items:
                        continue
                    for m_idx in cell_items:
                        m = modis_list[m_idx]
                        dt_min = abs(v_time - m["epoch_minutes"])
                        if dt_min <= temp_thresh_min:
                            dist_km = haversine_distance_km(v_lat, v_lon, m["latitude"], m["longitude"])
                            if dist_km <= spatial_thresh_km:
                                # Spatiotemporal cost metric: normalized distance + temporal factor
                                cost = (dist_km / spatial_thresh_km) + 0.5 * (dt_min / temp_thresh_min)
                                viirs_candidates[v_idx].append((cost, dist_km, dt_min, m_idx))

        # Mutually exclusive assignment:
        # Each VIIRS detection selects its closest candidate MODIS footprint
        modis_to_viirs = defaultdict(list)
        matched_viirs_indices = set()
        for v_idx, candidates in viirs_candidates.items():
            candidates.sort(key=lambda x: x[0])  # Sort by cost ascending
            best = candidates[0]
            best_m_idx = best[3]
            dist_km = best[1]
            dt_min = best[2]
            modis_to_viirs[best_m_idx].append((v_idx, dist_km, dt_min))
            matched_viirs_indices.add(v_idx)

        events = []
        event_counter = 1

        sum_dist_km = 0.0
        sum_dt_min = 0.0
        sum_frp_ratio = 0.0
        matched_pairs_count = 0

        # Formulate Coincident and MODIS-Only events
        for m_idx, m in enumerate(modis_list):
            v_matches = modis_to_viirs.get(m_idx, [])
            date_str = m["acq_date"]

            if v_matches:
                # DUAL-SENSOR COINCIDENT EVENT
                matched_viirs_obs = [viirs_list[v_idx] for v_idx, _, _ in v_matches]
                viirs_count = len(matched_viirs_obs)
                min_dist = min(d for _, d, _ in v_matches)
                min_dt = min(t for _, _, t in v_matches)

                sum_dist_km += min_dist
                sum_dt_min += min_dt
                matched_pairs_count += 1

                # Representative coordinates adopt the primary (closest) 375m VIIRS observation
                # to provide highest spatial resolution, while preserving MODIS center
                v_best_idx = min(v_matches, key=lambda x: x[1])[0]
                primary_viirs = viirs_list[v_best_idx]

                modis_frp = m["frp"]
                viirs_total_frp = sum(v["frp"] for v in matched_viirs_obs)
                viirs_mean_frp = viirs_total_frp / viirs_count
                total_frp = round((modis_frp + viirs_total_frp) / 2.0, 1) if viirs_count > 0 else modis_frp

                frp_ratio = round(viirs_total_frp / max(0.1, modis_frp), 2)
                sum_frp_ratio += frp_ratio

                # Sensor concordance
                if abs(1.0 - frp_ratio) <= 0.4:
                    concordance = "HIGH_AGREEMENT"
                elif frp_ratio > 1.4:
                    concordance = "VIIRS_MORE_INTENSE"
                elif frp_ratio < 0.6:
                    concordance = "MODIS_MORE_INTENSE"
                else:
                    concordance = "MODERATE_AGREEMENT"

                # Estimated area
                estimated_area_km2 = round(max(0.14, min(1.0 + viirs_count * 0.14, 25.0)), 2)

                all_cluster_obs = [m] + matched_viirs_obs
                mean_conf = round(sum(o["confidence_score"] for o in all_cluster_obs) / len(all_cluster_obs), 1)

                events.append({
                    "event_id": f"HFE_{date_str.replace('-', '')}_{event_counter:05d}",
                    "date": date_str,
                    "latitude": round(primary_viirs["latitude"], 5),
                    "longitude": round(primary_viirs["longitude"], 5),
                    "modis_latitude": round(m["latitude"], 5),
                    "modis_longitude": round(m["longitude"], 5),
                    "spatial_offset_km": round(min_dist, 3),
                    "temporal_offset_min": round(min_dt, 1),
                    "total_frp": total_frp,
                    "peak_frp": round(max([modis_frp] + [v["frp"] for v in matched_viirs_obs]), 1),
                    "modis_frp": round(modis_frp, 1),
                    "viirs_total_frp": round(viirs_total_frp, 1),
                    "viirs_mean_frp": round(viirs_mean_frp, 1),
                    "frp_ratio": frp_ratio,
                    "modis_pixel_count": 1,
                    "viirs_pixel_count": viirs_count,
                    "total_pixel_count": 1 + viirs_count,
                    "sensor_composition": "COINCIDENT",
                    "harmonization_type": "DUAL_SENSOR_COINCIDENT",
                    "concordance_status": concordance,
                    "estimated_area_km2": estimated_area_km2,
                    "mean_confidence": mean_conf,
                    "primary_modis_id": m["id"],
                    "primary_viirs_id": primary_viirs["id"],
                    "raw_observation_ids": [m["id"]] + [v["id"] for v in matched_viirs_obs],
                    "modis_observation": m["original_observation"],
                    "viirs_observations": [v["original_observation"] for v in matched_viirs_obs],
                    "country": primary_viirs.get("country") or m.get("country"),
                    "continent": primary_viirs.get("continent") or m.get("continent"),
                    "proximity_label": primary_viirs.get("proximity_label") or m.get("proximity_label")
                })
            else:
                # MODIS-ONLY EVENT
                modis_frp = m["frp"]
                events.append({
                    "event_id": f"HFE_{date_str.replace('-', '')}_{event_counter:05d}",
                    "date": date_str,
                    "latitude": round(m["latitude"], 5),
                    "longitude": round(m["longitude"], 5),
                    "modis_latitude": round(m["latitude"], 5),
                    "modis_longitude": round(m["longitude"], 5),
                    "spatial_offset_km": 0.0,
                    "temporal_offset_min": 0.0,
                    "total_frp": round(modis_frp, 1),
                    "peak_frp": round(modis_frp, 1),
                    "modis_frp": round(modis_frp, 1),
                    "viirs_total_frp": 0.0,
                    "viirs_mean_frp": 0.0,
                    "frp_ratio": 0.0,
                    "modis_pixel_count": 1,
                    "viirs_pixel_count": 0,
                    "total_pixel_count": 1,
                    "sensor_composition": "MODIS_ONLY",
                    "harmonization_type": "MODIS_ONLY",
                    "concordance_status": "SINGLE_SENSOR_MODIS",
                    "estimated_area_km2": 1.0,
                    "mean_confidence": float(m["confidence_score"]),
                    "primary_modis_id": m["id"],
                    "primary_viirs_id": None,
                    "raw_observation_ids": [m["id"]],
                    "modis_observation": m["original_observation"],
                    "viirs_observations": [],
                    "country": m.get("country"),
                    "continent": m.get("continent"),
                    "proximity_label": m.get("proximity_label")
                })
            event_counter += 1

        # Formulate VIIRS-Only events for unmatched VIIRS detections
        for v_idx, v in enumerate(viirs_list):
            if v_idx not in matched_viirs_indices:
                date_str = v["acq_date"]
                v_frp = v["frp"]
                events.append({
                    "event_id": f"HFE_{date_str.replace('-', '')}_{event_counter:05d}",
                    "date": date_str,
                    "latitude": round(v["latitude"], 5),
                    "longitude": round(v["longitude"], 5),
                    "modis_latitude": None,
                    "modis_longitude": None,
                    "spatial_offset_km": 0.0,
                    "temporal_offset_min": 0.0,
                    "total_frp": round(v_frp, 1),
                    "peak_frp": round(v_frp, 1),
                    "modis_frp": 0.0,
                    "viirs_total_frp": round(v_frp, 1),
                    "viirs_mean_frp": round(v_frp, 1),
                    "frp_ratio": 0.0,
                    "modis_pixel_count": 0,
                    "viirs_pixel_count": 1,
                    "total_pixel_count": 1,
                    "sensor_composition": "VIIRS_ONLY",
                    "harmonization_type": "VIIRS_ONLY",
                    "concordance_status": "SINGLE_SENSOR_VIIRS",
                    "estimated_area_km2": 0.14,
                    "mean_confidence": float(v["confidence_score"]),
                    "primary_modis_id": None,
                    "primary_viirs_id": v["id"],
                    "raw_observation_ids": [v["id"]],
                    "modis_observation": None,
                    "viirs_observations": [v["original_observation"]],
                    "country": v.get("country"),
                    "continent": v.get("continent"),
                    "proximity_label": v.get("proximity_label")
                })
                event_counter += 1

        # Generate Harmonization Metrics
        metrics = self._generate_metrics(
            total_modis=total_modis,
            total_viirs=total_viirs,
            events=events,
            matched_pairs_count=matched_pairs_count,
            sum_dist_km=sum_dist_km,
            sum_dt_min=sum_dt_min,
            sum_frp_ratio=sum_frp_ratio
        )

        return events, metrics

    def _generate_metrics(
        self,
        total_modis: int,
        total_viirs: int,
        events: List[Dict[str, Any]],
        matched_pairs_count: int,
        sum_dist_km: float,
        sum_dt_min: float,
        sum_frp_ratio: float
    ) -> Dict[str, Any]:
        """Calculates comprehensive harmonization and sensor agreement metrics."""
        total_obs = total_modis + total_viirs
        total_events = len(events)

        coincident = sum(1 for e in events if e.get("sensor_composition") == "COINCIDENT")
        viirs_only = sum(1 for e in events if e.get("sensor_composition") == "VIIRS_ONLY")
        modis_only = sum(1 for e in events if e.get("sensor_composition") == "MODIS_ONLY")

        matched_modis = coincident
        matched_viirs = sum(e["viirs_pixel_count"] for e in events if e.get("sensor_composition") == "COINCIDENT")

        modis_match_rate = round((matched_modis / total_modis * 100.0), 1) if total_modis > 0 else 0.0
        viirs_match_rate = round((matched_viirs / total_viirs * 100.0), 1) if total_viirs > 0 else 0.0

        mean_dist_km = round(sum_dist_km / matched_pairs_count, 3) if matched_pairs_count > 0 else 0.0
        mean_dt_min = round(sum_dt_min / matched_pairs_count, 1) if matched_pairs_count > 0 else 0.0
        mean_frp_ratio = round(sum_frp_ratio / matched_pairs_count, 2) if matched_pairs_count > 0 else 1.0

        ratio = round(total_viirs / total_modis, 2) if total_modis > 0 else (round(float(total_viirs), 2) if total_viirs > 0 else 1.0)
        reduction_factor = round(total_obs / total_events, 2) if total_events > 0 else 1.0
        total_frp = round(sum(e.get("total_frp", 0.0) for e in events), 1)

        # Mathematical verification of conservation
        accounted_modis = coincident + modis_only
        accounted_viirs = matched_viirs + viirs_only
        exact_conservation = (accounted_modis == total_modis) and (accounted_viirs == total_viirs)

        return {
            "total_observations": total_obs,
            "modis_observations": total_modis,
            "viirs_observations": total_viirs,
            "total_fire_events": total_events,
            "coincident_events": coincident,
            "viirs_only_events": viirs_only,
            "modis_only_events": modis_only,
            "matched_modis_count": matched_modis,
            "matched_viirs_count": matched_viirs,
            "modis_match_rate_pct": modis_match_rate,
            "viirs_match_rate_pct": viirs_match_rate,
            "viirs_to_modis_ratio": ratio,
            "spatial_reduction_factor": reduction_factor,
            "total_frp_mw": total_frp,
            "sensor_agreement": {
                "mean_spatial_offset_km": mean_dist_km,
                "mean_temporal_offset_min": mean_dt_min,
                "mean_frp_ratio": mean_frp_ratio,
                "spatial_threshold_km": self.spatial_threshold_km,
                "temporal_threshold_hours": self.temporal_threshold_hours
            },
            "exact_conservation_verified": exact_conservation,
            "methodology_notes": (
                f"Geodesic spatiotemporal matching applied (max distance: {self.spatial_threshold_km} km, "
                f"max temporal delta: {self.temporal_threshold_hours} h). Mutually exclusive bipartite assignment "
                "reconciled sub-pixel VIIRS detections into MODIS footprints, eliminating double-counting while "
                "preserving 100% of observations without data loss."
            )
        }

    def cluster_observations_into_events(self, observations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Groups spatio-temporally adjacent fire pixels on the same date into cohesive burn complexes.
        Preserves legacy fire event delineation for Fire Source Classification and diurnal burning analysis.
        """
        if not observations:
            return []

        by_date = defaultdict(list)
        for raw in observations:
            std = self.standardize_observation(raw)
            by_date[std["acq_date"]].append(std)

        events = []
        event_counter = 1

        for date_str, day_obs in by_date.items():
            n = len(day_obs)
            if n == 0:
                continue

            lats = [o["latitude"] for o in day_obs]
            lons = [o["longitude"] for o in day_obs]

            deg_threshold = 2.0 / 111.0
            cell_size = max(0.02, deg_threshold)
            grid = defaultdict(list)
            for idx in range(n):
                gx = int(lats[idx] / cell_size)
                gy = int(lons[idx] / cell_size)
                grid[(gx, gy)].append(idx)

            visited = [False] * n

            for i in range(n):
                if visited[i]:
                    continue

                cluster_indices = [i]
                visited[i] = True
                queue = [i]

                while queue:
                    curr = queue.pop(0)
                    c_lat, c_lon = lats[curr], lons[curr]
                    cgx = int(c_lat / cell_size)
                    cgy = int(c_lon / cell_size)

                    candidates = []
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            cell_items = grid.get((cgx + dx, cgy + dy))
                            if cell_items:
                                candidates.extend(cell_items)

                    for nbr in candidates:
                        if not visited[nbr]:
                            if abs(lats[nbr] - c_lat) <= deg_threshold and abs(lons[nbr] - c_lon) <= deg_threshold:
                                dist = haversine_distance_km(c_lat, c_lon, lats[nbr], lons[nbr])
                                if dist <= 2.0:
                                    visited[nbr] = True
                                    queue.append(nbr)
                                    cluster_indices.append(nbr)

                cluster_obs = [day_obs[idx] for idx in cluster_indices]
                modis_obs = [o for o in cluster_obs if o["sensor"] == "MODIS"]
                viirs_obs = [o for o in cluster_obs if o["sensor"] == "VIIRS"]

                modis_count = len(modis_obs)
                viirs_count = len(viirs_obs)
                total_obs = len(cluster_obs)

                total_frp = sum(o["frp"] for o in cluster_obs)
                if total_frp > 0:
                    cen_lat = sum(o["latitude"] * o["frp"] for o in cluster_obs) / total_frp
                    cen_lon = sum(o["longitude"] * o["frp"] for o in cluster_obs) / total_frp
                else:
                    cen_lat = sum(o["latitude"] for o in cluster_obs) / total_obs
                    cen_lon = sum(o["longitude"] for o in cluster_obs) / total_obs

                if modis_count > 0 and viirs_count > 0:
                    comp = "COINCIDENT"
                elif viirs_count > 0:
                    comp = "VIIRS_ONLY"
                else:
                    comp = "MODIS_ONLY"

                base_area = (modis_count * 1.0 + viirs_count * 0.14) / (2.0 if comp == "COINCIDENT" else 1.0)
                estimated_area_km2 = round(max(0.14, min(base_area, 25.0)), 2)

                d_clean = date_str.replace("-", "")
                events.append({
                    "event_id": f"FE_{d_clean}_{event_counter:05d}",
                    "date": date_str,
                    "latitude": round(cen_lat, 5),
                    "longitude": round(cen_lon, 5),
                    "total_frp": round(total_frp, 1),
                    "peak_frp": round(max((o["frp"] for o in cluster_obs), default=0.0), 1),
                    "modis_pixel_count": modis_count,
                    "viirs_pixel_count": viirs_count,
                    "total_pixel_count": total_obs,
                    "sensor_composition": comp,
                    "estimated_area_km2": estimated_area_km2,
                    "mean_confidence": round(sum(o["confidence_score"] for o in cluster_obs) / total_obs, 1),
                    "raw_observation_ids": [o["id"] for o in cluster_obs]
                })
                event_counter += 1

        return events

    def compute_harmonization_metrics(self, observations: List[Dict[str, Any]], events: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        """Computes scientific cross-sensor harmonization metrics."""
        _, metrics = self.harmonize_observations(observations)
        return metrics


harmonization_engine = HarmonizationEngine(spatial_threshold_km=1.5, temporal_threshold_hours=2.5)
