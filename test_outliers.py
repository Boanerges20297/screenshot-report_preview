import json
import sys

with open('C:/Users/Boanerges/Desktop/Projetos/screenshot-report_preview/public/data/cvli_points.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

outside_count = 0
for feat in data.get('features', []):
    props = feat.get('properties', {})
    coords = feat.get('geometry', {}).get('coordinates', [0, 0])
    lng, lat = coords
    # Ceara is roughly between lat -8.0 and -2.8, lng -41.5 and -37.0
    if lat < -8.0 or lat > -2.8 or lng < -41.5 or lng > -37.0:
        print(f"OUTSIDE CEARA BBOX: {props.get('cidade')} -> lat: {lat}, lng: {lng}")
        outside_count += 1
    
print(f"Total outside rough bbox: {outside_count}")
