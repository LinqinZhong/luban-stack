import { streamCursorAgent } from '../api/ai'
import type { AiAgentConfig } from '../stores/workspace-settings'

export type CursorAgentHooks = {
  onThinking: (full: string) => void
  onStatus?: (text: string) => void
  onFinish: (message: string) => void
}

/**
 * 使用已配置的 Cursor 智能体在当前项目目录执行任务（直接改工程文件）。
 */
export async function runCursorAgent(options: {
  projectPath: string
  agent: AiAgentConfig
  userText: string
  active?: { scope: 'page' | 'component'; id: string } | null
  priorSummary?: string
  hooks: CursorAgentHooks
  signal?: AbortSignal
}): Promise<void> {
  const activeLine = options.active
    ? `当前打开资源：${options.active.scope === 'page' ? '页面' : '组件'}:${options.active.id}`
    : '当前打开资源：无'

  const prompt = [
    '你在 LubanStack 低代码项目目录中工作。请直接修改项目文件完成用户需求。',
    '常见结构：pages/*/page.xml + page.json；components/*；luban.json；.lubanstack/ 等。',
    '改完后简要说明改了哪些文件与要点。',
    activeLine,
    options.priorSummary?.trim()
      ? `会话上文摘要：\n${options.priorSummary.trim()}`
      : '',
    '',
    '用户需求：',
    options.userText.trim(),
  ]
    .filter(Boolean)
    .join('\n')

  let thinking = ''
  let content = ''
  options.hooks.onStatus?.('正在启动 Cursor 智能体…')

  for await (const event of streamCursorAgent({
    projectPath: options.projectPath,
    apiKey: options.agent.apiKey,
    modelId: options.agent.modelId,
    prompt,
    signal: options.signal,
  })) {
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'status') {
      options.hooks.onStatus?.(event.text)
      continue
    }
    if (event.type === 'thinking') {
      thinking = event.text
      options.hooks.onThinking(thinking)
      options.hooks.onStatus?.('')
      continue
    }
    if (event.type === 'content') {
      content += event.text
      // 无独立 thinking 时用正文预览填思考区
      if (!thinking.trim()) {
        const preview = content.trim()
        options.hooks.onThinking(
          preview.length > 1200 ? `${preview.slice(0, 1200)}…` : preview,
        )
      }
      options.hooks.onStatus?.('Cursor 智能体输出中…')
      continue
    }
  }

  options.hooks.onStatus?.('')
  const message =
    content.trim() ||
    thinking.trim() ||
    'Cursor 智能体已完成（请在工作区查看文件改动）'
  options.hooks.onFinish(message)
}
