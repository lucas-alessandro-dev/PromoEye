import { Link } from 'react-router'
import { api } from '../api'
import { useRun } from '../context/run'
import { useLoad, useTitle } from '../lib/hooks'
import { ErrorBox, Loading } from '../components/States'
import { MessageQueue } from '../components/MessageQueue'
import { WhatsAppSender } from '../components/WhatsAppSender'

export function WhatsApp() {
  useTitle('WhatsApp')
  const { version } = useRun()
  const settings = useLoad(() => api.settings(), [])
  const wa = useLoad(() => api.whatsappStatus(), [version])

  // Os números da fila no cartão de envio mudam junto com as mensagens.
  const refreshStatus = () => {
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

      <MessageQueue channel="whatsapp" canSend={wa.data?.ready ?? false} onChange={refreshStatus} />
    </div>
  )
}
