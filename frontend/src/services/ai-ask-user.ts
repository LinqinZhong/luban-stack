/**
 * ask_user 的 options 是单选：一次只能问一个决策点。
 * 禁止把「页面范围 / 格子内容 / 玩法」等多题塞进同一条 question。
 */
export function assertSingleAskUserQuestion(
  question: string,
  options: string[] = [],
): void {
  const text = question.trim()
  if (!text) throw new Error('ask_user 缺少 question')

  const numbered =
    text.match(/(?:^|[\n\r]|[；;。])\s*\d+\s*[.、．)]\s+\S/g) ??
    text.match(/\d+\s*[.、．)]\s+(?:页面|格子|玩法|风格|主题|新建|改造|背景)/g) ??
    []
  // 同一题干里出现多个编号决策点（如 1. 2. 3.）
  const numberedAll = text.match(/\d+\s*[.、．)]\s+\S/g) ?? []
  if (numbered.length >= 2 || numberedAll.length >= 3) {
    throw new Error(
      'ask_user 一次只能问一个问题（options 为单选）。检测到题干里有多个编号项（1. 2. 3. …）。请拆成多次 ask_user：先问最关键的一个，等用户答复后再问下一个。',
    )
  }

  const topicMarkers =
    text.match(
      /(?:^|[\n\r])\s*(?:【?\s*)?(?:页面范围|格子|玩法|风格|主题|布局|奖品|交互|背景)[^:\n]{0,12}[：:]/g,
    ) ?? []
  if (topicMarkers.length >= 2) {
    throw new Error(
      'ask_user 一次只能问一个问题。检测到题干里并列了多个主题（如页面范围/格子/玩法）。请拆成多次 ask_user，每次只确认一件事。',
    )
  }

  // options 明显跨多个互不替代维度时拒绝（单选无法同时回答）
  if (options.length >= 6) {
    const buckets = new Set<string>()
    for (const opt of options) {
      if (/新建|改造|页面|home|slot/i.test(opt)) buckets.add('scope')
      if (/emoji|图标|图案|水果|奖品/i.test(opt)) buckets.add('content')
      if (/滚动|旋转|点击开始|逐格|玩法/i.test(opt)) buckets.add('play')
      if (/深色|浅色|赌场|明亮|风格|背景/i.test(opt)) buckets.add('style')
    }
    if (buckets.size >= 2) {
      throw new Error(
        'ask_user 的 options 看起来混合了多个互不替代的决策（如页面范围、内容、玩法、风格）。options 是单选，不能用来同时回答多题。请每次只问一个决策，options 仅列出该题的互斥答案。',
      )
    }
  }
}
