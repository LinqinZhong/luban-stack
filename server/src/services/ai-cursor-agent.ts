/**
 * 通过 @cursor/sdk 在本地项目目录跑 Cursor 智能体，并以 SSE 事件流回传。
 */
import { Agent, CursorAgentError } from '@cursor/sdk'
import type { AiStreamEvent } from './ai-chat.js'

export type CursorAgentStreamRequest = {
  apiKey: string
  modelId?: string
  projectPath: string
  prompt: string
  signal?: AbortSignal
}

function textFromStreamEvent(event: {
  type: string
  text?: string
  message?: { content?: Array<{ type: string; text?: string }> }
}): { kind: 'thinking' | 'content' | 'status' | null; text: string } {
  if (event.type === 'thinking' && typeof event.text === 'string' && event.text) {
    return { kind: 'thinking', text: event.text }
  }
  if (event.type === 'assistant' && event.message?.content) {
    let out = ''
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) out += block.text
    }
    if (out) return { kind: 'content', text: out }
  }
  if (event.type === 'tool_call' || event.type === 'tool_use') {
    return { kind: 'status', text: 'Cursor 正在调用工具…' }
  }
  return { kind: null, text: '' }
}

export async function* streamCursorAgent(
  req: CursorAgentStreamRequest,
): AsyncGenerator<AiStreamEvent> {
  const apiKey = req.apiKey.trim()
  if (!apiKey) {
    yield { type: 'error', message: '请先配置 Cursor API Key' }
    return
  }
  const projectPath = req.projectPath.trim()
  if (!projectPath) {
    yield { type: 'error', message: '缺少 projectPath' }
    return
  }
  const prompt = req.prompt.trim()
  if (!prompt) {
    yield { type: 'error', message: 'prompt 不能为空' }
    return
  }
  const modelId = (req.modelId ?? '').trim() || 'composer-2.5'

  yield { type: 'status', text: '正在启动 Cursor 智能体…' }

  let agent: Awaited<ReturnType<typeof Agent.create>> | null = null
  try {
    agent = await Agent.create({
      apiKey,
      model: { id: modelId },
      local: { cwd: projectPath },
    })

    if (req.signal?.aborted) {
      yield { type: 'error', message: '已取消' }
      return
    }

    const run = await agent.send(prompt)
    yield { type: 'status', text: 'Cursor 智能体执行中…' }

    const onAbort = () => {
      void (async () => {
        try {
          if (run.supports?.('cancel')) await run.cancel()
        } catch {
          // ignore
        }
      })()
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      let thinkingBuf = ''
      for await (const event of run.stream()) {
        if (req.signal?.aborted) break
        const parsed = textFromStreamEvent(event as never)
        if (parsed.kind === 'thinking') {
          thinkingBuf += parsed.text
          yield { type: 'thinking', text: thinkingBuf }
        } else if (parsed.kind === 'content') {
          yield { type: 'content', text: parsed.text }
        } else if (parsed.kind === 'status') {
          yield { type: 'status', text: parsed.text }
        }
      }

      const result = await run.wait()
      if (req.signal?.aborted) {
        yield { type: 'error', message: '已取消' }
        return
      }
      if (result.status === 'error') {
        yield {
          type: 'error',
          message: `Cursor 智能体执行失败（run=${result.id}）`,
        }
        return
      }
      yield { type: 'status', text: '' }
      yield { type: 'done' }
    } finally {
      req.signal?.removeEventListener('abort', onAbort)
    }
  } catch (err) {
    if (err instanceof CursorAgentError) {
      yield {
        type: 'error',
        message: `Cursor 启动失败：${err.message}${err.isRetryable ? '（可重试）' : ''}`,
      }
      return
    }
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Cursor 智能体失败',
    }
  } finally {
    if (agent) {
      try {
        await agent[Symbol.asyncDispose]()
      } catch {
        // ignore
      }
    }
  }
}
