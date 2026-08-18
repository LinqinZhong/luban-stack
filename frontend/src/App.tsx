import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { PRODUCT_NAME } from './constants/brand'
import { useProjectStore } from './stores/project'
import MainLayout from './layouts/MainLayout'
import WelcomeView from './views/WelcomeView'
import WorkspaceView from './views/WorkspaceView'
import AiAssistantView from './views/AiAssistantView'

function TitleSync() {
  const location = useLocation()
  useEffect(() => {
    const titles: Record<string, string> = {
      '/': '选择项目',
      '/workspace': '工作区',
      '/ai-assistant': 'AI 助手',
    }
    const title = titles[location.pathname]
    document.title = title ? `${title} - ${PRODUCT_NAME}` : PRODUCT_NAME
  }, [location.pathname])
  return null
}

function RequireProject() {
  const hasProject = useProjectStore((s) => s.hasProject)
  if (!hasProject) return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <TitleSync />
      <Routes>
        <Route path="/" element={<WelcomeView />} />
        <Route element={<RequireProject />}>
          <Route path="/ai-assistant" element={<AiAssistantView />} />
          <Route element={<MainLayout />}>
            <Route path="/workspace" element={<WorkspaceView />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
