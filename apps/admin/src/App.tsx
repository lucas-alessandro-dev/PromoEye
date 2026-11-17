import { Link, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './context/auth'
import { RunProvider } from './context/run'
import { ToastProvider } from './context/toast'
import { Layout } from './components/Layout'
import { FullPageLoading, Empty } from './components/States'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Items } from './pages/Items'
import { ItemForm } from './pages/ItemForm'
import { ItemDetail } from './pages/ItemDetail'
import { Offers } from './pages/Offers'
import { Stores } from './pages/Stores'
import { WhatsApp } from './pages/WhatsApp'
import { Settings } from './pages/Settings'
import { ProductDetail, Products } from './pages/Products'
import { Alerts } from './pages/Alerts'

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoading />
  if (!user) return <Login />
  return (
    <RunProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="itens" element={<Items />} />
          <Route path="itens/novo" element={<ItemForm />} />
          <Route path="itens/:id" element={<ItemDetail />} />
          <Route path="itens/:id/editar" element={<ItemForm />} />
          <Route path="ofertas" element={<Offers />} />
          <Route path="lojas" element={<Stores />} />
          <Route path="catalogo" element={<Products />} />
          <Route path="catalogo/:id" element={<ProductDetail />} />
          <Route path="alertas" element={<Alerts />} />
          <Route path="whatsapp" element={<WhatsApp />} />
          <Route path="configuracoes" element={<Settings />} />
          <Route
            path="*"
            element={
              <Empty title="Página não encontrada" action={<Link to="/">Voltar ao painel</Link>}>
                Esse endereço não existe no painel.
              </Empty>
            }
          />
        </Route>
      </Routes>
    </RunProvider>
  )
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  )
}
