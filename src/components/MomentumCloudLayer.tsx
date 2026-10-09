import { useEffect, useMemo } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  buildTerritoryId,
  normalizeLookupName,
  type GeoFeatureCollection,
  type RegionKey,
  type RiskItem,
} from '../lib/snapshot'

type MomentumCloudLayerProps = {
  region: RegionKey
  polygons: GeoFeatureCollection
  riskItems: RiskItem[]
}

type CloudAnchor = {
  position: L.LatLng
  score: number
  momentum7: number
  momentum14: number
  directionX: number
  directionY: number
  strength: number
  phase: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function locateAnchors(
  region: RegionKey,
  polygons: GeoFeatureCollection,
  riskItems: RiskItem[],
): CloudAnchor[] {
  const riskById = new Map(riskItems.map((item) => [item.id, item]))
  const positions = new Map<string, L.LatLng>()

  for (const feature of polygons.features) {
    const properties = feature.properties ?? {}
    const featureRegion = normalizeLookupName(
      String(properties.region ?? properties.region_type ?? ''),
    )
    if (featureRegion !== normalizeLookupName(region)) continue

    const name = String(
      properties.name ?? properties.Name ?? properties.bairro ?? properties.municipio ?? '',
    ).replace(/\s*-\s*AIS.*$/i, '')
    const territoryId = buildTerritoryId(region, name)
    if (!riskById.has(territoryId) || positions.has(territoryId)) continue

    const bounds = L.geoJSON(feature as never).getBounds()
    if (bounds.isValid()) positions.set(territoryId, bounds.getCenter())
  }

  const nodes = riskItems
    .filter((item) => positions.has(item.id))
    .map((item) => ({
      position: positions.get(item.id)!,
      score: clamp(finiteNumber(item.score), 0, 100),
      momentum7: finiteNumber(item.momentum_7d),
      momentum14: finiteNumber(item.momentum_14d),
    }))

  // Gradient between neighboring momentum measurements, not an inferred
  // trajectory of offenders or a forecast of individual occurrences.
  const radiusMeters = region === 'fortaleza' ? 6500 : region === 'rmf' ? 17000 : 42000

  return nodes.map((node, index) => {
    const ownTrend = node.momentum7 + node.momentum14 * 0.45
    let dx = 0
    let dy = 0

    for (const neighbor of nodes) {
      if (neighbor === node) continue
      const distance = node.position.distanceTo(neighbor.position)
      if (distance < 1 || distance > radiusMeters * 2) continue

      const otherTrend = neighbor.momentum7 + neighbor.momentum14 * 0.45
      const delta = otherTrend - ownTrend
      if (delta <= 0) continue

      const spatialWeight = Math.exp(-0.5 * (distance / radiusMeters) ** 2)
      const weight = delta * spatialWeight * (neighbor.score / 100)
      const east = (neighbor.position.lng - node.position.lng) *
        Math.cos((node.position.lat * Math.PI) / 180)
      const north = neighbor.position.lat - node.position.lat
      const magnitude = Math.hypot(east, north) || 1

      dx += (east / magnitude) * weight
      dy -= (north / magnitude) * weight
    }

    const vectorLength = Math.hypot(dx, dy)
    const trendStrength = clamp(Math.abs(ownTrend) / 3, 0, 1)

    return {
      ...node,
      directionX: vectorLength > 0.001 ? dx / vectorLength : 0,
      directionY: vectorLength > 0.001 ? dy / vectorLength : 0,
      strength: trendStrength,
      phase: index * 1.618,
    }
  })
}

/** Additive, read-only visualization of the existing static risk snapshot. */
export function MomentumCloudLayer({
  region,
  polygons,
  riskItems,
}: MomentumCloudLayerProps) {
  const map = useMap()
  const anchors = useMemo(
    () => locateAnchors(region, polygons, riskItems),
    [region, polygons, riskItems],
  )

  useEffect(() => {
    const pane = map.getPane('momentum-cloud')
    if (!pane) return

    const canvas = document.createElement('canvas')
    canvas.className = 'momentum-cloud-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.position = 'absolute'
    canvas.style.pointerEvents = 'none'
    pane.appendChild(canvas)

    const context = canvas.getContext('2d', { alpha: true })
    if (!context) {
      canvas.remove()
      return
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let lastFrame = 0
    let initialized = false
    let isVisible = !document.hidden
    let reducedMotion = media.matches

    function resizeCanvas(): void {
      const size = map.getSize()
      if (size.x <= 0 || size.y <= 0) return

      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(1, Math.round(size.x * pixelRatio))
      const height = Math.max(1, Math.round(size.y * pixelRatio))

      canvas.style.width = size.x + 'px'
      canvas.style.height = size.y + 'px'
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context!.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    }

    function draw(now: number): void {
      const size = map.getSize()
      if (size.x <= 0 || size.y <= 0) return
      resizeCanvas()
      context!.clearRect(0, 0, size.x, size.y)

      // This animation encodes the momentum already stored in the snapshot;
      // the oscillation is illustrative, NOT a historical time series.
      const elapsed = reducedMotion ? 0 : now
      const wave = Math.sin((elapsed * 2 * Math.PI) / 17000)
      const zoom = map.getZoom()
      const baseRadius = clamp(26 + zoom * 3.6, 38, 90)

      for (const anchor of anchors) {
        const location = map.latLngToContainerPoint(anchor.position)
        const trend = clamp(
          (anchor.momentum7 + anchor.momentum14 * 0.45) / 3,
          -1,
          1,
        )
        const oscillation = reducedMotion ? 0 : Math.sin(elapsed / 2450 + anchor.phase)
        const spread = clamp(1 + trend * (0.18 + oscillation * 0.10), 0.7, 1.35)
        const radius = baseRadius * spread
        const drift = reducedMotion ? 0 : (wave * 12 * anchor.strength)
        const x = location.x + anchor.directionX * drift
        const y = location.y + anchor.directionY * drift
        if (x < -radius || y < -radius || x > size.x + radius || y > size.y + radius) {
          continue
        }

        const power = clamp((anchor.score / 100) ** 1.35, 0.08, 1)
        const trendEffect = clamp(1 + trend * 0.22, 0.7, 1.25)
        const alpha = power * trendEffect

        const gradient = context!.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, `rgba(153,27,27,${(0.43 * alpha).toFixed(3)})`)
        gradient.addColorStop(0.26, `rgba(234,88,12,${(0.37 * alpha).toFixed(3)})`)
        gradient.addColorStop(0.60, `rgba(250,204,21,${(0.25 * alpha).toFixed(3)})`)
        gradient.addColorStop(1, 'rgba(250,204,21,0)')
        context!.fillStyle = gradient
        context!.beginPath()
        context!.arc(x, y, radius, 0, Math.PI * 2)
        context!.fill()
      }
    }

    function onMapChange(): void {
      resizeCanvas()
      draw(performance.now())
    }

    function onVisibilityChange(): void {
      isVisible = !document.hidden
      if (isVisible) onMapChange()
    }

    function onMotionPreference(event: MediaQueryListEvent): void {
      reducedMotion = event.matches
      onMapChange()
    }

    function animate(time: number): void {
      if (!initialized || (isVisible && time - lastFrame >= 80)) {
        if (isVisible) draw(time)
        initialized = true
        lastFrame = time
      }
      frame = window.requestAnimationFrame(animate)
    }

    map.on('move zoom resize', onMapChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    media.addEventListener('change', onMotionPreference)
    resizeCanvas()
    frame = window.requestAnimationFrame(animate)

    return () => {
      window.cancelAnimationFrame(frame)
      map.off('move zoom resize', onMapChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      media.removeEventListener('change', onMotionPreference)
      canvas.remove()
    }
  }, [map, anchors])

  return null
}
