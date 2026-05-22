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

// ─── Constants ───────────────────────────────────────────────────────────────

const REGION_LABELS: Record<RegionKey, string> = {
  fortaleza: 'Fortaleza',
  rmf: 'RMF',
  interior: 'Interior',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPeakHours(value?: string | null): string {
  const text = String(value ?? '').trim()
  return text || 'Sem padrão horário consolidado'
}

function formatCriticalStreets(detail: TerritoryDetail | null): string {
  if (!detail) return 'Sem logradouros críticos registrados.'
  if (typeof detail.critical_streets === 'string') return detail.critical_streets
  if (detail.critical_streets.length === 0) return 'Sem logradouros críticos registrados.'
  return detail.critical_streets
    .slice(0, 5)
    .map((s) => `${s.loc} (${s.cvli} CVLI)`)
    .join(', ')
}

function countRiskBands(
  items: SnapshotData['risk']['items'],
): Record<'crítico' | 'alto' | 'moderado' | 'baixo', number> {
  return items.reduce(
    (acc, item) => {
      const s = item.status.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      if (s.includes('CRIT')) acc.crítico += 1
      else if (s.includes('ALTO')) acc.alto += 1
      else if (s.includes('MODER')) acc.moderado += 1
      else if (s.includes('BAIX')) acc.baixo += 1
      else if (item.score >= 71) acc.crítico += 1
      else if (item.score >= 51) acc.alto += 1
      else if (item.score >= 31) acc.moderado += 1
      else acc.baixo += 1
      return acc
    },
    { crítico: 0, alto: 0, moderado: 0, baixo: 0 },
  )
}

/** Returns a CSS color variable name for the risk band */
function riskBandColor(score: number): string {
  if (score >= 71) return 'var(--critical)'
  if (score >= 51) return 'var(--high)'
  if (score >= 31) return 'var(--moderate)'
  return 'var(--low)'
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: string
  label: string
  value: string | number
  sub: string
  barPct: number
  variant: 'critical' | 'high' | 'alert' | 'sat'
  cardClass?: string
}

function KpiCard({ icon, label, value, sub, barPct, variant, cardClass = '' }: KpiCardProps) {
  return (
    <article className={`kpi-card ${cardClass}`}>
      <div className="kpi-header">
        <span className={`kpi-icon ${variant}`} aria-hidden="true">{icon}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
      <div className="kpi-bar-track" role="progressbar" aria-valuenow={barPct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`kpi-bar-fill ${variant}`} style={{ width: `${Math.min(barPct, 100)}%` }} />
      </div>
    </article>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

type DetailTab = 'indicadores' | 'ia' | 'logradouros'

function App() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)
  const [region, setRegion] = useState<RegionKey>('fortaleza')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusTrigger, setFocusTrigger] = useState(0)
  const [showMicronodes, setShowMicronodes] = useState(false)
  const [showTop30, setShowTop30] = useState(false)
  const [showEliteP10, setShowEliteP10] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [detailTab, setDetailTab] = useState<DetailTab>('indicadores')

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '')
  }, [theme])

  useEffect(() => {
    let cancelled = false
    loadSnapshot()
      .then((data) => { if (!cancelled) setSnapshot(data) })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Falha ao carregar snapshot.')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!snapshot || !selectedId) return
    const items = snapshot.risk.items.filter((item) => item.region === region)
    if (!items.some((item) => item.id === selectedId)) setSelectedId(null)
  }, [region, selectedId, snapshot])

  // Derived data
  const _selectedRisk = snapshot && selectedId
    ? snapshot.risk.items.find((item) => item.id === selectedId) ?? null
    : null
  const _selectedTerritory = snapshot && selectedId ? snapshot.territoryDetails[selectedId] ?? null : null
  const _explainability = snapshot && selectedId ? snapshot.explainability[selectedId] ?? null : null
  const _explainabilityAcademics = snapshot && selectedId ? snapshot.explainabilityAcademics[selectedId] ?? null : null

  const regionalItems = snapshot
    ? snapshot.risk.items.filter((item) => item.region === region).sort((a, b) => b.score - a.score)
    : []

  const _regionalTop = regionalItems.slice(0, 5).map((it) => `${it.name} (${it.score.toFixed(1)}%)`)
  const aiRec = useAIRecommendation(_selectedRisk, _selectedTerritory, _explainability, _explainabilityAcademics, _regionalTop)

  // ─── Error state ────────────────────────────────────────────────────────────
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

  // ─── Loading state ──────────────────────────────────────────────────────────
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

  // ─── Data computations ──────────────────────────────────────────────────────
  const topRegionalItems = regionalItems.slice(0, 10)
  const regionalSummary = snapshot.summary.regions[region]
  const selectedTerritory = _selectedTerritory
  const selectedRisk = _selectedRisk
  const regionalCount = countRiskBands(regionalItems)
  const regionalLeader = topRegionalItems[0] ?? null
  const regionalPriorityCount = regionalItems.filter((item) => item.score >= 31).length
  const regionalCriticalCount = regionalCount.crítico ?? 0
  const regionalHighCount = regionalCount.alto ?? 0
  const saturationPct = regionalSummary?.total_nodes
    ? Math.round((regionalPriorityCount / regionalSummary.total_nodes) * 100)
    : 0

  // ─── Rendered ──────────────────────────────────────────────────────────────
  return (
    <main className="app-shell" data-region={region}>

      {/* ── Top Bar ── */}
      <header className="top-bar" role="banner">
        <div className="top-bar-brand">
          <div className="top-bar-logo" aria-hidden="true">ST</div>
          <div>
            <div className="top-bar-title">ST-GAT/ST-GCN</div>
            <div className="top-bar-subtitle">Painel Territorial de Risco</div>
          </div>
        </div>

        <div className="top-bar-center">
          <div className="region-pill-group" role="tablist" aria-label="Filtro regional">
            {(['fortaleza', 'rmf', 'interior'] as RegionKey[]).map((r) => (
              <button
                key={r}
                id={`region-pill-${r}`}
                type="button"
                role="tab"
                aria-selected={r === region}
                className={r === region ? 'region-pill active' : 'region-pill'}
                onClick={() => setRegion(r)}
              >
                {REGION_LABELS[r]}
              </button>
            ))}
          </div>

          <div className="status-pill">
            <span className="status-pill-dot" aria-hidden="true" />
            Snapshot homologado
          </div>
        </div>

        <div className="top-bar-right">
          <span className="snapshot-timestamp" title="Data de geração do snapshot">
            {new Date(snapshot.manifest.generated_at).toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit', year: '2-digit',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>

          <button
            id="theme-toggle"
            className={`theme-toggle-switch ${theme === 'light' ? 'is-light' : ''}`}
            onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
          >
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb" />
            </span>
            <span className="theme-toggle-label">{theme === 'dark' ? '🌙 Escuro' : '☀ Claro'}</span>
          </button>
        </div>
      </header>

      {/* ── KPI Row ── */}
      <section className="kpi-row" aria-label="Indicadores regionais">
        <KpiCard
          icon="⚠"
          label="Territórios críticos"
          value={regionalCriticalCount}
          sub={`faixa ≥ 71% de risco`}
          barPct={(regionalCriticalCount / Math.max(regionalSummary?.total_nodes ?? 1, 1)) * 100}
          variant="critical"
          cardClass="kpi-critical"
        />
        <KpiCard
          icon="▲"
          label="Faixa alta"
          value={regionalHighCount}
          sub={`territórios 51–70%`}
          barPct={(regionalHighCount / Math.max(regionalSummary?.total_nodes ?? 1, 1)) * 100}
          variant="high"
          cardClass="kpi-high"
        />
        <KpiCard
          icon="◉"
          label="Em alerta"
          value={regionalPriorityCount}
          sub={`de ${regionalSummary?.total_nodes ?? 0} localidades acima de 31%`}
          barPct={saturationPct}
          variant="alert"
        />
        <KpiCard
          icon="◈"
          label="Saturação"
          value={`${saturationPct}%`}
          sub={regionalLeader?.name ? `Líder: ${regionalLeader.name}` : 'Sem destaque'}
          barPct={saturationPct}
          variant="sat"
        />
      </section>

      {/* ── Controls ── */}
      <nav className="control-row" aria-label="Controles de camada">
        <div className="control-group">
          <span className="control-label">Camadas:</span>
          <button
            id="toggle-orcrim"
            type="button"
            className={showMicronodes ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setShowMicronodes((v) => !v)}
          >
            {showMicronodes ? '✕ ORCRIM' : '+ ORCRIM'}
          </button>
          <button
            id="toggle-top30"
            type="button"
            className={showTop30 ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setShowTop30((v) => !v)}
          >
            {showTop30 ? '✕ Top 30' : '+ Top 30'}
          </button>
          <button
            id="toggle-elite"
            type="button"
            className={showEliteP10 ? 'toggle-button active-critical' : 'toggle-button'}
            onClick={() => setShowEliteP10((v) => !v)}
          >
            {showEliteP10 ? '✕ Elite P10' : '+ Elite P10'}
          </button>
        </div>

        <div className="control-group">
          <div className="divider-v" aria-hidden="true" />
          <span className="control-label">Snapshot:</span>
          <span className="snapshot-timestamp">
            Commit {snapshot.manifest.source_commit} · {snapshot.summary.global.total_nodes} localidades
          </span>
          <div className="divider-v" aria-hidden="true" />
          <button
            id="open-event-form"
            type="button"
            className="add-event-btn"
            onClick={() => setShowEventForm(true)}
          >
            <span aria-hidden="true">＋</span> Registrar Evento
          </button>
        </div>
      </nav>

      {/* ── Workspace Grid ── */}
      <section className="workspace-grid" aria-label="Espaço de trabalho operacional">

        {/* ── Sidebar: Ranking ── */}
        <aside className="sidebar-panel" aria-label="Ranking regional">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Ranking regional</p>
              <h2>{REGION_LABELS[region]}</h2>
              <p className="panel-subtext">{regionalSummary?.total_nodes ?? 0} localidades consolidadas</p>
            </div>
            <span
              className="risk-dot"
              style={{ backgroundColor: riskLevelColor(topRegionalItems[0]?.score ?? 0) }}
              aria-hidden="true"
            />
          </div>

          <div className="top-list" role="listbox" aria-label="Lista de territórios por risco">
            {topRegionalItems.map((item, idx) => (
              <button
                type="button"
                key={item.id}
                id={`territory-item-${item.id}`}
                role="option"
                aria-selected={item.id === selectedId}
                className={item.id === selectedId ? 'top-item active' : 'top-item'}
                style={{ '--item-risk-color': riskBandColor(item.score) } as React.CSSProperties}
                onClick={() => {
                  setSelectedId(item.id)
                  setFocusTrigger((n) => n + 1)
                  setDetailTab('indicadores')
                }}
              >
                <span className={`rank-chip ${idx < 3 ? 'rank-top' : ''}`}>#{item.rank_region}</span>
                <div className="top-copy">
                  <strong>{item.name}</strong>
                  <span>{item.faction || 'N/A'} · {item.score.toFixed(1)}%</span>
                  {item.peak_hours && <small>⏱ {item.peak_hours}</small>}
                </div>
              </button>
            ))}
          </div>


        </aside>

        {/* ── Map ── */}
        <section className="map-panel" aria-label="Mapa operacional">
          <OperationalMap
            region={region}
            polygons={snapshot.polygons}
            top30={snapshot.top30[region]}
            top30EliteP10={snapshot.top30EliteP10}
            micronodes={snapshot.micronodes}
            riskItems={regionalItems}
            territoryDetails={snapshot.territoryDetails}
            selectedId={selectedId}
            focusTrigger={focusTrigger}
            showMicronodes={showMicronodes}
            showTop30={showTop30}
            showEliteP10={showEliteP10}
            onSelectTerritory={(id) => {
              setSelectedId(id)
              setFocusTrigger((n) => n + 1)
              setDetailTab('indicadores')
            }}
          />
        </section>

        {/* ── Detail Panel ── */}
        <aside className="detail-panel" aria-label="Painel de detalhe territorial">
          {selectedRisk ? (
            <>
              <p className="eyebrow">Território selecionado</p>
              <h2>{selectedRisk.name}</h2>

              {/* Tabs */}
              <div className="detail-tabs" role="tablist" aria-label="Seções de detalhe">
                {(['indicadores', 'ia', 'logradouros'] as DetailTab[]).map((tab) => (
                  <button
                    key={tab}
                    id={`detail-tab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === tab}
                    className={detailTab === tab ? 'detail-tab active' : 'detail-tab'}
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab === 'indicadores' && '📊 Indicadores'}
                    {tab === 'ia' && '🤖 Auditoria IA'}
                    {tab === 'logradouros' && '📍 Logradouros'}
                  </button>
                ))}
              </div>

              {/* Tab Panels */}
              <div
                className="detail-content scroll-area"
                role="tabpanel"
                aria-labelledby={`detail-tab-${detailTab}`}
              >
                {/* ── Indicadores Tab ── */}
                {detailTab === 'indicadores' && (
                  <>
                    <div className="detail-grid">
                      <div>
                        <span>Score</span>
                        <strong style={{ color: riskBandColor(selectedRisk.score) }}>
                          {selectedRisk.score?.toFixed(1) ?? '0.0'}%
                        </strong>
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
                      <h3>Janela crítica</h3>
                      <p>{formatPeakHours(selectedTerritory?.peak_hours ?? selectedRisk.peak_hours)}</p>
                    </div>

                    <div className="detail-copy">
                      <h3>Leitura congelada</h3>
                      <p>{selectedTerritory?.summary ?? selectedRisk.summary ?? 'Sem resumo disponível.'}</p>
                    </div>
                  </>
                )}

                {/* ── IA Tab ── */}
                {detailTab === 'ia' && (
                  <div className="recommendation-box">
                    <span>Auditoria E-GCN · IA</span>
                    {aiRec.loading ? (
                      <p style={{ opacity: 0.5, fontStyle: 'italic' }}>Analisando território via IA…</p>
                    ) : aiRec.error ? (
                      <p style={{ opacity: 0.55, fontSize: '0.82em' }}>
                        Falha na análise via IA: {aiRec.error}
                      </p>
                    ) : aiRec.text ? (
                      <p>{aiRec.text}</p>
                    ) : (
                      <p style={{ opacity: 0.4, fontStyle: 'italic' }}>Aguardando análise…</p>
                    )}
                  </div>
                )}

                {/* ── Logradouros Tab ── */}
                {detailTab === 'logradouros' && (
                  <div className="detail-copy">
                    <h3>Logradouros críticos</h3>
                    <p>{formatCriticalStreets(selectedTerritory)}</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow">Visão regional</p>
              <h2>{REGION_LABELS[region]}</h2>

              <div className="detail-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected
                  className="detail-tab active"
                  style={{ flexGrow: 1 }}
                >
                  📊 Resumo regional
                </button>
              </div>

              <div className="detail-content scroll-area">
                <div className="detail-empty">
                  <div className="detail-empty-icon" aria-hidden="true">🗺</div>
                  <p>Selecione um território no ranking ou no mapa para visualizar indicadores detalhados, logradouros críticos e a auditoria técnica E-GCN.</p>
                </div>
              </div>
            </>
          )}
        </aside>
      </section>

      {/* ── Event Form Modal ── */}
      {showEventForm && (
        <AddExogenousEventForm onClose={() => setShowEventForm(false)} />
      )}
    </main>
  )
}

export default App
