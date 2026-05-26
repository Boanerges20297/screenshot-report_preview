import { useState, useEffect, useRef, type MutableRefObject } from 'react'
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
import { MapSearchBox } from './MapSearchBox'

type OperationalMapProps = {
  region: RegionKey
  polygons: GeoFeatureCollection
  top30: GeoFeatureCollection
  top30EliteP10: GeoFeatureCollection
  micronodes: GeoFeatureCollection
  cvliPoints: GeoFeatureCollection
  riskItems: RiskItem[]
  territoryDetails: Record<string, TerritoryDetail>
  selectedId: string | null
  focusTrigger: number
  showMicronodes: boolean
  showTop30: boolean
  showEliteP10: boolean
  showCvliPoints: boolean
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
  fortaleza: { center: [-3.75, -38.53], zoom: 12 },
  rmf: { center: [-3.85, -38.6], zoom: 11 },
  interior: { center: [-5.1, -39.6], zoom: 7 },
}

function getPeakHoursFromSources(
  detail?: TerritoryDetail | null,
  riskItem?: RiskItem | null,
  props?: Record<string, unknown> | null,
): string {
  const fromDetail = String(detail?.peak_hours ?? '').trim()
  if (fromDetail) {
    return fromDetail
  }
  const fromRisk = String(riskItem?.peak_hours ?? '').trim()
  if (fromRisk) {
    return fromRisk
  }
  const fromProps = String(props?.peak_hours ?? '').trim()
  if (fromProps) {
    return fromProps
  }
  const metrics = props?.metrics as Record<string, unknown> | undefined
  return String(metrics?.peak_hours ?? '').trim()
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

function cvliPointBelongsToRegion(feature: GeoFeature | undefined, region: RegionKey): boolean {
  const props = feature?.properties || {}
  const pointRegion = normalizeLookupName(String(props.region ?? ''))
  const pointCity = normalizeLookupName(String(props.cidade ?? props.city ?? ''))

  if (region === 'fortaleza' && pointCity !== 'fortaleza') {
    return false
  }

  return pointRegion === normalizeLookupName(region)
}

function FitToRegion({ region, polygons }: { polygons: GeoFeatureCollection; region: RegionKey }) {
  const map = useMap()

  useEffect(() => {
    if (polygons && polygons.features.length > 0) {
      const geoJsonLayer = L.geoJSON(polygons as never)
      const bounds = geoJsonLayer.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { animate: true, padding: [10, 10] })
        return
      }
    }
    const view = REGION_VIEW[region]
    map.setView(view.center, view.zoom, { animate: true })
  }, [map, region, polygons])

  return null
}

function FocusSelectedTerritory({
  selectedId,
  region,
  focusTrigger,
  riskById,
  layerRegistryRef,
}: {
  selectedId: string | null
  region: RegionKey
  focusTrigger: number
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
        map.fitBounds(bounds.pad(0.35), { 
          animate: true, 
          maxZoom: Math.max(REGION_VIEW[region].zoom + 1, 12),
          paddingTopLeft: [0, 80],
          paddingBottomRight: [0, 100]
        })
      }
    }
    if (typeof selectedLayer.openPopup === 'function') {
      selectedLayer.openPopup()
    }
  }, [layerRegistryRef, map, region, riskById, selectedId, focusTrigger])

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
  top30EliteP10,
  micronodes,
  cvliPoints,
  riskItems,
  territoryDetails,
  selectedId,
  focusTrigger,
  showMicronodes,
  showTop30,
  showEliteP10,
  showCvliPoints,
  onSelectTerritory,
}: OperationalMapProps) {
  const [map, setMap] = useState<L.Map | null>(null)
  const riskById = new Map(riskItems.map((item) => [item.id, item]))
  const layerRegistryRef = useRef<Map<string, Layer>>(new Map())
  const polygonCollection = toFeatureCollection(polygons)
  const regionPolygons: GeoFeatureCollection = {
    type: 'FeatureCollection',
    features: polygonCollection.features.filter(
      (feature) => normalizeLookupName(String(feature.properties?.region ?? feature.properties?.region_type ?? '')) === normalizeLookupName(region),
    ),
  }

  // Derive polygonal Elite P10 geometries by matching with base polygons
  const eliteCollection = toFeatureCollection(top30EliteP10)
  const elitePropsMap = new Map<string, any>()
  eliteCollection.features.forEach(f => {
    const name = normalizePolygonName(String(f.properties?.bairro ?? f.properties?.name ?? ''))
    if (name) elitePropsMap.set(name, f.properties)
  })

  const elitePolygons: GeoFeatureCollection = {
    type: 'FeatureCollection',
    features: regionPolygons.features.filter(f => {
      const name = normalizePolygonName(extractFeatureName(f))
      return elitePropsMap.has(name)
    }).map(f => {
      const name = normalizePolygonName(extractFeatureName(f))
      return {
        ...f,
        properties: {
          ...f.properties,
          ...elitePropsMap.get(name)
        }
      }
    })
  }

  function bindTopPopup(feature: GeoFeature | undefined, layer: Layer) {
    if (!feature) {
      return
    }
    const name = extractFeatureName(feature)
    const territoryId = buildTerritoryId(region, normalizePolygonName(name))
    const riskItem = riskById.get(territoryId)
    const detail = territoryDetails[territoryId]
    const peakHours = getPeakHoursFromSources(detail, riskItem, feature.properties)

    layer.on({
      click: () => onSelectTerritory(territoryId),
    })

    layerRegistryRef.current.set(territoryId, layer)

    layer.bindPopup(`
      <div style="min-width:240px;font-family:'Inter',system-ui,sans-serif;">
        <div style="font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#f97316;font-weight:800;">
          Top 30 · ${region.toUpperCase()}
        </div>
        <div style="font-size:17px;font-weight:700;color:var(--text-heading);margin-top:6px;">${name}</div>
        <div style="margin-top:10px;font-size:12px;color:#94a3b8;display:grid;gap:4px;">
          <div><span style="color:#64748b;">Risco</span> <strong style="color:#f97316;">${riskItem?.score?.toFixed(1) ?? '0.0'}%</strong></div>
          <div><span style="color:#64748b;">Facção</span> <strong style="color:#e2e8f0;">${detail?.faction ?? feature.properties?.faction ?? 'N/A'}</strong></div>
          <div><span style="color:#64748b;">Momentum 14d</span> <strong style="color:#e2e8f0;">${detail?.momentum_14d ?? riskItem?.momentum_14d ?? 0}</strong></div>
          <div><span style="color:#64748b;">CVLI recente</span> <strong style="color:#e2e8f0;">${detail?.recent_cvli ?? riskItem?.recent_cvli ?? 0}</strong></div>
          <div><span style="color:#64748b;">Exógenos</span> <strong style="color:#e2e8f0;">${detail?.recent_exogenous ?? riskItem?.recent_exogenous ?? 0}</strong></div>
          ${peakHours ? `<div><span style="color:#64748b;">Horário crítico</span> <strong style="color:#fdba74;">⏱ ${peakHours}</strong></div>` : ''}
        </div>
        ${detail?.summary || riskItem?.summary ? `<div style="margin-top:10px;font-size:11px;color:#64748b;line-height:1.5;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px;">${detail?.summary ?? riskItem?.summary}</div>` : ''}
      </div>
    `)

    layer.bindTooltip(`
      <div style="font-family:'Inter',system-ui,sans-serif;text-align:center;">
        <div style="font-weight:700;color:var(--text-heading);font-size:13px;">${name}</div>
        <div style="font-weight:600;color:#f97316;font-size:12px;margin-top:2px;">Risco: ${riskItem?.score?.toFixed(1) ?? '0.0'}%</div>
        ${peakHours ? `<div style="color:#fdba74;font-size:11px;margin-top:2px;">⏱ ${peakHours}</div>` : ''}
      </div>
    `, { sticky: true, direction: 'auto', className: 'territory-tooltip' })
  }

  function bindMicronodePopup(feature: GeoFeature | undefined, layer: Layer) {
    if (!feature) {
      return
    }
    const props = feature.properties || {}
    const area = String(props.area_oficial ?? props.micronodo ?? 'Micronodo')
    const peakHours = getPeakHoursFromSources(null, null, props)
    layer.bindPopup(`
      <div style="min-width:220px;font-family:'Inter',system-ui,sans-serif;">
        <div style="font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#94a3b8;font-weight:800;">ORCRIM</div>
        <div style="font-size:16px;font-weight:700;color:var(--text-heading);margin-top:6px;">${area}</div>
        <div style="margin-top:10px;font-size:12px;color:#94a3b8;display:grid;gap:4px;">
          <div><span style="color:#64748b;">Micronodo</span> <strong style="color:#e2e8f0;">${String(props.micronodo ?? 'N/A')}</strong></div>
          <div><span style="color:#64748b;">Facção</span> <strong style="color:#e2e8f0;">${String(props.faction ?? 'N/A')}</strong></div>
          ${peakHours ? `<div><span style="color:#64748b;">Horário crítico</span> <strong style="color:#fdba74;">⏱ ${peakHours}</strong></div>` : ''}
        </div>
      </div>
    `)

    layer.bindTooltip(`
      <div style="font-family:'Inter',system-ui,sans-serif;text-align:center;">
        <div style="font-weight:700;color:#94a3b8;font-size:12px;">ORCRIM</div>
        <div style="font-weight:600;color:var(--text-heading);font-size:13px;margin-top:2px;">${area}</div>
        <div style="color:#64748b;font-size:11px;margin-top:2px;">Facção: ${String(props.faction ?? 'N/A')}</div>
        ${peakHours ? `<div style="color:#fdba74;font-size:11px;margin-top:2px;">⏱ ${peakHours}</div>` : ''}
      </div>
    `, { sticky: true, direction: 'auto', className: 'micronode-tooltip' })
  }

  function bindElitePopup(feature: GeoFeature | undefined, layer: Layer) {
    if (!feature) {
      return
    }
    const props = feature.properties || {}
    const peakHours = getPeakHoursFromSources(null, null, props)
    layer.bindPopup(`
      <div style="min-width:240px;font-family:'Inter',system-ui,sans-serif;">
        <div style="font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#f87171;font-weight:800;">⚠ ELITE P10 · ALTA PRIORIDADE</div>
        <div style="font-size:17px;font-weight:700;color:var(--text-heading);margin-top:6px;">${props.bairro ?? 'Território Elite'}</div>
        <div style="margin-top:10px;font-size:12px;color:#94a3b8;display:grid;gap:4px;">
          <div><span style="color:#64748b;">Rank</span> <strong style="color:#e2e8f0;">#${props.rank ?? 'N/A'}</strong></div>
          <div><span style="color:#64748b;">Risco</span> <strong style="color:#f87171;">${props.indice_risco ?? 'N/A'}%</strong></div>
          <div><span style="color:#64748b;">Natureza</span> <strong style="color:#e2e8f0;">${props.natureza ?? 'N/A'}</strong></div>
          <div><span style="color:#64748b;">Raio</span> <strong style="color:#e2e8f0;">${props.raio ?? 'N/A'}</strong></div>
          ${peakHours ? `<div><span style="color:#64748b;">Horário crítico</span> <strong style="color:#fdba74;">⏱ ${peakHours}</strong></div>` : ''}
        </div>
        <div style="margin-top:10px;padding:8px;background:rgba(239,68,68,0.12);border-radius:6px;font-size:11px;color:#f87171;border:1px solid rgba(239,68,68,0.25);">
          <strong>Alerta:</strong> Micronodo pertence à elite P10 de maior criticidade tática.
        </div>
      </div>
    `)

    layer.bindTooltip(`
      <div style="font-family:'Inter',system-ui,sans-serif;text-align:center;">
        <div style="font-weight:700;color:#f87171;font-size:12px;">Elite P10</div>
        <div style="font-weight:600;color:var(--text-heading);font-size:13px;margin-top:2px;">${props.bairro ?? 'Território'}</div>
        <div style="color:#f87171;font-size:11px;margin-top:2px;">Risco: ${props.indice_risco ?? 'N/A'}%</div>
        ${peakHours ? `<div style="color:#fdba74;font-size:11px;margin-top:2px;">⏱ ${peakHours}</div>` : ''}
      </div>
    `, { sticky: true, direction: 'auto', className: 'elite-tooltip' })
  }

  function bindCvliPopup(feature: GeoFeature | undefined, layer: Layer) {
    if (!feature) {
      return
    }
    const props = feature.properties || {}
    const local = String(props.local ?? props.rua ?? '').trim()
    const bairro = String(props.bairro ?? 'Nao informado')
    const cidade = String(props.cidade ?? 'Nao informada')
    const vitimas = String(props.vitimas ?? 1)
    const details = `
      <div style="min-width:220px;font-family:'Inter',system-ui,sans-serif;">
        <div style="font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#dc2626;font-weight:800;">CVLI 90 DIAS</div>
        <div style="font-size:15px;font-weight:800;color:#f8fafc;margin-top:6px;">${bairro} - ${cidade}</div>
        <div style="margin-top:9px;font-size:12px;color:#cbd5e1;display:grid;gap:4px;">
          <div><span style="color:#94a3b8;">Data</span> <strong>${String(props.data ?? '')} ${String(props.hora ?? '')}</strong></div>
          ${local ? `<div><span style="color:#94a3b8;">Rua/Local</span> <strong>${local}</strong></div>` : ''}
          <div><span style="color:#94a3b8;">Vitimas</span> <strong>${vitimas}</strong></div>
          ${props.arma ? `<div><span style="color:#94a3b8;">Meio</span> <strong>${String(props.arma)}</strong></div>` : ''}
          <div><span style="color:#94a3b8;">Evento</span> <strong>${String(props.tipo_evento ?? 'CVLI')}</strong></div>
        </div>
      </div>
    `
    layer.bindTooltip(details, { sticky: true, direction: 'top', className: 'cvli-tooltip' })
    layer.bindPopup(details)
  }

  function cvliPinIcon() {
    return L.divIcon({
      className: 'cvli-static-pin',
      html: '<span class="cvli-static-pin-dot"></span>',
      iconSize: [18, 24],
      iconAnchor: [9, 22],
      popupAnchor: [0, -22],
    })
  }
  useEffect(() => {
    layerRegistryRef.current = new Map()
  }, [region])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapSearchBox map={map} polygons={regionPolygons} onSelectTerritory={onSelectTerritory} />
      <MapContainer ref={setMap} center={REGION_VIEW[region].center} zoom={REGION_VIEW[region].zoom} className="map-shell" zoomControl={false}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <FitToRegion polygons={regionPolygons} region={region} />
      <FocusSelectedTerritory
        selectedId={selectedId}
        region={region}
        focusTrigger={focusTrigger}
        riskById={riskById}
        layerRegistryRef={layerRegistryRef}
      />

      {showTop30 && (
        <Pane name="top30-tatico" style={{ zIndex: 425 }}>
          <GeoJSON
            key={`top30-tatico-${region}`}
            data={toFeatureCollection(_top30) as never}
            style={() => ({
              color: '#f97316',
              weight: 2.5,
              fillColor: '#fb923c',
              fillOpacity: 0.25,
            })}
            onEachFeature={(feature, layer) => {
              const props = feature.properties || {}
              const name = props.name ?? props.Name ?? props.bairro ?? 'Território Top 30'
              const peakHours = getPeakHoursFromSources(null, null, props)
              layer.bindPopup(`
                <div style="min-width:220px;font-family:'Inter',system-ui,sans-serif;">
                  <div style="font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#f97316;font-weight:800;">Top 30 Tático</div>
                  <div style="font-size:16px;font-weight:700;color:var(--text-heading);margin-top:6px;">${name}</div>
                  <div style="margin-top:10px;font-size:12px;color:#94a3b8;display:grid;gap:4px;">
                    <div><span style="color:#64748b;">Rank</span> <strong style="color:#e2e8f0;">#${props.rank ?? 'N/A'}</strong></div>
                    <div><span style="color:#64748b;">Risco</span> <strong style="color:#f97316;">${props.risk_score ?? props.indice_risco ?? 'N/A'}%</strong></div>
                    ${peakHours ? `<div><span style="color:#64748b;">Horário crítico</span> <strong style="color:#fdba74;">⏱ ${peakHours}</strong></div>` : ''}
                  </div>
                </div>
              `)
              layer.bindTooltip(`
                <div style="font-family:'Inter',system-ui,sans-serif;text-align:center;">
                  <div style="font-weight:700;color:#f97316;font-size:12px;">Top 30</div>
                  <div style="font-weight:600;color:var(--text-heading);font-size:13px;margin-top:2px;">${name}</div>
                  <div style="color:#f97316;font-size:11px;margin-top:2px;">Risco: ${props.risk_score ?? props.indice_risco ?? 'N/A'}%</div>
                  ${peakHours ? `<div style="color:#fdba74;font-size:11px;margin-top:2px;">⏱ ${peakHours}</div>` : ''}
                </div>
              `, { sticky: true, direction: 'auto', className: 'top30-tooltip' })
            }}
          />
        </Pane>
      )}

      {/* Base Layer - Always show but could be toggled if needed */}
      <Pane name="visao-geral" style={{ zIndex: 410 }}>
        <GeoJSON
          key={`risk-polygons-${region}`}
          data={regionPolygons as never}
          style={(feature) => topLayerStyle(feature as unknown as GeoFeature, riskById, selectedId)}
          onEachFeature={(feature, layer) => bindTopPopup(feature as unknown as GeoFeature, layer)}
        />
      </Pane>

      {showEliteP10 && (
        <Pane name="elite-p10" style={{ zIndex: 440 }}>
          <GeoJSON
            key={`elite-p10-${region}`}
            data={elitePolygons as never}
            style={() => ({
              color: '#8b0000',
              weight: 3,
              fillColor: '#ff0000',
              fillOpacity: 0.35,
              dashArray: '5, 5',
            })}
            onEachFeature={(feature, layer) => bindElitePopup(feature as unknown as GeoFeature, layer)}
          />
        </Pane>
      )}

      {showMicronodes ? (
        <Pane name="micronodes" style={{ zIndex: 430 }}>
          <GeoJSON
            key={`micronodes-${region}`}
            data={micronodes as never}
            filter={(feature) => normalizeLookupName(String(feature?.properties?.region ?? '')) === normalizeLookupName(region)}
            style={(feature) => {
              const geoFeature = feature as unknown as GeoFeature
              const factionStr = String(geoFeature?.properties?.faction ?? 'N/A')
              const color = factionColor(factionStr)
              return {
                color: color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.4,
              }
            }}
            pointToLayer={(feature, latlng) => {
              const fColor = factionColor(String(feature.properties?.faction ?? 'N/A'))
              const svgPolygon = `<svg width="14" height="14" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg"><polygon points="7,0 14,7 7,14 0,7" fill="${fColor}" stroke="#e2e8f0" stroke-width="1.5"/></svg>`
              return L.marker(latlng, {
                icon: L.divIcon({
                  html: svgPolygon,
                  className: 'micronode-polygon-icon',
                  iconSize: [14, 14],
                  iconAnchor: [7, 7]
                })
              })
            }}
            onEachFeature={(feature, layer) => bindMicronodePopup(feature as unknown as GeoFeature, layer)}
          />
        </Pane>
      ) : null}

      {showCvliPoints ? (
        <Pane name="cvli-points" style={{ zIndex: 460 }}>
          <GeoJSON
            key={`cvli-points-${region}`}
            data={cvliPoints as never}
            filter={(feature) => {
              const geoFeature = feature as unknown as GeoFeature
              return cvliPointBelongsToRegion(geoFeature, region)
            }}
            pointToLayer={(_feature, latlng) => L.marker(latlng, { icon: cvliPinIcon(), riseOnHover: true })}
            onEachFeature={(feature, layer) => bindCvliPopup(feature as unknown as GeoFeature, layer)}
          />
        </Pane>
      ) : null}
      </MapContainer>
    </div>
  )
}
