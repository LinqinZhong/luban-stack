import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProjectStore } from '../stores/project'
import { useAiAssistantStore } from '../stores/ai-assistant'
import AiAssistantPanel from '../components/editor/AiAssistantPanel'
import './AiAssistantView.css'

export default function AiAssistantView() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const hasProject = useProjectStore((s) => s.hasProject)
  const setPanelOpen = useAiAssistantStore((s) => s.setPanelOpen)
  const sessionId = params.get('session')?.trim() || ''

  useEffect(() => {
    if (!hasProject) {
      void navigate('/', { replace: true })
      return
    }
    setPanelOpen(true)
    document.title = 'AI 助手'
  }, [hasProject, navigate, setPanelOpen])

  return (
    <div className="ai-window-page">
      <AiAssistantPanel
        open
        onOpenChange={() => {
          window.close()
          void navigate('/workspace')
        }}
        mode="window"
        initialSessionId={sessionId}
      />
    </div>
  )
}
