"""
IGNIS Geographic Reference & Reverse Geocoding Module.
Provides fast, offline reverse geocoding for NASA FIRMS global coordinates:
- Continent assignment (Africa, Asia, Europe, North America, South America, Oceania, Antarctica)
- Country assignment (covering major global fire belts and sovereign nations)
- Nearest city / geographic landmark proximity calculation without external API dependencies.
"""

import math
from typing import Dict, Any, List, Optional, Tuple

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two points in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    return R * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

# Major Global Continents Bounding Boxes (broad geographic partitions)
CONTINENT_BOUNDS = [
    {
        "continent": "South America",
        "code": "SA",
        "bbox": [-92.0, -56.0, -34.0, 13.0]
    },
    {
        "continent": "North America",
        "code": "NA",
        "bbox": [-168.0, 7.0, -52.0, 83.0]
    },
    {
        "continent": "Europe",
        "code": "EU",
        "bbox": [-25.0, 35.0, 45.0, 72.0]
    },
    {
        "continent": "Africa",
        "code": "AF",
        "bbox": [-18.0, -35.0, 52.0, 38.0]
    },
    {
        "continent": "Oceania",
        "code": "OC",
        "bbox": [110.0, -48.0, 180.0, -10.0]
    },
    {
        "continent": "Asia",
        "code": "AS",
        "bbox": [26.0, 1.0, 180.0, 78.0]
    },
    {
        "continent": "Antarctica",
        "code": "AN",
        "bbox": [-180.0, -90.0, 180.0, -60.0]
    }
]

# Major Sovereign Countries Bounding Boxes for Primary Global Fire Belts
COUNTRY_BOUNDS = [
    # South America
    {"country": "Brazil", "code": "BRA", "continent": "South America", "bbox": [-74.0, -33.8, -34.8, 5.3]},
    {"country": "Bolivia", "code": "BOL", "continent": "South America", "bbox": [-69.6, -22.9, -57.5, -9.7]},
    {"country": "Paraguay", "code": "PRY", "continent": "South America", "bbox": [-62.7, -27.6, -54.3, -19.3]},
    {"country": "Argentina", "code": "ARG", "continent": "South America", "bbox": [-73.6, -55.1, -53.6, -21.8]},
    {"country": "Colombia", "code": "COL", "continent": "South America", "bbox": [-79.0, -4.2, -66.9, 12.5]},
    {"country": "Peru", "code": "PER", "continent": "South America", "bbox": [-81.3, -18.4, -68.7, -0.0]},
    {"country": "Venezuela", "code": "VEN", "continent": "South America", "bbox": [-73.4, 0.6, -59.8, 12.2]},
    {"country": "Chile", "code": "CHL", "continent": "South America", "bbox": [-75.6, -55.9, -66.9, -17.5]},

    # North America
    {"country": "United States", "code": "USA", "continent": "North America", "bbox": [-125.0, 24.5, -66.9, 49.4]},
    {"country": "Canada", "code": "CAN", "continent": "North America", "bbox": [-141.0, 41.7, -52.6, 83.1]},
    {"country": "Mexico", "code": "MEX", "continent": "North America", "bbox": [-118.4, 14.5, -86.7, 32.7]},

    # Africa
    {"country": "Democratic Republic of the Congo", "code": "COD", "continent": "Africa", "bbox": [12.2, -13.5, 31.3, 5.4]},
    {"country": "Angola", "code": "AGO", "continent": "Africa", "bbox": [11.7, -18.0, 24.1, -4.4]},
    {"country": "Zambia", "code": "ZMB", "continent": "Africa", "bbox": [22.0, -18.1, 33.7, -8.2]},
    {"country": "Mozambique", "code": "MOZ", "continent": "Africa", "bbox": [30.2, -26.9, 40.8, -10.5]},
    {"country": "Madagascar", "code": "MDG", "continent": "Africa", "bbox": [43.2, -25.6, 50.5, -11.9]},
    {"country": "South Africa", "code": "ZAF", "continent": "Africa", "bbox": [16.5, -34.8, 32.9, -22.1]},
    {"country": "Nigeria", "code": "NGA", "continent": "Africa", "bbox": [2.7, 4.3, 14.7, 13.9]},
    {"country": "Central African Republic", "code": "CAF", "continent": "Africa", "bbox": [14.4, 2.2, 27.5, 11.0]},
    {"country": "Tanzania", "code": "TZA", "continent": "Africa", "bbox": [29.3, -11.7, 40.4, -0.9]},

    # Oceania
    {"country": "Australia", "code": "AUS", "continent": "Oceania", "bbox": [113.3, -43.6, 153.6, -10.7]},
    {"country": "New Zealand", "code": "NZL", "continent": "Oceania", "bbox": [166.4, -47.3, 178.6, -34.4]},
    {"country": "Papua New Guinea", "code": "PNG", "continent": "Oceania", "bbox": [140.8, -11.7, 156.0, -1.0]},

    # Asia
    {"country": "Indonesia", "code": "IDN", "continent": "Asia", "bbox": [95.0, -11.0, 141.0, 6.0]},
    {"country": "India", "code": "IND", "continent": "Asia", "bbox": [68.1, 8.1, 97.4, 35.5]},
    {"country": "China", "code": "CHN", "continent": "Asia", "bbox": [73.5, 18.2, 134.8, 53.6]},
    {"country": "Russia", "code": "RUS", "continent": "Asia", "bbox": [28.0, 41.2, 180.0, 81.9]},
    {"country": "Kazakhstan", "code": "KAZ", "continent": "Asia", "bbox": [46.5, 40.6, 87.3, 55.4]},
    {"country": "Myanmar", "code": "MMR", "continent": "Asia", "bbox": [92.2, 9.8, 101.2, 28.5]},
    {"country": "Thailand", "code": "THA", "continent": "Asia", "bbox": [97.3, 5.6, 105.6, 20.5]},
    {"country": "Vietnam", "code": "VNM", "continent": "Asia", "bbox": [102.1, 8.6, 109.5, 23.4]},

    # Europe
    {"country": "Spain", "code": "ESP", "continent": "Europe", "bbox": [-9.3, 36.0, 3.3, 43.8]},
    {"country": "Portugal", "code": "PRT", "continent": "Europe", "bbox": [-9.5, 36.9, -6.2, 42.2]},
    {"country": "Greece", "code": "GRC", "continent": "Europe", "bbox": [19.4, 34.8, 28.2, 41.8]},
    {"country": "Italy", "code": "ITA", "continent": "Europe", "bbox": [6.6, 36.6, 18.5, 47.1]},
    {"country": "France", "code": "FRA", "continent": "Europe", "bbox": [-4.8, 41.3, 9.6, 51.1]}
]

# Major Landmark / City Gazetteer for Proximity Labels
MAJOR_GLOBAL_CITIES = [
    # South America
    {"name": "Corumbá", "country": "Brazil", "lat": -19.01, "lon": -57.65},
    {"name": "Cuiabá", "country": "Brazil", "lat": -15.60, "lon": -56.10},
    {"name": "Campo Grande", "country": "Brazil", "lat": -20.47, "lon": -54.62},
    {"name": "Porto Velho", "country": "Brazil", "lat": -8.76, "lon": -63.90},
    {"name": "Manaus", "country": "Brazil", "lat": -3.12, "lon": -60.02},
    {"name": "Belém", "country": "Brazil", "lat": -1.45, "lon": -48.50},
    {"name": "Brasília", "country": "Brazil", "lat": -15.79, "lon": -47.88},
    {"name": "Santa Cruz de la Sierra", "country": "Bolivia", "lat": -17.78, "lon": -63.18},
    {"name": "Asunción", "country": "Paraguay", "lat": -25.26, "lon": -57.58},
    {"name": "Buenos Aires", "country": "Argentina", "lat": -34.60, "lon": -58.38},
    {"name": "Bogotá", "country": "Colombia", "lat": 4.71, "lon": -74.07},

    # North America
    {"name": "Los Angeles", "country": "United States", "lat": 34.05, "lon": -118.24},
    {"name": "San Francisco", "country": "United States", "lat": 37.77, "lon": -122.42},
    {"name": "Seattle", "country": "United States", "lat": 47.61, "lon": -122.33},
    {"name": "Denver", "country": "United States", "lat": 39.74, "lon": -104.99},
    {"name": "Houston", "country": "United States", "lat": 29.76, "lon": -95.37},
    {"name": "Miami", "country": "United States", "lat": 25.76, "lon": -80.19},
    {"name": "New York", "country": "United States", "lat": 40.71, "lon": -74.01},
    {"name": "Vancouver", "country": "Canada", "lat": 49.28, "lon": -123.12},
    {"name": "Edmonton", "country": "Canada", "lat": 53.55, "lon": -113.49},
    {"name": "Fort McMurray", "country": "Canada", "lat": 56.73, "lon": -111.38},
    {"name": "Calgary", "country": "Canada", "lat": 51.05, "lon": -114.07},
    {"name": "Toronto", "country": "Canada", "lat": 43.65, "lon": -79.38},
    {"name": "Mexico City", "country": "Mexico", "lat": 19.43, "lon": -99.13},

    # Africa
    {"name": "Kinshasa", "country": "Democratic Republic of the Congo", "lat": -4.44, "lon": 15.27},
    {"name": "Lubumbashi", "country": "Democratic Republic of the Congo", "lat": -11.69, "lon": 27.48},
    {"name": "Luanda", "country": "Angola", "lat": -8.84, "lon": 13.23},
    {"name": "Huambo", "country": "Angola", "lat": -12.78, "lon": 15.74},
    {"name": "Lusaka", "country": "Zambia", "lat": -15.39, "lon": 28.32},
    {"name": "Maputo", "country": "Mozambique", "lat": -25.97, "lon": 32.58},
    {"name": "Johannesburg", "country": "South Africa", "lat": -26.20, "lon": 28.05},
    {"name": "Nairobi", "country": "Kenya", "lat": -1.29, "lon": 36.82},
    {"name": "Lagos", "country": "Nigeria", "lat": 6.52, "lon": 3.38},

    # Oceania
    {"name": "Darwin", "country": "Australia", "lat": -12.46, "lon": 130.84},
    {"name": "Katherine", "country": "Australia", "lat": -14.46, "lon": 132.26},
    {"name": "Perth", "country": "Australia", "lat": -31.95, "lon": 115.86},
    {"name": "Sydney", "country": "Australia", "lat": -33.87, "lon": 151.21},
    {"name": "Brisbane", "country": "Australia", "lat": -27.47, "lon": 153.03},
    {"name": "Melbourne", "country": "Australia", "lat": -37.81, "lon": 144.96},
    {"name": "Auckland", "country": "New Zealand", "lat": -36.85, "lon": 174.76},

    # Asia
    {"name": "Jakarta", "country": "Indonesia", "lat": -6.21, "lon": 106.85},
    {"name": "Palembang", "country": "Indonesia", "lat": -2.99, "lon": 104.76},
    {"name": "Pontianak", "country": "Indonesia", "lat": -0.02, "lon": 109.34},
    {"name": "New Delhi", "country": "India", "lat": 28.61, "lon": 77.21},
    {"name": "Beijing", "country": "China", "lat": 39.90, "lon": 116.40},
    {"name": "Novosibirsk", "country": "Russia", "lat": 55.03, "lon": 82.93},
    {"name": "Yakutsk", "country": "Russia", "lat": 62.03, "lon": 129.73},
    {"name": "Bangkok", "country": "Thailand", "lat": 13.76, "lon": 100.50},

    # Europe
    {"name": "Madrid", "country": "Spain", "lat": 40.42, "lon": -3.70},
    {"name": "Lisbon", "country": "Portugal", "lat": 38.72, "lon": -9.14},
    {"name": "Athens", "country": "Greece", "lat": 37.98, "lon": 23.73},
    {"name": "Rome", "country": "Italy", "lat": 41.90, "lon": 12.50},
    {"name": "Paris", "country": "France", "lat": 48.86, "lon": 2.35}
]

CONTINENT_CODES = {
    "South America": "SA",
    "North America": "NA",
    "Europe": "EU",
    "Africa": "AF",
    "Oceania": "OC",
    "Asia": "AS",
    "Antarctica": "AN",
    "Unknown": "UNK"
}

def resolve_geographic_context(lat: float, lon: float) -> Dict[str, Any]:
    """
    Given a latitude and longitude, returns:
    - continent: str
    - continent_code: str
    - country: str
    - country_code: str
    - proximity_label: str (e.g. '34 km NE of Cuiabá, Brazil')
    - nearest_city: str
    - distance_to_city_km: float
    """
    # 1. Identify Country first (more specific than continent)
    matched_country = "International Waters"
    matched_country_code = "INT"
    matched_continent = "Unknown"
    matched_continent_code = "UNK"

    for c in COUNTRY_BOUNDS:
        w, s, e, n = c["bbox"]
        if w <= lon <= e and s <= lat <= n:
            matched_country = c["country"]
            matched_country_code = c["code"]
            matched_continent = c["continent"]
            matched_continent_code = CONTINENT_CODES.get(c["continent"], "UNK")
            break

    # 2. If country was not found in prioritized list, fall back to continent bounds
    if matched_continent == "Unknown":
        for cont in CONTINENT_BOUNDS:
            w, s, e, n = cont["bbox"]
            if w <= lon <= e and s <= lat <= n:
                matched_continent = cont["continent"]
                matched_continent_code = cont["code"]
                if matched_country == "International Waters":
                    matched_country = f"{cont['continent']} (Region)"
                break

    # 3. Find nearest landmark/city for realistic geographic context
    best_dist = 999999.0
    best_city = None

    for city in MAJOR_GLOBAL_CITIES:
        d = haversine_km(lat, lon, city["lat"], city["lon"])
        if d < best_dist:
            best_dist = d
            best_city = city

    if best_city and best_dist <= 500.0:
        # Determine cardinal direction
        dlat = lat - best_city["lat"]
        dlon = lon - best_city["lon"]
        ns = "N" if dlat >= 0 else "S"
        ew = "E" if dlon >= 0 else "W"
        direction = f"{ns}{ew}" if abs(dlat) > 0.1 and abs(dlon) > 0.1 else (ns if abs(dlat) > abs(dlon) else ew)
        proximity_label = f"{best_dist:.0f} km {direction} of {best_city['name']}, {best_city['country']}"
        city_name = best_city["name"]
    else:
        proximity_label = f"{abs(lat):.2f}°{'S' if lat < 0 else 'N'}, {abs(lon):.2f}°{'W' if lon < 0 else 'E'} ({matched_country})"
        city_name = None

    return {
        "continent": matched_continent,
        "continent_code": matched_continent_code,
        "country": matched_country,
        "country_code": matched_country_code,
        "proximity_label": proximity_label,
        "nearest_city": city_name,
        "distance_to_city_km": round(best_dist, 1) if best_city else None
    }
