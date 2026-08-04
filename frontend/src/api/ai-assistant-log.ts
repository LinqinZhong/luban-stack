import { request } from './index'

export type AiAssistantLogStatus = 'running' | 'done' | 'error' | 'cancelled'

export type AiAssistantLogSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
  modelName?: string
  status: AiAssistantLogStatus
}

export type AiAssistantLogRecord = AiAssistantLogSummary & {
  timeline: unknown[]
}

export function listAiAssistantLogs(projectPath: string) {
  const q = new URLSearchParams({ projectPath })
  return request<{ logs: AiAssistantLogSummary[] }>(
    `/api/ai/assistant/logs?${q.toString()}`,
  )
}

export function getAiAssistantLog(projectPath: string, id: string) {
  const q = new URLSearchParams({ projectPath })
  return request<{ log: AiAssistantLogRecord }>(
    `/api/ai/assistant/logs/${encodeURIComponent(id)}?${q.toString()}`,
  )
}

export function saveAiAssistantLog(
  projectPath: string,
  payload: {
    id: string
    title: string
    status?: AiAssistantLogStatus
    timeline?: unknown[]
    modelId?: string
    modelName?: string
    createdAt?: string
  },
) {
  return request<{ log: AiAssistantLogRecord }>(
    `/api/ai/assistant/logs/${encodeURIComponent(payload.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ projectPath, ...payload }),
    },
  )
}

export function deleteAiAssistantLog(projectPath: string, id: string) {
  const q = new URLSearchParams({ projectPath })
  return request<{ ok: boolean }>(
    `/api/ai/assistant/logs/${encodeURIComponent(id)}?${q.toString()}`,
    { method: 'DELETE' },
  )
}

export function getAiAssistantLock(projectPath: string) {
  const q = new URLSearchParams({ projectPath })
  return request<{ locked: boolean; ownerId: string | null }>(
    `/api/ai/assistant/lock?${q.toString()}`,
  )
}

export function acquireAiAssistantLock(projectPath: string, ownerId: string) {
  return request<{ ok: true; ownerId: string }>(
    '/api/ai/assistant/lock/acquire',
    {
      method: 'POST',
      body: JSON.stringify({ projectPath, ownerId }),
    },
  )
}

export function heartbeatAiAssistantLock(projectPath: string, ownerId: string) {
  return request<{ ok: boolean; ownerId: string | null }>(
    '/api/ai/assistant/lock/heartbeat',
    {
      method: 'POST',
      body: JSON.stringify({ projectPath, ownerId }),
    },
  )
}

export function releaseAiAssistantLock(projectPath: string, ownerId: string) {
  return request<{ ok: boolean }>('/api/ai/assistant/lock/release', {
    method: 'POST',
    body: JSON.stringify({ projectPath, ownerId }),
  })
}
