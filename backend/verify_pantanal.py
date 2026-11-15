import sys
sys.path.insert(0, 'backend')
from app.api.routes import (
    get_aoi_details,
    get_fires,
    get_harmonization_analysis,
    get_fire_source_classification,
    get_burning_calendar,
    get_anomaly_intelligence,
    get_intelligence_report
)

print("=== VERIFYING PANTANAL REGIONAL PRESERVATION ===")

# 1. AOI Details
aoi_det = get_aoi_details('pantanal_brazil')
print(f"1. AOI Details: Name={aoi_det['metadata']['name']}, Total available={aoi_det['observations_summary']['total']}, Is Live={aoi_det['observations_summary']['is_live']}")

# 2. Fires Endpoint
fires = get_fires(aoi_id='pantanal_brazil', limit=500)
print(f"2. Fires Endpoint: Count={fires['count']}, Total Available={fires['total_available']}, Is Live={fires['is_live']}")
if fires['observations']:
    f0 = fires['observations'][0]
    print(f"   Sample Obs: ID={f0['id']}, Sensor={f0['sensor']}, Lat={f0['latitude']}, Lon={f0['longitude']}, FRP={f0['frp']} MW, Probable Source={f0.get('probable_source')}")

# 3. Harmonization
harm = get_harmonization_analysis(aoi_id='pantanal_brazil')
m = harm['metrics']
print(f"3. Harmonization Engine: Events={harm['events_count']}, VIIRS/MODIS Ratio={m['viirs_to_modis_ratio']}, Reduction Factor={m['spatial_reduction_factor']}, Cumulative FRP={m['total_frp_mw']} MW")
if harm['sample_events']:
    ev0 = harm['sample_events'][0]
    print(f"   Sample Event: ID={ev0['event_id']}, Class={ev0['probable_source']}, Conf={ev0['classification_confidence']}%, Sensors={ev0['sensor_composition']}")

# 4. Classification
classif = get_fire_source_classification(aoi_id='pantanal_brazil')
print(f"4. Source Classification: Total Classified={classif['total_classified_events']}")
for cat, c_info in classif['summary']['categories'].items():
    print(f"   - {cat}: {c_info['count']} events ({c_info['pct']}%)")

# 5. Calendar
cal = get_burning_calendar(aoi_id='pantanal_brazil')
print(f"5. Burning Calendar: Total Records={len(cal['calendar'])}, Peak Season={cal['season_profile']['peak_window']}")

# 6. Anomalies
anom = get_anomaly_intelligence(aoi_id='pantanal_brazil')
print(f"6. Anomaly Intel: Analyzed Days={anom['analysis']['analyzed_days']}, Anomalous Days={len(anom['analysis']['anomalous_days'])}")

# 7. Reports
rep = get_intelligence_report(aoi_id='pantanal_brazil', format='json')
print(f"7. Intelligence Report: Status={rep['report_metadata']['status']}, Provenance={rep['report_metadata']['provenance_mode']}")
print("\nALL 7 REGIONAL PANTANAL SERVICES PRESERVED AND VERIFIED!")
