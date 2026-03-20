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

export async function loadSnapshot(): Promise<SnapshotData> {
  const [manifest, summary, risk, territoryDetails, polygons, micronodes, topFortaleza, topRmf, topInterior] =
    await Promise.all([
      loadJson<SnapshotManifest>('/data/manifest.json'),
      loadJson<DashboardSummary>('/data/dashboard_summary.json'),
      loadJson<RiskSnapshot>('/data/risk_snapshot.json'),
      loadJson<Record<string, TerritoryDetail>>('/data/territory_details.json'),
      loadJson<GeoFeatureCollection>('/data/polygons.geojson'),
      loadJson<GeoFeatureCollection>('/data/micronodes.geojson'),
      loadJson<GeoFeatureCollection>('/data/top30_capital.geojson'),
      loadJson<GeoFeatureCollection>('/data/top30_rmf.geojson'),
      loadJson<GeoFeatureCollection>('/data/top30_interior.geojson'),
    ])

  return {
    manifest,
    summary,
    risk,
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