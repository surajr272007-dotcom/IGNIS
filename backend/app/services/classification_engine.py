"""
IGNIS Fire Source Classification Engine
Classifies NASA FIRMS active-fire thermal anomaly events into probable source categories:
1. Likely Forest Wildfire
2. Possible Agricultural Burning
3. Possible Industrial Heat
4. Unknown Thermal Anomaly

Scientific Principles:
- Multi-criteria evidence scoring combining land-cover context, industrial infrastructure proximity,
  radiant heat flux (FRP), spatial footprint, sensor coincidence, and diurnal/temporal recurrence.
- Explainable confidence scores and transparent evidence reasons.
- Strict conservatism: When evidence is ambiguous, classifications default to 'Unknown Thermal Anomaly'.
  Never declares a hotspot a confirmed wildfire based purely on location.
"""

import math
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
from ..data.spatial_reference import get_land_cover_at, find_nearest_industrial, haversine_km

class SourceCategory:
    LIKELY_FOREST_WILDFIRE = "Likely Forest Wildfire"
    POSSIBLE_AGRICULTURAL_BURNING = "Possible Agricultural Burning"
    POSSIBLE_INDUSTRIAL_HEAT = "Possible Industrial Heat"
    UNKNOWN_THERMAL_ANOMALY = "Unknown Thermal Anomaly"

class SourceCode:
    FOREST_WILDFIRE = "FOREST_WILDFIRE"
    AGRICULTURAL_BURNING = "AGRICULTURAL_BURNING"
    INDUSTRIAL_HEAT = "INDUSTRIAL_HEAT"
    UNKNOWN = "UNKNOWN"

CATEGORY_METADATA = {
    SourceCode.FOREST_WILDFIRE: {
        "name": SourceCategory.LIKELY_FOREST_WILDFIRE,
        "color": "#f97316", # Flame Orange-Red
        "badge_bg": "bg-orange-950/40",
        "badge_border": "border-orange-800/60",
        "badge_text": "text-orange-400",
        "description": "High-intensity vegetation or crown fire running through native forest, gallery woodlands, or wetland reserves."
    },
    SourceCode.AGRICULTURAL_BURNING: {
        "name": SourceCategory.POSSIBLE_AGRICULTURAL_BURNING,
        "color": "#eab308", # Amber-Yellow
        "badge_bg": "bg-yellow-950/40",
        "badge_border": "border-yellow-800/60",
        "badge_text": "text-yellow-400",
        "description": "Controlled pasture maintenance, crop residue burning, or rotational field clearance in agro-pastoral belts."
    },
    SourceCode.INDUSTRIAL_HEAT: {
        "name": SourceCategory.POSSIBLE_INDUSTRIAL_HEAT,
        "color": "#a855f7", # Violet-Purple
        "badge_bg": "bg-purple-950/40",
        "badge_border": "border-purple-800/60",
        "badge_text": "text-purple-400",
        "description": "Stationary thermal emitter associated with industrial kilns, refineries, power plants, bioethanol boilers, or flare stacks."
    },
    SourceCode.UNKNOWN: {
        "name": SourceCategory.UNKNOWN_THERMAL_ANOMALY,
        "color": "#94a3b8", # Slate-Gray
        "badge_bg": "bg-slate-900/40",
        "badge_border": "border-slate-700/60",
        "badge_text": "text-slate-400",
        "description": "Thermal detection with ambiguous or insufficient spatial, temporal, or radiometric evidence to establish probable source."
    }
}

class FireSourceClassifier:
    def __init__(self):
        pass

    def classify_event(self, event: Dict[str, Any], raw_observations: List[Dict[str, Any]], aoi_id: str = "pantanal_brazil", obs_lookup_map: Optional[Dict[str, Any]] = None, spatial_date_grid: Optional[Dict[tuple, set]] = None) -> Dict[str, Any]:
        """
        Classifies a single harmonized fire event complex into a probable source category.
        Returns the original event enriched with classification attributes, confidence, and reasons.
        """
        lat = float(event.get("latitude", 0.0))
        lon = float(event.get("longitude", 0.0))
        frp = float(event.get("total_frp", 0.0))
        peak_frp = float(event.get("peak_frp", frp))
        pix_count = int(event.get("total_pixel_count", 1))
        area_km2 = float(event.get("estimated_area_km2", 0.14))
        sensor_comp = event.get("sensor_composition", "UNKNOWN")
        mean_conf = float(event.get("mean_confidence", 50.0))
        raw_ids = set(event.get("raw_observation_ids", []))

        # Filter cluster raw observations
        if obs_lookup_map:
            cluster_obs = [obs_lookup_map[oid] for oid in raw_ids if oid in obs_lookup_map]
        else:
            cluster_obs = [o for o in raw_observations if o.get("id") in raw_ids]

        if not cluster_obs and len(raw_observations) <= 500:
            # Fallback by spatial proximity if IDs don't match (for small datasets only)
            cluster_obs = [
                o for o in raw_observations 
                if haversine_km(lat, lon, float(o.get("latitude", 0.0)), float(o.get("longitude", 0.0))) <= 2.5
            ]

        # 1. Spatial context
        land_cover = get_land_cover_at(lat, lon, aoi_id)
        nearest_ind = find_nearest_industrial(lat, lon, aoi_id, max_dist_km=25.0)

        # 2. Radiometric & temporal indicators
        day_passes = sum(1 for o in cluster_obs if str(o.get("daynight", "D")).upper() == "D")
        night_passes = sum(1 for o in cluster_obs if str(o.get("daynight", "")).upper() == "N")
        max_brightness = max((float(o.get("brightness", 300.0)) for o in cluster_obs), default=310.0)
        is_strictly_nocturnal = night_passes > 0 and day_passes == 0
        is_strictly_diurnal = day_passes > 0 and night_passes == 0

        # Check multi-day stationary recurrence (thermal point persistent across days)
        if spatial_date_grid is not None:
            nearby_dates = set()
            c_lat = round(lat, 2)
            c_lon = round(lon, 2)
            for dlat in (-0.01, 0.0, 0.01):
                for dlon in (-0.01, 0.0, 0.01):
                    k = (round(c_lat + dlat, 2), round(c_lon + dlon, 2))
                    if k in spatial_date_grid:
                        nearby_dates.update(spatial_date_grid[k])
            nearby_dates.discard(event.get("date"))
            is_stationary_recurrent = len(nearby_dates) >= 1
        elif len(raw_observations) <= 1000:
            nearby_dates = set()
            for o in raw_observations:
                d_km = haversine_km(lat, lon, float(o.get("latitude", 0.0)), float(o.get("longitude", 0.0)))
                if d_km <= 1.0 and o.get("acq_date") != event.get("date"):
                    nearby_dates.add(o.get("acq_date"))
            is_stationary_recurrent = len(nearby_dates) >= 1
        else:
            is_stationary_recurrent = False

        # 3. Multi-Criteria Evidence Scoring
        # Dimensions are normalized and weighted to avoid single-attribute dominance:
        # 1. Ecoregional Context Prior (max 0.25) - Macro-zone prior, not ground truth
        # 2. Radiative Combustion Energy (max 0.20) - FRP measures heat flux, not fuel type
        # 3. Spatial Spread / Footprint (max 0.20) - Measures raster extent
        # 4. Cross-Sensor Coincidence (max 0.25) - Inter-instrument confirmation (MODIS + VIIRS)
        # 5. Diurnal / Temporal Persistence (max 0.10) - Day/night activity
        score_wildfire = 0.0
        score_agricultural = 0.0
        score_industrial = 0.0

        reasons_wildfire = []
        reasons_agri = []
        reasons_ind = []

        # Inter-instrument cross-sensor verification (Requirement 4)
        # Strict rule: Dual-sensor coincidence is ONLY awarded when BOTH MODIS and VIIRS independently detect the event
        modis_pix = int(event.get("modis_pixel_count", 0))
        viirs_pix = int(event.get("viirs_pixel_count", 0))
        is_cross_sensor_verified = (sensor_comp == "COINCIDENT" and modis_pix > 0 and viirs_pix > 0)

        # --- A. Industrial Heat Assessment ---
        if nearest_ind:
            dist = nearest_ind["distance_km"]
            if nearest_ind["within_immediate_radius"] or dist <= 4.0:
                score_industrial += 0.65
                reasons_ind.append(f"Located {dist:.1f} km from {nearest_ind['name']} ({nearest_ind['type']}).")
            elif dist <= 8.0:
                score_industrial += 0.35
                reasons_ind.append(f"Proximity to industrial corridor ({dist:.1f} km to {nearest_ind['name']}).")

        if is_stationary_recurrent and area_km2 <= 0.6:
            score_industrial += 0.25
            reasons_ind.append(f"Stationary thermal signature recurring at same coordinate across multiple observation dates ({', '.join(sorted(nearby_dates))}).")

        if is_strictly_nocturnal and max_brightness >= 330.0 and pix_count <= 2:
            score_industrial += 0.20
            reasons_ind.append(f"Compact nocturnal thermal emission (Peak Brightness: {max_brightness:.1f} K, Pass: Night).")

        if pix_count > 6 or area_km2 > 1.5:
            # Significant spatial spread strongly disfavors stationary industrial point sources
            score_industrial -= 0.40

        # --- B. Likely Forest Wildfire Assessment ---
        # Dimension 1: Ecoregional Context Prior (Max 0.25)
        # Regional land-cover macro-zones provide contextual priors, NOT ground-level fuel verification (Requirement 6)
        if land_cover["category"] == "FOREST_WETLAND":
            score_wildfire += 0.25
            reasons_wildfire.append(f"Ecoregional macro-zone prior: Situated within {land_cover['name']} (regional satellite land cover; not on-the-ground verified fuel survey).")
        elif land_cover.get("wildfire_affinity", 0.5) >= 0.7:
            score_wildfire += 0.15
            reasons_wildfire.append("Situated in regional natural vegetation matrix (regional prior).")

        # Dimension 2: Radiative Combustion Energy (Max 0.20)
        # High FRP reflects combustion rate/intensity; does not independently prove forest fuel (Requirement 5)
        if frp >= 100.0:
            score_wildfire += 0.20
            reasons_wildfire.append(f"Elevated radiative heat output ({frp:.1f} MW cumulative FRP, Peak {peak_frp:.1f} MW) indicates intense biomass combustion, but does not independently establish fuel type.")
        elif frp >= 35.0:
            score_wildfire += 0.14
            reasons_wildfire.append(f"Substantial radiative intensity ({frp:.1f} MW FRP).")
        elif frp >= 15.0:
            score_wildfire += 0.08

        # Dimension 3: Spatial Footprint & Multi-pixel Extent (Max 0.20)
        # Footprint measures spatial spread; does not independently prove forest fuel (Requirement 5)
        if pix_count >= 8 or area_km2 >= 1.5:
            score_wildfire += 0.20
            reasons_wildfire.append(f"Widespread active fire front spreading across {area_km2:.2f} km² ({pix_count} satellite detections).")
        elif pix_count >= 3 or area_km2 >= 0.7:
            score_wildfire += 0.10
            reasons_wildfire.append(f"Multi-pixel cluster perimeter ({pix_count} pixels, {area_km2:.2f} km²).")

        # Dimension 4: Inter-Instrument Cross-Sensor Coincidence (Max 0.25)
        # Coincidence is ONLY rewarded if both MODIS and VIIRS actually detect the event (Requirement 4)
        if is_cross_sensor_verified:
            score_wildfire += 0.25
            reasons_wildfire.append(f"Dual-sensor confirmed: Detected independently by both MODIS ({modis_pix} pixels) and VIIRS ({viirs_pix} pixels) constellations.")
        else:
            # Document absence of cross-sensor corroboration explicitly in reasons
            if sensor_comp == "VIIRS_ONLY":
                reasons_wildfire.append("Single-sensor observation (VIIRS 375m only, 0 MODIS detections): Lacks multi-platform corroboration; classification confidence strictly bounded.")
            elif sensor_comp == "MODIS_ONLY":
                reasons_wildfire.append("Single-sensor observation (MODIS 1000m only, 0 VIIRS detections): Lacks high-resolution VIIRS confirmation.")

        # Dimension 5: Diurnal / Nocturnal Profile (Max 0.10)
        if day_passes > 0 and night_passes > 0:
            score_wildfire += 0.10
            reasons_wildfire.append("Continuous diurnal and nocturnal active burning (nocturnal persistence typical of uncontrolled wildfire).")
        elif day_passes > 0:
            score_wildfire += 0.05

        if nearest_ind and nearest_ind["within_immediate_radius"]:
            score_wildfire -= 0.30

        # --- C. Possible Agricultural Burning Assessment ---
        if land_cover["category"] == "AGRICULTURE_PASTURE":
            score_agricultural += 0.30
            reasons_agri.append(f"Located in cultivated agricultural/pasture zone: {land_cover['name']} (regional prior).")
        elif land_cover.get("agricultural_affinity", 0.3) >= 0.7:
            score_agricultural += 0.20
            reasons_agri.append("Surrounded by active agricultural clearings and managed pastures (regional prior).")

        # Moderate intensity, localized footprint typical of agricultural burnings
        if 2.0 <= frp <= 45.0:
            score_agricultural += 0.25
            reasons_agri.append(f"Moderate radiative power ({frp:.1f} MW) consistent with agricultural residue or pasture burn.")

        if pix_count <= 3 and area_km2 <= 0.8:
            score_agricultural += 0.25
            reasons_agri.append(f"Confined, localized burn footprint ({area_km2:.2f} km², {pix_count} detection pixels).")

        if is_strictly_diurnal:
            score_agricultural += 0.15
            reasons_agri.append("Diurnal daylight overpass timing (agricultural burns are typically conducted in daytime and extinguished before nightfall).")

        if pix_count >= 10 or area_km2 >= 2.5 or frp >= 150.0:
            # Massive spreading complexes strongly disfavor standard agricultural maintenance burns
            score_agricultural -= 0.35

        if nearest_ind and nearest_ind["within_immediate_radius"]:
            score_agricultural -= 0.25

        # 4. Final Classification Decision
        scores = {
            SourceCode.FOREST_WILDFIRE: max(0.0, score_wildfire),
            SourceCode.AGRICULTURAL_BURNING: max(0.0, score_agricultural),
            SourceCode.INDUSTRIAL_HEAT: max(0.0, score_industrial)
        }

        best_code = max(scores, key=scores.get)
        best_score = scores[best_code]

        # Minimum evidence threshold to avoid false claims
        # Require score >= 0.45 and adequate confidence
        reasons_unknown = []
        is_unknown = False

        if best_score < 0.45:
            is_unknown = True
            reasons_unknown.append("Insufficient radiometric, spatial, or multi-sensor evidence to differentiate source.")
        elif mean_conf < 30.0 and frp < 5.0 and pix_count == 1:
            is_unknown = True
            reasons_unknown.append(f"Low sensor detection confidence ({mean_conf:.0f}%) and faint radiative output ({frp:.1f} MW) lack corroboration.")

        if is_unknown:
            final_code = SourceCode.UNKNOWN
            final_meta = CATEGORY_METADATA[SourceCode.UNKNOWN]
            final_reasons = reasons_unknown + [
                f"Land cover context: {land_cover['name']} (regional prior).",
                "Classification withheld per scientific protocol: never assert wildfire or agriculture without decisive evidence."
            ]
            confidence_pct = max(35.0, round(best_score * 65.0, 1))
            tier = "Low"
        else:
            final_code = best_code
            final_meta = CATEGORY_METADATA[best_code]
            if final_code == SourceCode.FOREST_WILDFIRE:
                final_reasons = reasons_wildfire
            elif final_code == SourceCode.AGRICULTURAL_BURNING:
                final_reasons = reasons_agri
            else:
                final_reasons = reasons_ind

            # Confidence percentage calculation:
            # If dual-sensor verified (MODIS + VIIRS), confidence can reach High Tier (80% - 92%)
            # If single-sensor only (e.g. VIIRS_ONLY or MODIS_ONLY), confidence is strictly capped at 76.0% (Moderate Tier)
            # because single-sensor observations lack inter-instrument cross-validation (Requirement 4 & 5)
            if is_cross_sensor_verified:
                confidence_pct = min(92.0, max(65.0, round(55.0 + (best_score * 38.0), 1)))
            else:
                # Single-sensor observation cap
                confidence_pct = min(76.0, max(50.0, round(45.0 + (best_score * 35.0), 1)))

            if confidence_pct >= 80.0:
                tier = "High"
            elif confidence_pct >= 65.0:
                tier = "Moderate"
            else:
                tier = "Low"

        # Construct enriched event with explicit distinction between classification and sensor detection confidences (Requirement 8)
        enriched = dict(event)
        enriched.update({
            "probable_source": final_meta["name"],
            "classification_code": final_code,
            "classification_color": final_meta["color"],
            "confidence_score": confidence_pct,        # Preserved for backward compatibility
            "confidence_tier": tier,                   # Preserved for backward compatibility
            "classification_confidence": confidence_pct,
            "classification_tier": tier,
            "sensor_detection_confidence": round(mean_conf, 1),
            "sensor_detection_tier": "High" if mean_conf >= 80.0 else ("Nominal" if mean_conf >= 50.0 else "Low"),
            "cross_sensor_corroborated": is_cross_sensor_verified,
            "classification_reasons": final_reasons,
            "land_cover_context": {
                "name": land_cover["name"],
                "category": land_cover["category"],
                "is_macrozone_prior": True,
                "disclaimer": "Ecoregional macro-zone prior; does not constitute on-the-ground verified fuel."
            },
            "industrial_proximity": {
                "nearest_facility": nearest_ind["name"] if nearest_ind else None,
                "distance_km": nearest_ind["distance_km"] if nearest_ind else None,
                "facility_type": nearest_ind["type"] if nearest_ind else None
            } if nearest_ind else None,
            "diurnal_profile": {
                "day_detections": day_passes,
                "night_detections": night_passes,
                "max_brightness_kelvin": max_brightness
            },
            "is_stationary_recurrent": is_stationary_recurrent
        })

        return enriched

    def classify_events(self, events: List[Dict[str, Any]], raw_observations: List[Dict[str, Any]], aoi_id: str = "pantanal_brazil") -> List[Dict[str, Any]]:
        """Classifies a list of harmonized events with fast indexing for high observation counts."""
        obs_map = None
        date_grid = None
        if len(raw_observations) > 200:
            obs_map = {o.get("id"): o for o in raw_observations if o.get("id")}
            date_grid = defaultdict(set)
            for o in raw_observations:
                try:
                    c = (round(float(o.get("latitude", 0)), 2), round(float(o.get("longitude", 0)), 2))
                    d = o.get("acq_date")
                    if d:
                        date_grid[c].add(d)
                except Exception:
                    pass

        return [self.classify_event(ev, raw_observations, aoi_id, obs_lookup_map=obs_map, spatial_date_grid=date_grid) for ev in events]

    def classify_observations(self, raw_observations: List[Dict[str, Any]], classified_events: List[Dict[str, Any]], aoi_id: str = "pantanal_brazil") -> List[Dict[str, Any]]:
        """Maps cluster classifications onto constituent raw observations."""
        event_map = {}
        for ev in classified_events:
            for obs_id in ev.get("raw_observation_ids", []):
                event_map[obs_id] = ev

        enriched_obs = []
        for o in raw_observations:
            item = dict(o)
            parent_event = event_map.get(o.get("id"))
            if parent_event:
                item["probable_source"] = parent_event["probable_source"]
                item["classification_code"] = parent_event["classification_code"]
                item["classification_color"] = parent_event["classification_color"]
                item["confidence_score"] = parent_event["confidence_score"]
                item["confidence_tier"] = parent_event["confidence_tier"]
                item["classification_confidence"] = parent_event["classification_confidence"]
                item["classification_tier"] = parent_event["classification_tier"]
                item["sensor_detection_confidence"] = float(o.get("confidence_numeric", o.get("confidence_score", 50)))
                item["sensor_detection_tier"] = "High" if item["sensor_detection_confidence"] >= 80 else ("Nominal" if item["sensor_detection_confidence"] >= 50 else "Low")
                item["cross_sensor_corroborated"] = parent_event["cross_sensor_corroborated"]
                item["event_id"] = parent_event["event_id"]
            else:
                dummy_ev = {
                    "event_id": f"FE_SINGLE_{o.get('id')}",
                    "date": o.get("acq_date"),
                    "latitude": float(o.get("latitude")),
                    "longitude": float(o.get("longitude")),
                    "total_frp": float(o.get("frp", 0.0)),
                    "peak_frp": float(o.get("frp", 0.0)),
                    "total_pixel_count": 1,
                    "estimated_area_km2": 0.14 if o.get("sensor") == "VIIRS" else 1.0,
                    "sensor_composition": f"{o.get('sensor')}_ONLY",
                    "mean_confidence": float(o.get("confidence_numeric", 50)),
                    "raw_observation_ids": [o.get("id")]
                }
                c = self.classify_event(dummy_ev, [o], aoi_id)
                item["probable_source"] = c["probable_source"]
                item["classification_code"] = c["classification_code"]
                item["classification_color"] = c["classification_color"]
                item["confidence_score"] = c["confidence_score"]
                item["confidence_tier"] = c["confidence_tier"]
                item["classification_confidence"] = c["classification_confidence"]
                item["classification_tier"] = c["classification_tier"]
                item["sensor_detection_confidence"] = float(o.get("confidence_numeric", o.get("confidence_score", 50)))
                item["sensor_detection_tier"] = "High" if item["sensor_detection_confidence"] >= 80 else ("Nominal" if item["sensor_detection_confidence"] >= 50 else "Low")
                item["cross_sensor_corroborated"] = c["cross_sensor_corroborated"]
                item["event_id"] = dummy_ev["event_id"]
            enriched_obs.append(item)
        return enriched_obs

    def get_classification_summary(self, classified_events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculates categorical distributions and summary metrics for classified events."""
        total = len(classified_events)
        if total == 0:
            return {
                "total_events": 0,
                "categories": {
                    SourceCode.FOREST_WILDFIRE: {"count": 0, "pct": 0.0, "total_frp_mw": 0.0, "name": SourceCategory.LIKELY_FOREST_WILDFIRE, "color": "#f97316"},
                    SourceCode.AGRICULTURAL_BURNING: {"count": 0, "pct": 0.0, "total_frp_mw": 0.0, "name": SourceCategory.POSSIBLE_AGRICULTURAL_BURNING, "color": "#eab308"},
                    SourceCode.INDUSTRIAL_HEAT: {"count": 0, "pct": 0.0, "total_frp_mw": 0.0, "name": SourceCategory.POSSIBLE_INDUSTRIAL_HEAT, "color": "#a855f7"},
                    SourceCode.UNKNOWN: {"count": 0, "pct": 0.0, "total_frp_mw": 0.0, "name": SourceCategory.UNKNOWN_THERMAL_ANOMALY, "color": "#94a3b8"}
                },
                "predominant_source": None,
                "scientific_disclaimer": "Classifications are probabilistic estimates based on satellite thermal signatures, land cover, and infrastructure proximity. They do not constitute on-the-ground forensic investigations."
            }

        counts = defaultdict(int)
        frp_by_cat = defaultdict(float)

        for ev in classified_events:
            code = ev.get("classification_code", SourceCode.UNKNOWN)
            counts[code] += 1
            frp_by_cat[code] += float(ev.get("total_frp", 0.0))

        cat_summary = {}
        for code in [SourceCode.FOREST_WILDFIRE, SourceCode.AGRICULTURAL_BURNING, SourceCode.INDUSTRIAL_HEAT, SourceCode.UNKNOWN]:
            cnt = counts[code]
            meta = CATEGORY_METADATA[code]
            cat_summary[code] = {
                "count": cnt,
                "pct": round((cnt / total) * 100.0, 1),
                "total_frp_mw": round(frp_by_cat[code], 1),
                "name": meta["name"],
                "color": meta["color"],
                "description": meta["description"]
            }

        predominant = max(counts, key=counts.get)

        return {
            "total_events": total,
            "categories": cat_summary,
            "predominant_source": CATEGORY_METADATA[predominant]["name"],
            "predominant_code": predominant,
            "scientific_disclaimer": "Classifications are probabilistic estimates based on satellite thermal signatures, land cover, and infrastructure proximity. They do not constitute on-the-ground forensic investigations."
        }

classification_engine = FireSourceClassifier()
