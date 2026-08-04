export type AiApiType = 'openai' | 'anthropic'

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AiChatRequest = {
  apiType: AiApiType
  baseUrl: string
  apiKey: string
  modelId: string
  thinking?: boolean
  messages: AiChatMessage[]
}

export type AiStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'content'; text: string }
  | { type: 'status'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

function joinUrl(base: string, pathPart: string): string {
  const b = base.replace(/\/+$/, '')
  const p = pathPart.replace(/^\/+/, '')
  return `${b}/${p}`
}

function normalizeOpenAiBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://api.openai.com/v1'
  if (trimmed.endsWith('/v1')) return trimmed
  return `${trimmed}/v1`
}

async function* iterateSseLines(
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
    for (const line of parts) {
      yield line
    }
  }
  if (buffer.trim()) yield buffer
}

function parseSseData(line: string): unknown | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

async function* streamOpenAiCompatible(
  req: AiChatRequest,
): AsyncGenerator<AiStreamEvent> {
  const base = normalizeOpenAiBase(req.baseUrl || 'https://api.openai.com/v1')
  const url = joinUrl(base, 'chat/completions')
  const body: Record<string, unknown> = {
    model: req.modelId,
    stream: true,
    messages: req.messages,
  }
  // 部分兼容网关用 enable_thinking / thinking
  if (req.thinking) {
    body.enable_thinking = true
    body.thinking = { type: 'enabled' }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    yield {
      type: 'error',
      message: text.trim() || `OpenAI 兼容接口错误：${res.status}`,
    }
    return
  }
  if (!res.body) {
    yield { type: 'error', message: 'OpenAI 兼容接口未返回流' }
    return
  }

  for await (const line of iterateSseLines(res.body)) {
    const payload = parseSseData(line)
    if (!payload || typeof payload !== 'object') continue
    const choice = (payload as { choices?: Array<{ delta?: Record<string, unknown> }> })
      .choices?.[0]
    const delta = choice?.delta
    if (!delta) continue

    const reasoning =
      (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
      (typeof delta.reasoning === 'string' && delta.reasoning) ||
      (typeof (delta as { thinking?: unknown }).thinking === 'string' &&
        (delta as { thinking: string }).thinking) ||
      ''
    if (reasoning) yield { type: 'thinking', text: reasoning }

    const content = typeof delta.content === 'string' ? delta.content : ''
    if (content) yield { type: 'content', text: content }
  }
  yield { type: 'done' }
}

async function* streamAnthropic(req: AiChatRequest): AsyncGenerator<AiStreamEvent> {
  const base = (req.baseUrl.trim() || 'https://api.anthropic.com').replace(/\/+$/, '')
  const url = joinUrl(base, 'v1/messages')
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }))

  const body: Record<string, unknown> = {
    model: req.modelId,
    max_tokens: 16384,
    stream: true,
    messages,
  }
  if (system) body.system = system
  if (req.thinking) {
    body.thinking = { type: 'enabled', budget_tokens: 8000 }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    yield {
      type: 'error',
      message: text.trim() || `Anthropic 接口错误：${res.status}`,
    }
    return
  }
  if (!res.body) {
    yield { type: 'error', message: 'Anthropic 接口未返回流' }
    return
  }

  for await (const line of iterateSseLines(res.body)) {
    const payload = parseSseData(line)
    if (!payload || typeof payload !== 'object') continue
    const event = payload as {
      type?: string
      delta?: { type?: string; text?: string; thinking?: string }
    }
    if (event.type === 'content_block_delta' && event.delta) {
      if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        yield { type: 'thinking', text: event.delta.thinking }
      } else if (event.delta.type === 'text_delta' && event.delta.text) {
        yield { type: 'content', text: event.delta.text }
      }
    }
  }
  yield { type: 'done' }
}

export async function* streamAiChat(
  req: AiChatRequest,
): AsyncGenerator<AiStreamEvent> {
  if (!req.apiKey.trim()) {
    yield { type: 'error', message: '缺少 ApiKey' }
    return
  }
  if (!req.modelId.trim()) {
    yield { type: 'error', message: '缺少模型 ID' }
    return
  }
  if (!req.messages.length) {
    yield { type: 'error', message: '消息不能为空' }
    return
  }

  try {
    if (req.apiType === 'anthropic') {
      yield* streamAnthropic(req)
    } else {
      yield* streamOpenAiCompatible(req)
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'AI 请求失败',
    }
  }
}
