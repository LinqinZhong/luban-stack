import { streamAiChat, type AiChatMessage } from '../api/ai'
import type { AiModelConfig } from '../stores/workspace-settings'
import {
  isBackendMutatingTool,
} from './ai-backend-debug'
import {
  isFrontendMutatingTool,
} from './ai-frontend-debug'
import {
  buildToolCatalogPrompt,
  executeAiTool,
  toolLabel,
} from './ai-tools'
import { assertSingleAskUserQuestion } from './ai-ask-user'

export { assertSingleAskUserQuestion } from './ai-ask-user'

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

/** 上一轮对话写入模型上下文（不含本轮最新用户输入） */
export type AiAgentPriorMessage = {
  role: 'user' | 'assistant'
  content: string
}

const MAX_PRIOR_CHARS = 24000
const MAX_PARSE_RETRY = 4

function trimPriorMessages(
  prior: AiAgentPriorMessage[],
): AiChatMessage[] {
  if (!prior.length) return []
  const mapped: AiChatMessage[] = prior
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? '').trim(),
    }))
    .filter((m) => m.content)
  if (!mapped.length) return []

  let total = mapped.reduce((sum, m) => sum + m.content.length, 0)
  if (total <= MAX_PRIOR_CHARS) return mapped

  // 从最早的消息开始丢，保留最近对话
  const kept = [...mapped]
  while (kept.length > 1 && total > MAX_PRIOR_CHARS) {
    const removed = kept.shift()
    total -= removed?.content.length ?? 0
  }
  if (total > MAX_PRIOR_CHARS && kept.length === 1) {
    const last = kept[0]
    kept[0] = {
      ...last,
      content: `…(上文已截断)\n${last.content.slice(-(MAX_PRIOR_CHARS - 20))}`,
    }
  }
  return kept
}

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
      ? parsed.options
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
      : []
    assertSingleAskUserQuestion(question, options)
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
3. **边做边带界面**：干活时按场景切换主工作区（打开对应页/组件、底部模式、左侧活动栏、选中节点），让用户能跟着看；不要闷头只调读写接口。
4. **不确定先问（强制，优先于开干）**：动手改之前，若需求里有缺省、歧义或多种合理方案，**必须先 \`ask_user\`**，不要自行拍板。例如（不限于）：
   - 界面风格/主题色/深浅背景、布局结构、是否新建页还是改现有页
   - **内容超出一屏时**：滚动查看 vs 压缩进一屏 vs 分页/折叠（见「屏幕溢出」）
   - 字段命名、表结构细节、接口路径、业务规则边界
   - 用户说「这个按钮」但未指明是哪一个；@提及与口述不一致
   - 覆盖已有实现 vs 另建一份
   提问要短、具体，尽量带 \`options\` 方便点选。
   **\`ask_user\` 一次只问一个决策（强制）**：界面 options 是**单选**。禁止在同一条 question 里并列 1/2/3 多个问题，也禁止把「新建页 vs 改 home」「emoji vs 图标」「深色 vs 浅色」等互不替代的选项混进同一个 options 列表。有多件事要确认时：先问最阻塞开工的那一个，用户答完再 ask 下一个。
5. **禁止随意发挥**：未获确认时，不要自行发明交互流程、视觉风格、多余功能或「顺手优化」。用户明确说「随意发挥 / 你看着办 / 按你的想法来」等之后，才可在合理范围内自行设计。
6. 先通过接口检索再修改；不确定是否覆盖/删表/删桶时必须 ask_user。
7. 需要创建资源、选择实现方案时，用 ask_user 询问，可给 options。
8. 禁止假装整份提交磁盘文件。按领域用结构化接口：
   - 前端界面：add_widgets（批量/嵌套优先）/ add_widget（仅单个）/ update_widget_attrs / remove_widget / move_widget / insert_component_ref / upsert_data_field / delete_data_field
   - 读控件：get_page / get_component（紧凑 tree）→ get_widget（单节点完整 attrs/events）→ get_page_method（方法 body）
   - **编辑器导航**：get_workspace_ui / switch_workspace_nav / switch_workspace_mode / open_editor_resource / select_widget / focus_props_tab / open_backend_workspace / reveal_in_editor / set_canvas_scene（可驱动主工作区左侧栏与底部 tab；独立 AI 弹窗同样有效）
   - 图标/调色板/类型：upsert_* / delete_*（先 get/list 再改）
   - MySQL：list/upsert 连接 → 建表/设计表/行数据接口（见下方「表设计确认」）
   - OSS：list/upsert 连接 → 桶/对象接口
   - 后端：list/upsert 服务 → 控制器/API/处理器/方法接口
9. **表设计确认（强制）**：用户未明确给出表结构时，你可以先拟定方案，但**在调用 create_mysql_table / design_mysql_table 之前**必须用 ask_user 让用户确认，至少包含：
   - 表名
   - 全部字段（字段名 + 类型，必要时空值/主键/自增/备注）
   - 索引（名称、包含列、说明；无索引也要说明「无额外索引」）
   可用 options 如「按此方案建表」「我来修改后再说」。用户已完整指定表名/字段/索引时可直接执行，不必重复确认。
10. **表名单数**：表名使用业务单数词根，**禁止常规复数结尾**。正确：\`order\`、\`user\`、\`goods_item\`；错误：\`orders\`、\`users\`、\`items\`。实体类型/数据处理器命名与表名单数保持一致。
11. **前端验收（强制）**：只要改动了页面/组件界面、方法或数据池，必须：
   1) 用 \`preview_page\` **打开主工作区真实预览画布**（用户能看见；需主编辑器窗口已打开该工程），必要时 \`get_preview_state\` / \`assert_preview\` 排查；
   2) **检查屏幕溢出（强制）**：查看返回的 \`layoutRisks\` / \`viewportOverflow\`。若 \`overflowing=true\` 或 risks 提示超出屏幕，必须处理后再测（见「屏幕溢出」）；不得无视溢出直接 finish；
   3) 用 \`run_frontend_tests\` 生成并执行用例（同样驱动真实预览），至少覆盖：初始可见性与关键文案、主要点击事件后的数据变化、依赖数据的动态显示（vIf/vShow）；若用了 dynamicStyles / 选中高亮 / 背景随数据变化，**必须**含 \`assertStyle\`（或 assert_preview 对 background/textColor），禁止只 assertData 就宣称视觉完成；
   4) **交互必须真点**：验证按钮/事件效果时要用 steps 的 \`click\` 或 \`runMethod\`（会点到画布上），**禁止**只用测试 DSL 的 \`setData\` 把期望值写进数据池再 assert（那是作弊，不算测到方法体）；
   5) 若工具返回运行出错（如 setData 用法错误、字段不存在、dynamicStyles/数据池被拒绝、主编辑器未打开），视为失败，必须先修再重测；
   6) **全部顶层 passed=true 之后才允许 finish**。失败必须先修复再重测。未跑通测试时系统会拒绝 finish。
   7) **不要迁就错误实现去改断言**：数据类型/样式对不上时先修数据池或 attrs，再测。
   8) 长动画用 \`wait\`（ms≤8000）；测完保持/切回 preview 便于用户目视。
12. **后端验收（强制）**：只要改动了数据层 / 业务层 / 控制器（含 API、处理器、方法），必须：
   1) 为相关方法/API 生成**全面测试用例**（正常、边界、缺参/非法入参、权限或业务失败路径等，能覆盖就覆盖）；
   2) 用 \`run_backend_tests\`（或分别调用 debug_data_layer_method / debug_business_method / debug_controller_api）执行调试；
   3) **全部 passed=true 之后才允许 finish**。失败必须先修复再重测。未跑通测试时系统会拒绝 finish。
13. **数据层方法复用（强制）**：在 \`upsert_processor_method\`（layer=data）创建新方法之前，必须先 \`get_service_processors(layer=data)\` 查看该处理器**全部方法**（含预置 source=preset 与自定义 source=custom）。若已有能满足需求的方法则**直接复用，禁止再写**：
   - 按主键查单条 → \`oneById\`
   - 分页列表 → \`page\`；按索引字段筛选 → \`pageByXxx\` / \`countByXxx\`
   - 计数 → \`count\`
   - 新增 → \`save\` / \`saveBatch\`；更新 → \`updateById\`；删除 → \`deleteById\` / \`hardDeleteById\`
   仅当现有方法确实无法覆盖（新查询条件、新 SQL 逻辑等）时才创建自定义方法。
14. 工具失败时会把错误返回给你，请修正参数或换方案后重试。
15. 全部完成后用 finish，并按如下格式总结（须包含测试结果摘要）：
已根据要求完成修改，改动如下：

【前端-页面（home）】新增元素
【类型-分组（order）】新增 Order
【数据库（mysql_local）】创建表 order
【后端-服务（order）】新增 API /list
【测试】run_frontend_tests 通过 3/3；run_backend_tests 通过 5/5

## 输出格式（非常严格，每次回复都必须遵守）
你可以先用 <thinking>...</thinking> 写思考，但**必须**再给出一个完整 JSON 动作，否则流程会中断。
不要只输出自然语言。不要省略 type 字段。

正确示例：
\`\`\`json
{"type":"tool_call","tool":"list_pages","label":"检索页面列表","args":{}}
\`\`\`
\`\`\`json
{"type":"tool_call","tool":"add_widgets","label":"批量添加两行六键","args":{"scope":"page","id":"home","parentNodeId":"0:LinearLayout","widgets":[{"tag":"LinearLayout","attrs":{"orientation":"vertical","width":"match_parent","height":"wrap_content"},"children":[{"tag":"LinearLayout","attrs":{"orientation":"horizontal","width":"match_parent","height":"wrap_content"},"children":[{"tag":"Button","attrs":{"text":"1","width":"match_parent","weight":"1","height":"48"}},{"tag":"Button","attrs":{"text":"2","width":"match_parent","weight":"1","height":"48"}},{"tag":"Button","attrs":{"text":"3","width":"match_parent","weight":"1","height":"48"}}]},{"tag":"LinearLayout","attrs":{"orientation":"horizontal","width":"match_parent","height":"wrap_content"},"children":[{"tag":"Button","attrs":{"text":"4","width":"match_parent","weight":"1","height":"48"}},{"tag":"Button","attrs":{"text":"5","width":"match_parent","weight":"1","height":"48"}},{"tag":"Button","attrs":{"text":"6","width":"match_parent","weight":"1","height":"48"}}]}]}]}}
\`\`\`
\`\`\`json
{"type":"tool_call","tool":"list_mysql_connections","label":"查看数据库连接","args":{}}
\`\`\`
\`\`\`json
{"type":"ask_user","question":"页面要用浅色还是深色主题？","options":["浅色（白底）","深色（黑底）","随意发挥"]}
\`\`\`
\`\`\`json
{"type":"ask_user","question":"老虎机是新建独立页面，还是改当前 home？","options":["新建 slot-machine 页面","改造 home 页面"]}
\`\`\`
\`\`\`json
{"type":"ask_user","question":"发现订单列表已存在，是否覆盖？","options":["覆盖","额外创建一个 OrderList2"]}
\`\`\`
错误示例（禁止：一题多问 + 混杂 options）：
\`\`\`json
{"type":"ask_user","question":"需要确认：\\n1. 新建还是改 home？\\n2. 用 emoji 还是图标？\\n3. 深色还是浅色？","options":["新建页面","改 home","用 emoji","深色"]}
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
- **开干前先消歧**：需求不清就 ask_user；只有用户说「随意发挥」等才可自行设计未指定细节。
- nodeId 使用路径格式，如 0:LinearLayout/1:Button（来自工具返回或用户提及，不要猜）。
- get_page / get_component 返回紧凑 tree（含 nodeId 与 events）。若仍不够，用 get_widget 读单节点；不要臆造被截断部分的 nodeId。
- **批量加控件（强制优先）**：同一父节点下要加 ≥2 个控件，或要加「容器+子节点」结构时，必须用一次 \`add_widgets\`（widgets 可嵌套 children），禁止连续多次 \`add_widget\` 一个个加。仅添加单个叶子控件时才用 \`add_widget\`。
  - **禁止拆小批**：不要人为拆成每次 2～3 个。九宫格、多行表单、整块卡片区等应**一次** \`add_widgets\` 写完整棵子树（含嵌套合计最多约 80 个节点）。例如 3×3 九宫格 = 外层 + 3 行容器 + 9 格（及格子内子节点）全部放进同一次 widgets，不要先加一行再加一行。
- **增删改后 nodeId 会变（强制）**：\`remove_widget\` / \`add_widget\` / \`add_widgets\` / \`move_widget\` 之后旧路径全部作废。必须使用工具返回的最新 tree（或再 \`get_page\`）里的 nodeId，禁止凭记忆连删多个节点。
- **按场景操作前端编辑器（强制习惯）**：执行任务时要同步驱动主工作区 UI，让用户跟着你的步骤看到对应界面；不要只改接口数据而让画布停在无关页面。
  - 改布局/控件前：\`open_editor_resource\` + \`switch_workspace_mode({ mode:"edit" })\`，必要时 \`select_widget\` / \`focus_props_tab\`（style|event|dynamic）。
  - 改数据池字段：切 \`datapool\`；改方法体：切 \`methods\`；改生命周期：切 \`lifecycle\`。
  - 改后端控制器/业务/数据层：\`open_backend_workspace\` 打开对应 serviceId 与 layer。
  - 改类型/MySQL/OSS/图标/调色板：\`switch_workspace_nav\` 到 datatypes|mysql|oss|icons|palette。
  - 阶段性改完或 finish 前：\`reveal_in_editor\` 定位到本次改动的页面/节点，便于用户目视确认。
  - 要给用户看运行效果：\`preview_page\` / \`run_frontend_tests\` 已驱动真实预览画布；亦可 \`switch_workspace_mode({ mode:"preview" })\`。
  - 不确定当前停在哪：先 \`get_workspace_ui\` 再决定下一步导航。
  - 独立 AI 弹窗同样调用上述工具，主工作区会同步切换。
- **屏幕溢出（强制）**：设计/改完界面后必须判断内容是否超出手机屏幕（约 375×667，小程序还要扣状态栏+标题栏）。
  - **如何发现**：\`preview_page\` / \`get_preview_state({includeLayout:true})\` 返回的 \`viewportOverflow\`（DOM 实测）与 \`layoutRisks\`（含预估超高提示）。
  - **溢出策略（LinearLayout / RelativeLayout 的 \`overflow\`）**：
    - \`scroll\`：列表、长表单、聊天记录、设置页等**本就需要上下翻看**的内容 → 给**内容区或根布局**设 \`overflow="scroll"\`（可滚动布局才支持 onScroll*）。
    - \`hidden\`：需要裁切的装饰/圆角容器；**不要**拿来「假装塞进一屏」藏掉重要内容。
    - \`visible\`（默认）：短内容、单屏仪表盘；若实测已溢出却仍 visible，底部会画在屏外且难操作。
  - **应不应该溢出**：
    - 计算器、登录框、弹层主操作区等**应尽量一屏内** → 用 \`height=match_parent\` + \`weight\` 分配、减小固定高/字号/间距，而不是盲目 scroll。
    - 订单列表、文章、多段表单等**自然会长于一屏** → 滚动合理。
  - **拿捏不定必须 ask_user**，例如 options：\`["做成可滚动长页","压缩进一屏","分页/折叠部分内容"]\`。禁止擅自选一种用户可能不满意的方案。
  - 横向溢出优先改布局（weight / 缩小固定宽 / 换行），少用横向滚动。
- **界面视觉（强制）**：
  - 页面默认背景是**白色**。若整页/区块要用深色底，必须同步把文字、图标、按钮设成浅色；反之浅色底用深色字。**禁止**背景与文字同色或对比过低（如黑底黑字、白底白色）。
  - 控件背景属性名是 \`background\`（**禁止**写 \`backgroundColor\`——那是状态栏配置字段，写在控件上画布原先不认；工具虽会自动纠正，但仍应写对）。
  - 先定背景再定内容色：根布局/容器设 \`background\` 后，子 Text/Button 的 \`textColor\`、\`background\` 必须与之区分开。
  - 用户未指定主题色/深浅时，先 ask_user（可提供「浅色 / 深色 / 随意发挥」），不要擅自改成黑底计算器等风格。
  - Button：**禁止** \`width="0"\` / \`height="0"\`（会坍塌看不见）。横向均分用 \`width="match_parent"\` + \`weight="1"\`；单按钮用 \`match_parent\` 或合适固定宽（如 80/120）。**未指定高度时默认 \`wrap_content\`**；若设固定高度须为正数（如 40–56），禁止写 0。
  - 其它控件同理：未写 height → \`wrap_content\`；需要固定高时用正数像素，**禁止 height=0**。纵向占满剩余用 \`height="match_parent"\`（可配合 weight），不要用 0。
  - 计算器/宫格等：给按钮明确 height、borderRadius、字号，运算符与数字可用不同背景色，保证在当前页面背景上清晰可辨。
  - 改完主题后用 \`get_page\`/\`get_widget\` 核对 attrs.background 是否已是目标色；不要只凭写入参数口头宣称「已是深色」。
- **控件事件（强制）**：
  - 属性名必须是：\`onClick\` / \`onLongClick\` / \`onTouchStart\` / \`onTouchMove\` / \`onTouchEnd\`；可滚动布局（overflow=scroll）另有 \`onScroll\` / \`onScrollToLower\` / \`onScrollToUpper\`（**禁止** \`click\` / \`longClick\`，运行时不认）。
  - 属性值是 JSON 数组字符串：\`[{"id":"bind_xxx","method":"clear","args":{}}]\`。
  - 带参方法用 args 对象（参数名→值），如 inputDigit：\`{"digit":"7"}\`；**不要**写 \`type:"call"\` 或 \`params:[...]\`。
  - 组件自定义事件同理：实例属性上用事件名（如 change），值仍是上述绑定数组。
- **Button 按压反馈**：属性 \`pressFeedback\`：\`none\`（默认）/ \`scale\` / \`ripple\` / \`rippleScale\`。含波纹时可设 \`pressRippleColor\`（默认灰色半透明 \`rgba(0,0,0,0.22)\`）。一般不必另写 \`dynamicStyles\` / \`pressedKey\`。
- **动态样式 \`dynamicStyles\`**（仅复杂条件变色时用）：属性值为 JSON 字符串，正确格式：
  \`{"states":[{"id":"s1","name":"按压","scenarios":[{"id":"sc1","name":"匹配","conditions":[{"field":"pressedKey","op":"eq","value":"7"}]}],"styles":{"background":"#555555"}}]}\`
  **\`styles\` 与 \`scenarios\` 平级（在 state 上），禁止写进 scenario**；有条件时 styles 必须非空（如 background），否则工具会拒绝写入。优先用平台默认按压；要用动态样式时必须用 \`set_preview_data\`/\`assertStyle\` 验证有效背景（只 assertData 不算验过视觉）。
- **数据池字段（强制，upsert_data_field）**：
  - \`type:"array"\` 的 \`value\` **必须是真实 JSON 数组**，禁止把数组再包成字符串。正确：\`"value":[{"emoji":"🍎","name":"苹果"}]\`；错误：\`"value":"[{\\"emoji\\":...}]"\`（会显示 0 项，运行期也错）。对象元素时加 \`itemType:"json"\`。
  - \`type:"number"\` / \`boolean\` 的 value 用数字/布尔，不要写 \`"10"\` / \`"false"\` 字符串（工具会尽量纠偏，但仍应写对）。
  - \`binding:"computed"\` 时必须同时提供非空 \`computeBody\`（\`return\` 计算结果）；禁止只建空字段却绑 background 当「计算字段」。
  - 布尔字段在方法里用 \`if (spinning === true)\` / \`if (spinning !== true)\`，不要写 \`if (spinning)\`（初始值纠偏前曾出现字符串 "false" 为 truthy）。
- **方法体语法（强制，禁止自创 API）**：
  - 语言：TypeScript。\`save_*_method\` 的 \`body\` **只写方法体内部语句**，不要包含 \`function name(...) { }\` 外壳（编辑器会自动包一层）。
  - **读**数据池：直接用字段名，如 \`display\`、\`messageList.length\`、\`pagination.page\`。组件里读入参用 \`$props.xxx\`；页面路由用 \`$query.xxx\` / \`$route.xxx\`；主题色用 \`$color.primary\`。
  - **写**数据池：只能 \`setData('字段名', 值)\`，两个**位置参数**。正确：\`setData('display', '0')\`、\`setData('loading', false)\`、\`setData('list', [...list, item])\`。
  - **严禁**自创写法：\`setData({ prop: 'display', value: '0' })\`、\`setData({prop, value})\`、\`this.setData(...)\`、\`$data.xxx =\`、\`{$data.xxx}\`、任意未列出的全局函数。
  - 内置函数（仅此）：
    - \`setData(prop: string, value: any): void\`
    - \`navigateTo(to: string, params?: Record<string, unknown>): void\` — \`to\` 为页面 id
    - \`navigateBack(): void\`
    - \`showToast(message: string, duration?: 'short' | 'long'): void\`
    - \`getDeviceInfo(): DeviceInfo\`
    - 组件内另有：\`updateProps(prop: string, value: any)\`（可更新入参）、\`emit('事件名', ...args)\`
  - **浏览器预览可用标准定时器**：\`setTimeout\` / \`clearTimeout\` / \`setInterval\` / \`clearInterval\`（用于短延迟复位等）。仍禁止自创其它全局 API。
  - 调用**同页/同组件**其它自定义方法：按函数名直接调，实参**按定义顺序位置传递**（不要传对象），如 \`loadData()\`、\`inputDigit('7')\`。
  - 数据池 **ref** 字段：Modal 用 \`modalRef.show()\` / \`modalRef.hide()\`；组件引用调其暴露方法，如 \`pagerRef.reset()\`。
  - 事件内联自定义 body（\`method:"__custom__"\`）语法与上相同。
  - 写方法前先 \`get_page_method\` / \`get_component_method\` 看已有 body 风格；不确定就对照平台已有正确示例（\`setData('x', y)\`），不要臆造。
- 拿到工具结果后，立刻输出下一个 JSON 动作（继续 tool_call / ask_user / finish）。
- 平台规则说明只描述概念与接口用法，不代表你能浏览项目文件。
- 绑定写法：数据池字段用 {fieldName}，组件属性用 {$props.xxx}，列表项用 {item}/{item.xxx}，主题色用 {$color.xxx}。**不要**写 {$data.xxx}（平台无此命名空间）。
- 列表：repeat 写字段名（如 repeat="filteredOrders"），挂在要重复的节点上，不要挂在外层滚动容器上。
- 删表、清表、删桶、删服务等破坏性操作前先 ask_user。
- 建表/改表结构前：用户未给定完整设计时必须 ask_user 确认表名、字段（名+类型等）、索引；表名单数（order 而非 orders）。
- 后端调试默认 dryRun=true（写操作回滚）；需要真实落库时再显式 dryRun=false，并先 ask_user。
- run_backend_tests 的 cases[].targetId：data/business 填处理器 id，controller 填控制器 id；methodId 对应方法或 API id。
- 数据层写方法前先读 get_service_processors；优先复用 oneById/page/save 等预置与已有自定义方法。
- 前端自测：\`preview_page\` / \`run_frontend_tests\` **驱动主工作区真实预览画布**（需编辑器已打开）。steps 支持 reset / setData / click / runMethod / wait(ms≤8000) / assertData / assertVisible / assertText / assertStyle；\`assert_preview\` 可对 nodeId 断言 \`background\`/\`textColor\`（含 dynamicStyles 生效后的有效色）。click 的 nodeId 必须来自 get_page tree 或 layout 快照，不要猜。注意：测试步骤里的 op:\`setData\` 是测试 DSL，与方法体里的 \`setData('field', value)\` 不是同一种写法。
- 前端布局风险：width=0 且无 weight、height=0、内容超出屏幕（viewportOverflow / layoutRisks）、背景与文字对比过低、根布局未设背景（默认白底）会在 layout 快照的 risks 中提示，修完再测。`
}

/**
 * 解析测试套件结果：只认顶层 `passed === true`。
 * 禁止用全局 /"passed"\s*:\s*true/——子用例 passed:true 会导致整套误判通过。
 */
export function isSuitePassedResult(resultText: string): boolean {
  const text = (resultText || '').trim()
  if (!text) return false
  try {
    const data = JSON.parse(text) as { passed?: unknown }
    return data?.passed === true
  } catch {
    // summarize 截断时 JSON 可能不完整；套件结果把 passed 放在最前
    return /^\{\s*"passed"\s*:\s*true\b/.test(text)
  }
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
  /** 同会话历史轮次，便于「继续」等短指令接上上文 */
  priorMessages?: AiAgentPriorMessage[]
  hooks: AiAgentHooks
  signal?: AbortSignal
}): Promise<void> {
  const mentionLines =
    options.mentions?.map((m) => {
      const address = m.address || m.label
      return `- @${address} (scope=${m.resourceScope || '?'} id=${m.resourceId || '?'} nodeId=${m.nodeId})`
    }) ?? []

  const prior = trimPriorMessages(options.priorMessages ?? [])
  const contextLines = [
    `当前打开资源：${
      options.active
        ? `${options.active.scope === 'page' ? '页面' : '组件'}:${options.active.id}`
        : '无'
    }`,
    mentionLines.length ? '用户提及节点：' : '',
    ...mentionLines,
    prior.length
      ? '说明：上方 messages 已包含本会话历史。若用户说「继续 / 接着做 / 修一下」等短指令，必须承接上文，禁止声称没有上下文。'
      : '',
    '',
    '用户需求：',
    options.userText,
  ].filter(Boolean)

  const messages: AiChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...prior,
    { role: 'user', content: contextLines.join('\n') },
  ]

  let parseRetry = 0
  let step = 0
  /** 是否改动过后端（须测试通过才能 finish） */
  let backendDirty = false
  let backendTestsPassed = false
  /** 是否改动过前端界面/方法/数据池（须测试通过才能 finish） */
  let frontendDirty = false
  let frontendTestsPassed = false

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
{"type":"ask_user","question":"只问一个决策点","options":["选项A","选项B"]}
{"type":"finish","message":"..."}
注意：ask_user 一次只问一个问题（options 单选），不要把多个编号问题塞进同一条。
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
        if (action.tool === 'run_frontend_tests') frontendTestsPassed = false
        messages.push({
          role: 'user',
          content: `工具 ${action.tool}（${label}）执行失败：${result.error}\n请思考后重新给出下一步动作（可修正参数重试，或换方案，或 ask_user）。`,
        })
        continue
      }
      options.hooks.onTool({ id, tool: action.tool, label, status: 'done' })
      if (isBackendMutatingTool(action.tool)) {
        backendDirty = true
        backendTestsPassed = false
      }
      if (isFrontendMutatingTool(action.tool)) {
        frontendDirty = true
        frontendTestsPassed = false
      }
      if (action.tool === 'run_backend_tests') {
        backendTestsPassed = isSuitePassedResult(result.result)
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
      if (action.tool === 'run_frontend_tests') {
        frontendTestsPassed = isSuitePassedResult(result.result)
        if (!frontendTestsPassed) {
          messages.push({
            role: 'user',
            content: `工具 ${action.tool}（${label}）已执行，但测试未全部通过：
${result.result}
请根据失败用例修复前端界面/方法/数据池，然后重新生成/调整用例并再次 run_frontend_tests。未通过前禁止 finish。`,
          })
          continue
        }
      }
      const hints: string[] = []
      if (frontendDirty && !frontendTestsPassed) {
        hints.push(
          '前端已改动：请用 preview_page / run_frontend_tests（真实预览画布）覆盖可见性、点击与动态内容；全部通过后才能 finish。需主编辑器窗口已打开。',
        )
      } else if (frontendDirty && frontendTestsPassed) {
        hints.push('前端测试已通过。')
      }
      if (backendDirty && !backendTestsPassed) {
        hints.push(
          '后端已改动：请生成全面测试用例并调用 run_backend_tests；全部通过后才能 finish。',
        )
      } else if (backendDirty && backendTestsPassed) {
        hints.push('后端测试已通过。')
      }
      const nextHint =
        hints.length > 0
          ? hints.join(' ')
          : '请继续下一步；若已完成请 finish。'
      messages.push({
        role: 'user',
        content: `工具 ${action.tool}（${label}）执行成功：\n${result.result}\n${nextHint}`,
      })
      continue
    }

    // finish：前端/后端改动必须测试通过
    if (frontendDirty && !frontendTestsPassed) {
      options.hooks.onStatus?.(
        '前端改动尚未通过测试，已要求 AI 继续调试…',
      )
      messages.push({
        role: 'user',
        content: `禁止 finish：检测到前端改动尚未通过测试套件。
请立刻：
1) 用 preview_page 打开真实预览画布（主编辑器须已打开）；
2) 编写覆盖初始可见性/关键文案、主要点击、动态显示的用例并调用 run_frontend_tests；
3) 全部 passed=true 之后再 finish。
不要再输出未通过测试的 finish。`,
      })
      continue
    }
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
