import { Router } from 'express'
import { loadAiDocsPrompt } from '../services/ai-docs.js'
import { streamAiChat, type AiApiType, type AiChatMessage } from '../services/ai-chat.js'
import { streamCursorAgent } from '../services/ai-cursor-agent.js'
import {
  acquireAiAssistantLock,
  deleteAiAssistantLog,
  getAiAssistantLock,
  getAiAssistantLog,
  heartbeatAiAssistantLock,
  listAiAssistantLogs,
  releaseAiAssistantLock,
  saveAiAssistantLog,
  type AiAssistantLogRecord,
  type AiAssistantLogStatus,
} from '../services/ai-assistant-log.js'
import { ProjectError } from '../services/project.js'

const router = Router()

function projectPathFrom(bodyOrQuery: unknown): string {
  if (!bodyOrQuery || typeof bodyOrQuery !== 'object') return ''
  const row = bodyOrQuery as { projectPath?: unknown }
  return typeof row.projectPath === 'string' ? row.projectPath : ''
}

function handleServiceError(res: import('express').Response, err: unknown) {
  if (err instanceof ProjectError) {
    res.status(err.status).json({ message: err.message })
    return
  }
  res.status(500).json({
    message: err instanceof Error ? err.message : '操作失败',
  })
}

router.get('/docs', async (_req, res) => {
  try {
    const docs = await loadAiDocsPrompt()
    res.json({ docs })
  } catch (err) {
    res.status(500).json({
      message: err instanceof Error ? err.message : '读取文档失败',
    })
  }
})

router.post('/chat', async (req, res) => {
  try {
    const body = req.body ?? {}
    const apiType: AiApiType =
      body.apiType === 'anthropic' ? 'anthropic' : 'openai'
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : ''
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
    const modelId = typeof body.modelId === 'string' ? body.modelId : ''
    const thinking = Boolean(body.thinking)
    const includeDocs = body.includeDocs !== false
    const rawMessages = Array.isArray(body.messages) ? body.messages : []
    const messages: AiChatMessage[] = rawMessages
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null
        const row = item as { role?: unknown; content?: unknown }
        const role =
          row.role === 'system' || row.role === 'assistant' || row.role === 'user'
            ? row.role
            : null
        const content = typeof row.content === 'string' ? row.content : ''
        if (!role || !content) return null
        return { role, content }
      })
      .filter((item: AiChatMessage | null): item is AiChatMessage => Boolean(item))

    if (!messages.length) {
      res.status(400).json({ message: 'messages 不能为空' })
      return
    }

    // 先开启 SSE，避免加载 docs / 等上游时前端长时间无任何反馈
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const writeEvent = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      const flushable = res as typeof res & { flush?: () => void }
      flushable.flush?.()
    }

    writeEvent({ type: 'status', text: '准备上下文…' })

    const finalMessages = [...messages]
    if (includeDocs && !finalMessages.some((m) => m.role === 'system')) {
      const docs = await loadAiDocsPrompt()
      finalMessages.unshift({
        role: 'system',
        content: docs,
      })
    } else if (includeDocs) {
      const docs = await loadAiDocsPrompt()
      const firstSystem = finalMessages.findIndex((m) => m.role === 'system')
      if (firstSystem >= 0) {
        finalMessages[firstSystem] = {
          role: 'system',
          content: `${docs}\n\n${finalMessages[firstSystem].content}`,
        }
      }
    }

    writeEvent({ type: 'status', text: '正在连接模型…' })

    for await (const event of streamAiChat({
      apiType,
      baseUrl,
      apiKey,
      modelId,
      thinking,
      messages: finalMessages,
    })) {
      writeEvent(event)
      if (event.type === 'error' || event.type === 'done') break
    }

    res.end()
  } catch (err) {
    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : 'AI 请求失败',
        })}\n\n`,
      )
      res.end()
      return
    }
    res.status(500).json({
      message: err instanceof Error ? err.message : 'AI 请求失败',
    })
  }
})

/** Cursor 智能体：在项目目录本地执行，流式回传 */
router.post('/cursor-agent', async (req, res) => {
  try {
    const body = req.body ?? {}
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : ''
    const modelId = typeof body.modelId === 'string' ? body.modelId : ''
    const projectPath =
      typeof body.projectPath === 'string' ? body.projectPath.trim() : ''
    const prompt = typeof body.prompt === 'string' ? body.prompt : ''

    if (!projectPath) {
      res.status(400).json({ message: '请提供 projectPath' })
      return
    }
    if (!prompt.trim()) {
      res.status(400).json({ message: 'prompt 不能为空' })
      return
    }
    if (!apiKey.trim()) {
      res.status(400).json({ message: '请提供 Cursor API Key' })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const writeEvent = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
      const flushable = res as typeof res & { flush?: () => void }
      flushable.flush?.()
    }

    // 注意：不要用 req.on('close')。POST body 读完后 Node 会立刻
    // 把 IncomingMessage 标成 close/destroyed，会误取消仍在进行的 SSE。
    const ac = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) ac.abort()
    })

    for await (const event of streamCursorAgent({
      apiKey,
      modelId,
      projectPath,
      prompt,
      signal: ac.signal,
    })) {
      writeEvent(event)
      if (event.type === 'error' || event.type === 'done') break
    }
    res.end()
  } catch (err) {
    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : 'Cursor 智能体失败',
        })}\n\n`,
      )
      res.end()
      return
    }
    res.status(500).json({
      message: err instanceof Error ? err.message : 'Cursor 智能体失败',
    })
  }
})

router.get('/assistant/logs', async (req, res) => {
  try {
    const projectPath = projectPathFrom(req.query)
    const logs = await listAiAssistantLogs(projectPath)
    res.json({ logs })
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.get('/assistant/logs/:id', async (req, res) => {
  try {
    const projectPath = projectPathFrom(req.query)
    const log = await getAiAssistantLog(projectPath, String(req.params.id))
    res.json({ log })
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.put('/assistant/logs/:id', async (req, res) => {
  try {
    const body = req.body ?? {}
    const projectPath = projectPathFrom(body)
    const id = String(req.params.id)
    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim()
        : '未命名'
    const status = (
      ['running', 'done', 'error', 'cancelled'] as AiAssistantLogStatus[]
    ).includes(body.status)
      ? (body.status as AiAssistantLogStatus)
      : undefined
    const timeline = Array.isArray(body.timeline) ? body.timeline : undefined
    const payload: Partial<AiAssistantLogRecord> & { id: string; title: string } =
      {
        id,
        title,
        status,
        timeline,
        modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
        modelName: typeof body.modelName === 'string' ? body.modelName : undefined,
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : undefined,
      }
    const log = await saveAiAssistantLog(projectPath, payload)
    res.json({ log })
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.delete('/assistant/logs/:id', async (req, res) => {
  try {
    const projectPath = projectPathFrom(req.query)
    await deleteAiAssistantLog(projectPath, String(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.get('/assistant/lock', (req, res) => {
  try {
    const projectPath = projectPathFrom(req.query)
    res.json(getAiAssistantLock(projectPath))
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.post('/assistant/lock/acquire', (req, res) => {
  try {
    const body = req.body ?? {}
    const projectPath = projectPathFrom(body)
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId : ''
    const result = acquireAiAssistantLock(projectPath, ownerId)
    if (!result.ok) {
      res.status(409).json({
        message: 'AI 助手正在其它窗口执行任务',
        ownerId: result.ownerId,
      })
      return
    }
    res.json(result)
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.post('/assistant/lock/heartbeat', (req, res) => {
  try {
    const body = req.body ?? {}
    const projectPath = projectPathFrom(body)
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId : ''
    const result = heartbeatAiAssistantLock(projectPath, ownerId)
    if (!result.ok) {
      res.status(409).json({
        message: '执行锁已失效或被其它窗口占用',
        ownerId: result.ownerId,
      })
      return
    }
    res.json(result)
  } catch (err) {
    handleServiceError(res, err)
  }
})

router.post('/assistant/lock/release', (req, res) => {
  try {
    const body = req.body ?? {}
    const projectPath = projectPathFrom(body)
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId : ''
    const result = releaseAiAssistantLock(projectPath, ownerId)
    res.json(result)
  } catch (err) {
    handleServiceError(res, err)
  }
})

export default router
