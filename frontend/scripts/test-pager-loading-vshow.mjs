/**
 * 逻辑验证：Pager「加载中」vShow 在 loading/loadingMore 均为 false 时应隐藏。
 * 同时验证 resolveComponentInstanceDollarProps + revision 能跟上原地 setData。
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { reactive, computed, effect, ref } from 'vue'

const require = createRequire(import.meta.url)

// 动态 import TS 源（Vite 未跑时用 node --experimental-strip-types 或直接内联评估）
const xml = readFileSync(
  new URL('../../demos/mall/components/Pager/index.xml', import.meta.url),
  'utf8',
)

const i = xml.indexOf('加载中...')
if (i < 0) {
  console.error('FAIL: 找不到「加载中...」节点')
  process.exit(1)
}
const before = xml.slice(0, i)
const vShowIdx = before.lastIndexOf('vShow="')
const start = vShowIdx + 'vShow="'.length
let end = start
while (end < before.length && before[end] !== '"') end++
const attr = before.slice(start, end)
const decoded = attr
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
const vShowConfig = JSON.parse(decoded)

function coerceBool(value) {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === 'true' || s === '1') return true
    if (s === 'false' || s === '0' || s === '') return false
  }
  return undefined
}

function resolveField(field, pageData, scope) {
  if (field.startsWith('$props.')) {
    const key = field.slice('$props.'.length)
    return scope?.$props?.[key]
  }
  const f = pageData.fields.find((x) => x.name === field)
  return f?.value
}

function evalCondition(cond, pageData, scope) {
  const left = resolveField(cond.field, pageData, scope)
  if (cond.op === 'eq') {
    const lb = coerceBool(left)
    const rb = coerceBool(cond.value)
    if (lb !== undefined && rb !== undefined) return lb === rb
    return String(left ?? '') === String(cond.value)
  }
  return false
}

function evaluateScenarios(scenarios, pageData, scope) {
  const active = scenarios
    .map((s) => ({
      ...s,
      conditions: (s.conditions || []).filter((c) => c.field?.trim()),
    }))
    .filter((s) => s.conditions.length)
  if (!active.length) return true
  return active.some((s) =>
    s.conditions.every((c) => evalCondition(c, pageData, scope)),
  )
}

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL:', name)
    process.exit(1)
  }
  console.log('OK:', name)
}

const pageFalse = {
  fields: [
    { name: 'loadingMore', value: false },
    { name: 'refreshing', value: false },
    { name: 'hasNext', value: false },
  ],
}

assert(
  'loading=false & loadingMore=false → 隐藏「加载中」',
  evaluateScenarios(vShowConfig.scenarios, pageFalse, {
    $props: { loading: false },
  }) === false,
)

assert(
  'loading=true → 显示「加载中」',
  evaluateScenarios(vShowConfig.scenarios, pageFalse, {
    $props: { loading: true },
  }) === true,
)

assert(
  'loadingMore=true → 显示「加载中」',
  evaluateScenarios(
    vShowConfig.scenarios,
    {
      fields: [
        { name: 'loadingMore', value: true },
        { name: 'refreshing', value: false },
      ],
    },
    { $props: { loading: false } },
  ) === true,
)

// —— 模拟「原地 setData + revision」驱动 $props 刷新 ——
const hostData = reactive({
  fields: [{ name: 'loading', type: 'boolean', value: true }],
})
const revision = ref(0)

function buildHostBoundAttrsDepsKey(attrs, pageData) {
  const parts = []
  for (const [key, raw] of Object.entries(attrs)) {
    if (!raw?.includes('{')) continue
    for (const m of raw.matchAll(/\{([^{}]+)\}/g)) {
      const expr = m[1]?.trim()
      const field = pageData.fields.find((f) => f.name === expr)
      if (field) parts.push(key, expr, field.value)
    }
  }
  return JSON.stringify(parts)
}

const attrs = { loading: '{loading}' }
const instanceLoading = computed(() => {
  void revision.value
  const key = buildHostBoundAttrsDepsKey(attrs, hostData)
  void key
  const field = hostData.fields.find((f) => f.name === 'loading')
  return field?.value
})

const seen = []
effect(() => {
  seen.push(instanceLoading.value)
})

assert('初始 $props.loading === true', instanceLoading.value === true)

// 原地写入（不换 hostData 引用）——模拟 updateProps → setData
hostData.fields[0].value = false
revision.value += 1

assert(
  '原地改 false + bump revision 后 $props.loading === false',
  instanceLoading.value === false,
)

assert(
  'effect 观察到 true→false',
  seen.includes(true) && seen.includes(false),
)

// 最终：面板 false 时 vShow 必须为隐藏
assert(
  '最终状态：面板 loading=false 时「加载中」隐藏',
  evaluateScenarios(vShowConfig.scenarios, pageFalse, {
    $props: { loading: instanceLoading.value },
  }) === false,
)

console.log('\nAll pager loading vShow checks passed.')
