import { useState } from 'react'
import { flagLabel, formatBRL, timeAgo, type MessageChannel, type MessageDTO, type MessageUpdateInput } from '@promoeye/shared'
import { ApiError, api, errorMessage } from '../api'
import { useRun } from '../context/run'
import { useToast } from '../context/toast'
import { useLoad } from '../lib/hooks'
import { copyText, formatTime, whatsappShareUrl } from '../lib/format'
import { Badge, Thumb } from './Deal'
import { TextArea } from './Fields'
import { Empty, ErrorBox, Loading } from './States'
import { WhatsAppBubble } from './WhatsAppBubble'

/**
 * As mensagens de um canal, por status, com as ações de cada uma. Serve às
 * páginas WhatsApp e Telegram: o texto tem o mesmo formato nos dois (o
 * servidor converte para o Telegram na hora de enviar).
 */

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

const EMPTY_TELEGRAM_DRAFT: [string, string] = [
  'Nenhuma mensagem para enviar',
  'Depois que você escolhe o grupo, cada promoção nova gera uma mensagem aqui. Com o envio automático ligado, ela vai direto para a fila.',
]

const STATUS_BADGE: Record<MessageDTO['status'], { label: string; tone: 'good' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  DRAFT: { label: 'rascunho', tone: 'info' },
  QUEUED: { label: 'na fila', tone: 'warn' },
  SENDING: { label: 'enviando', tone: 'warn' },
  SENT: { label: 'enviada', tone: 'good' },
  DISCARDED: { label: 'descartada', tone: 'neutral' },
  FAILED: { label: 'falhou', tone: 'danger' },
}

export function MessageQueue({
  channel,
  canSend,
  onChange,
}: {
  channel: MessageChannel
  /** Conectado e com grupo escolhido: "Enviar agora" e "Pôr na fila" aparecem. */
  canSend: boolean
  /** Uma mensagem mudou: a página atualiza os números da fila. */
  onChange?: () => void
}) {
  const { version } = useRun()
  const [tab, setTab] = useState<Tab>('DRAFT')
  const list = useLoad(() => api.messages(tab === 'ALL' ? undefined : tab, channel), [tab, version, channel])

  const replace = (m: MessageDTO) => {
    list.setData((rows) => {
      if (!rows) return rows
      // Mudou de status e saiu da aba atual: some da lista.
      if (tab !== 'ALL' && m.status !== tab) return rows.filter((r) => r.id !== m.id)
      return rows.map((r) => (r.id === m.id ? m : r))
    })
    onChange?.()
  }

  const empty = channel === 'telegram' && tab === 'DRAFT' ? EMPTY_TELEGRAM_DRAFT : EMPTY[tab]

  return (
    <>
      <div className="segmented" role="group" aria-label="Filtrar mensagens">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" className="seg-btn" aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {list.loading && !list.data && <Loading />}
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {list.data && list.data.length === 0 && <Empty title={empty[0]}>{empty[1]}</Empty>}
      {list.data && list.data.length > 0 && (
        <ul className="message-list">
          {list.data.map((m) => (
            <MessageCard key={m.id} message={m} onChange={replace} canSend={canSend} channel={channel} />
          ))}
        </ul>
      )}
    </>
  )
}

function MessageCard({
  message: m,
  onChange,
  canSend,
  channel,
}: {
  message: MessageDTO
  onChange: (m: MessageDTO) => void
  canSend: boolean
  channel: MessageChannel
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.body)
  const [busy, setBusy] = useState(false)
  const badge = STATUS_BADGE[m.status]
  const appName = channel === 'telegram' ? 'Telegram' : 'WhatsApp'

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
          <TextArea
            label="Texto da mensagem"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={9}
            maxLength={4000}
            hint={`*negrito*, _itálico_ e ~riscado~ funcionam no ${appName}.`}
            autoFocus
          />
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
          {channel === 'whatsapp' && (
            <a className="btn btn-sm btn-ghost" href={whatsappShareUrl(m.body)} target="_blank" rel="noopener noreferrer">
              Abrir no WhatsApp
            </a>
          )}
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
