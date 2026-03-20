export type RegionKey = 'fortaleza' | 'rmf' | 'interior'

export type DashboardSummary = {
  global: {
    total_nodes: number
    active_locations: number
    top_region: string | null
    top_name: string | null
    avg_risk: number
  }
  regions: Record<
    string,
    {
      total_nodes: number
      avg_risk: number
      max_risk: number
      top_name: string
    }
  >
}

export type SnapshotManifest = {
  snapshot_id: string
  generated_at: string
  source_repo: string
  source_commit: string
  model_label: string
  model_architecture: string
  momentum_window_days: number
  regions: RegionKey[]
  notes: string
}

export type RiskItem = {
  id: string
  node_id: number
  name: string
  clean_name: string
  region: RegionKey
  municipality: string
  score: number
  rank_region: number
  rank_global: number
  momentum_7d: number
  momentum_14d: number
  recent_cvli: number
  recent_exogenous: number
  faction: string
  tension_index: number
  status: string
  trend: string
  summary: string
}

export type TerritoryDetail = {
  name: string
  municipality: string
  region: RegionKey
  faction: string
  recent_cvli: number
  recent_exogenous: number
  momentum_7d: number
  momentum_14d: number
  critical_streets: string | Array<{ loc: string; cvli: number; score: number }>
  summary: string
  risk_score: number
  status: string
}

export type RiskSnapshot = {
  meta: Record<string, unknown>
  items: RiskItem[]
}

export type GeoFeature = {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: unknown
  }
  properties: Record<string, unknown>
}

export type GeoFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

export type SnapshotData = {
  manifest: SnapshotManifest
  summary: DashboardSummary
  risk: RiskSnapshot
  territoryDetails: Record<string, TerritoryDetail>
  polygons: GeoFeatureCollection
  micronodes: GeoFeatureCollection
  top30: Record<RegionKey, GeoFeatureCollection>
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function hasAccents(value: string): boolean {
  return /[^\u0000-\u007f]/.test(value)
}

function preferDisplayName(currentName: string, candidateName: string): string {
  if (!currentName) {
    return candidateName
  }
  if (!candidateName) {
    return currentName
  }

  if (hasAccents(candidateName) && !hasAccents(currentName)) {
    return candidateName
  }
  if (candidateName.length > currentName.length) {
    return candidateName
  }
  return currentName
}

function riskBandForItem(item: RiskItem): 'crítico' | 'alto' | 'moderado' | 'baixo' {
  const status = normalizeLookupName(item.status)
  if (status.includes('CRIT')) {
    return 'crítico'
  }
  if (status.includes('ALTO')) {
    return 'alto'
  }
  if (status.includes('MODER')) {
    return 'moderado'
  }
  if (status.includes('BAIX')) {
    return 'baixo'
  }
  return item.score >= 71 ? 'crítico' : item.score >= 51 ? 'alto' : item.score >= 31 ? 'moderado' : 'baixo'
}

function dedupeRiskItems(items: RiskItem[]): RiskItem[] {
  const dedupedById = new Map<string, RiskItem>()

  for (const rawItem of [...items].sort((left, right) => right.score - left.score)) {
    const normalizedItem: RiskItem = {
      ...rawItem,
      id: rawItem.id || buildTerritoryId(rawItem.region, rawItem.name),
      clean_name: rawItem.clean_name || normalizeLookupName(rawItem.name),
    }
    const existing = dedupedById.get(normalizedItem.id)

    if (!existing) {
      dedupedById.set(normalizedItem.id, normalizedItem)
      continue
    }

    dedupedById.set(normalizedItem.id, {
      ...existing,
      name: preferDisplayName(existing.name, normalizedItem.name),
      municipality: existing.municipality || normalizedItem.municipality,
      faction: existing.faction || normalizedItem.faction,
      node_id: existing.node_id ?? normalizedItem.node_id,
      recent_cvli: Math.max(existing.recent_cvli, normalizedItem.recent_cvli),
      recent_exogenous: Math.max(existing.recent_exogenous, normalizedItem.recent_exogenous),
      momentum_7d: Math.abs(normalizedItem.momentum_7d) > Math.abs(existing.momentum_7d)
        ? normalizedItem.momentum_7d
        : existing.momentum_7d,
      momentum_14d: Math.abs(normalizedItem.momentum_14d) > Math.abs(existing.momentum_14d)
        ? normalizedItem.momentum_14d
        : existing.momentum_14d,
      summary: normalizedItem.summary.length > existing.summary.length ? normalizedItem.summary : existing.summary,
      trend: existing.trend || normalizedItem.trend,
      status: existing.status || normalizedItem.status,
    })
  }

  const rankedItems = [...dedupedById.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return left.name.localeCompare(right.name, 'pt-BR')
  })

  const regionCounters: Record<RegionKey, number> = {
    fortaleza: 0,
    rmf: 0,
    interior: 0,
  }

  return rankedItems.map((item, index) => {
    regionCounters[item.region] += 1
    return {
      ...item,
      rank_global: index + 1,
      rank_region: regionCounters[item.region],
    }
  })
}

function buildCounts(items: RiskItem[]): { counts: Record<string, number>; countsByRegion: Record<string, Record<string, number>> } {
  const counts = { crítico: 0, alto: 0, moderado: 0, baixo: 0 }
  const countsByRegion: Record<string, Record<string, number>> = {
    fortaleza: { crítico: 0, alto: 0, moderado: 0, baixo: 0 },
    rmf: { crítico: 0, alto: 0, moderado: 0, baixo: 0 },
    interior: { crítico: 0, alto: 0, moderado: 0, baixo: 0 },
  }

  for (const item of items) {
    const band = riskBandForItem(item)
    counts[band] += 1
    countsByRegion[item.region][band] += 1
  }

  return { counts, countsByRegion }
}

function buildSummary(items: RiskItem[]): DashboardSummary {
  const globalTop = items[0] ?? null
  const grouped: Record<RegionKey, RiskItem[]> = {
    fortaleza: [],
    rmf: [],
    interior: [],
  }

  for (const item of items) {
    grouped[item.region].push(item)
  }

  return {
    global: {
      total_nodes: items.length,
      active_locations: items.filter((item) => item.score >= 51).length,
      top_region: globalTop?.region ?? null,
      top_name: globalTop?.name ?? null,
      avg_risk: Number((items.reduce((total, item) => total + item.score, 0) / Math.max(items.length, 1)).toFixed(2)),
    },
    regions: {
      fortaleza: {
        total_nodes: grouped.fortaleza.length,
        avg_risk: Number((grouped.fortaleza.reduce((total, item) => total + item.score, 0) / Math.max(grouped.fortaleza.length, 1)).toFixed(2)),
        max_risk: grouped.fortaleza[0]?.score ?? 0,
        top_name: grouped.fortaleza[0]?.name ?? 'N/A',
      },
      rmf: {
        total_nodes: grouped.rmf.length,
        avg_risk: Number((grouped.rmf.reduce((total, item) => total + item.score, 0) / Math.max(grouped.rmf.length, 1)).toFixed(2)),
        max_risk: grouped.rmf[0]?.score ?? 0,
        top_name: grouped.rmf[0]?.name ?? 'N/A',
      },
      interior: {
        total_nodes: grouped.interior.length,
        avg_risk: Number((grouped.interior.reduce((total, item) => total + item.score, 0) / Math.max(grouped.interior.length, 1)).toFixed(2)),
        max_risk: grouped.interior[0]?.score ?? 0,
        top_name: grouped.interior[0]?.name ?? 'N/A',
      },
    },
  }
}

export async function loadSnapshot(): Promise<SnapshotData> {
  const [manifest, risk, territoryDetails, polygons, micronodes, topFortaleza, topRmf, topInterior] =
    await Promise.all([
      loadJson<SnapshotManifest>('/data/manifest.json'),
      loadJson<RiskSnapshot>('/data/risk_snapshot.json'),
      loadJson<Record<string, TerritoryDetail>>('/data/territory_details.json'),
      loadJson<GeoFeatureCollection>('/data/polygons.geojson'),
      loadJson<GeoFeatureCollection>('/data/micronodes.geojson'),
      loadJson<GeoFeatureCollection>('/data/top30_capital.geojson'),
      loadJson<GeoFeatureCollection>('/data/top30_rmf.geojson'),
      loadJson<GeoFeatureCollection>('/data/top30_interior.geojson'),
    ])

  const dedupedItems = dedupeRiskItems(risk.items)
  const derivedCounts = buildCounts(dedupedItems)

  return {
    manifest,
    summary: buildSummary(dedupedItems),
    risk: {
      ...risk,
      meta: {
        ...risk.meta,
        counts: derivedCounts.counts,
        counts_by_region: derivedCounts.countsByRegion,
      },
      items: dedupedItems,
    },
    territoryDetails,
    polygons,
    micronodes,
    top30: {
      fortaleza: topFortaleza,
      rmf: topRmf,
      interior: topInterior,
    },
  }
}

export function normalizeLookupName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function buildTerritoryId(region: RegionKey, name: string): string {
  return `${region}:${normalizeLookupName(name)}`
}

export function riskLevelColor(score: number): string {
  if (score >= 71) {
    return '#7f1d1d'
  }
  if (score >= 51) {
    return '#b91c1c'
  }
  if (score >= 31) {
    return '#ea580c'
  }
  return '#2563eb'
}

export function factionColor(faction: string): string {
  const key = normalizeLookupName(faction)
  if (key.includes('CV')) {
    return '#991b1b'
  }
  if (key.includes('MASSA')) {
    return '#14532d'
  }
  if (key.includes('TCP') || key.includes('GDE')) {
    return '#1d4ed8'
  }
  if (key.includes('DISPUTA')) {
    return '#7c3aed'
  }
  return '#475569'
}