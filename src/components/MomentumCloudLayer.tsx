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
  cvliPoints: GeoFeatureCollection
  speed: number
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
  validationStatus: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function observedDrift(points: GeoFeatureCollection): { x: number; y: number; valid: boolean } {
  const dated = points.features.map((feature) => {
    const time = Date.parse(String(feature.properties?.data ?? '').slice(0, 10))
    const coordinates = feature.geometry?.coordinates
    if (!Number.isFinite(time) || !Array.isArray(coordinates)) return null
    const lng = Number(coordinates[0]); const lat = Number(coordinates[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? { time, lng, lat } : null
  }).filter((item): item is { time: number; lng: number; lat: number } => item !== null)
  if (dated.length < 6) return { x: 0, y: 0, valid: false }
  const latest = Math.max(...dated.map((item) => item.time)); const day = 86_400_000
  const recent = dated.filter((item) => latest - item.time <= 30 * day)
  const previous = dated.filter((item) => latest - item.time > 30 * day && latest - item.time <= 60 * day)
  if (recent.length < 3 || previous.length < 3) return { x: 0, y: 0, valid: false }
  const center = (items: typeof dated) => ({
    lng: items.reduce((sum, item) => sum + item.lng, 0) / items.length,
    lat: items.reduce((sum, item) => sum + item.lat, 0) / items.length,
  })
  const current = center(recent); const prior = center(previous)
  const east = (current.lng - prior.lng) * Math.cos((current.lat * Math.PI) / 180)
  const north = current.lat - prior.lat; const magnitude = Math.hypot(east, north)
  return magnitude < 1e-5 ? { x: 0, y: 0, valid: false } : { x: east / magnitude, y: -north / magnitude, valid: true }
}

function locateAnchors(
  region: RegionKey,
  polygons: GeoFeatureCollection,
  riskItems: RiskItem[],
  drift: { x: number; y: number; valid: boolean },
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
      validationStatus: item.trend_validation?.status ?? 'indeterminado',
    }))

  return nodes.map((node, index) => {
    const ownTrend = node.momentum7 + node.momentum14 * 0.45
    const validationFactor = node.validationStatus.startsWith('confirmada') ? 1 :
      node.validationStatus === 'estavel' ? 0.65 : 0.35
    const trendStrength = clamp((Math.abs(ownTrend) / 3) * validationFactor, 0, 1)

    return {
      ...node,
      directionX: drift.valid ? drift.x : 0,
      directionY: drift.valid ? drift.y : 0,
      strength: drift.valid ? trendStrength : 0,
      phase: index * 1.618,
    }
  })
}

/** Additive, read-only visualization of the existing static risk snapshot. */
export function MomentumCloudLayer({
  region,
  polygons,
  riskItems,
  cvliPoints,
  speed,
}: MomentumCloudLayerProps) {
  const map = useMap()
  const drift = useMemo(() => observedDrift(cvliPoints), [cvliPoints])
  const anchors = useMemo(
    () => locateAnchors(region, polygons, riskItems, drift),
    [region, polygons, riskItems, drift],
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

      // The snapshot is static: two overlapping fronts continuously traverse
      // the current spatial momentum gradient. This is illustrative movement,
      // NOT a playback of actual crimes, observed paths or future forecasts.
      const elapsed = reducedMotion ? 0 : now
      const cycle = (elapsed * clamp(speed, 0.5, 2.5)) / 12500
      const baseRadius = clamp(26 + map.getZoom() * 3.6, 38, 90)

      function paintCloud(x: number, y: number, radius: number, alpha: number): void {
        if (alpha <= 0.001 || x < -radius || y < -radius ||
            x > size.x + radius || y > size.y + radius) return
        const gradient = context!.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, `rgba(127,14,14,${clamp(0.82 * alpha, 0, 0.98)})`)
        gradient.addColorStop(0.30, `rgba(220,55,10,${clamp(0.68 * alpha, 0, 0.95)})`)
        gradient.addColorStop(0.64, `rgba(245,158,11,${clamp(0.48 * alpha, 0, 0.9)})`)
        gradient.addColorStop(1, 'rgba(250,204,21,0)')
        context!.fillStyle = gradient
        context!.beginPath()
        context!.arc(x, y, radius, 0, Math.PI * 2)
        context!.fill()
      }

      for (const anchor of anchors) {
        const location = map.latLngToContainerPoint(anchor.position)
        const trend = clamp(
          (anchor.momentum7 + anchor.momentum14 * 0.45) / 3, -1, 1,
        )
        const power = clamp((anchor.score / 100) ** 1.35, 0.08, 1)
        const baseIntensity = power * clamp(1 + 0.22 * trend, 0.68, 1.25)

        if (reducedMotion) {
          paintCloud(location.x, location.y, baseRadius, baseIntensity)
          continue
        }

        // Stable low-opacity reference keeps hotspot geography recognizable.
        paintCloud(location.x, location.y, baseRadius * 1.08, baseIntensity * 0.26)

        // Two fronts, offset half a cycle: their edges fade to zero before
        // wrapping, so the animation never jumps back to its starting point.
        const travel = clamp(baseRadius * (0.95 + anchor.strength * 0.50), 48, 130)
        for (let front = 0; front < 2; front += 1) {
          const progress = (cycle + anchor.phase * 0.025 + front * 0.5) % 1
          const visibility = Math.sin(Math.PI * progress) ** 1.35
          const progressFromCenter = progress - 0.5
          const offset = progressFromCenter * 2 * travel
          const x = location.x + anchor.directionX * offset
          const y = location.y + anchor.directionY * offset
          const radius = baseRadius * clamp(
            1 + progressFromCenter * 0.72 + trend * 0.22,
            0.65, 1.45,
          )
          paintCloud(x, y, radius, baseIntensity * visibility * 1.22)
        }
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
      if (!initialized || (isVisible && time - lastFrame >= 50)) {
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
  }, [map, anchors, speed])

  return null
}
