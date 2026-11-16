import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { formatBRL, watchItemInput, type PreviewResult, type PreviewRow, type StoreDTO, type WatchItemDTO } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { formatDuration, moneyInput } from '../lib/format'
import { ChipsInput, Switch, TextArea, TextField } from '../components/Fields'
import { ConfirmModal } from '../components/Modal'
import { Thumb } from '../components/Deal'
import { ErrorBox, Loading } from '../components/States'

interface FormState {
  name: string
  query: string
  mustInclude: string[]
  mustExclude: string[]
  minPrice: string
  targetPrice: string
  minDiscountPct: string
  storeIds: string[]
  category: string
  active: boolean
  notes: string
}

const EMPTY: FormState = {
  name: '',
  query: '',
  mustInclude: [],
  mustExclude: [],
  minPrice: '',
  targetPrice: '',
  minDiscountPct: '',
  storeIds: [],
  category: '',
  active: true,
  notes: '',
}

const money = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))

function fromDTO(i: WatchItemDTO): FormState {
  return {
    name: i.name,
    query: i.query,
    mustInclude: i.mustInclude,
    mustExclude: i.mustExclude,
    minPrice: money(i.minPrice),
    targetPrice: money(i.targetPrice),
    minDiscountPct: i.minDiscountPct === null ? '' : String(i.minDiscountPct),
    storeIds: i.storeIds,
    category: i.category ?? '',
    active: i.active,
    notes: i.notes ?? '',
  }
}

const FIELD_MESSAGES: Record<string, string> = {
  minPrice: 'Use um valor em reais (ex.: 1500) ou deixe em branco',
  targetPrice: 'Use um valor em reais (ex.: 3999,90) ou deixe em branco',
  minDiscountPct: 'Use um número de 0 a 95, sem o %',
}

function toRaw(f: FormState) {
  return {
    name: f.name,
    query: f.query,
    mustInclude: f.mustInclude,
    mustExclude: f.mustExclude,
    minPrice: moneyInput(f.minPrice),
    targetPrice: moneyInput(f.targetPrice),
    minDiscountPct: f.minDiscountPct.trim().replace('%', ''),
    storeIds: f.storeIds,
    category: f.category.trim() || null,
    active: f.active,
    notes: f.notes.trim() || null,
  }
}

type Errors = Partial<Record<keyof FormState, string>>

function issuesToErrors(issues: { path: (string | number)[] | string; message: string }[]): Errors {
  const out: Errors = {}
  for (const i of issues) {
    const key = (Array.isArray(i.path) ? String(i.path[0] ?? '') : i.path.split('.')[0]) as keyof FormState
    if (!out[key]) out[key] = FIELD_MESSAGES[key] ?? i.message
  }
  return out
}

export function ItemForm() {
  const { id } = useParams()
  const editing = Boolean(id)
  useTitle(editing ? 'Editar item' : 'Novo item')
  const navigate = useNavigate()
  const { toast } = useToast()

  const stores = useLoad(() => api.stores(), [])
  const item = useLoad(() => (id ? api.item(id) : Promise.resolve(null)), [id])

  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (item.data) setForm(fromDTO(item.data))
  }, [item.data])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const autoStores = useMemo(() => (stores.data ?? []).filter((s) => s.adapter !== 'MANUAL'), [stores.data])

  const save = async () => {
    setFormError(null)
    const parsed = watchItemInput.safeParse(toRaw(form))
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues))
      setFormError('Confira os campos marcados.')
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const saved = id ? await api.updateItem(id, parsed.data) : await api.createItem(parsed.data)
      toast(id ? 'Item salvo.' : 'Item criado. Ele entra na próxima coleta, ou clique em “Buscar este”.')
      navigate(`/itens/${saved.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setErrors(issuesToErrors(err.issues))
      setFormError(errorMessage(err))
      setSaving(false)
    }
  }

  const runPreview = async () => {
    const raw = toRaw(form)
    if (raw.query.trim().length < 2) {
      setErrors((e) => ({ ...e, query: 'Diga o que buscar nas lojas' }))
      return
    }
    const parsed = watchItemInput
      .pick({ query: true, mustInclude: true, mustExclude: true, minPrice: true, storeIds: true })
      .safeParse(raw)
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues))
      return
    }
    setPreviewing(true)
    setPreviewError(null)
    try {
      setPreview(await api.preview(parsed.data))
    } catch (err) {
      setPreviewError(errorMessage(err))
    } finally {
      setPreviewing(false)
    }
  }

  const remove = async () => {
    if (!id) return
    setDeleting(true)
    try {
      await api.deleteItem(id)
      toast('Item excluído.')
      navigate('/itens')
    } catch (err) {
      toast(errorMessage(err), 'danger')
      setDeleting(false)
    }
  }

  if (editing && item.loading && !item.data) return <Loading />
  if (editing && item.error && !item.data) return <ErrorBox error={item.error} onRetry={item.reload} />

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="crumbs">
            <Link to="/itens">Itens</Link>
            {item.data && (
              <>
                {' / '}
                <Link to={`/itens/${item.data.id}`}>{item.data.name}</Link>
              </>
            )}
          </p>
          <h1>{editing ? 'Editar item' : 'Novo item'}</h1>
        </div>
      </header>

      <form
        className="card form-card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="form-grid">
          <TextField
            label="Nome"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            placeholder="iPhone 16 128GB"
            hint="Como o item aparece na vitrine e nas mensagens."
            maxLength={120}
          />
          <TextField
            label="O que buscar nas lojas"
            value={form.query}
            onChange={(e) => set('query', e.target.value)}
            error={errors.query}
            placeholder="iphone 16 128gb"
            hint="É o texto digitado na busca de cada loja. Quanto mais específico, menos lixo."
            maxLength={160}
          />

          <div className="span-2">
            <ChipsInput
              label="Termos obrigatórios"
              values={form.mustInclude}
              onChange={(v) => set('mustInclude', v)}
              error={errors.mustInclude}
              placeholder="iphone, 16, 128gb|128 gb"
              hint={
                <>
                  Todos precisam aparecer no título do anúncio, como palavra inteira (“16” não pega “16e”). Vazio = usa as
                  palavras da busca. Use <code>|</code> para alternativas: <code>128gb|128 gb</code> aceita qualquer uma das duas.
                </>
              }
            />
          </div>
          <div className="span-2">
            <ChipsInput
              label="Termos excluídos"
              values={form.mustExclude}
              onChange={(v) => set('mustExclude', v)}
              error={errors.mustExclude}
              placeholder="pro, plus, max, 16e"
              hint="Se aparecer no título, o anúncio fica de fora. Capa, película, usado e vitrine já são excluídos em todos os itens (Configurações)."
            />
          </div>

          <TextField
            label="Preço mínimo (R$)"
            inputMode="decimal"
            value={form.minPrice}
            onChange={(e) => set('minPrice', e.target.value)}
            error={errors.minPrice}
            placeholder="2500"
            hint="Abaixo disso é acessório ou erro de cadastro e é descartado."
          />
          <TextField
            label="Preço-alvo (R$)"
            inputMode="decimal"
            value={form.targetPrice}
            onChange={(e) => set('targetPrice', e.target.value)}
            error={errors.targetPrice}
            placeholder="3999,90"
            hint="Abaixo dele vira promoção na hora, com aviso no WhatsApp."
          />
          <TextField
            label="Desconto real mínimo (%)"
            inputMode="numeric"
            value={form.minDiscountPct}
            onChange={(e) => set('minDiscountPct', e.target.value)}
            error={errors.minDiscountPct}
            placeholder="padrão das configurações"
            hint="Contra o preço normal dos últimos 30 dias que o PromoEye registrou, não contra o “de” da loja."
          />
          <TextField
            label="Categoria (opcional)"
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            error={errors.category}
            placeholder="Celulares"
            maxLength={60}
          />

          <fieldset className="span-2 store-picker">
            <legend>Lojas</legend>
            <p className="hint">Nenhuma marcada = todas as lojas com coleta automática que estiverem ligadas.</p>
            {stores.loading && !stores.data && <Loading label="Carregando lojas…" />}
            {stores.error ? <ErrorBox error={stores.error} onRetry={stores.reload} /> : null}
            <div className="check-grid">
              {autoStores.map((s: StoreDTO) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.storeIds.includes(s.id)}
                    onChange={(e) =>
                      set('storeIds', e.target.checked ? [...form.storeIds, s.id] : form.storeIds.filter((x) => x !== s.id))
                    }
                  />
                  <span>
                    {s.name}
                    {!s.enabled && <span className="muted small"> (desligada)</span>}
                  </span>
                </label>
              ))}
            </div>
            {form.storeIds.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('storeIds', [])}>
                Limpar seleção (usar todas)
              </button>
            )}
          </fieldset>

          <div className="span-2">
            <TextArea label="Notas (opcional)" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} maxLength={2000} />
          </div>
          <div className="span-2">
            <Switch
              label="Acompanhar este item"
              checked={form.active}
              onChange={(v) => set('active', v)}
              hint="Pausado, o item sai da coleta e da vitrine, mas o histórico fica guardado."
            />
          </div>
        </div>

        {formError && (
          <p className="field-error" role="alert">
            {formError}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-accent" onClick={() => void runPreview()} disabled={previewing}>
            {previewing ? 'Testando…' : 'Testar busca'}
          </button>
          <span className="spacer" />
          {editing && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
              Excluir item
            </button>
          )}
          <Link className="btn btn-ghost" to={id ? `/itens/${id}` : '/itens'}>
            Cancelar
          </Link>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvando…' : editing ? 'Salvar' : 'Criar item'}
          </button>
        </div>
      </form>

      <section className="card" aria-labelledby="h-preview" aria-busy={previewing}>
        <h2 id="h-preview">Testar busca</h2>
        <p className="muted">
          Busca agora nas lojas com os termos acima, sem gravar nada, e mostra o que entra e o que fica de fora — com o motivo.
          Use para afinar os termos antes de salvar.
        </p>
        <div aria-live="polite">
          {previewing && <Loading label="Buscando nas lojas… leva de 5 a 15 segundos." />}
          {previewError && (
            <p className="field-error" role="alert">
              {previewError}
            </p>
          )}
        </div>
        {preview && !previewing && <PreviewPanel result={preview} />}
      </section>

      {confirmDelete && (
        <ConfirmModal
          title="Excluir este item?"
          confirmLabel="Excluir item"
          danger
          busy={deleting}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        >
          <p>O item, as ofertas encontradas e todo o histórico de preço são apagados. Para só parar de buscar, desligue “Acompanhar este item”.</p>
        </ConfirmModal>
      )}
    </div>
  )
}

type Filter = 'all' | 'accepted' | 'rejected'

function PreviewPanel({ result }: { result: PreviewResult }) {
  const [filter, setFilter] = useState<Filter>('all')
  const accepted = result.rows.filter((r) => r.accepted).sort((a, b) => a.price - b.price)
  const rejected = result.rows.filter((r) => !r.accepted)
  const stores = new Set(result.rows.map((r) => r.storeId)).size
  const shown = filter === 'accepted' ? accepted : filter === 'rejected' ? rejected : [...accepted, ...rejected]
  const best = accepted.find((r) => r.available)

  return (
    <div className="preview">
      <p className="preview-summary">
        <strong>{accepted.length}</strong> {accepted.length === 1 ? 'anúncio entra' : 'anúncios entram'} e{' '}
        <strong>{rejected.length}</strong> {rejected.length === 1 ? 'fica' : 'ficam'} de fora, em {stores}{' '}
        {stores === 1 ? 'loja' : 'lojas'} · levou {formatDuration(result.tookMs)}
        {best && (
          <>
            {' '}
            · mais barato: <strong>{formatBRL(best.price)}</strong> em {best.storeName}
          </>
        )}
      </p>

      {result.storeErrors.length > 0 && (
        <div className="notice notice-warn">
          <p>
            <strong>Algumas lojas não responderam:</strong>
          </p>
          <ul>
            {result.storeErrors.map((e) => (
              <li key={e.storeId}>
                {e.storeName}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="segmented" role="group" aria-label="Filtrar resultado do teste">
        {(
          [
            ['all', `Todos (${result.rows.length})`],
            ['accepted', `Entram (${accepted.length})`],
            ['rejected', `Ficam de fora (${rejected.length})`],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className="seg-btn" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">Nada aqui.</p>
      ) : (
        <ul className="preview-list">
          {shown.map((r, i) => (
            <PreviewItem key={`${r.storeId}-${r.url}-${i}`} row={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PreviewItem({ row: r }: { row: PreviewRow }) {
  return (
    <li className={`preview-row ${r.accepted ? 'is-accepted' : 'is-rejected'}`}>
      <span className="preview-verdict">{r.accepted ? 'Entra' : 'Fica de fora'}</span>
      <Thumb src={r.imageUrl} size={56} />
      <div className="preview-main">
        <p className="offer-meta">
          <strong>{r.storeName}</strong>
          {r.sellerName && <> · {r.sellerName}</>}
          {!r.available && <> · indisponível</>}
        </p>
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="preview-title">
          {r.title}
        </a>
        {!r.accepted && r.reason && <p className="preview-reason">{r.reason}</p>}
      </div>
      <div className="preview-price">
        <strong className="num">{formatBRL(r.price)}</strong>
        {r.listPrice && r.listPrice > r.price && <s className="muted small">{formatBRL(r.listPrice)}</s>}
      </div>
    </li>
  )
}
