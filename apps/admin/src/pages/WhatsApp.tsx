import { useState } from 'react'
import { Link } from 'react-router'
import { flagLabel, formatBRL, timeAgo, type MessageDTO, type MessageUpdateInput } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useRun } from '../context/run'
import { useToast } from '../context/toast'
import { useLoad, useTitle } from '../lib/hooks'
import { copyText, formatTime, whatsappShareUrl } from '../lib/format'
import { Badge, Thumb } from '../components/Deal'
import { TextArea } from '../components/Fields'
import { Empty, ErrorBox, Loading } from '../components/States'
import { WhatsAppBubble } from '../components/WhatsAppBubble'
import { WhatsAppSender } from '../components/WhatsAppSender'

type Tab = 'DRAFT' | 'QUEUED' | 'SENT' | 'FAILED' | 'DISCARDED' | 'ALL'

const TABS: [Tab, string][] = [
  ['DRAFT', 'Para enviar'],
  ['QUEUED', 'Na fila'],
  ['SENT', 'Enviadas'],
  ['FAILED', 'Com erro'],
  ['DISCARDED', 'Descartadas'],
  ['ALL', 'Todas'],
]

const EMPTY: Record<Tab, [string, string]> = {
  DRAFT: [
    'Nenhuma mensagem para enviar',
    'As mensagens aparecem sozinhas quando uma oferta vira promoção. Também dá para gerar uma em Ofertas › Gerar mensagem.',
  ],
  QUEUED: ['A fila está vazia', 'Com o envio automático ligado, cada promoção nova entra aqui e sai sozinha para o grupo.'],
  SENT: ['Nada enviado ainda', 'Mude de aba para ver as outras mensagens.'],
  FAILED: ['Nenhum erro', 'Mensagens que não saíram aparecem aqui, com o motivo.'],
  DISCARDED: ['Nada descartado', 'Mude de aba para ver as outras mensagens.'],
  ALL: ['Nada por aqui', 'As mensagens aparecem quando uma oferta vira promoção.'],
}

const STATUS_BADGE: Record<MessageDTO['status'], { label: string; tone: 'good' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  DRAFT: { label: 'rascunho', tone: 'info' },
  QUEUED: { label: 'na fila', tone: 'warn' },
  SENDING: { label: 'enviando', tone: 'warn' },
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
  const wa = useLoad(() => api.whatsappStatus(), [version])

  const replace = (m: MessageDTO) => {
    list.setData((rows) => {
      if (!rows) return rows
      // Mudou de status e saiu da aba atual: some da lista.
      if (tab !== 'ALL' && m.status !== tab) return rows.filter((r) => r.id !== m.id)
      return rows.map((r) => (r.id === m.id ? m : r))
    })
    // Os números da fila no cartão de envio mudam junto.
    api.whatsappStatus().then(wa.setData).catch(() => undefined)
  }

  const invite = settings.data?.whatsapp.groupInviteUrl
  const autoDraftOff = settings.data && !settings.data.whatsapp.autoDraft

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Mensagens para o grupo</h1>
          <p className="lead">
            Quando surge promoção nova, o PromoEye monta a mensagem. Com o envio automático ligado ela vai sozinha para o grupo;
            sem ele, fica aqui para você revisar e mandar.
          </p>
        </div>
      </header>

      {wa.loading && !wa.data && <Loading label="Conferindo o WhatsApp…" />}
      {wa.error && !wa.data ? <ErrorBox error={wa.error} onRetry={wa.reload} title="Não deu para ver o envio automático" /> : null}
      {wa.data && <WhatsAppSender status={wa.data} onStatus={wa.setData} onRetry={wa.reload} />}

      {autoDraftOff && (
        <div className="notice notice-warn">
          <p>
            A geração de mensagens está desligada em <Link to="/configuracoes">Configurações</Link>: nenhuma promoção nova vai
            aparecer aqui nem sair para o grupo.
          </p>
        </div>
      )}

      <div className="notice notice-info">
        {invite ? (
          <p>
            Grupo da vitrine: <a href={invite} target="_blank" rel="noopener noreferrer">{invite}</a>
          </p>
        ) : (
          <p>
            Nenhum convite cadastrado. Cole o convite do grupo em <Link to="/configuracoes">Configurações</Link> para ele aparecer
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
      {list.data && list.data.length === 0 && <Empty title={EMPTY[tab][0]}>{EMPTY[tab][1]}</Empty>}
      {list.data && list.data.length > 0 && (
        <ul className="message-list">
          {list.data.map((m) => (
            <MessageCard key={m.id} message={m} onChange={replace} canSend={wa.data?.ready ?? false} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MessageCard({
  message: m,
  onChange,
  canSend,
}: {
  message: MessageDTO
  onChange: (m: MessageDTO) => void
  /** WhatsApp conectado e grupo escolhido. */
  canSend: boolean
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const [busy, setBusy] = useState(false)
  const badge = STATUS_BADGE[m.status]

  const update = async (input: MessageUpdateInput, done: string) => {
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

  const sendNow = async () => {
    setBusy(true)
    try {
      onChange(await api.sendMessage(m.id))
      toast('Enviada ao grupo.')
    } catch (err) {
      // Em falha o servidor devolve a mensagem já marcada com o erro.
      const data = err instanceof ApiError ? (err.data as { message?: MessageDTO } | null) : null
      if (data?.message) onChange(data.message)
      toast(errorMessage(err), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const ok = await copyText(m.body)
    toast(ok ? 'Mensagem copiada. Cole no grupo.' : 'Não deu para copiar. Selecione o texto e copie à mão.', ok ? 'good' : 'warn')
  }

  const sending = m.status === 'SENDING'
  const sendable = canSend && (m.status === 'DRAFT' || m.status === 'QUEUED' || m.status === 'FAILED')

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
            {m.status === 'QUEUED' && m.queuedAt && <> · na fila {timeAgo(m.queuedAt)}</>}
            {m.sentAt && <> · enviada {timeAgo(m.sentAt)}</>}
            {m.attempts > 1 && <> · {m.attempts} tentativas</>}
          </p>
          {m.error && <p className={m.status === 'DISCARDED' ? 'muted small' : 'store-error small'}>{m.error}</p>}
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
        <WhatsAppBubble text={m.body} time={formatTime(m.sentAt ?? m.createdAt)} />
      )}

      {!editing && !sending && (
        <div className="row-actions">
          {sendable && (
            <button type="button" className="btn btn-sm btn-accent" onClick={() => void sendNow()} disabled={busy}>
              {m.status === 'FAILED' ? 'Tentar de novo' : 'Enviar agora'}
            </button>
          )}
          {m.status === 'DRAFT' && canSend && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'QUEUED' }, 'Na fila. Sai assim que o limite e o horário deixarem.')} disabled={busy}>
              Pôr na fila
            </button>
          )}
          {m.status === 'QUEUED' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'DRAFT' }, 'Saiu da fila e voltou para os rascunhos.')} disabled={busy}>
              Tirar da fila
            </button>
          )}
          <button type="button" className={`btn btn-sm ${sendable ? 'btn-ghost' : 'btn-accent'}`} onClick={() => void copy()}>
            Copiar
          </button>
          <a className="btn btn-sm btn-ghost" href={whatsappShareUrl(m.body)} target="_blank" rel="noopener noreferrer">
            Abrir no WhatsApp
          </a>
          {m.status !== 'SENT' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
              Editar texto
            </button>
          )}
          {m.status !== 'SENT' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'SENT' }, 'Marcada como enviada.')} disabled={busy}>
              Marcar como enviada
            </button>
          )}
          {(m.status === 'DRAFT' || m.status === 'QUEUED' || m.status === 'FAILED') && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'DISCARDED' }, 'Mensagem descartada.')} disabled={busy}>
              Descartar
            </button>
          )}
          {(m.status === 'SENT' || m.status === 'DISCARDED') && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void update({ status: 'DRAFT' }, 'Voltou para os rascunhos.')} disabled={busy}>
              Voltar para rascunho
            </button>
          )}
        </div>
      )}
    </li>
  )
}
