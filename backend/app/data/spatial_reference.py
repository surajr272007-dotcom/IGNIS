"""
IGNIS Spatial Reference Data: Land Cover Context & Industrial Infrastructure
Provides scientifically verified geographic reference envelopes for land cover biomes,
agricultural agricultural belts, and industrial/thermal point sources.
Used exclusively by the Fire Source Classification Engine for explainable attribution.
"""

import math
from typing import Dict, Any, List, Optional

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two decimal coordinates in km."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

# Known Industrial Facilities, Energy Infrastructure, and Thermal Point Sources
# Verified coordinates for regional mining, refineries, cement kilns, thermal power, and bioethanol plants
KNOWN_INDUSTRIAL_FACILITIES = [
    # --- Brazil / Pantanal / Cerrado Corridor ---
    {
        "id": "ind_corumba_thermo",
        "name": "Termopantanal / UTE Corumbá (Gas Thermoelectric)",
        "type": "THERMAL_POWER_PLANT",
        "latitude": -19.015,
        "longitude": -57.650,
        "radius_km": 4.5,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_corumba_cement",
        "name": "Votorantim / Itaú Cement & Lime Kilns",
        "type": "CEMENT_LIME_KILN",
        "latitude": -19.022,
        "longitude": -57.635,
        "radius_km": 3.5,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_corumba_port",
        "name": "Granel Química & Ladário River Port Terminals",
        "type": "PORT_LOGISTICS",
        "latitude": -19.005,
        "longitude": -57.625,
        "radius_km": 4.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_urucum_mining",
        "name": "Vale / J&F Urucum Iron & Manganese Beneficiation Plant",
        "type": "MINING_METALLURGY",
        "latitude": -19.190,
        "longitude": -57.620,
        "radius_km": 5.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_cuiaba_thermo",
        "name": "Usina Termelétrica de Cuiabá (UTE Cuiabá 529MW)",
        "type": "THERMAL_POWER_PLANT",
        "latitude": -15.688,
        "longitude": -56.095,
        "radius_km": 4.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_cuiaba_distrito",
        "name": "Distrito Industrial de Cuiabá (Biofuels & Foundries)",
        "type": "INDUSTRIAL_ZONE",
        "latitude": -15.695,
        "longitude": -56.040,
        "radius_km": 5.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_varzea_grande",
        "name": "Várzea Grande Agro-Industrial & Grain Storage",
        "type": "AGRO_INDUSTRIAL",
        "latitude": -15.645,
        "longitude": -56.135,
        "radius_km": 4.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_rondonopolis_complex",
        "name": "Rondonópolis Agro-Industrial & Rumo Rail Terminal",
        "type": "AGRO_INDUSTRIAL_RAIL",
        "latitude": -16.460,
        "longitude": -54.630,
        "radius_km": 6.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_bodoquena_calcario",
        "name": "Calcário Bodoquena & Lime Calcination Works",
        "type": "CEMENT_LIME_KILN",
        "latitude": -20.530,
        "longitude": -56.710,
        "radius_km": 4.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_miranda_processing",
        "name": "Miranda Rail Depot & Agro-Processing Yard",
        "type": "RAIL_AGRO_DEPOT",
        "latitude": -20.240,
        "longitude": -56.380,
        "radius_km": 3.0,
        "region": "pantanal_brazil"
    },
    {
        "id": "ind_usina_sonora",
        "name": "Usina Sonora (Sugarcane Bagasse Cogeneration)",
        "type": "BIOETHANOL_MILL",
        "latitude": -17.570,
        "longitude": -54.750,
        "radius_km": 4.5,
        "region": "pantanal_brazil"
    },

    # --- USA / California Sierra Foothills ---
    {
        "id": "ind_bakersfield_refinery",
        "name": "Kern Oil & Refining Co. / Cogeneration Plant",
        "type": "REFINERY_COGEN",
        "latitude": 35.335,
        "longitude": -118.960,
        "radius_km": 5.0,
        "region": "california_sierra"
    },
    {
        "id": "ind_fresno_cogen",
        "name": "Fresno Industrial Cogeneration & Biomass Facility",
        "type": "BIOMASS_COGEN",
        "latitude": 36.710,
        "longitude": -119.780,
        "radius_km": 4.0,
        "region": "california_sierra"
    },

    # --- Australia / Northern Territory ---
    {
        "id": "ind_darwin_lng",
        "name": "Darwin LNG / Ichthys LNG Processing & Flare Stacks",
        "type": "LNG_FLARING_TERMINAL",
        "latitude": -12.520,
        "longitude": 130.860,
        "radius_km": 6.0,
        "region": "australia_nt"
    },

    # --- Canada / Alberta Boreal ---
    {
        "id": "ind_fort_mcmurray_upgrader",
        "name": "Syncrude Mildred Lake Oil Sands Upgrader & Flaring",
        "type": "PETROCHEMICAL_UPGRADER",
        "latitude": 57.040,
        "longitude": -111.620,
        "radius_km": 7.0,
        "region": "canada_boreal"
    },

    # --- Congo Basin ---
    {
        "id": "ind_muanda_flaring",
        "name": "Muanda Offshore Oil Terminal & Flare System",
        "type": "OIL_GAS_FLARE",
        "latitude": -5.930,
        "longitude": 12.350,
        "radius_km": 8.0,
        "region": "congo_basin"
    }
]

# Land Cover Macro-Zones based on IGBP / Copernicus Global Land Service
# Delineates dominant physical ecosystems across each Area of Interest
LAND_COVER_ZONES = {
    "pantanal_brazil": [
        {
            "id": "pantanal_core_wetland",
            "name": "Pantanal Wetland & Riparian Forest Matrix",
            "category": "FOREST_WETLAND",
            "description": "Seasonally flooded tropical wetlands, gallery forests, and cordilheiras",
            "bounds": {"west": -58.0, "south": -20.2, "east": -55.8, "north": -16.2},
            "wildfire_affinity": 0.85,
            "agricultural_affinity": 0.20
        },
        {
            "id": "cerrado_planalto_east",
            "name": "Cerrado Plateau Agro-Pastoral Belt (East)",
            "category": "AGRICULTURE_PASTURE",
            "description": "Cultivated soybean/corn fields, intensive cattle pastures, and cleared savanna",
            "bounds": {"west": -55.8, "south": -20.5, "east": -54.0, "north": -16.0},
            "wildfire_affinity": 0.30,
            "agricultural_affinity": 0.85
        },
        {
            "id": "cerrado_planalto_south",
            "name": "Mato Grosso do Sul Agro-Pastoral Belt (South)",
            "category": "AGRICULTURE_PASTURE",
            "description": "Planalto pastureland, sugarcane, and agro-industrial buffer",
            "bounds": {"west": -56.5, "south": -20.5, "east": -55.0, "north": -19.8},
            "wildfire_affinity": 0.35,
            "agricultural_affinity": 0.80
        },
        {
            "id": "chiquitano_dry_forest_west",
            "name": "Chiquitano Dry Forest & Border Savanna",
            "category": "FOREST_WETLAND",
            "description": "Dense semi-deciduous transition forest near Bolivian border",
            "bounds": {"west": -58.5, "south": -18.5, "east": -57.4, "north": -16.0},
            "wildfire_affinity": 0.80,
            "agricultural_affinity": 0.25
        }
    ]
}

def get_land_cover_at(lat: float, lon: float, aoi_id: str = "pantanal_brazil") -> Dict[str, Any]:
    """
    Identifies the predominant land-cover class at a coordinate location.
    Falls back to regional ecozone default if no specific micro-zone matches.
    """
    # 1. Search specified AOI zones or all zones if global
    target_aois = [aoi_id] if aoi_id != "global" else list(LAND_COVER_ZONES.keys())
    for aid in target_aois:
        zones = LAND_COVER_ZONES.get(aid, [])
        for z in zones:
            b = z["bounds"]
            if b["west"] <= lon <= b["east"] and b["south"] <= lat <= b["north"]:
                return {
                    "zone_id": z["id"],
                    "name": z["name"],
                    "category": z["category"],
                    "description": z["description"],
                    "wildfire_affinity": z["wildfire_affinity"],
                    "agricultural_affinity": z["agricultural_affinity"]
                }

    # 2. Check across all known zones if not found
    for aid, zones in LAND_COVER_ZONES.items():
        for z in zones:
            b = z["bounds"]
            if b["west"] <= lon <= b["east"] and b["south"] <= lat <= b["north"]:
                return {
                    "zone_id": z["id"],
                    "name": z["name"],
                    "category": z["category"],
                    "description": z["description"],
                    "wildfire_affinity": z["wildfire_affinity"],
                    "agricultural_affinity": z["agricultural_affinity"]
                }

    # Default fallback based on regional context
    if aoi_id == "pantanal_brazil":
        # West of -56.0 is mostly wetland/forest, East is agricultural plateau
        if lon <= -56.0:
            return {
                "zone_id": "pantanal_wetland_general",
                "name": "Pantanal Wetland & Seasonally Flooded Savanna",
                "category": "FOREST_WETLAND",
                "description": "Native wetland and savanna matrix",
                "wildfire_affinity": 0.75,
                "agricultural_affinity": 0.30
            }
        else:
            return {
                "zone_id": "cerrado_agriculture_general",
                "name": "Cerrado Agro-Pastoral Landscape",
                "category": "AGRICULTURE_PASTURE",
                "description": "Agricultural clearings and cattle pasture",
                "wildfire_affinity": 0.35,
                "agricultural_affinity": 0.75
            }

    return {
        "zone_id": "mixed_landscape_general",
        "name": "Mixed Vegetation Mosaic",
        "category": "MIXED_MOSAIC",
        "description": "Heterogeneous vegetation and land use",
        "wildfire_affinity": 0.50,
        "agricultural_affinity": 0.50
    }

def find_nearest_industrial(lat: float, lon: float, aoi_id: Optional[str] = None, max_dist_km: float = 30.0) -> Optional[Dict[str, Any]]:
    """
    Finds the nearest verified industrial / thermal facility within max_dist_km.
    Returns facility metadata and exact distance in km, or None if none in proximity.
    """
    candidates = KNOWN_INDUSTRIAL_FACILITIES
    if aoi_id:
        candidates = [f for f in KNOWN_INDUSTRIAL_FACILITIES if f.get("region") == aoi_id]

    closest = None
    min_dist = float("inf")

    for fac in candidates:
        d = haversine_km(lat, lon, fac["latitude"], fac["longitude"])
        if d < min_dist and d <= max_dist_km:
            min_dist = d
            closest = {
                **fac,
                "distance_km": round(d, 2),
                "within_immediate_radius": d <= fac.get("radius_km", 4.0)
            }

    return closest
