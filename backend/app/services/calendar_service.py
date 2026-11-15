"""
IGNIS Burning Activity Calendar Service
Constructs unified daily, monthly, and seasonal burning matrices from harmonized observations.
Calculates historical climatological baselines and burning regimes.
"""

from datetime import datetime, date
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional
from collections import defaultdict

class CalendarService:
    def build_burning_calendar(self, observations: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Creates a structured multi-dimensional burning calendar.
        Includes:
        - Daily fire activity timeline (Raw MODIS, Raw VIIRS, Harmonized Events, Total FRP)
        - Monthly summaries
        - Day-of-Year (DOY 1-365) multi-year matrix for heatmaps
        - Seasonal Burning Regime (Onset, Peak Burning Window, Cessation)
        """
        if not observations:
            return {
                "daily_timeline": [],
                "monthly_summary": [],
                "doy_matrix": {},
                "years_available": [],
                "season_profile": {
                    "onset_doy": None,
                    "peak_doy": None,
                    "cessation_doy": None,
                    "total_active_days": 0
                }
            }

        # 1. Map events by date
        event_by_date = defaultdict(list)
        for ev in events:
            event_by_date[ev["date"]].append(ev)

        # 2. Map raw observations by date
        obs_by_date = defaultdict(lambda: {"modis": 0, "viirs": 0, "total_frp": 0.0})
        for obs in observations:
            d = obs["acq_date"]
            sensor = obs.get("sensor", "").upper()
            if sensor == "MODIS":
                obs_by_date[d]["modis"] += 1
            elif sensor == "VIIRS":
                obs_by_date[d]["viirs"] += 1
            obs_by_date[d]["total_frp"] += float(obs.get("frp", 0.0))

        # 3. Compile full daily timeline
        all_dates = sorted(set(list(obs_by_date.keys()) + list(event_by_date.keys())))
        daily_timeline = []

        doy_records = defaultdict(dict)  # doy -> { year: count }
        years_set = set()

        for d_str in all_dates:
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            year = dt.year
            month = dt.month
            doy = dt.timetuple().tm_yday
            years_set.add(year)

            m_count = obs_by_date[d_str]["modis"]
            v_count = obs_by_date[d_str]["viirs"]
            ev_list = event_by_date.get(d_str, [])
            ev_count = len(ev_list)
            ev_frp = sum(e["total_frp"] for e in ev_list)
            
            # Harmonized Fire Metric: Weighted blend of events and radiative energy
            # 1 Harmonized Index Unit ~ 1 standardized fire event or 25 MW FRP
            harmonized_index = round(ev_count * 1.0 + (ev_frp / 25.0) * 0.5, 2)

            daily_timeline.append({
                "date": d_str,
                "year": year,
                "month": month,
                "day_of_year": doy,
                "modis_count": m_count,
                "viirs_count": v_count,
                "harmonized_event_count": ev_count,
                "harmonized_frp_mw": round(ev_frp, 1),
                "harmonized_fire_index": harmonized_index
            })

            doy_records[doy][year] = {
                "events": ev_count,
                "frp": round(ev_frp, 1),
                "index": harmonized_index,
                "modis": m_count,
                "viirs": v_count
            }

        # 4. Calculate Historical Baseline for each DOY (climatology)
        # Using a 15-day rolling window across available years
        all_years = sorted(list(years_set))
        doy_baselines = {}
        for d in range(1, 367):
            window_values = []
            for delta in range(-7, 8):
                target_d = (d + delta - 1) % 365 + 1
                if target_d in doy_records:
                    for y in all_years:
                        val = doy_records[target_d].get(y, {}).get("index", 0)
                        window_values.append(val)
            
            if window_values:
                doy_baselines[d] = {
                    "median": round(float(np.median(window_values)), 2),
                    "q75": round(float(np.percentile(window_values, 75)), 2),
                    "q90": round(float(np.percentile(window_values, 90)), 2),
                    "mean": round(float(np.mean(window_values)), 2)
                }
            else:
                doy_baselines[d] = {"median": 0.0, "q75": 0.0, "q90": 0.0, "mean": 0.0}

        # Enrich daily timeline with baseline and anomaly flag
        for day in daily_timeline:
            b = doy_baselines.get(day["day_of_year"], {"median": 0.0, "q90": 0.0})
            med = b["median"]
            q90 = b["q90"]
            val = day["harmonized_fire_index"]

            day["baseline_median"] = med
            day["baseline_q90"] = q90

            if val > max(2.0, q90 * 1.5):
                day["anomaly_level"] = "SEVERE"
            elif val > max(1.0, q90):
                day["anomaly_level"] = "ELEVATED"
            elif val > med:
                day["anomaly_level"] = "NORMAL"
            else:
                day["anomaly_level"] = "LOW"

        # 5. Monthly aggregation
        monthly_map = defaultdict(lambda: {
            "modis": 0, "viirs": 0, "events": 0, "frp": 0.0, "index": 0.0, "days": 0
        })
        for day in daily_timeline:
            key = f"{day['year']}-{day['month']:02d}"
            monthly_map[key]["modis"] += day["modis_count"]
            monthly_map[key]["viirs"] += day["viirs_count"]
            monthly_map[key]["events"] += day["harmonized_event_count"]
            monthly_map[key]["frp"] += day["harmonized_frp_mw"]
            monthly_map[key]["index"] += day["harmonized_fire_index"]
            monthly_map[key]["days"] += 1

        monthly_summary = [
            {
                "year_month": ym,
                "year": int(ym.split("-")[0]),
                "month": int(ym.split("-")[1]),
                "modis_count": v["modis"],
                "viirs_count": v["viirs"],
                "event_count": v["events"],
                "total_frp_mw": round(v["frp"], 1),
                "fire_index": round(v["index"], 2)
            }
            for ym, v in sorted(monthly_map.items())
        ]

        # 6. Season profile (Average across all years)
        doy_avg = [(d, doy_baselines[d]["mean"]) for d in range(1, 366)]
        doy_avg.sort(key=lambda x: x[1], reverse=True)
        peak_doy = doy_avg[0][0] if doy_avg else None

        # Cumulative distribution to find onset (10%) and cessation (90%)
        total_sum = sum(v["mean"] for v in doy_baselines.values())
        onset_doy, cessation_doy = None, None
        if total_sum > 0:
            running = 0.0
            for d in range(1, 366):
                running += doy_baselines[d]["mean"]
                if onset_doy is None and running >= total_sum * 0.10:
                    onset_doy = d
                if cessation_doy is None and running >= total_sum * 0.90:
                    cessation_doy = d

        return {
            "daily_timeline": daily_timeline,
            "monthly_summary": monthly_summary,
            "doy_matrix": dict(doy_records),
            "doy_baselines": doy_baselines,
            "years_available": all_years,
            "season_profile": {
                "onset_doy": onset_doy,
                "peak_doy": peak_doy,
                "cessation_doy": cessation_doy,
                "peak_month_name": date(2024, 1, 1).fromordinal(date(2024, 1, 1).toordinal() + (peak_doy or 180) - 1).strftime("%B") if peak_doy else "Unknown",
                "total_active_days": sum(1 for d in daily_timeline if d["harmonized_event_count"] > 0)
            }
        }

calendar_service = CalendarService()
