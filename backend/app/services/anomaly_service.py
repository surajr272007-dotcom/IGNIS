"""
IGNIS Anomaly Intelligence Service
Detects and contextualizes abnormal burning surges, unseasonal fire activity,
and extreme fire radiative power exceedances against multi-year climatological baselines.
"""

import math
import numpy as np
from typing import List, Dict, Any, Optional

class AnomalyService:
    def analyze_anomalies(self, daily_timeline: List[Dict[str, Any]], aoi_metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Analyzes fire timeline to detect anomalous burning episodes.
        Uses standardized deviation from seasonal climatology (Z-score)
        and baseline exceedance metrics.
        """
        if not daily_timeline:
            return {
                "anomalies": [],
                "summary": {
                    "total_anomaly_days": 0,
                    "severe_anomaly_days": 0,
                    "peak_anomaly_date": None,
                    "max_anomaly_score": 0.0,
                    "uncertainty_rating": "HIGH",
                    "uncertainty_rationale": "Insufficient observation records to establish statistical baseline."
                }
            }

        anomalous_episodes = []
        scores = []

        for day in daily_timeline:
            val = day.get("harmonized_fire_index", 0.0)
            baseline_med = day.get("baseline_median", 0.0)
            baseline_q90 = day.get("baseline_q90", 0.0)

            if val == 0:
                continue

            # Calculate Anomaly Score (log-ratio exceedance over baseline)
            # Baseline floor of 0.5 to avoid division by zero in zero-burning seasons
            effective_base = max(0.5, baseline_med)
            ratio = val / effective_base
            
            # Anomaly score from 0.0 to 10.0 scale
            # 1.0 = normal baseline; 3.0+ = significant surge; 5.0+ = extreme event
            raw_score = min(10.0, max(0.0, math.log2(ratio + 0.5) * 2.0)) if ratio > 1.0 else 0.0

            # Exceedance category
            if val > max(2.5, baseline_q90 * 2.0) or raw_score >= 4.5:
                status = "CRITICAL_SURGE"
                urgency = "High"
            elif val > max(1.0, baseline_q90) or raw_score >= 2.5:
                status = "ELEVATED_ANOMALY"
                urgency = "Moderate"
            else:
                status = "TYPICAL_SEASONAL"
                urgency = "Low"

            if status != "TYPICAL_SEASONAL":
                # Compute uncertainty factor based on sensor composition and count
                m_cnt = day.get("modis_count", 0)
                v_cnt = day.get("viirs_count", 0)
                
                # Higher uncertainty if only single sensor observed or very low pixel count
                if m_cnt > 0 and v_cnt > 0:
                    conf = "High (Dual-Sensor Confirmed)"
                    unc_pct = 15
                elif v_cnt > 0:
                    conf = "Moderate (VIIRS High-Res Only)"
                    unc_pct = 28
                else:
                    conf = "Moderate (MODIS Coarse Only)"
                    unc_pct = 32

                anomalous_episodes.append({
                    "date": day["date"],
                    "day_of_year": day["day_of_year"],
                    "year": day["year"],
                    "status": status,
                    "urgency": urgency,
                    "anomaly_score": round(raw_score, 1),
                    "harmonized_index": val,
                    "baseline_median": baseline_med,
                    "baseline_q90": baseline_q90,
                    "exceedance_percentage": round((ratio - 1.0) * 100, 1),
                    "modis_count": m_cnt,
                    "viirs_count": v_cnt,
                    "harmonized_events": day.get("harmonized_event_count", 0),
                    "total_frp_mw": day.get("harmonized_frp_mw", 0.0),
                    "confidence_assessment": conf,
                    "uncertainty_margin_pct": unc_pct
                })
                scores.append(raw_score)

        # Sort anomalies by severity score descending
        anomalous_episodes.sort(key=lambda x: (x["anomaly_score"], x["harmonized_index"]), reverse=True)

        severe_days = sum(1 for a in anomalous_episodes if a["status"] == "CRITICAL_SURGE")
        max_score = round(max(scores), 1) if scores else 0.0
        peak_date = anomalous_episodes[0]["date"] if anomalous_episodes else None

        # Regional fire regime context
        regime_notes = aoi_metadata.get("fire_type", "Wildfire and vegetation burning") if aoi_metadata else ""
        days_span = len(daily_timeline)
        is_short_span = days_span < 15

        return {
            "anomalies": anomalous_episodes,
            "summary": {
                "total_anomaly_days": len(anomalous_episodes),
                "severe_anomaly_days": severe_days,
                "peak_anomaly_date": peak_date,
                "max_anomaly_score": max_score,
                "regional_context": regime_notes,
                "observation_span_days": days_span,
                "baseline_statistical_sufficiency": "SUFFICIENT" if not is_short_span else "LIMITED_OBSERVATION_WINDOW",
                "baseline_context": (
                    "Multi-year climatological baseline active." if not is_short_span
                    else f"Short-window observation stream ({days_span} days). Evaluated against historical DOY climatological envelope."
                ),
                "scientific_disclaimer": "Activity exceedance indicator derived from satellite radiative flux. This is not a predictive wildfire forecast.",
                "uncertainty_framework": {
                    "sensor_geometry_factor": "VIIRS 375m captures smaller fires (<10 MW) that MODIS misses. Dual-sensor confirmation dramatically reduces false anomaly alarms.",
                    "temporal_sampling": "Sun-synchronous orbits capture ~4 overpasses daily (Terra 10:30, Aqua 13:30, S-NPP 13:15, NOAA-20 14:05). Rapid morning or late afternoon fires outside overpasses carry higher uncertainty.",
                    "atmospheric_attenuation": "Heavy smoke plumes and cloud cover can cause negative detection bias."
                }
            }
        }

anomaly_service = AnomalyService()
