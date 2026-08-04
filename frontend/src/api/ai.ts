import type { AiApiType } from '../stores/workspace-settings'

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AiStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'content'; text: string }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export type AiChatStreamPayload = {
  apiType: AiApiType
  baseUrl: string
  apiKey: string
  modelId: string
  thinking?: boolean
  includeDocs?: boolean
  messages: AiChatMessage[]
  signal?: AbortSignal
}

async function* iterateSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n/)
    buffer = parts.pop() ?? ''
    for (const line of parts) yield line
  }
  if (buffer.trim()) yield buffer
}

export async function* streamAiChat(
  payload: AiChatStreamPayload,
): AsyncGenerator<AiStreamEvent> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: payload.signal,
    body: JSON.stringify({
      apiType: payload.apiType,
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      modelId: payload.modelId,
      thinking: payload.thinking,
      includeDocs: payload.includeDocs,
      messages: payload.messages,
    }),
  })

  if (!res.ok) {
    let message = `AI 请求失败：${res.status}`
    try {
      const data = (await res.json()) as { message?: string }
      if (data.message) message = data.message
    } catch {
      /* ignore */
    }
    yield { type: 'error', message }
    return
  }

  if (!res.body) {
    yield { type: 'error', message: 'AI 未返回流式响应' }
    return
  }

  for await (const line of iterateSse(res.body)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (!data) continue
    try {
      const event = JSON.parse(data) as AiStreamEvent
      yield event
      if (event.type === 'done' || event.type === 'error') return
    } catch {
      /* ignore malformed chunk */
    }
  }
  yield { type: 'done' }
}
