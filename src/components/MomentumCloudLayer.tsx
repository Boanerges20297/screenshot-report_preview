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
  const radiusMeters = region === 'fortaleza' ? 10500 : region === 'rmf' ? 27000 : 90000

  return nodes.map((node, index) => {
    const ownTrend = node.momentum7 + node.momentum14 * 0.45
    let dx = 0
    let dy = 0

    for (const neighbor of nodes) {
      if (neighbor === node) continue
      const distance = node.position.distanceTo(neighbor.position)
      if (distance < 1 || distance > radiusMeters * 2) continue

      const otherTrend = neighbor.momentum7 + neighbor.momentum14 * 0.45
      // Spatial gradient of existing risk and momentum. Signed weights allow
      // the field to evolve in both directions without inventing a route.
      const delta = (otherTrend - ownTrend) +
        ((neighbor.score - node.score) / 35) * 0.45
      if (Math.abs(delta) < 0.001) continue

      const spatialWeight = Math.exp(-0.5 * (distance / radiusMeters) ** 2)
      const weight = delta * spatialWeight * (0.4 + neighbor.score / 100)
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

      // The snapshot is static: two overlapping fronts continuously traverse
      // the current spatial momentum gradient. This is illustrative movement,
      // NOT a playback of actual crimes, observed paths or future forecasts.
      const elapsed = reducedMotion ? 0 : now
      const cycle = elapsed / 12500
      const baseRadius = clamp(26 + map.getZoom() * 3.6, 38, 90)

      function paintCloud(x: number, y: number, radius: number, alpha: number): void {
        if (alpha <= 0.001 || x < -radius || y < -radius ||
            x > size.x + radius || y > size.y + radius) return
        const gradient = context!.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, `rgba(153,27,27,${clamp(0.58 * alpha, 0, 0.95)})`)
        gradient.addColorStop(0.30, `rgba(234,88,12,${clamp(0.47 * alpha, 0, 0.92)})`)
        gradient.addColorStop(0.64, `rgba(250,204,21,${clamp(0.31 * alpha, 0, 0.85)})`)
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
        paintCloud(location.x, location.y, baseRadius * 1.08, baseIntensity * 0.16)

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
          paintCloud(x, y, radius, baseIntensity * visibility * 1.04)
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
  }, [map, anchors])

  return null
}
