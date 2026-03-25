import { useEffect, useState } from 'react'
import { OperationalMap } from './components/OperationalMap'
import { AddExogenousEventForm } from './components/AddExogenousEventForm'
import { useAIRecommendation } from './hooks/useAIRecommendation'
import {
  loadSnapshot,
  riskLevelColor,
  type RegionKey,
  type SnapshotData,
  type TerritoryDetail,
} from './lib/snapshot'
import './App.css'

const REGION_LABELS: Record<RegionKey, string> = {
  fortaleza: 'Fortaleza',
  rmf: 'RMF',
  interior: 'Interior',
}

function App() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)
  const [region, setRegion] = useState<RegionKey>('fortaleza')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusTrigger, setFocusTrigger] = useState(0)
  const [showMicronodes, setShowMicronodes] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    loadSnapshot()
      .then((data) => {
        if (cancelled) {
          return
        }
        setSnapshot(data)
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
    // Only clear selection if currently selected territory doesn't belong to this region
    // Do NOT auto-select — let user click voluntarily
    if (selectedId) {
      const regionalItems = snapshot.risk.items.filter((item) => item.region === region)
      if (!regionalItems.some((item) => item.id === selectedId)) {
        setSelectedId(null)
      }
    }
  }, [region, selectedId, snapshot])

  // Must be called unconditionally before any early return (Rules of Hooks)
  const _selectedRisk = snapshot && selectedId
    ? snapshot.risk.items.find((item) => item.id === selectedId) ?? null
    : null
  const _selectedTerritory = snapshot && selectedId ? snapshot.territoryDetails[selectedId] ?? null : null
  const aiRec = useAIRecommendation(_selectedRisk, _selectedTerritory)

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
        <section className="loading-shell">
          <div className="loading-hero">
            <div className="loading-hero-copy">
              <p className="eyebrow">Snapshot estático</p>
              <h1>Preparando o quadro situacional executivo.</h1>
              <p className="loading-subtext">
                Organizando camadas territoriais, ranking regional e indicadores consolidados para a leitura do snapshot.
              </p>
            </div>

            <div className="loading-chip-row" aria-hidden="true">
              <span className="loading-chip">Camadas territoriais</span>
              <span className="loading-chip">Ranking regional</span>
              <span className="loading-chip">Indicadores congelados</span>
            </div>
          </div>

          <section className="loading-grid" aria-hidden="true">
            <article className="loading-card loading-card-wide">
              <div className="loading-line loading-line-kicker" />
              <div className="loading-line loading-line-title" />
              <div className="loading-line loading-line-title short" />
              <div className="loading-line loading-line-text" />
              <div className="loading-line loading-line-text medium" />
              <div className="loading-pill-row">
                <span className="loading-pill" />
                <span className="loading-pill" />
                <span className="loading-pill" />
              </div>
            </article>

            <article className="loading-card loading-card-stack">
              <div className="loading-line loading-line-kicker short" />
              <div className="loading-metric-block" />
              <div className="loading-metric-block" />
              <div className="loading-metric-block compact" />
            </article>
          </section>

          <section className="loading-dashboard" aria-hidden="true">
            <div className="loading-stat" />
            <div className="loading-stat" />
            <div className="loading-stat" />
            <div className="loading-stat" />
          </section>

          <section className="loading-process">
            <div className="loading-process-head">
              <span className="eyebrow">Andamento</span>
              <span className="loading-pulse-dot" />
            </div>
            <div className="loading-step-list">
              <div className="loading-step active">
                <span className="loading-step-bullet" />
                <div>
                  <strong>Carregando artefatos</strong>
                  <p>Leitura de manifesto, métricas, territórios e camadas geográficas.</p>
                </div>
              </div>
              <div className="loading-step active">
                <span className="loading-step-bullet" />
                <div>
                  <strong>Consolidando painéis</strong>
                  <p>Preparação do ranking, contagens regionais e recorte inicial.</p>
                </div>
              </div>
              <div className="loading-step">
                <span className="loading-step-bullet" />
                <div>
                  <strong>Renderizando interface</strong>
                  <p>Aplicando mapa, destaques territoriais e painéis executivos.</p>
                </div>
              </div>
            </div>
          </section>
        </section>
      </main>
    )
  }

  const regionalItems = snapshot.risk.items
    .filter((item) => item.region === region)
    .sort((left, right) => right.score - left.score)
  const topRegionalItems = regionalItems.slice(0, 30)
  const regionalSummary = snapshot.summary.regions[region]
  const selectedTerritory = selectedId ? snapshot.territoryDetails[selectedId] : null
  const selectedRisk = selectedId ? snapshot.risk.items.find((item) => item.id === selectedId) ?? null : null
  const managerView = snapshot.risk.meta.manager_view as {
    confidence_pct: number
    confidence_label: string
    state_temperature_label: string
    state_temperature_pct: number
    recommendation: string
  }
  const regionalCount = countRiskBands(regionalItems)
  const regionalLeader = topRegionalItems[0] ?? null
  const regionalPriorityCount = regionalItems.filter((item) => item.score >= 31).length
  const regionalCriticalCount = regionalCount.crítico ?? 0
  const regionalHighCount = regionalCount.alto ?? 0

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
            Recorte atual: {REGION_LABELS[region]}. Leitura consolidada do ranking regional, territórios críticos e sinais ORCRIM em formato estático para consulta executiva.
          </p>

          <div className="hero-highlights">
            <div className="hero-highlight">
              <span>Recorte selecionado</span>
              <strong>{REGION_LABELS[region]}</strong>
            </div>
            <div className="hero-highlight">
              <span>Pico de risco</span>
              <strong>{regionalLeader?.score?.toFixed(1) ?? '0.0'}%</strong>
            </div>
            <div className="hero-highlight">
              <span>Territórios priorizados</span>
              <strong>{regionalPriorityCount}</strong>
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
            <strong>{snapshot.summary.global.total_nodes} localidades consolidadas</strong>
          </div>
          <p className="snapshot-note">{snapshot.manifest.notes}</p>
        </div>
      </section>

      <section className="metrics-row">
        <article className="metric-card feature">
          <span>Maior risco</span>
          <strong>{regionalLeader?.score?.toFixed(1) ?? '0.0'}%</strong>
          <p>{regionalLeader?.name ?? 'Sem destaque'}</p>
        </article>
        <article className="metric-card warm">
          <span>Territórios críticos</span>
          <strong>{regionalCriticalCount}</strong>
          <p>{regionalHighCount} em faixa alta</p>
        </article>
        <article className="metric-card">
          <span>Em alerta</span>
          <strong>{regionalPriorityCount}</strong>
          <p>de {regionalSummary?.total_nodes ?? 0} territórios acima de 31%</p>
        </article>
        <article className="metric-card">
          <span>Saturação</span>
          <strong>
            {regionalSummary?.total_nodes
              ? ((regionalPriorityCount / regionalSummary.total_nodes) * 100).toFixed(0)
              : '0'}%
          </strong>
          <p>{regionalLeader?.faction || managerView.confidence_label || 'Sem leitura'} lidera</p>
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

        <div className="region-switcher">
          <button
            type="button"
            className="toggle-button"
            onClick={() => setShowEventForm(true)}
            style={{ fontWeight: 800, background: '#f8fafc', borderColor: '#cbd5e1' }}
          >
            + Registrar Evento
          </button>
          
          <button
            type="button"
            className={showMicronodes ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setShowMicronodes((value) => !value)}
          >
            {showMicronodes ? 'Ocultar ORCRIM' : 'Mostrar ORCRIM'}
          </button>
        </div>
      </section>

      <section className="workspace-grid">
        <aside className="sidebar-panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Resumo regional</p>
              <h2>{REGION_LABELS[region]}</h2>
              <p className="panel-subtext">{regionalSummary?.total_nodes ?? 0} localidades consolidadas no recorte atual.</p>
            </div>
            <span className="risk-dot" style={{ backgroundColor: riskLevelColor(topRegionalItems[0]?.score ?? 0) }} />
          </div>

          <div className="top-list">
            {topRegionalItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === selectedId ? 'top-item active' : 'top-item'}
                onClick={() => {
                  setSelectedId(item.id)
                  setFocusTrigger((n) => n + 1)
                }}
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

          <div className="region-kpis">
            <div>
              <span>Em alerta</span>
              <strong>{regionalPriorityCount}</strong>
            </div>
            <div>
              <span>Críticos</span>
              <strong>{regionalCriticalCount}</strong>
            </div>
            <div>
              <span>Altos</span>
              <strong>{regionalHighCount}</strong>
            </div>
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
            focusTrigger={focusTrigger}
            showMicronodes={showMicronodes}
            onSelectTerritory={(id) => {
              setSelectedId(id)
              setFocusTrigger((n) => n + 1)
            }}
          />
        </section>

        <aside className="detail-panel">
          {selectedRisk ? (
            <>
              <p className="eyebrow">Território selecionado</p>
              <h2>{selectedRisk.name}</h2>
              <div className="detail-grid">
                <div>
                  <span>Score</span>
                  <strong>{selectedRisk.score?.toFixed(1) ?? '0.0'}%</strong>
                </div>
                <div>
                  <span>Facção</span>
                  <strong>{selectedTerritory?.faction ?? selectedRisk.faction ?? 'N/A'}</strong>
                </div>
                <div>
                  <span>Momentum 7d</span>
                  <strong>{selectedTerritory?.momentum_7d ?? selectedRisk.momentum_7d ?? 0}</strong>
                </div>
                <div>
                  <span>Momentum 14d</span>
                  <strong>{selectedTerritory?.momentum_14d ?? selectedRisk.momentum_14d ?? 0}</strong>
                </div>
                <div>
                  <span>CVLI recente</span>
                  <strong>{selectedTerritory?.recent_cvli ?? selectedRisk.recent_cvli ?? 0}</strong>
                </div>
                <div>
                  <span>Exógenos</span>
                  <strong>{selectedTerritory?.recent_exogenous ?? selectedRisk.recent_exogenous ?? 0}</strong>
                </div>
              </div>

              <div className="detail-copy">
                <h3>Leitura congelada</h3>
                <p>{selectedTerritory?.summary ?? selectedRisk.summary ?? 'Sem resumo disponível.'}</p>
              </div>

              <div className="detail-copy">
                <h3>Logradouros críticos</h3>
                <p>{formatCriticalStreets(selectedTerritory)}</p>
              </div>

              <div className="recommendation-box">
                <span>Recomendação operacional · IA</span>
                {aiRec.loading ? (
                  <p style={{ opacity: 0.5, fontStyle: 'italic' }}>Analisando território via IA...</p>
                ) : aiRec.error ? (
                  <p style={{ opacity: 0.55, fontSize: '0.82em' }}>
                    Falha na análise via IA: {aiRec.error}
                  </p>
                ) : aiRec.text ? (
                  <p>{aiRec.text}</p>
                ) : (
                  <p style={{ opacity: 0.4, fontStyle: 'italic' }}>Aguardando seleção de território...</p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow">Visão regional</p>
              <h2>{REGION_LABELS[region]}</h2>
              <div className="detail-grid">
                <div>
                  <span>Localidades</span>
                  <strong>{regionalSummary?.total_nodes ?? 0}</strong>
                </div>
                <div>
                  <span>Saturação</span>
                  <strong>
                    {regionalSummary?.total_nodes
                      ? ((regionalPriorityCount / regionalSummary.total_nodes) * 100).toFixed(0)
                      : '0'}%
                  </strong>
                </div>
                <div>
                  <span>Críticos</span>
                  <strong>{regionalCriticalCount}</strong>
                </div>
                <div>
                  <span>Altos</span>
                  <strong>{regionalHighCount}</strong>
                </div>
                <div>
                  <span>Em alerta</span>
                  <strong>{regionalPriorityCount}</strong>
                </div>
                <div>
                  <span>Líder</span>
                  <strong>{regionalLeader?.name ?? 'N/A'}</strong>
                </div>
              </div>
              <div className="detail-copy" style={{ marginTop: '1rem' }}>
                <h3>Orientação</h3>
                <p>
                  Selecione um território no ranking ou no mapa para visualizar indicadores detalhados, logradouros críticos e a recomendação operacional gerada por IA.
                </p>
              </div>
            </>
          )}
        </aside>
      </section>

      {showEventForm && (
        <AddExogenousEventForm onClose={() => setShowEventForm(false)} />
      )}
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

function countRiskBands(items: SnapshotData['risk']['items']): Record<'crítico' | 'alto' | 'moderado' | 'baixo', number> {
  return items.reduce(
    (accumulator, item) => {
      const status = item.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      if (status.includes('CRIT')) {
        accumulator.crítico += 1
      } else if (status.includes('ALTO')) {
        accumulator.alto += 1
      } else if (status.includes('MODER')) {
        accumulator.moderado += 1
      } else if (status.includes('BAIX')) {
        accumulator.baixo += 1
      } else if (item.score >= 71) {
        accumulator.crítico += 1
      } else if (item.score >= 51) {
        accumulator.alto += 1
      } else if (item.score >= 31) {
        accumulator.moderado += 1
      } else {
        accumulator.baixo += 1
      }
      return accumulator
    },
    { crítico: 0, alto: 0, moderado: 0, baixo: 0 },
  )
}

export default App
