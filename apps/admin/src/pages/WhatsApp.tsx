import { useState } from 'react'
import { Link } from 'react-router'
import { flagLabel, formatBRL, timeAgo, type MessageDTO } from '@promoeye/shared'
import { api, errorMessage } from '../api'
import { useRun } from '../context/run'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { copyText, formatTime, whatsappShareUrl } from '../lib/format'
import { Badge, Thumb } from '../components/Deal'
import { SelectField, TextArea, TextField } from '../components/Fields'
import { Empty, ErrorBox, Loading } from '../components/States'
import { WhatsAppBubble } from '../components/WhatsAppBubble'

type Tab = 'DRAFT' | 'SENT' | 'DISCARDED' | 'ALL'

const TABS: [Tab, string][] = [
  ['DRAFT', 'Para enviar'],
  ['SENT', 'Enviadas'],
  ['DISCARDED', 'Descartadas'],
  ['ALL', 'Todas'],
]

const STATUS_BADGE: Record<MessageDTO['status'], { label: string; tone: 'good' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  DRAFT: { label: 'rascunho', tone: 'info' },
  SENT: { label: 'enviada', tone: 'good' },
  DISCARDED: { label: 'descartada', tone: 'neutral' },
  FAILED: { label: 'falhou', tone: 'danger' },
}

export function WhatsApp() {
  useTitle('WhatsApp')
  const { version } = useRun()
  const [tab, setTab] = useState<Tab>('DRAFT')
  const list = useLoad(() => api.messages(tab === 'ALL' ? undefined : tab), [tab, version])
  const settings = useLoad(() => api.settings(), [])

  const replace = (m: MessageDTO) =>
    list.setData((rows) => {
      if (!rows) return rows
      // Mudou de status e saiu da aba atual: some da lista.
      if (tab !== 'ALL' && m.status !== tab) return rows.filter((r) => r.id !== m.id)
      return rows.map((r) => (r.id === m.id ? m : r))
    })

  const invite = settings.data?.whatsapp.groupInviteUrl

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Mensagens para o grupo</h1>
          <p className="lead">
            Quando surge promoção nova, o PromoEye deixa a mensagem pronta aqui. Por enquanto o envio é seu: copie e cole no
            grupo, ou abra direto no WhatsApp.
          </p>
        </div>
      </header>

      <div className="notice notice-info">
        {invite ? (
          <p>
            Grupo da vitrine: <a href={invite} target="_blank" rel="noopener noreferrer">{invite}</a>
          </p>
        ) : (
          <p>
            Nenhum grupo cadastrado. Cole o convite do grupo em <Link to="/configuracoes">Configurações</Link> para ele aparecer
            na vitrine.
          </p>
        )}
      </div>

      <div className="segmented" role="group" aria-label="Filtrar mensagens">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className="seg-btn" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {list.loading && !list.data && <Loading />}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.length === 0 && (
        <Empty title={tab === 'DRAFT' ? 'Nenhuma mensagem para enviar' : 'Nada por aqui'}>
          {tab === 'DRAFT'
            ? 'As mensagens aparecem sozinhas quando uma oferta vira promoção. Também dá para gerar uma em Ofertas › Gerar mensagem.'
            : 'Mude de aba para ver as outras mensagens.'}
        </Empty>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="message-list">
          {list.data.map((m) => (
            <MessageCard key={m.id} message={m} onChange={replace} />
          ))}
        </ul>
      )}

      <AutoSendBlock settings={settings.data?.whatsapp ?? null} tokenSet={settings.data?.providerTokenSet ?? false} />
    </div>
  )
}

function MessageCard({ message: m, onChange }: { message: MessageDTO; onChange: (m: MessageDTO) => void }) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const [busy, setBusy] = useState(false)
  const badge = STATUS_BADGE[m.status]

  const update = async (input: { status?: 'DRAFT' | 'SENT' | 'DISCARDED'; body?: string }, done: string) => {
    setBusy(true)
    try {
      const saved = await api.updateMessage(m.id, input)
      onChange(saved)
      setEditing(false)
      toast(done)
    } catch (err) {
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const ok = await copyText(m.body)
    toast(ok ? 'Mensagem copiada. Cole no grupo.' : 'Não deu para copiar. Selecione o texto e copie à mão.', ok ? 'good' : 'warn')
  }

  return (
    <li className="card message-card">
      <header className="message-head">
        <Thumb src={m.imageUrl} size={56} />
        <div className="message-meta">
          <p className="offer-meta">
            <Badge tone={badge.tone}>{badge.label}</Badge> {m.storeName && <strong>{m.storeName}</strong>}
            {m.price !== null && <> · {formatBRL(m.price)}</>}
            {m.reason && <> · {flagLabel(m.reason)}</>}
          </p>
          <p className="message-title">{m.offerTitle ?? 'Oferta removida'}</p>
          <p className="muted small">
            criada {timeAgo(m.createdAt)}
            {m.sentAt && <> · enviada {timeAgo(m.sentAt)}</>}
          </p>
          {m.error && <p className="store-error small">{m.error}</p>}
        </div>
      </header>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void update({ body: draft }, 'Texto salvo.')
          }}
        >
          <TextArea label="Texto da mensagem" value={draft} onChange={(e) => setDraft(e.target.value)} rows={9} maxLength={4000} hint="*negrito*, _itálico_ e ~riscado~ funcionam no WhatsApp." autoFocus />
          <div className="row-actions">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDraft(m.body); setEditing(false) }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !draft.trim()}>
              Salvar texto
            </button>
          </div>
        </form>
      ) : (
        <WhatsAppBubble text={m.body} time={formatTime(m.createdAt)} />
      )}

      {!editing && (
        <div className="row-actions">
          <button type="button" className="btn btn-sm btn-accent" onClick={() => void copy()}>
            Copiar
          </button>
          <a className="btn btn-sm btn-ghost" href={whatsappShareUrl(m.body)} target="_blank" rel="noopener noreferrer">
            Abrir no WhatsApp
          </a>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
            Editar texto
          </button>
          {m.status !== 'SENT' && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void update({ status: 'SENT' }, 'Marcada como enviada.')} disabled={busy}>
              Marcar como enviada
            </button>
          )}
          {m.status === 'DRAFT' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'DISCARDED' }, 'Mensagem descartada.')} disabled={busy}>
              Descartar
            </button>
          )}
          {m.status !== 'DRAFT' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'DRAFT' }, 'Voltou para os rascunhos.')} disabled={busy}>
              Voltar para rascunho
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function AutoSendBlock({
  settings,
  tokenSet,
}: {
  settings: { provider: string; providerUrl: string; providerInstance: string; groupId: string } | null
  tokenSet: boolean
}) {
  return (
    <section className="card card-muted" aria-labelledby="h-auto-send">
      <h2 id="h-auto-send">Envio automático para o grupo — próxima etapa</h2>
      <p>
        Para o PromoEye mandar sozinho para o grupo, ele precisa de um provedor de WhatsApp conectado a um número. A API
        oficial da Meta (Cloud API) não envia para grupos comuns; Evolution API e Z-API enviam, mas usam um número de WhatsApp
        comum, que pode ser bloqueado se mandar mensagens demais. A fila desta página já está pronta para esse provedor
        consumir.
      </p>
      <fieldset disabled className="form-grid">
        <legend className="sr-only">Provedor de envio (desabilitado)</legend>
        <SelectField label="Provedor" value={settings?.provider ?? 'none'} onChange={() => undefined}>
          <option value="none">Nenhum (envio manual)</option>
          <option value="evolution">Evolution API</option>
          <option value="zapi">Z-API</option>
          <option value="cloud">WhatsApp Cloud API (Meta)</option>
        </SelectField>
        <TextField label="Endereço do provedor" value={settings?.providerUrl ?? ''} onChange={() => undefined} placeholder="https://" />
        <TextField label="Instância" value={settings?.providerInstance ?? ''} onChange={() => undefined} />
        <TextField label="ID do grupo" value={settings?.groupId ?? ''} onChange={() => undefined} placeholder="120363…@g.us" />
        <TextField label="Token" type="password" value={tokenSet ? '••••••••' : ''} onChange={() => undefined} placeholder="não configurado" />
      </fieldset>
    </section>
  )
}
