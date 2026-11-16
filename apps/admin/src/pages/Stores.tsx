import { useState } from 'react'
import { Link } from 'react-router'
import { formatBRL, timeAgo, type StoreDTO } from '@promoeye/shared'
import { api, errorMessage, type StorePatch, type StoreTestResult } from '../api'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { ADAPTER_LABEL, formatDuration, previewOutbound } from '../lib/format'
import { Badge } from '../components/Deal'
import { SelectField, Switch, TextField } from '../components/Fields'
import { Modal } from '../components/Modal'
import { ErrorBox, Loading } from '../components/States'

export function Stores() {
  useTitle('Lojas')
  const { data, error, loading, reload, setData } = useLoad(() => api.stores(), [])

  const replace = (s: StoreDTO) => setData((list) => (list ? list.map((x) => (x.id === s.id ? s : x)) : list))
  const auto = (data ?? []).filter((s) => s.adapter !== 'MANUAL')
  const manual = (data ?? []).filter((s) => s.adapter === 'MANUAL')

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Lojas confiáveis</h1>
          <p className="lead">Onde o PromoEye procura, quais vendedores aceita e como o link de afiliado é montado.</p>
        </div>
      </header>

      {loading && !data && <Loading />}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : null}

      {data && (
        <>
          <section aria-labelledby="h-auto">
            <h2 id="h-auto" className="section-title">
              Coleta automática <span className="muted small">({auto.length})</span>
            </h2>
            <div className="store-grid">
              {auto.map((s) => (
                <StoreCard key={s.id} store={s} onSaved={replace} />
              ))}
            </div>
          </section>

          <section aria-labelledby="h-manual">
            <h2 id="h-manual" className="section-title">
              Manuais <span className="muted small">(bloqueiam robôs)</span>
            </h2>
            <p className="muted">
              Mercado Livre, Magazine Luiza e Casas Bahia recusam buscas automáticas, então o PromoEye não tenta. Achou uma
              promoção nelas? Adicione em <Link to="/ofertas">Ofertas › Adicionar oferta manual</Link>, com o seu link de afiliado.
            </p>
            <div className="store-grid">
              {manual.map((s) => (
                <StoreCard key={s.id} store={s} onSaved={replace} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function StoreCard({ store: s, onSaved }: { store: StoreDTO; onSaved: (s: StoreDTO) => void }) {
  const { toast } = useToast()
  const [template, setTemplate] = useState(s.affiliateTemplate ?? '')
  const [busy, setBusy] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const isManual = s.adapter === 'MANUAL'
  const dirty = (template.trim() || null) !== (s.affiliateTemplate ?? null)

  const sampleUrl = `https://${s.domain}/produto-exemplo/p`
  const previewLink = previewOutbound(sampleUrl, template)

  const patch = async (input: StorePatch, done: string) => {
    setBusy(true)
    try {
      // Reenvia o modelo salvo (não o rascunho do campo): ligar a loja nunca apaga o afiliado.
      const saved = await api.updateStore(s.id, { affiliateTemplate: s.affiliateTemplate, ...input })
      onSaved(saved)
      setTemplate(saved.affiliateTemplate ?? '')
      toast(done)
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const failing = s.lastErrorAt && (!s.lastOkAt || new Date(s.lastErrorAt) > new Date(s.lastOkAt))

  return (
    <article className={`card store-card${s.enabled ? '' : ' is-off'}`} aria-labelledby={`store-${s.id}`}>
      <header className="store-head">
        <div>
          <h3 id={`store-${s.id}`}>{s.name}</h3>
          <p className="muted small">
            {s.domain} · {ADAPTER_LABEL[s.adapter]}
          </p>
        </div>
        <Switch
          label={s.enabled ? 'Ligada' : 'Desligada'}
          checked={s.enabled}
          disabled={busy}
          onChange={(v) => void patch({ enabled: v }, v ? `${s.name} ligada.` : `${s.name} desligada.`)}
        />
      </header>

      {s.trustNote && <p className="store-trust">{s.trustNote}</p>}

      <p className="store-status">
        {isManual ? (
          <Badge tone="neutral">sem coleta automática</Badge>
        ) : failing ? (
          <Badge tone="warn">com erro</Badge>
        ) : s.lastOkAt ? (
          <Badge tone="good">respondendo</Badge>
        ) : (
          <Badge tone="neutral">ainda não coletada</Badge>
        )}{' '}
        <span className="muted small">
          {s.offerCount} {s.offerCount === 1 ? 'anúncio' : 'anúncios'}
          {!isManual && <> · último sucesso {timeAgo(s.lastOkAt)}</>}
        </span>
      </p>
      {failing && s.lastError && (
        <p className="store-error small">
          Último erro {timeAgo(s.lastErrorAt)}: {s.lastError}
        </p>
      )}

      {!isManual && (
        <SelectField
          label="Vendedores aceitos"
          value={s.sellerPolicy}
          disabled={busy}
          onChange={(e) =>
            void patch({ sellerPolicy: e.target.value as StoreDTO['sellerPolicy'] }, 'Política de vendedor salva.')
          }
          hint="Marketplace aberto tem de tudo. Na primeira opção, só passa a própria loja e os vendedores da lista de confiáveis (Configurações)."
        >
          <option value="OFFICIAL_ONLY">Só a loja e vendedores confiáveis</option>
          <option value="ALL">Qualquer vendedor do marketplace</option>
        </SelectField>
      )}

      <form
        className="affiliate-form"
        onSubmit={(e) => {
          e.preventDefault()
          void patch({ affiliateTemplate: template.trim() || null }, template.trim() ? 'Modelo de afiliado salvo.' : 'Modelo de afiliado removido.')
        }}
      >
        <TextField
          label="Modelo de afiliado da loja"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={s.id === 'amazon' ? 'tag=seutag-20' : 'tag=seutag ou https://rede…{url_encoded}'}
          hint={
            <>
              Duas formas: um parâmetro como <code>tag=seutag-20</code> (anexado ao link do produto, é o caso da Amazon), ou um
              link da rede de afiliados com <code>{'{url_encoded}'}</code> no lugar do produto (Awin, Rakuten, Lomadee). Link
              colado em uma oferta vence este modelo.
            </>
          }
        />
        <p className="affiliate-preview small">
          <span className="muted">Fica assim: </span>
          <code>{previewLink}</code>
        </p>
        <div className="row-actions">
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !dirty}>
            Salvar modelo
          </button>
          {!isManual && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTestOpen(true)}>
              Testar busca nesta loja
            </button>
          )}
        </div>
      </form>

      {testOpen && <StoreTestModal store={s} onClose={() => setTestOpen(false)} />}
    </article>
  )
}

function StoreTestModal({ store, onClose }: { store: StoreDTO; onClose: () => void }) {
  const [query, setQuery] = useState('smart tv 50')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StoreTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (query.trim().length < 2) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.testStore(store.id, query.trim()))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Testar ${store.name}`} onClose={onClose} wide>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <TextField label="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Buscando…' : 'Buscar'}
        </button>
      </form>
      <div aria-live="polite">
        {busy && <Loading label="Perguntando à loja…" />}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {result && !busy && (
          <>
            <p className={result.ok ? 'notice notice-good' : 'notice notice-warn'}>
              {result.ok
                ? `A loja respondeu com ${result.count} ${result.count === 1 ? 'anúncio' : 'anúncios'} em ${formatDuration(result.tookMs)}.`
                : `A loja não respondeu: ${result.message ?? 'erro desconhecido'}`}
            </p>
            {result.sample.length > 0 && (
              <ul className="preview-list">
                {result.sample.map((r, i) => (
                  <li key={`${r.url}-${i}`} className="preview-row preview-row-simple is-accepted">
                    <div className="preview-main">
                      <p className="offer-meta">{r.sellerName ?? store.name}</p>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="preview-title">
                        {r.title}
                      </a>
                    </div>
                    <div className="preview-price">
                      <strong className="num">{formatBRL(r.price)}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
