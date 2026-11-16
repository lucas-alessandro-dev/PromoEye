import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { OfferDTO } from '@promoeye/shared'
import { api, errorMessage } from '../api'
import { useRun } from '../context/run'
import { useToast } from '../context/toast'
import { useDebounced, useLoad, useTitle } from '../lib/hooks'
import { SelectField, TextField } from '../components/Fields'
import { ManualOfferModal } from '../components/ManualOfferForm'
import { OfferList } from '../components/OfferList'
import { Empty, ErrorBox, Loading } from '../components/States'

const PAGE = 50

export function Offers() {
  useTitle('Ofertas')
  const { version } = useRun()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const itemId = params.get('itemId') ?? ''
  const storeId = params.get('storeId') ?? ''
  const deals = params.get('deals') === '1'
  const hidden = params.get('hidden') === '1'
  const old = params.get('old') === '1'
  const [q, setQ] = useState(params.get('q') ?? '')
  const qDebounced = useDebounced(q, 350)

  const [rows, setRows] = useState<OfferDTO[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const items = useLoad(() => api.items(), [])
  const stores = useLoad(() => api.stores(), [])
  const list = useLoad(
    () => api.offers({ itemId, storeId, deals, hidden, fresh: !old, q: qDebounced, limit: PAGE, offset: 0 }),
    [itemId, storeId, deals, hidden, old, qDebounced, version]
  )

  useEffect(() => {
    if (list.data) {
      setRows(list.data.rows)
      setTotal(list.data.total)
    }
  }, [list.data])

  useEffect(() => {
    const next = new URLSearchParams(params)
    if (qDebounced.trim()) next.set('q', qDebounced.trim())
    else next.delete('q')
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced])

  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params)
    if (value === '' || value === false) next.delete(key)
    else next.set(key, value === true ? '1' : value)
    setParams(next, { replace: true })
  }

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const more = await api.offers({ itemId, storeId, deals, hidden, fresh: !old, q: qDebounced, limit: PAGE, offset: rows.length })
      setRows((r) => [...r, ...more.rows.filter((m) => !r.some((x) => x.id === m.id))])
      setTotal(more.total)
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Ofertas</h1>
          <p className="lead">Tudo o que a coleta encontrou e passou nos filtros, da melhor pontuação para a pior.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setManualOpen(true)} disabled={!items.data || !stores.data}>
          Adicionar oferta manual
        </button>
      </header>

      <form className="card filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <SelectField label="Item" value={itemId} onChange={(e) => setParam('itemId', e.target.value)}>
          <option value="">Todos os itens</option>
          {(items.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Loja" value={storeId} onChange={(e) => setParam('storeId', e.target.value)}>
          <option value="">Todas as lojas</option>
          {(stores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Buscar no título" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex.: preto, 256" />
        <fieldset className="filter-checks">
          <legend className="sr-only">Opções</legend>
          <label className="check">
            <input type="checkbox" checked={deals} onChange={(e) => setParam('deals', e.target.checked)} />
            <span>Só promoções</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={hidden} onChange={(e) => setParam('hidden', e.target.checked)} />
            <span>Incluir ocultas</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={old} onChange={(e) => setParam('old', e.target.checked)} />
            <span>Incluir anúncios antigos</span>
          </label>
        </fieldset>
      </form>

      <div aria-live="polite" className="sr-only">
        {list.data ? `${total} ofertas encontradas` : ''}
      </div>

      {list.loading && !list.data && <Loading />}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}

      {list.data && rows.length === 0 && (
        <Empty title={deals ? 'Nenhuma promoção com esses filtros' : 'Nenhuma oferta com esses filtros'}>
          {deals
            ? 'Desmarque “Só promoções” para ver todos os anúncios acompanhados.'
            : 'Crie itens em “Itens” e rode uma coleta para começar a ver ofertas aqui.'}
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <p className="muted small">
            Mostrando {rows.length} de {total}
            {list.loading && ' · atualizando…'}
          </p>
          <OfferList
            rows={rows}
            onChange={(o) => setRows((r) => r.map((x) => (x.id === o.id ? o : x)))}
            onRemove={(id) => {
              setRows((r) => r.filter((x) => x.id !== id))
              setTotal((t) => t - 1)
            }}
          />
          {rows.length < total && (
            <div className="load-more">
              <button type="button" className="btn btn-ghost" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : `Carregar mais ${Math.min(PAGE, total - rows.length)}`}
              </button>
            </div>
          )}
        </>
      )}

      {manualOpen && items.data && stores.data && (
        <ManualOfferModal
          items={items.data}
          stores={stores.data}
          defaultItemId={itemId || undefined}
          onClose={() => setManualOpen(false)}
          onCreated={(o) => {
            setManualOpen(false)
            toast('Oferta adicionada.')
            setRows((r) => [o, ...r])
            setTotal((t) => t + 1)
          }}
        />
      )}
    </div>
  )
}
