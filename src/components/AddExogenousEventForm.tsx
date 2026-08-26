import { useState } from 'react'
import './AddExogenousEventForm.css'

type Props = {
  onClose: () => void
}

const CEARA_MUNICIPALITIES = [
  'ABAIARA', 'ACARAPE', 'ACARAU', 'ACOPIARA', 'AIUABA', 'ALCANTARAS', 'ALTANEIRA', 'ALTO SANTO',
  'AMONTADA', 'ANTONINA DO NORTE', 'APUIARES', 'AQUIRAZ', 'ARACATI', 'ARACOIABA', 'ARARENDA',
  'ARARIPE', 'ARATUBA', 'ARNEIROZ', 'ASSARE', 'AURORA', 'BAIXIO', 'BANABUIU', 'BARBALHA',
  'BARREIRA', 'BARRO', 'BARROQUINHA', 'BATURITE', 'BEBERIBE', 'BELA CRUZ', 'BOA VIAGEM',
  'BREJO SANTO', 'CAMOCIM', 'CAMPOS SALES', 'CANINDE', 'CAPISTRANO', 'CARIDADE', 'CARIRE',
  'CARIRIACU', 'CARIUS', 'CARNAUBAL', 'CASCAVEL', 'CATARINA', 'CATUNDA', 'CAUCAIA', 'CEDRO',
  'CHAVAL', 'CHORO', 'CHOROZINHO', 'COREAU', 'CRATEUS', 'CRATO', 'CROATA', 'CRUZ',
  'DEPUTADO IRAPUAN PINHEIRO', 'ERERE', 'EUSEBIO', 'FARIAS BRITO', 'FORQUILHA', 'FORTALEZA',
  'FORTIM', 'FRECHEIRINHA', 'GENERAL SAMPAIO', 'GRACA', 'GRANJA', 'GRANJEIRO', 'GROAIRAS',
  'GUAIUBA', 'GUARACIABA DO NORTE', 'GUARAMIRANGA', 'HIDROLANDIA', 'HORIZONTE', 'IBARETAMA',
  'IBIAPINA', 'IBICUITINGA', 'ICAPUI', 'ICO', 'IGUATU', 'INDEPENDENCIA', 'IPAPORANGA',
  'IPAUMIRIM', 'IPU', 'IPUEIRAS', 'IRACEMA', 'IRAUCUBA', 'ITAICABA', 'ITAITINGA', 'ITAPAJE',
  'ITAPIPOCA', 'ITAPIUNA', 'ITAREMA', 'ITATIRA', 'JAGUARETAMA', 'JAGUARIBARA', 'JAGUARIBE',
  'JAGUARUANA', 'JARDIM', 'JATI', 'JIJOCA DE JERICOACOARA', 'JUAZEIRO DO NORTE', 'JUCAS',
  'LAVRAS DA MANGABEIRA', 'LIMOEIRO DO NORTE', 'MADALENA', 'MARACANAU', 'MARANGUAPE', 'MARCO',
  'MARTINOPOLE', 'MASSAPE', 'MAURITI', 'MERUOCA', 'MILAGRES', 'MILHA', 'MIRAIMA', 'MISSAO VELHA',
  'MOMBACA', 'MONSENHOR TABOSA', 'MORADA NOVA', 'MORAUJO', 'MORRINHOS', 'MUCAMBO', 'MULUNGU',
  'NOVA OLINDA', 'NOVA RUSSAS', 'NOVO ORIENTE', 'OCARA', 'OROS', 'PACAJUS', 'PACATUBA', 'PACOTI',
  'PACUJA', 'PALHANO', 'PALMACIA', 'PARACURU', 'PARAIPABA', 'PARAMBU', 'PARAMOTI', 'PEDRA BRANCA',
  'PENAFORTE', 'PENTECOSTE', 'PEREIRO', 'PINDORETAMA', 'PIQUET CARNEIRO', 'PIRES FERREIRA',
  'PORANGA', 'PORTEIRAS', 'POTENGI', 'POTIRETAMA', 'QUITERIANOPOLIS', 'QUIXADA', 'QUIXELO',
  'QUIXERAMOBIM', 'QUIXERE', 'REDENCAO', 'RERIUTABA', 'RUSSAS', 'SABOEIRO', 'SALITRE',
  'SANTANA DO ACARAU', 'SANTANA DO CARIRI', 'SANTA QUITERIA', 'SAO BENEDITO',
  'SAO GONCALO DO AMARANTE', 'SAO JOAO DO JAGUARIBE', 'SAO LUIS DO CURU', 'SENADOR POMPEU',
  'SENADOR SA', 'SOBRAL', 'SOLONOPOLE', 'TABULEIRO DO NORTE', 'TAMBORIL', 'TARRAFAS', 'TAUA',
  'TEJUCUOCA', 'TIANGUA', 'TRAIRI', 'TURURU', 'UBAJARA', 'UMARI', 'UMIRIM', 'URUBURETAMA',
  'URUOCA', 'VARJOTA', 'VARZEA ALEGRE', 'VICOSA DO CEARA',
]

const normalizeMunicipality = (value: string) =>
  value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

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
      setError('VITE_GOOGLE_WEBHOOK_URL nao configurada no .env')
      setLoading(false)
      return
    }

    if (webhookUrl.includes('googleusercontent.com') || webhookUrl.includes('output=csv')) {
      setError('A URL configurada parece ser de planilha publicada (CSV). Use a URL do Google Apps Script Web App (/macros/s/.../exec).')
      setLoading(false)
      return
    }

    const municipio = normalizeMunicipality(formData.municipio)
    if (!CEARA_MUNICIPALITIES.includes(municipio)) {
      setError('Selecione um municipio valido do Ceara.')
      setLoading(false)
      return
    }

    try {
      const now = new Date()
      const hora = now.toTimeString().slice(0, 5)
      const compiledText = [
        formData.natureza.toUpperCase(),
        formData.descricao.trim(),
        formData.bairro.toUpperCase(),
        municipio,
        hora,
      ]
        .filter(Boolean)
        .join(' - ')

      const payload = {
        ...formData,
        municipio,
        descricao: compiledText,
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      })

      const raw = await response.text()
      let result: { status?: string; message?: string } = {}
      if (raw) {
        try {
          result = JSON.parse(raw) as { status?: string; message?: string }
        } catch {
          result = { message: raw }
        }
      }

      if (response.ok && (result.status === 'success' || !raw)) {
        setSuccess(true)
        setTimeout(onClose, 2000)
      } else {
        const hint405 = response.status === 405
          ? ' (405: metodo nao permitido. Verifique se a URL e do Apps Script /exec, nao uma URL de CSV da planilha.)'
          : ''
        throw new Error((result.message || `Falha ao registrar (${response.status}).`) + hint405)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na requisicao.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content form-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Insercao de Registro</p>
            <h2>Novo Evento Exogeno</h2>
            <p className="panel-subtext">Registre um evento extraordinario via web webhook integrado a ferramenta.</p>
          </div>
          <button className="close-button" onClick={onClose}>
            x
          </button>
        </div>

        {success ? (
          <div className="success-message">
            <strong>Registrado com sucesso!</strong>
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
                <option value="HOMICIDIO">HOMICIDIO (CVLI)</option>
                <option value="ACHADO DE CADAVER">ACHADO DE CADAVER</option>
                <option value="LESAO CORPORAL">LESAO CORPORAL (A BALA/OUTROS)</option>
                <option value="TRAFICO DE DROGAS">TRAFICO DE DROGAS</option>
                <option value="PORTE / POSSE ILEGAL DE ARMA">PORTE / POSSE ILEGAL DE ARMA</option>
                <option value="MANDADO DE PRISAO">CUMPRIMENTO DE MANDADO / PRISAO</option>
                <option value="ROUBO">ROUBO / ASSALTO</option>
                <option value="FURTO">FURTO</option>
                <option value="EXPULSAO DE MORADORES">EXPULSAO DE MORADORES / DESLOCAMENTO</option>
                <option value="VEICULO LOCALIZADO">VEICULO RECUPERADO / LOCALIZADO</option>
                <option value="OUTROS">OUTROS</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="municipio">Municipio da Ocorrencia</label>
              <input
                id="municipio"
                name="municipio"
                list="ceara-municipalities"
                required
                placeholder="Digite para buscar..."
                value={formData.municipio}
                onChange={handleChange}
              />
              <datalist id="ceara-municipalities">
                {CEARA_MUNICIPALITIES.map((municipio) => (
                  <option key={municipio} value={municipio} />
                ))}
              </datalist>
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
              <label htmlFor="descricao">Descricao (CIOPS / Texto Bruto)</label>
              <textarea
                id="descricao"
                name="descricao"
                rows={4}
                required
                placeholder="Cole o relato ou descricao resumida..."
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
