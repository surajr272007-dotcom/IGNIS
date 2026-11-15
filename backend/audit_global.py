import sys
sys.path.insert(0, 'backend')
from app.api.routes import get_global_fire_summary, get_fires

summary = get_global_fire_summary()
print("=== GLOBAL SUMMARY CONTINENT COUNTS ===")
for c in summary['continents']:
    print(f"{c['name']}: {c['count']:,} fires ({c['total_frp']:,.1f} MW) [MODIS: {c['modis']}, VIIRS: {c['viirs']}]")

print("\n=== GLOBAL SUMMARY TOP COUNTRIES ===")
for c in summary['top_countries'][:10]:
    print(f"{c['name']}: {c['count']:,} fires ({c['total_frp']:,.1f} MW)")

print("\n=== VERIFYING ACTUAL GLOBAL COORDINATES (MULTIPLE CONTINENTS) ===")
fires_res = get_fires(aoi_id='global', limit=1000)
obs = fires_res['observations']
by_cont = {}
for o in obs:
    cont = o.get('continent') or 'Unknown'
    if cont not in by_cont:
        by_cont[cont] = []
    by_cont[cont].append(o)

print(f"Retrieved {len(obs)} fires across {len(by_cont)} continents:")
for cont, items in by_cont.items():
    sample = items[0]
    print(f"Continent: {cont:15} | Count: {len(items):3} | Sample: Lat {sample['latitude']:.4f}, Lon {sample['longitude']:.4f} in {sample.get('country')} ({sample.get('proximity_label')})")
