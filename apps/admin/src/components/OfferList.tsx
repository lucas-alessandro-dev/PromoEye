import { useState } from 'react'
import { Link } from 'react-router'
import type { OfferDTO } from '@promoeye/shared'
import { formatBRL, normalizeGtin, timeAgo } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useToast } from '../context/toast'
import { useLoad } from '../lib/hooks'
import { Badge, Flags, Price, Thumb } from './Deal'
import { TextField } from './Fields'
import { ConfirmModal, Modal } from './Modal'
import { ErrorBox, Loading } from './States'
import { StepChart, type ChartPoint } from './StepChart'

/**
 * Lista de ofertas usada em "Ofertas" e no detalhe do item. Em tela larga
 * cada linha é uma faixa (foto · título · preço · pontos · ações); no
 * celular a mesma marcação vira cartão.
 */
export function OfferList({
  rows,
  onChange,
  onRemove,
  showItem = true,
}: {
  rows: OfferDTO[]
  onChange: (o: OfferDTO) => void
  onRemove: (id: string) => void
  showItem?: boolean
}) {
  return (
    <ul className="offer-list">
      {rows.map((o) => (
        <OfferRow key={o.id} offer={o} onChange={onChange} onRemove={onRemove} showItem={showItem} />
      ))}
    </ul>
  )
}

function OfferRow({
  offer: o,
  onChange,
  onRemove,
  showItem,
}: {
  offer: OfferDTO
  onChange: (o: OfferDTO) => void
  onRemove: (id: string) => void
  showItem: boolean
}) {
  const { toast } = useToast()
  const [modal, setModal] = useState<null | 'affiliate' | 'history' | 'delete' | 'gtin'>(null)
  const [busy, setBusy] = useState(false)

  const patch = async (input: { pinned?: boolean; hidden?: boolean }, done: string) => {
    setBusy(true)
    try {
      // Reenvia o afiliado atual: fixar/ocultar nunca pode apagar o link.
      onChange(await api.updateOffer(o.id, { ...input, affiliateUrl: o.affiliateUrl }))
      toast(done)
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const makeMessage = async () => {
    setBusy(true)
    try {
      await api.offerMessage(o.id)
      toast('Rascunho criado na aba WhatsApp.')
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.deleteOffer(o.id)
      onRemove(o.id)
      toast('Oferta excluída.')
    } catch (err) {
      toast(errorMessage(err), 'danger')
      setBusy(false)
    }
  }

  const seller = o.soldByStore ? `Vendido por ${o.storeName}` : o.sellerName ? `Vendido por ${o.sellerName}` : null

  return (
    <li className={`offer-row${o.hidden ? ' is-hidden' : ''}${o.isDeal ? ' is-deal' : ''}`}>
      <div className="offer-thumb">
        <Thumb src={o.imageUrl} size={72} />
      </div>

      <div className="offer-main">
        <p className="offer-meta">
          <strong>{o.storeName}</strong>
          {showItem && (
            <>
              {' · '}
              <Link to={`/itens/${o.watchItemId}`}>{o.watchItemName}</Link>
            </>
          )}
          {o.pinned && <Badge tone="info">fixada</Badge>}
          {o.hidden && <Badge tone="neutral">oculta</Badge>}
          {o.source === 'MANUAL' && <Badge tone="neutral">manual</Badge>}
          {!o.available && <Badge tone="warn">indisponível</Badge>}
          {o.hasAffiliate && <Badge tone="good">afiliado</Badge>}
        </p>
        <h3 className="offer-title">
          <a href={o.url} target="_blank" rel="noopener noreferrer">
            {o.title}
          </a>
        </h3>
        <p className="offer-sub">
          {seller && <span>{seller}</span>}
          {o.pixPrice !== null && o.pixPrice < o.price - 0.005 && <span className="offer-pix">{formatBRL(o.pixPrice)} no Pix</span>}
          {o.installments && <span>{o.installments}</span>}
          {o.gtin && <span className="num">EAN {o.gtin}</span>}
          {o.productUrl && (
            <a href={o.productUrl} target="_blank" rel="noopener">
              produto no catálogo
            </a>
          )}
          {o.promoLabel && <span className="offer-promo">{o.promoLabel}</span>}
          <span>visto {timeAgo(o.lastSeenAt)}</span>
          {o.clicks > 0 && <span>{o.clicks} cliques</span>}
        </p>
        <Flags flags={o.flags} />
      </div>

      <div className="offer-price">
        <Price price={o.price} listPrice={o.listPrice} flags={o.flags} />
        <p className="offer-range">
          menor visto {formatBRL(o.lowestPrice)}
          {o.realDiscountPct !== null && o.realDiscountPct >= 0.01 && (
            <> · {Math.round(o.realDiscountPct * 100)}% abaixo do normal</>
          )}
        </p>
      </div>

      <div className="offer-score" title="Pontuação de 0 a 100: preço contra as outras lojas, desconto real e selos">
        <span className="score-num">{Math.round(o.score)}</span>
        <span className="score-label">pontos</span>
      </div>

      <div className="offer-actions">
        <a className="btn btn-sm btn-primary" href={o.outboundUrl} target="_blank" rel="noopener noreferrer">
          Abrir
        </a>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModal('affiliate')} disabled={busy}>
          {o.affiliateUrl ? 'Editar afiliado' : 'Link de afiliado'}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={makeMessage} disabled={busy}>
          Gerar mensagem
        </button>
        <details className="menu">
          <summary className="btn btn-sm btn-ghost">Mais</summary>
          {/* Fecha o menu depois de escolher uma ação. */}
          <div className="menu-panel" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            <button type="button" className="menu-item" onClick={() => setModal('history')}>
              Histórico de preço
            </button>
            <button type="button" className="menu-item" onClick={() => setModal('gtin')} disabled={busy}>
              {o.productId ? 'Trocar ou desligar o EAN' : 'Ligar ao EAN'}
            </button>
            <button type="button" className="menu-item" onClick={() => patch({ pinned: !o.pinned }, o.pinned ? 'Oferta desafixada.' : 'Oferta fixada no topo da vitrine.')} disabled={busy}>
              {o.pinned ? 'Desafixar' : 'Fixar no topo'}
            </button>
            <button type="button" className="menu-item" onClick={() => patch({ hidden: !o.hidden }, o.hidden ? 'Oferta visível de novo.' : 'Oferta ocultada da vitrine.')} disabled={busy}>
              {o.hidden ? 'Mostrar na vitrine' : 'Ocultar da vitrine'}
            </button>
            <button type="button" className="menu-item menu-danger" onClick={() => setModal('delete')} disabled={busy}>
              Excluir oferta
            </button>
          </div>
        </details>
      </div>

      {modal === 'affiliate' && <AffiliateModal offer={o} onClose={() => setModal(null)} onSaved={(n) => { onChange(n); setModal(null) }} />}
      {modal === 'history' && <HistoryModal offer={o} onClose={() => setModal(null)} />}
      {modal === 'gtin' && <GtinModal offer={o} onClose={() => setModal(null)} onSaved={(n) => { onChange(n); setModal(null) }} />}
      {modal === 'delete' && (
        <ConfirmModal title="Excluir oferta?" confirmLabel="Excluir" danger busy={busy} onConfirm={remove} onClose={() => setModal(null)}>
          <p>
            “{o.title}” sai do painel e da vitrine junto com o histórico de preço.
            {o.source === 'AUTO' && ' Se a loja continuar mostrando o anúncio, a próxima coleta traz ele de volta. Para sumir de vez, use “Ocultar da vitrine”.'}
          </p>
        </ConfirmModal>
      )}
    </li>
  )
}

function AffiliateModal({ offer, onClose, onSaved }: { offer: OfferDTO; onClose: () => void; onSaved: (o: OfferDTO) => void }) {
  const { toast } = useToast()
  const [value, setValue] = useState(offer.affiliateUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (url: string | null) => {
    if (url && !/^https:\/\//i.test(url)) {
      setError('O link de afiliado precisa começar com https://')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await api.updateOffer(offer.id, { affiliateUrl: url })
      toast(url ? 'Link de afiliado salvo.' : 'Link de afiliado removido.')
      onSaved(updated)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Link de afiliado desta oferta"
      onClose={onClose}
      footer={
        <>
          {offer.affiliateUrl && (
            <button type="button" className="btn btn-ghost" onClick={() => save(null)} disabled={busy}>
              Remover link
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => save(value.trim() || null)} disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <p>
        Cole o link gerado no programa de afiliados da loja (Mercado Livre, Magalu, Amazon…). Ele vale só para esta oferta e
        tem prioridade sobre o modelo de afiliado da loja.
      </p>
      <p className="muted small">
        Produto: <a href={offer.url} target="_blank" rel="noopener noreferrer">{offer.title}</a>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(value.trim() || null)
        }}
      >
        <TextField
          label="Link de afiliado"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          hint="Quem clicar em “Abrir” na vitrine ou no WhatsApp vai por este link. O clique é contado antes."
          autoFocus
        />
      </form>
    </Modal>
  )
}

/** Liga a oferta ao produto do catálogo pelo EAN (cria o produto se for o primeiro), ou desliga. */
function GtinModal({ offer, onClose, onSaved }: { offer: OfferDTO; onClose: () => void; onSaved: (o: OfferDTO) => void }) {
  const { toast } = useToast()
  const [value, setValue] = useState(offer.gtin ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (gtin: string | null) => {
    if (gtin && !normalizeGtin(gtin)) {
      setError('EAN inválido: confira os dígitos do código de barras.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await api.linkOfferProduct(offer.id, gtin)
      toast(gtin ? 'Oferta ligada ao produto do catálogo.' : 'Oferta desligada do catálogo.')
      onSaved(updated)
    } catch (err) {
      setError(err instanceof ApiError && err.issues.length ? (err.issues[0]?.message ?? errorMessage(err)) : errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="EAN desta oferta"
      onClose={onClose}
      footer={
        <>
          {offer.productId && (
            <button type="button" className="btn btn-ghost" onClick={() => void save(null)} disabled={busy}>
              Desligar do catálogo
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save(value.trim() || null)} disabled={busy || !value.trim()}>
            {busy ? 'Salvando…' : 'Ligar ao EAN'}
          </button>
        </>
      }
    >
      <p>
        Com o EAN, esta oferta aparece na página do produto ao lado das mesmas ofertas das outras lojas. Use para Amazon,
        KaBuM! e ofertas manuais, que não trazem o código na busca. Se a loja mandar o EAN numa próxima coleta, vale o dela.
      </p>
      <p className="muted small">
        Produto: <a href={offer.url} target="_blank" rel="noopener noreferrer">{offer.title}</a>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(value.trim() || null)
        }}
      >
        <TextField
          label="EAN (código de barras)"
          inputMode="numeric"
          placeholder="7891234567895"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          hint="Está na ficha técnica da loja ou na embalagem: 13 dígitos, em geral."
          maxLength={20}
          autoFocus
        />
      </form>
    </Modal>
  )
}

function HistoryModal({ offer, onClose }: { offer: OfferDTO; onClose: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.offerHistory(offer.id), [offer.id])

  const points: ChartPoint[] = (data ?? []).map((p) => ({ t: new Date(p.at).getTime(), v: p.available ? p.price : null }))
  // O preço atual vale até agora: estende o degrau até o presente.
  if (points.length) points.push({ t: Date.now(), v: offer.available ? offer.price : null })

  return (
    <Modal title="Histórico de preço" onClose={onClose} wide>
      <p className="muted small">
        {offer.storeName} · {offer.title}
      </p>
      {loading && !data && <Loading />}
      {error ? <ErrorBox error={error} onRetry={reload} /> : null}
      {data && (
        <>
          <StepChart points={points} label={`Preço em ${offer.storeName}`} />
          <dl className="stats stats-inline">
            <div>
              <dt>Agora</dt>
              <dd>{formatBRL(offer.price)}</dd>
            </div>
            <div>
              <dt>Menor visto</dt>
              <dd>{formatBRL(offer.lowestPrice)}</dd>
            </div>
            <div>
              <dt>Maior visto</dt>
              <dd>{formatBRL(offer.highestPrice)}</dd>
            </div>
            <div>
              <dt>Acompanhando desde</dt>
              <dd>{new Date(offer.firstSeenAt).toLocaleDateString('pt-BR')}</dd>
            </div>
          </dl>
          <p className="muted small">Gravamos um ponto só quando o preço, o preço “de” ou o estoque mudam.</p>
        </>
      )}
    </Modal>
  )
}
