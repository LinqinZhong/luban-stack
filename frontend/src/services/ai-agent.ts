import { streamAiChat, type AiChatMessage } from '../api/ai'
import type { AiModelConfig } from '../stores/workspace-settings'
import {
  isBackendMutatingTool,
} from './ai-backend-debug'
import {
  buildToolCatalogPrompt,
  executeAiTool,
  toolLabel,
} from './ai-tools'

export type AiAgentMention = {
  nodeId: string
  label: string
  address?: string
  resourceScope?: 'page' | 'component'
  resourceId?: string
}

export type AiAgentAction =
  | {
      type: 'tool_call'
      tool: string
      label?: string
      args?: Record<string, unknown>
    }
  | {
      type: 'ask_user'
      question: string
      options?: string[]
    }
  | {
      type: 'finish'
      message: string
    }

export type AiAgentToolEvent = {
  id: string
  tool: string
  label: string
  status: 'running' | 'done' | 'error'
  error?: string
}

export type AiAgentHooks = {
  onThinking: (full: string) => void
  onTool: (event: AiAgentToolEvent) => void
  onAskUser: (payload: {
    question: string
    options: string[]
  }) => Promise<string>
  onStatus?: (text: string) => void
  onFinish: (message: string) => void
}

const MAX_PARSE_RETRY = 4

function extractThinking(raw: string): { thinking: string; rest: string } {
  const match = raw.match(/<thinking>([\s\S]*?)<\/thinking>/i)
  if (!match) {
    // 未闭合 thinking：思考内容单独记，全文仍留给 JSON 提取
    const open = raw.match(/<thinking>([\s\S]*)$/i)
    if (open) return { thinking: open[1].trim(), rest: raw }
    return { thinking: '', rest: raw }
  }
  const thinking = match[1].trim()
  const rest = `${raw.slice(0, match.index)}${raw.slice((match.index ?? 0) + match[0].length)}`
  return { thinking, rest }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // 容忍尾逗号
    try {
      const fixed = trimmed.replace(/,\s*([}\]])/g, '$1')
      return JSON.parse(fixed) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function extractJsonBlock(text: string): string | null {
  const candidates: string[] = []
  const fencedJson = text.matchAll(/```json\s*([\s\S]*?)```/gi)
  for (const match of fencedJson) {
    if (match[1]?.trim()) candidates.push(match[1].trim())
  }
  const fencedAny = text.matchAll(/```\s*([\s\S]*?)```/g)
  for (const match of fencedAny) {
    const body = match[1]?.trim()
    if (body?.startsWith('{')) candidates.push(body)
  }
  // 未闭合代码块：```json { ...
  const openFence = text.match(/```(?:json)?\s*(\{[\s\S]*)$/i)
  if (openFence?.[1]) candidates.push(openFence[1].trim())

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1).trim())

  for (const candidate of candidates) {
    if (tryParseJsonObject(candidate)) return candidate
  }
  return candidates[0] ?? null
}

function actionFromParsed(parsed: Record<string, unknown>): AiAgentAction {
  const type = parsed.type
  if (type === 'tool_call') {
    const tool = typeof parsed.tool === 'string' ? parsed.tool.trim() : ''
    if (!tool) throw new Error('tool_call 缺少 tool')
    const args =
      parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {}
    return {
      type: 'tool_call',
      tool,
      label: typeof parsed.label === 'string' ? parsed.label : undefined,
      args,
    }
  }
  if (type === 'ask_user') {
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
    if (!question) throw new Error('ask_user 缺少 question')
    const options = Array.isArray(parsed.options)
      ? parsed.options.filter((item): item is string => typeof item === 'string' && item.trim())
      : []
    return { type: 'ask_user', question, options }
  }
  if (type === 'finish') {
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : ''
    if (!message) throw new Error('finish 缺少 message')
    return { type: 'finish', message }
  }
  throw new Error('type 必须是 tool_call / ask_user / finish 之一')
}

export function parseAiAgentAction(rawContent: string): AiAgentAction {
  const sources = [rawContent, extractThinking(rawContent).rest].filter(Boolean)
  let lastError = 'AI 未返回可解析的 JSON 动作'
  for (const source of sources) {
    const jsonText = extractJsonBlock(source)
    if (!jsonText) continue
    const parsed = tryParseJsonObject(jsonText)
    if (!parsed) {
      lastError = 'AI 返回的 JSON 无法解析'
      continue
    }
    try {
      return actionFromParsed(parsed)
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError
    }
  }
  throw new Error(lastError)
}

function buildSystemPrompt(): string {
  return `你是 LubanStack 低代码全栈助手（前端 + 后端 + 数据/资源）。

## 可见性（极其重要）
- 你**看不到**项目磁盘上的任何文件内容（页面、组件、服务、类型、mysql.json、oss.json、图标等一律不可见）。
- 你**不能**假设自己打开过某个路径、目录或文件；不要说「我看到了 xxx 文件」。
- 唯一合法渠道：调用下方工具（它们走平台接口）。只有工具返回的结果，才是你可知的项目状态。
- 未调用工具之前，不要臆造项目里已有哪些页面/表/服务/类型。

## 工作方式
1. 先思考用户需求，再决定下一步（可跨前端界面、类型、数据库、对象存储、后端服务）。
2. 每次只输出一个动作（tool_call / ask_user / finish）。
3. 先通过接口检索再修改；不确定是否覆盖/删表/删桶时必须 ask_user。
4. 需要创建资源、选择实现方案时，用 ask_user 询问，可给 options。
5. 禁止假装整份提交磁盘文件。按领域用结构化接口：
   - 前端界面：add_widget / update_widget_attrs / remove_widget / move_widget / insert_component_ref / upsert_data_field / delete_data_field
   - 图标/调色板/类型：upsert_* / delete_*（先 get/list 再改）
   - MySQL：list/upsert 连接 → 建表/设计表/行数据接口（见下方「表设计确认」）
   - OSS：list/upsert 连接 → 桶/对象接口
   - 后端：list/upsert 服务 → 控制器/API/处理器/方法接口
6. **表设计确认（强制）**：用户未明确给出表结构时，你可以先拟定方案，但**在调用 create_mysql_table / design_mysql_table 之前**必须用 ask_user 让用户确认，至少包含：
   - 表名
   - 全部字段（字段名 + 类型，必要时空值/主键/自增/备注）
   - 索引（名称、包含列、说明；无索引也要说明「无额外索引」）
   可用 options 如「按此方案建表」「我来修改后再说」。用户已完整指定表名/字段/索引时可直接执行，不必重复确认。
7. **表名单数**：表名使用业务单数词根，**禁止常规复数结尾**。正确：\`order\`、\`user\`、\`goods_item\`；错误：\`orders\`、\`users\`、\`items\`。实体类型/数据处理器命名与表名单数保持一致。
8. **后端验收（强制）**：只要改动了数据层 / 业务层 / 控制器（含 API、处理器、方法），必须：
   1) 为相关方法/API 生成**全面测试用例**（正常、边界、缺参/非法入参、权限或业务失败路径等，能覆盖就覆盖）；
   2) 用 \`run_backend_tests\`（或分别调用 debug_data_layer_method / debug_business_method / debug_controller_api）执行调试；
   3) **全部 passed=true 之后才允许 finish**。失败必须先修复再重测。未跑通测试时系统会拒绝 finish。
9. 工具失败时会把错误返回给你，请修正参数或换方案后重试。
10. 全部完成后用 finish，并按如下格式总结（须包含测试结果摘要）：
已根据要求完成修改，改动如下：

【前端-页面（home）】新增元素
【类型-分组（order）】新增 Order
【数据库（mysql_local）】创建表 order
【后端-服务（order）】新增 API /list
【测试】run_backend_tests 通过 5/5

## 输出格式（非常严格，每次回复都必须遵守）
你可以先用 <thinking>...</thinking> 写思考，但**必须**再给出一个完整 JSON 动作，否则流程会中断。
不要只输出自然语言。不要省略 type 字段。

正确示例：
\`\`\`json
{"type":"tool_call","tool":"list_pages","label":"检索页面列表","args":{}}
\`\`\`
\`\`\`json
{"type":"tool_call","tool":"add_widget","label":"添加按钮","args":{"scope":"page","id":"home","parentNodeId":"0:LinearLayout","tag":"Button","attrs":{"text":"提交"}}}
\`\`\`
\`\`\`json
{"type":"tool_call","tool":"list_mysql_connections","label":"查看数据库连接","args":{}}
\`\`\`
\`\`\`json
{"type":"ask_user","question":"发现订单列表已存在，是否覆盖？","options":["覆盖","额外创建一个 OrderList2"]}
\`\`\`
\`\`\`json
{"type":"finish","message":"已根据要求完成修改，改动如下：\\n\\n..."}
\`\`\`

## 可用工具（仅此接口面）
${buildToolCatalogPrompt()}

## 约束
- 可做全栈：前端页面/组件、类型库、图标、调色板、MySQL、对象存储、后端服务（控制器/API/业务与数据处理器）。
- 每次只输出一个 JSON 动作。
- label 用简短中文，会显示在对话里。
- 用户 @提及地址格式：页面:资源id/元素路径 或 组件:资源id/元素路径。
- nodeId 使用路径格式，如 0:LinearLayout/1:Button（来自工具返回或用户提及，不要猜）。
- 拿到工具结果后，立刻输出下一个 JSON 动作（继续 tool_call / ask_user / finish）。
- 平台规则说明只描述概念与接口用法，不代表你能浏览项目文件。
- 绑定写法：数据池字段用 {fieldName}，组件属性用 {$props.xxx}，列表项用 {item}/{item.xxx}。**不要**写 {$data.xxx}（平台无此命名空间）。
- 列表：repeat 写字段名（如 repeat="filteredOrders"），挂在要重复的节点上，不要挂在外层滚动容器上。
- 组件事件用事件名属性（如 change="[{...}]"），不要发明 onChange="method(...)" 这种字符串调用。
- 删表、清表、删桶、删服务等破坏性操作前先 ask_user。
- 建表/改表结构前：用户未给定完整设计时必须 ask_user 确认表名、字段（名+类型等）、索引；表名单数（order 而非 orders）。
- 后端调试默认 dryRun=true（写操作回滚）；需要真实落库时再显式 dryRun=false，并先 ask_user。
- run_backend_tests 的 cases[].targetId：data/business 填处理器 id，controller 填控制器 id；methodId 对应方法或 API id。`
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function collectModelOutput(options: {
  model: AiModelConfig
  messages: AiChatMessage[]
  onThinking: (full: string) => void
  onStatus?: (text: string) => void
  signal?: AbortSignal
}): Promise<{ thinking: string; content: string }> {
  let thinking = ''
  let contentBuf = ''
  let lastPaint = 0
  let sawThinking = false
  const paint = async (force = false) => {
    const now = Date.now()
    if (!force && now - lastPaint < 50) return
    lastPaint = now
    await yieldToUi()
  }

  // 立刻占位，避免等首个 token 前界面空白
  options.onThinking('')
  options.onStatus?.('正在连接模型…')

  for await (const event of streamAiChat({
    apiType: options.model.apiType,
    baseUrl: options.model.baseUrl,
    apiKey: options.model.apiKey,
    modelId: options.model.modelId,
    thinking: options.model.thinking,
    includeDocs: true,
    messages: options.messages,
    signal: options.signal,
  })) {
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'status') {
      options.onStatus?.(event.text)
      await paint()
      continue
    }
    if (event.type === 'thinking') {
      sawThinking = true
      thinking += event.text
      options.onThinking(thinking)
      options.onStatus?.('')
      await paint()
      continue
    }
    if (event.type === 'content') {
      contentBuf += event.text
      const split = extractThinking(contentBuf)
      if (split.thinking) {
        sawThinking = true
        thinking = split.thinking
        options.onThinking(thinking)
        options.onStatus?.('')
        await paint()
      } else if (!sawThinking) {
        // 无独立思考通道时，用正文预览填思考区，避免“卡住无反馈”
        const preview = contentBuf.trim()
        if (preview) {
          options.onThinking(preview.length > 1200 ? `${preview.slice(0, 1200)}…` : preview)
          options.onStatus?.('正在生成…')
          await paint()
        }
      }
    }
  }
  const split = extractThinking(contentBuf)
  const finalThinking = thinking || split.thinking
  if (finalThinking) options.onThinking(finalThinking)
  else if (contentBuf.trim() && !sawThinking) {
    const preview = contentBuf.trim()
    options.onThinking(preview.length > 1200 ? `${preview.slice(0, 1200)}…` : preview)
  }
  options.onStatus?.('')
  await paint(true)
  // content 始终保留完整缓冲，避免 thinking 标签把 JSON 吃掉
  return {
    thinking: finalThinking,
    content: contentBuf || split.rest,
  }
}

export async function runAiAgent(options: {
  projectPath: string
  model: AiModelConfig
  userText: string
  active?: { scope: 'page' | 'component'; id: string } | null
  mentions?: AiAgentMention[]
  hooks: AiAgentHooks
  signal?: AbortSignal
}): Promise<void> {
  const mentionLines =
    options.mentions?.map((m) => {
      const address = m.address || m.label
      return `- @${address} (scope=${m.resourceScope || '?'} id=${m.resourceId || '?'} nodeId=${m.nodeId})`
    }) ?? []

  const contextLines = [
    `当前打开资源：${
      options.active
        ? `${options.active.scope === 'page' ? '页面' : '组件'}:${options.active.id}`
        : '无'
    }`,
    mentionLines.length ? '用户提及节点：' : '',
    ...mentionLines,
    '',
    '用户需求：',
    options.userText,
  ].filter(Boolean)

  const messages: AiChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: contextLines.join('\n') },
  ]

  let changed = false
  let parseRetry = 0
  let step = 0
  /** 是否改动过后端（须测试通过才能 finish） */
  let backendDirty = false
  let backendTestsPassed = false

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    step += 1

    const { thinking, content } = await collectModelOutput({
      model: options.model,
      messages,
      onThinking: options.hooks.onThinking,
      onStatus: options.hooks.onStatus,
      signal: options.signal,
    })

    let action: AiAgentAction
    try {
      action = parseAiAgentAction(content)
      parseRetry = 0
      options.hooks.onStatus?.('')
    } catch (err) {
      parseRetry += 1
      const message = err instanceof Error ? err.message : '解析失败'
      const preview = (content || '').trim().slice(0, 500)
      if (parseRetry > MAX_PARSE_RETRY) {
        throw new Error(
          `${message}（已重试 ${MAX_PARSE_RETRY} 次）。模型最近输出预览：${preview || '（空）'}`,
        )
      }
      options.hooks.onStatus?.(
        `模型输出格式不正确，正在第 ${parseRetry}/${MAX_PARSE_RETRY} 次要求重试…`,
      )
      messages.push(
        { role: 'assistant', content: content || '(空响应)' },
        {
          role: 'user',
          content: `你的输出无法解析：${message}。
请立刻重新输出，且只能是下面三种 JSON 之一（可先写 <thinking>，但 JSON 必填）：
{"type":"tool_call","tool":"list_pages","label":"检索页面列表","args":{}}
{"type":"ask_user","question":"...","options":["选项A","选项B"]}
{"type":"finish","message":"..."}
不要解释，不要只写思考。`,
        },
      )
      continue
    }

    // 把本轮模型输出记入上下文
    messages.push({
      role: 'assistant',
      content: `${thinking ? `<thinking>\n${thinking}\n</thinking>\n` : ''}${content}`,
    })

    if (action.type === 'ask_user') {
      const answer = await options.hooks.onAskUser({
        question: action.question,
        options: action.options ?? [],
      })
      messages.push({
        role: 'user',
        content: `用户答复：${answer}`,
      })
      continue
    }

    if (action.type === 'tool_call') {
      const id = `tool_${Date.now()}_${step}`
      const label = action.label?.trim() || toolLabel(action.tool)
      options.hooks.onTool({ id, tool: action.tool, label, status: 'running' })
      const result = await executeAiTool({
        projectPath: options.projectPath,
        tool: action.tool,
        args: action.args,
      })
      if (!result.ok) {
        options.hooks.onTool({
          id,
          tool: action.tool,
          label,
          status: 'error',
          error: result.error,
        })
        if (action.tool === 'run_backend_tests') backendTestsPassed = false
        messages.push({
          role: 'user',
          content: `工具 ${action.tool}（${label}）执行失败：${result.error}\n请思考后重新给出下一步动作（可修正参数重试，或换方案，或 ask_user）。`,
        })
        continue
      }
      options.hooks.onTool({ id, tool: action.tool, label, status: 'done' })
      if (agentDidMutateFromTool(action.tool)) changed = true
      if (isBackendMutatingTool(action.tool)) {
        backendDirty = true
        backendTestsPassed = false
      }
      if (action.tool === 'run_backend_tests') {
        backendTestsPassed = /"passed"\s*:\s*true/.test(result.result)
        if (!backendTestsPassed) {
          messages.push({
            role: 'user',
            content: `工具 ${action.tool}（${label}）已执行，但测试未全部通过：
${result.result}
请根据失败用例修复后端实现，然后重新生成/调整用例并再次 run_backend_tests。未通过前禁止 finish。`,
          })
          continue
        }
      }
      const nextHint =
        backendDirty && !backendTestsPassed
          ? '后端已改动：请生成全面测试用例并调用 run_backend_tests；全部通过后才能 finish。'
          : backendDirty && backendTestsPassed
            ? '后端测试已通过，若无其它改动可以 finish。'
            : '请继续下一步；若已完成请 finish。'
      messages.push({
        role: 'user',
        content: `工具 ${action.tool}（${label}）执行成功：\n${result.result}\n${nextHint}`,
      })
      continue
    }

    // finish：后端改动必须测试通过
    if (backendDirty && !backendTestsPassed) {
      options.hooks.onStatus?.(
        '后端改动尚未通过测试，已要求 AI 继续调试…',
      )
      messages.push({
        role: 'user',
        content: `禁止 finish：检测到后端改动尚未通过测试套件。
请立刻：
1) 为改动的数据层/业务层/控制器 API 生成全面用例（正常、边界、失败路径）；
2) 调用 run_backend_tests；
3) 全部 passed=true 之后再 finish。
不要再输出未通过测试的 finish。`,
      })
      continue
    }

    options.hooks.onFinish(action.message)
    return
  }
}

export function agentDidMutateFromTool(tool: string): boolean {
  return (
    tool.startsWith('create_') ||
    tool.startsWith('save_') ||
    tool.startsWith('copy_') ||
    tool.startsWith('delete_') ||
    tool.startsWith('rename_') ||
    tool.startsWith('add_') ||
    tool.startsWith('update_') ||
    tool.startsWith('remove_') ||
    tool.startsWith('move_') ||
    tool.startsWith('insert_') ||
    tool.startsWith('upsert_') ||
    tool.startsWith('design_') ||
    tool.startsWith('drop_') ||
    tool.startsWith('truncate_') ||
    tool.startsWith('upload_') ||
    tool === 'set_project_entry_page'
  )
}
