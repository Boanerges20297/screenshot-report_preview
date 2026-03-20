import { useEffect, useState } from 'react'
import { OperationalMap } from './components/OperationalMap'
import {
  loadSnapshot,
  riskLevelColor,
  type RegionKey,
  type SnapshotData,
  type TerritoryDetail,
} from './lib/snapshot'
import './App.css'

function App() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)
  const [region, setRegion] = useState<RegionKey>('fortaleza')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showMicronodes, setShowMicronodes] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    loadSnapshot()
      .then((data) => {
        if (cancelled) {
          return
        }
        setSnapshot(data)
        const firstTerritory = data.risk.items.find((item) => item.region === 'fortaleza')
        setSelectedId(firstTerritory?.id ?? null)
      })
      .catch((reason) => {
        if (cancelled) {
          return
        }
        setError(reason instanceof Error ? reason.message : 'Falha ao carregar snapshot estático.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!snapshot) {
      return
    }
    const regionalItems = snapshot.risk.items.filter((item) => item.region === region)
    if (!regionalItems.some((item) => item.id === selectedId)) {
      setSelectedId(regionalItems[0]?.id ?? null)
    }
  }, [region, selectedId, snapshot])

  if (error) {
    return (
      <main className="app-shell">
        <section className="status-panel error">
          <p className="eyebrow">Falha de bootstrap</p>
          <h1>O snapshot não carregou.</h1>
          <p>{error}</p>
        </section>
      </main>
    )
  }

  if (!snapshot) {
    return (
      <main className="app-shell">
        <section className="status-panel">
          <p className="eyebrow">Snapshot estático</p>
          <h1>Carregando quadro situacional...</h1>
          <p>Preparando camadas territoriais, ranking congelado e indicadores regionais.</p>
        </section>
      </main>
    )
  }

  const regionalItems = snapshot.risk.items
    .filter((item) => item.region === region)
    .sort((left, right) => right.score - left.score)
  const topRegionalItems = regionalItems.slice(0, 30)
  const selectedTerritory = selectedId ? snapshot.territoryDetails[selectedId] : null
  const selectedRisk = selectedId ? snapshot.risk.items.find((item) => item.id === selectedId) ?? null : null
  const managerView = snapshot.risk.meta.manager_view as {
    confidence_pct: number
    confidence_label: string
    state_temperature_label: string
    state_temperature_pct: number
    recommendation: string
  }
  const countsByRegion = snapshot.risk.meta.counts_by_region as Record<string, Record<string, number>>
  const regionalCount = countsByRegion[region] ?? {}

  return (
    <main className="app-shell">
      <section className="hero-band">
        <div className="hero-copy">
          <div className="hero-topline">
            <p className="eyebrow">Painel executivo</p>
            <span className="hero-status">Snapshot homologado</span>
          </div>
          <h1>Painel territorial de risco e priorização operacional.</h1>
          <p className="hero-text">
            Leitura consolidada do ranking regional, territórios críticos e sinais ORCRIM em formato estático para consulta executiva.
          </p>

          <div className="hero-highlights">
            <div className="hero-highlight">
              <span>Modelo</span>
              <strong>{snapshot.manifest.model_label}</strong>
            </div>
            <div className="hero-highlight">
              <span>Confiança do quadro</span>
              <strong>{managerView.confidence_pct.toFixed(1)}%</strong>
            </div>
            <div className="hero-highlight">
              <span>Região em evidência</span>
              <strong>{snapshot.summary.global.top_region?.toUpperCase() ?? 'N/A'}</strong>
            </div>
          </div>
        </div>

        <div className="snapshot-card">
          <span className="badge">Publicação estática</span>
          <div className="snapshot-meta">
            <span>Gerado em</span>
            <strong>{new Date(snapshot.manifest.generated_at).toLocaleString('pt-BR')}</strong>
          </div>
          <div className="snapshot-meta">
            <span>Versão fonte</span>
            <strong>Commit {snapshot.manifest.source_commit}</strong>
          </div>
          <div className="snapshot-meta">
            <span>Escopo</span>
            <strong>{snapshot.summary.global.active_locations} localidades monitoradas</strong>
          </div>
          <p className="snapshot-note">{snapshot.manifest.notes}</p>
        </div>
      </section>

      <section className="metrics-row">
        <article className="metric-card feature">
          <span>Confiança</span>
          <strong>{managerView.confidence_pct.toFixed(1)}%</strong>
          <p>{managerView.confidence_label}</p>
        </article>
        <article className="metric-card">
          <span>Temperatura</span>
          <strong>{managerView.state_temperature_pct.toFixed(1)}%</strong>
          <p>{managerView.state_temperature_label}</p>
        </article>
        <article className="metric-card">
          <span>Nós ativos</span>
          <strong>{snapshot.summary.global.active_locations}</strong>
          <p>de {snapshot.summary.global.total_nodes} localidades</p>
        </article>
        <article className="metric-card">
          <span>Região líder</span>
          <strong>{snapshot.summary.global.top_region?.toUpperCase() ?? 'N/A'}</strong>
          <p>{snapshot.summary.global.top_name ?? 'Sem destaque'}</p>
        </article>
      </section>

      <section className="control-row">
        <div className="region-switcher" role="tablist" aria-label="Filtro regional">
          {(['fortaleza', 'rmf', 'interior'] as RegionKey[]).map((regionKey) => {
            const isActive = regionKey === region
            return (
              <button
                key={regionKey}
                type="button"
                className={isActive ? 'region-pill active' : 'region-pill'}
                onClick={() => setRegion(regionKey)}
              >
                {regionKey === 'fortaleza' ? 'Fortaleza' : regionKey.toUpperCase()}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className={showMicronodes ? 'toggle-button active' : 'toggle-button'}
          onClick={() => setShowMicronodes((value) => !value)}
        >
          {showMicronodes ? 'Ocultar ORCRIM' : 'Mostrar ORCRIM'}
        </button>
      </section>

      <section className="workspace-grid">
        <aside className="sidebar-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Resumo regional</p>
              <h2>{region === 'fortaleza' ? 'Fortaleza' : region.toUpperCase()}</h2>
            </div>
            <span className="risk-dot" style={{ backgroundColor: riskLevelColor(topRegionalItems[0]?.score ?? 0) }} />
          </div>

          <div className="region-kpis">
            <div>
              <span>Risco médio</span>
              <strong>{snapshot.summary.regions[region]?.avg_risk?.toFixed(2) ?? '0.00'}%</strong>
            </div>
            <div>
              <span>Críticos</span>
              <strong>{regionalCount.crítico ?? 0}</strong>
            </div>
            <div>
              <span>Altos</span>
              <strong>{regionalCount.alto ?? 0}</strong>
            </div>
          </div>

          <div className="top-list">
            {topRegionalItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? 'top-item active' : 'top-item'}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="rank-chip">#{item.rank_region}</span>
                <div className="top-copy">
                  <strong>{item.name}</strong>
                  <span>
                    {item.faction || 'N/A'} · {item.score.toFixed(1)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="map-panel">
          <OperationalMap
            region={region}
            polygons={snapshot.polygons}
            top30={snapshot.top30[region]}
            micronodes={snapshot.micronodes}
            riskItems={regionalItems}
            territoryDetails={snapshot.territoryDetails}
            selectedId={selectedId}
            showMicronodes={showMicronodes}
            onSelectTerritory={setSelectedId}
          />
        </section>

        <aside className="detail-panel">
          <p className="eyebrow">Território selecionado</p>
          <h2>{selectedRisk?.name ?? 'Nenhum território'}</h2>
          <div className="detail-grid">
            <div>
              <span>Score</span>
              <strong>{selectedRisk?.score?.toFixed(1) ?? '0.0'}%</strong>
            </div>
            <div>
              <span>Facção</span>
              <strong>{selectedTerritory?.faction ?? selectedRisk?.faction ?? 'N/A'}</strong>
            </div>
            <div>
              <span>Momentum 7d</span>
              <strong>{selectedTerritory?.momentum_7d ?? selectedRisk?.momentum_7d ?? 0}</strong>
            </div>
            <div>
              <span>Momentum 14d</span>
              <strong>{selectedTerritory?.momentum_14d ?? selectedRisk?.momentum_14d ?? 0}</strong>
            </div>
            <div>
              <span>CVLI recente</span>
              <strong>{selectedTerritory?.recent_cvli ?? selectedRisk?.recent_cvli ?? 0}</strong>
            </div>
            <div>
              <span>Exógenos</span>
              <strong>{selectedTerritory?.recent_exogenous ?? selectedRisk?.recent_exogenous ?? 0}</strong>
            </div>
          </div>

          <div className="detail-copy">
            <h3>Leitura congelada</h3>
            <p>{selectedTerritory?.summary ?? selectedRisk?.summary ?? 'Sem resumo disponível.'}</p>
          </div>

          <div className="detail-copy">
            <h3>Logradouros críticos</h3>
            <p>{formatCriticalStreets(selectedTerritory)}</p>
          </div>

          <div className="recommendation-box">
            <span>Recomendação operacional</span>
            <p>{managerView.recommendation}</p>
          </div>
        </aside>
      </section>
    </main>
  )
}

function formatCriticalStreets(detail: TerritoryDetail | null): string {
  if (!detail) {
    return 'Sem logradouros críticos registrados.'
  }
  if (typeof detail.critical_streets === 'string') {
    return detail.critical_streets
  }
  if (detail.critical_streets.length === 0) {
    return 'Sem logradouros críticos registrados.'
  }
  return detail.critical_streets
    .slice(0, 5)
    .map((street) => `${street.loc} (${street.cvli} CVLI)`)
    .join(', ')
}

export default App
