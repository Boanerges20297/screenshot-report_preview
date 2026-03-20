import { useEffect, useRef, type MutableRefObject } from 'react'
import { GeoJSON, MapContainer, Pane, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Layer } from 'leaflet'
import {
  buildTerritoryId,
  factionColor,
  normalizeLookupName,
  riskLevelColor,
  type GeoFeature,
  type GeoFeatureCollection,
  type RegionKey,
  type RiskItem,
  type TerritoryDetail,
} from '../lib/snapshot'

type OperationalMapProps = {
  region: RegionKey
  polygons: GeoFeatureCollection
  top30: GeoFeatureCollection
  micronodes: GeoFeatureCollection
  riskItems: RiskItem[]
  territoryDetails: Record<string, TerritoryDetail>
  selectedId: string | null
  showMicronodes: boolean
  onSelectTerritory: (territoryId: string) => void
}

type SelectableLayer = Layer & {
  feature?: GeoFeature
  getBounds?: () => L.LatLngBounds
  openPopup?: () => void
  setStyle?: (style: L.PathOptions) => void
  bringToFront?: () => void
}

const REGION_VIEW: Record<RegionKey, { center: [number, number]; zoom: number }> = {
  fortaleza: { center: [-3.79, -38.54], zoom: 11 },
  rmf: { center: [-3.78, -38.7], zoom: 9 },
  interior: { center: [-5.1, -39.6], zoom: 7 },
}

function toFeatureCollection(payload: GeoFeatureCollection): GeoFeatureCollection {
  if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload
  }

  return {
    type: 'FeatureCollection',
    features: Array.isArray(payload?.features) ? payload.features : [],
  }
}

function extractFeatureName(feature: GeoFeature | undefined): string {
  return String(
    feature?.properties?.name ??
      feature?.properties?.Name ??
      feature?.properties?.bairro ??
      feature?.properties?.municipio ??
      '',
  )
}

function normalizePolygonName(value: string): string {
  return normalizeLookupName(value.replace(/\s*-\s*AIS.*$/i, ''))
}

function FitToRegion({ polygons, region }: { polygons: GeoFeatureCollection; region: RegionKey }) {
  const map = useMap()

  useEffect(() => {
    const bounds = L.latLngBounds([])
    const regionLayers = L.geoJSON(toFeatureCollection(polygons) as never, {
      filter: (feature) => normalizeLookupName(String(feature?.properties?.region_type ?? '')) === normalizeLookupName(region),
    })

    if (regionLayers.getLayers().length > 0) {
      bounds.extend(regionLayers.getBounds())
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.03), { animate: true, maxZoom: REGION_VIEW[region].zoom })
      return
    }

    const fallback = REGION_VIEW[region]
    map.setView(fallback.center, fallback.zoom)
  }, [map, polygons, region])

  return null
}

function FocusSelectedTerritory({
  selectedId,
  region,
  riskById,
  layerRegistryRef,
}: {
  selectedId: string | null
  region: RegionKey
  riskById: Map<string, RiskItem>
  layerRegistryRef: MutableRefObject<Map<string, Layer>>
}) {
  const map = useMap()

  useEffect(() => {
    layerRegistryRef.current.forEach((layer) => {
      const featureLayer = layer as SelectableLayer
      if (typeof featureLayer.setStyle === 'function') {
        featureLayer.setStyle(topLayerStyle(featureLayer.feature, riskById, selectedId))
      }
    })

    const selectedLayer = (selectedId ? layerRegistryRef.current.get(selectedId) : null) as SelectableLayer | null
    if (!selectedLayer) {
      return
    }

    if (typeof selectedLayer.bringToFront === 'function') {
      selectedLayer.bringToFront()
    }

    if (typeof selectedLayer.getBounds === 'function') {
      const bounds = selectedLayer.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.35), { animate: true, maxZoom: Math.max(REGION_VIEW[region].zoom + 1, 12) })
      }
    }
    if (typeof selectedLayer.openPopup === 'function') {
      selectedLayer.openPopup()
    }
  }, [layerRegistryRef, map, region, riskById, selectedId])

  return null
}

function topLayerStyle(feature: GeoFeature | undefined, riskById: Map<string, RiskItem>, selectedId: string | null) {
  const name = normalizePolygonName(extractFeatureName(feature))
  const region = String(feature?.properties?.region ?? feature?.properties?.region_type ?? 'fortaleza') as RegionKey
  const territoryId = buildTerritoryId(region, name)
  const riskItem = riskById.get(territoryId)
  const score = riskItem?.score ?? Number(feature?.properties?.risk_score ?? feature?.properties?.risk_score_cvli ?? 0)
  const isSelected = territoryId === selectedId
  const isHigh = score >= 51
  const fillOpacity = score >= 71 ? 0.6 : score >= 51 ? 0.45 : score >= 31 ? 0.28 : 0.12

  return {
    color: isSelected ? '#ffffff' : isHigh ? '#ffffff' : '#999999',
    weight: isSelected ? 4 : isHigh ? 2 : 1,
    fillColor: riskLevelColor(score),
    fillOpacity: isSelected ? 0.6 : fillOpacity,
    opacity: 1,
    dashArray: '3',
  }
}

export function OperationalMap({
  region,
  polygons,
  top30: _top30,
  micronodes,
  riskItems,
  territoryDetails,
  selectedId,
  showMicronodes,
  onSelectTerritory,
}: OperationalMapProps) {
  const riskById = new Map(riskItems.map((item) => [item.id, item]))
  const layerRegistryRef = useRef<Map<string, Layer>>(new Map())
  const polygonCollection = toFeatureCollection(polygons)
  const regionPolygons: GeoFeatureCollection = {
    type: 'FeatureCollection',
    features: polygonCollection.features.filter(
      (feature) => normalizeLookupName(String(feature.properties?.region_type ?? '')) === normalizeLookupName(region),
    ),
  }

  function bindTopPopup(feature: GeoFeature | undefined, layer: Layer) {
    if (!feature) {
      return
    }
    const name = extractFeatureName(feature)
    const territoryId = buildTerritoryId(region, normalizePolygonName(name))
    const riskItem = riskById.get(territoryId)
    const detail = territoryDetails[territoryId]

    layer.on({
      click: () => onSelectTerritory(territoryId),
    })

    layerRegistryRef.current.set(territoryId, layer)

    layer.bindPopup(`
      <div style="min-width:240px;font-family:system-ui,sans-serif;">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">Top 30 ${region.toUpperCase()}</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:4px;">${name}</div>
        <div style="margin-top:8px;font-size:13px;color:#334155;">
          <div><strong>Risco:</strong> ${riskItem?.score?.toFixed(1) ?? '0.0'}%</div>
          <div><strong>Facção:</strong> ${detail?.faction ?? feature.properties.faction ?? 'N/A'}</div>
          <div><strong>Momentum 14d:</strong> ${detail?.momentum_14d ?? riskItem?.momentum_14d ?? 0}</div>
          <div><strong>CVLI recente:</strong> ${detail?.recent_cvli ?? riskItem?.recent_cvli ?? 0}</div>
          <div><strong>Exógenos:</strong> ${detail?.recent_exogenous ?? riskItem?.recent_exogenous ?? 0}</div>
        </div>
        <div style="margin-top:10px;font-size:12px;color:#475569;line-height:1.45;">${detail?.summary ?? riskItem?.summary ?? 'Sem resumo congelado.'}</div>
      </div>
    `)
  }

  function bindMicronodePopup(feature: GeoFeature | undefined, layer: Layer) {
    if (!feature) {
      return
    }
    const props = feature.properties
    const area = String(props.area_oficial ?? props.micronodo ?? 'Micronodo')
    layer.bindPopup(`
      <div style="min-width:220px;font-family:system-ui,sans-serif;">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;">ORCRIM</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:4px;">${area}</div>
        <div style="margin-top:8px;font-size:13px;color:#334155;">
          <div><strong>Micronodo:</strong> ${String(props.micronodo ?? 'N/A')}</div>
          <div><strong>Facção:</strong> ${String(props.faction ?? 'N/A')}</div>
        </div>
      </div>
    `)
  }

  useEffect(() => {
    layerRegistryRef.current = new Map()
  }, [region])

  return (
    <MapContainer center={REGION_VIEW[region].center} zoom={REGION_VIEW[region].zoom} className="map-shell" zoomControl={false}>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <FitToRegion polygons={regionPolygons} region={region} />
      <FocusSelectedTerritory
        selectedId={selectedId}
        region={region}
        riskById={riskById}
        layerRegistryRef={layerRegistryRef}
      />

      <Pane name="top30" style={{ zIndex: 420 }}>
        <GeoJSON
          key={`risk-polygons-${region}`}
          data={regionPolygons as never}
          style={(feature) => topLayerStyle(feature as unknown as GeoFeature, riskById, selectedId)}
          onEachFeature={(feature, layer) => bindTopPopup(feature as unknown as GeoFeature, layer)}
        />
      </Pane>

      {showMicronodes ? (
        <Pane name="micronodes" style={{ zIndex: 430 }}>
          <GeoJSON
            key={`micronodes-${region}`}
            data={micronodes as never}
            filter={(feature) => normalizeLookupName(String(feature?.properties?.region ?? '')) === normalizeLookupName(region)}
            pointToLayer={(feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 4,
                weight: 1,
                color: '#e2e8f0',
                fillColor: factionColor(String(feature.properties?.faction ?? 'N/A')),
                fillOpacity: 0.9,
              })
            }
            onEachFeature={(feature, layer) => bindMicronodePopup(feature as unknown as GeoFeature, layer)}
          />
        </Pane>
      ) : null}
    </MapContainer>
  )
}