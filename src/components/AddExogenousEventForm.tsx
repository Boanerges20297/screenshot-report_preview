import { useState } from 'react'
import './AddExogenousEventForm.css'

type Props = {
  onClose: () => void
}

export function AddExogenousEventForm({ onClose }: Props) {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    natureza: '',
    municipio: '',
    bairro: '',
    descricao: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const webhookUrl = import.meta.env.VITE_GOOGLE_WEBHOOK_URL
    if (!webhookUrl) {
      setError('VITE_GOOGLE_WEBHOOK_URL não configurada no .env')
      setLoading(false)
      return
    }

    try {
      // Usar text/plain evita o preflight de CORS no Google Apps Script
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(formData),
      })

      const result = await response.json()
      if (result.status === 'success') {
        setSuccess(true)
        setTimeout(onClose, 2000)
      } else {
        throw new Error(result.message || 'Falha ao registrar.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na requisição.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content form-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Inserção de Registro</p>
            <h2>Novo Evento Exógeno</h2>
            <p className="panel-subtext">Registre um evento extraordinário via web webhook integrado à ferramenta.</p>
          </div>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        {success ? (
          <div className="success-message">
            <strong>✓ Registrado com sucesso!</strong>
            <p>Os dados foram enviados para a base de eventos pendentes.</p>
          </div>
        ) : (
          <form className="exogenous-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="natureza">Natureza Principal</label>
              <select
                id="natureza"
                name="natureza"
                required
                value={formData.natureza}
                onChange={handleChange}
              >
                <option value="" disabled>Selecione a Natureza...</option>
                <option value="HOMICÍDIO">HOMICÍDIO (CVLI)</option>
                <option value="ACHADO DE CADÁVER">ACHADO DE CADÁVER</option>
                <option value="LESÃO CORPORAL">LESÃO CORPORAL (A BALA/OUTROS)</option>
                <option value="TRÁFICO DE DROGAS">TRÁFICO DE DROGAS</option>
                <option value="PORTE / POSSE ILEGAL DE ARMA">PORTE / POSSE ILEGAL DE ARMA</option>
                <option value="MANDADO DE PRISÃO">CUMPRIMENTO DE MANDADO / PRISÃO</option>
                <option value="ROUBO">ROUBO / ASSALTO</option>
                <option value="FURTO">FURTO</option>
                <option value="EXPULSÃO DE MORADORES">EXPULSÃO DE MORADORES / DESLOCAMENTO</option>
                <option value="VEÍCULO LOCALIZADO">VEÍCULO RECUPERADO / LOCALIZADO</option>
                <option value="OUTROS">OUTROS</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="municipio">Município da Ocorrência</label>
              <select
                id="municipio"
                name="municipio"
                required
                value={formData.municipio}
                onChange={handleChange}
              >
                <option value="" disabled>Selecione o Município...</option>
                <option value="FORTALEZA">FORTALEZA</option>
                <option value="CAUCAIA">CAUCAIA</option>
                <option value="MARACANAÚ">MARACANAÚ</option>
                <option value="EUSÉBIO">EUSÉBIO</option>
                <option value="AQUIRAZ">AQUIRAZ</option>
                <option value="ITAITINGA">ITAITINGA</option>
                <option value="PACATUBA">PACATUBA</option>
                <option value="GUAIÚBA">GUAIÚBA</option>
                <option value="HORIZONTE">HORIZONTE</option>
                <option value="PACAJUS">PACAJUS</option>
                <option value="CHOROZINHO">CHOROZINHO</option>
                <option value="SÃO GONÇALO DO AMARANTE">SÃO GONÇALO DO AMARANTE</option>
                <option value="SOBRAL">SOBRAL</option>
                <option value="JUAZEIRO DO NORTE">JUAZEIRO DO NORTE</option>
                <option value="OUTRO">OUTRO (Apenas Ceará)</option>
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="bairro">Bairro / Localidade</label>
                <input
                  id="bairro"
                  name="bairro"
                  required
                  placeholder="Ex: Vicente Pinzon"
                  value={formData.bairro}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="descricao">Descrição (CIOPS / Texto Bruto)</label>
              <textarea
                id="descricao"
                name="descricao"
                rows={4}
                required
                placeholder="Cole o relato ou descrição resumida..."
                value={formData.descricao}
                onChange={handleChange}
              />
            </div>

            {error && <div className="error-message">Erro: {error}</div>}

            <div className="form-actions">
              <button type="button" className="cancel-button" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="submit-button" disabled={loading}>
                {loading ? 'Enviando...' : 'Registrar Evento'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
