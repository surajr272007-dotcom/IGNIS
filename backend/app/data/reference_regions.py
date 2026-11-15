"""
Curated Global Fire Regimes and Reference Areas of Interest (AOIs)
Accurate coordinates, typical burning seasonality, and sensor characteristics.
"""

REFERENCE_AOIS = [
    {
        "id": "global",
        "name": "Global Active Fire Network",
        "country": "Worldwide",
        "country_code": "GLOBAL",
        "bbox": [-180.0, -90.0, 180.0, 90.0],  # west, south, east, north
        "center": [20.0, 0.0],
        "ecozone": "Global Biosphere & Pyromes",
        "peak_season": "Year-Round Continental Cycles",
        "fire_type": "Global biomass burning, forest wildfires, savanna fires, agro-pastoral regimes",
        "description": "Comprehensive worldwide satellite thermal intelligence across all continents, biomes, and satellite overpasses.",
        "typical_viirs_to_modis_ratio": 5.2
    },
    {
        "id": "pantanal_brazil",
        "name": "Pantanal Wetland & Cerrado",
        "country": "Brazil",
        "country_code": "BRA",
        "bbox": [-58.0, -20.5, -55.0, -16.0],  # west, south, east, north
        "center": [-18.25, -56.5],
        "ecozone": "Tropical Wetland / Savanna Mosaic",
        "peak_season": "August - October",
        "fire_type": "Savanna fires, surface wetland peat burns, deforestation clearance",
        "description": "World's largest tropical wetland ecosystem. Highly sensitive to extreme drought years with massive fire surges.",
        "typical_viirs_to_modis_ratio": 4.2
    },
    {
        "id": "california_sierra",
        "name": "California Sierra Nevada & Foothills",
        "country": "United States",
        "country_code": "USA",
        "bbox": [-121.5, 36.5, -118.0, 40.5],
        "center": [38.5, -119.75],
        "ecozone": "Mediterranean Conifer & Chaparral",
        "peak_season": "July - October",
        "fire_type": "Fast-moving chaparral canopy fires, extreme fuel-driven conifer burns",
        "description": "High-severity wildland-urban interface fires influenced by Santa Ana and Diablo wind events.",
        "typical_viirs_to_modis_ratio": 3.8
    },
    {
        "id": "australia_nt",
        "name": "Northern Territory Savanna",
        "country": "Australia",
        "country_code": "AUS",
        "bbox": [130.0, -16.0, 136.0, -11.5],
        "center": [-13.75, 133.0],
        "ecozone": "Tropical Monsoon Savanna & Woodland",
        "peak_season": "September - November",
        "fire_type": "Extensive grass fires, prescribed early-dry-season burning vs late wildfire",
        "description": "One of the most active pyromes globally with frequent cyclical seasonal grass fires.",
        "typical_viirs_to_modis_ratio": 5.1
    },
    {
        "id": "canada_boreal",
        "name": "Alberta Boreal Forest",
        "country": "Canada",
        "country_code": "CAN",
        "bbox": [-118.0, 54.0, -110.0, 59.0],
        "center": [56.5, -114.0],
        "ecozone": "Boreal Conifer & Taiga",
        "peak_season": "May - July",
        "fire_type": "Deep peat smoldering and high-intensity crown fire runs",
        "description": "Boreal mega-fire complexes producing significant smoke plumes reaching hemispheric scales.",
        "typical_viirs_to_modis_ratio": 3.5
    },
    {
        "id": "congo_basin",
        "name": "Congo Basin Savanna Ecotone",
        "country": "DR Congo",
        "country_code": "COD",
        "bbox": [18.0, -8.0, 26.0, -2.0],
        "center": [-5.0, 22.0],
        "ecozone": "Afrotropical Humid Forest / Savanna Transition",
        "peak_season": "June - August",
        "fire_type": "Widespread agricultural slash-and-burn and rotational savanna burning",
        "description": "Globally highest density of small agricultural fire hot spots during the dry season.",
        "typical_viirs_to_modis_ratio": 6.3
    }
]

def get_aoi_by_id(aoi_id: str):
    for aoi in REFERENCE_AOIS:
        if aoi["id"] == aoi_id:
            return aoi
    return None
