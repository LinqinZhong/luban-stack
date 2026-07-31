import type { PageMethod } from '../../types/page-method.js'
import type { LifecycleConfig } from '../../types/lifecycle.js'
import type { DataField } from '../../types/page-data.js'
import type { MpApiBinding } from './api-runtime.js'
import {
  apiMethodExportName,
  apiModuleRelPath,
} from './api-runtime.js'
import { codeUsesIdent, lineComment } from './js-comments.js'

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

/** 将 Promise.finally 改成兼容写法（部分小程序运行时无 finally） */
function replacePromiseFinally(body: string): string {
  if (!body.includes('.finally')) return body
  return body.replace(
    /\.finally\s*\(\s*(?:\(\)\s*=>\s*|function\s*\(\s*\)\s*)\{([\s\S]*?)\}\s*\)/g,
    (_m, inner: string) =>
      `.then(function (__ok) { return __ok }, function (err) { console.error(err) }).then(function () {${inner}})`,
  )
}

/** 将组件方法体包成小程序 Component methods 实现 */
export function generateComponentMethodFn(
  method: PageMethod,
  options: {
    dataFieldNames: string[]
    propNames: string[]
    apiPropNames: string[]
    arrayPropNames?: string[]
    siblingMethodNames: string[]
    /** 数据池 type=ref 字段（组件 selectComponent / Modal show·hide） */
    refFields?: Array<{
      name: string
      kind: 'component' | 'modal'
      modalName?: string
      exposedMethods?: string[]
    }>
  },
): string {
  const name = method.name.trim()
  if (!name || !isValidIdent(name)) return ''

  const params = (method.params ?? [])
    .map((p) => p.name.trim())
    .filter((n) => isValidIdent(n))
  const paramList = params.join(', ')

  let body = (method.body || '').trim()
  // 小程序部分运行时无 Promise.finally；改成 then 收尾，失败也会关 loading
  body = replacePromiseFinally(body)
  // 刷新时 records 可能为空；保证始终是数组，避免 UI/展开报错
  body = body.replace(
    /updateProps\(\s*['"]data['"]\s*,\s*res\.records\s*\)/g,
    `updateProps('data', res.records || [])`,
  )
  const uses = (ident: string) => codeUsesIdent(body, ident)

  const dataNames = options.dataFieldNames.filter(isValidIdent)
  const propNames = options.propNames.filter(isValidIdent)
  const apiProps = new Set(options.apiPropNames.filter(isValidIdent))
  const arrayProps = new Set((options.arrayPropNames ?? []).filter(isValidIdent))
  const siblings = options.siblingMethodNames.filter(
    (n) => isValidIdent(n) && n !== name && uses(n),
  )
  const refNames = new Set(
    (options.refFields ?? []).map((f) => f.name).filter(isValidIdent),
  )
  const usedRefs = (options.refFields ?? []).filter(
    (f) => isValidIdent(f.name) && uses(f.name),
  )

  const needSetData = uses('setData')
  const needShowToast = uses('showToast')
  const needNavigateTo = uses('navigateTo')
  const needNavigateBack = uses('navigateBack')
  const needUpdateProps = uses('updateProps')
  const needEmit = uses('emit')
  const needRuntime =
    needSetData || needShowToast || needNavigateTo || needNavigateBack
  const needProps = uses('$props')
  const needApi =
    uses('api') ||
    uses('getDeviceInfo') ||
    (needProps && propNames.some((p) => apiProps.has(p)))

  const lines: string[] = []
  lines.push(`  ${name}(${paramList}) {`)
  lines.push(`    var that = this`)
  if (needApi) {
    lines.push(`    var api = require('../../utils/api.js')`)
  }
  if (needRuntime) {
    lines.push(`    var runtime = require('../../utils/runtime.js')`)
  }
  if (uses('getDeviceInfo')) {
    lines.push(`    var getDeviceInfo = api.getDeviceInfo`)
  }
  if (needSetData) {
    lines.push(`    var setData = runtime.createSetData(that)`)
  }
  if (needShowToast) {
    lines.push(`    var showToast = runtime.showToast`)
  }
  if (needNavigateTo) {
    lines.push(`    var navigateTo = runtime.navigateTo`)
  }
  if (needNavigateBack) {
    lines.push(`    var navigateBack = runtime.navigateBack`)
  }
  if (needUpdateProps) {
    lines.push(`    var updateProps = function (prop, value) {`)
    lines.push(`      var patch = {}`)
    lines.push(`      patch[prop] = value`)
    lines.push(`      that.setData(patch)`)
    lines.push(`      if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed([prop])`)
    lines.push(`      that.triggerEvent('update:' + String(prop), { value: value })`)
    lines.push(`    }`)
  }
  if (needEmit) {
    lines.push(`    var emit = function (event) {`)
    lines.push(
      `      var args = Array.prototype.slice.call(arguments, 1)`,
    )
    lines.push(`      that.triggerEvent(String(event), { args: args })`)
    lines.push(`    }`)
  }

  for (const sib of siblings) {
    lines.push(`    var ${sib} = function () { return that.${sib}.apply(that, arguments) }`)
  }

  // ref 局部变量（优先于 data 字段同名）
  for (const field of usedRefs) {
    if (field.kind === 'modal' && field.modalName) {
      const key = `__modal_${String(field.modalName).replace(/[^a-zA-Z0-9_$]/g, '_')}`
      lines.push(`    var ${field.name} = {`)
      lines.push(
        `      show: function () { var p = {}; p[${JSON.stringify(key)}] = true; that.setData(p) },`,
      )
      lines.push(
        `      hide: function () { var p = {}; p[${JSON.stringify(key)}] = false; that.setData(p) },`,
      )
      lines.push(`    }`)
    } else if (field.kind === 'component') {
      const methods = (field.exposedMethods ?? []).filter((m) =>
        /^[A-Za-z_$][\w$]*$/.test(m),
      )
      if (!methods.length) {
        lines.push(
          `    var ${field.name} = that.selectComponent(${JSON.stringify('#' + field.name)})`,
        )
      } else {
        lines.push(`    var ${field.name} = (function () {`)
        lines.push(
          `      var __c = that.selectComponent(${JSON.stringify('#' + field.name)})`,
        )
        lines.push(`      return {`)
        for (const m of methods) {
          lines.push(
            `        ${m}: function () { if (__c && typeof __c.${m} === 'function') return __c.${m}.apply(__c, arguments) },`,
          )
        }
        lines.push(`      }`)
        lines.push(`    })()`)
      }
    }
  }

  for (const field of dataNames) {
    if (propNames.includes(field) || params.includes(field)) continue
    if (refNames.has(field)) continue
    if (!uses(field)) continue
    lines.push(`    var ${field} = that.data.${field}`)
  }

  // $props：普通 prop 读 properties；api prop 变成可调用（内部 wx.request，含 paramBindings 合并）
  if (needProps) {
    lines.push(`    var $props = {}`)
    for (const prop of propNames) {
      if (apiProps.has(prop)) {
        lines.push(`    $props.${prop} = function (args) {`)
        lines.push(
          `      return api.invoke(that.properties.${prop} || that.data.${prop}, args)`,
        )
        lines.push(`    }`)
      } else if (arrayProps.has(prop)) {
        // 数组 prop 避免 null 展开报错： [...$props.data, ...]
        lines.push(
          `    Object.defineProperty($props, '${prop}', { enumerable: true, get: function () { var v = that.properties.${prop} !== undefined ? that.properties.${prop} : that.data.${prop}; return Array.isArray(v) ? v : [] } })`,
        )
      } else {
        lines.push(
          `    Object.defineProperty($props, '${prop}', { enumerable: true, get: function () { return that.properties.${prop} !== undefined ? that.properties.${prop} : that.data.${prop} } })`,
        )
      }
    }
  }

  if (body) {
    const indented = body
      .split('\n')
      .map((line) => (line.trim() ? `    ${line}` : ''))
      .join('\n')
    lines.push(indented)
  }
  lines.push(`  }`)
  return lines.join('\n')
}

/**
 * 组件计算字段：监听 props，运行时重算 list1/list2 等
 */
export function generateComputedObservers(options: {
  fields: DataField[]
  propNames: string[]
}): { observersJs: string; recomputeMethod: string; hasComputed: boolean } {
  const computed = (options.fields ?? []).filter((f) => {
    const name = f.name.trim()
    return (
      f.binding === 'computed' &&
      isValidIdent(name) &&
      typeof f.computeBody === 'string' &&
      f.computeBody.trim()
    )
  })
  if (!computed.length) {
    return { observersJs: '', recomputeMethod: '', hasComputed: false }
  }

  const propNames = options.propNames.filter(isValidIdent)
  const allFieldNames = new Set(
    (options.fields ?? []).map((f) => f.name.trim()).filter(isValidIdent),
  )
  const computedNames = new Set(computed.map((c) => c.name.trim()))

  const depsByComputed = new Map<string, string[]>()
  const observeDeps = new Set<string>()
  for (const field of computed) {
    const name = field.name.trim()
    const deps = collectComputeDeps(field.computeBody || '', {
      propNames,
      allFieldNames,
      computedNames,
    })
    depsByComputed.set(name, deps)
    for (const d of deps) {
      if (d === '$query' || d === '$route') continue
      if (computedNames.has(d)) continue
      observeDeps.add(d)
    }
  }

  const recomputeMethod = buildRecomputeMethod(
    computed,
    propNames,
    options.fields ?? [],
    depsByComputed,
  )

  const observerLines = [...observeDeps]
    .sort()
    .map(
      (dep) =>
        `    ${JSON.stringify(dep)}: function () {\n      this.__recomputeComputed([${JSON.stringify(dep)}])\n    },`,
    )

  // params 常由页面计算字段异步下发：attached 时可能仍是 {}，变化后需重新拉数
  if (propNames.includes('params')) {
    observerLines.push(`    "params": function (params) {
      var key = JSON.stringify(params == null ? null : params)
      if (this.__voiderParamsKey === key) return
      var prev = this.__voiderParamsKey
      this.__voiderParamsKey = key
      if (prev === undefined) return
      if (typeof this.reset === 'function') this.reset()
    },`)
  }

  const observersJs = observerLines.length
    ? `  observers: {\n${observerLines.join('\n')}\n  },`
    : ''

  return {
    observersJs,
    recomputeMethod,
    hasComputed: true,
  }
}

const COMPUTE_RESERVED = new Set([
  'return',
  'true',
  'false',
  'null',
  'undefined',
  'var',
  'let',
  'const',
  'function',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'this',
  'typeof',
  'instanceof',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'console',
  'getDeviceInfo',
  '$props',
  'props',
])

/** 从计算体收集直接依赖（data / computed / props / $query|$route） */
function collectComputeDeps(
  body: string,
  ctx: {
    propNames: string[]
    allFieldNames: Set<string>
    computedNames: Set<string>
  },
): string[] {
  const deps = new Set<string>()
  const stripped = String(body)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')

  for (const m of stripped.matchAll(/\$props\.([A-Za-z_$][\w$]*)/g)) {
    const p = m[1]!
    if (ctx.propNames.includes(p)) deps.add(p)
  }

  if (
    /(?:^|[^A-Za-z0-9_$])(?:\$query|\$route|query|route)(?:[^A-Za-z0-9_]|$)/.test(
      stripped,
    )
  ) {
    deps.add('$query')
  }

  const ids = stripped.match(/[A-Za-z_$][\w$]*/g) || []
  for (const id of ids) {
    if (COMPUTE_RESERVED.has(id)) continue
    if (id === '$query' || id === '$route' || id === 'query' || id === 'route') {
      continue
    }
    if (ctx.propNames.includes(id)) {
      deps.add(id)
      continue
    }
    if (ctx.computedNames.has(id) || ctx.allFieldNames.has(id)) {
      deps.add(id)
    }
  }
  return [...deps]
}

function buildRecomputeMethod(
  computed: DataField[],
  propNames: string[],
  allFields: DataField[],
  depsByComputed: Map<string, string[]>,
): string {
  const dataLocals = allFields
    .map((f) => f.name.trim())
    .filter(
      (n) =>
        isValidIdent(n) &&
        !propNames.includes(n) &&
        !computed.some((c) => c.name.trim() === n),
    )

  const lines: string[] = []
  lines.push(`  __recomputeComputed: function (changedKeys) {`)
  lines.push(`    var that = this`)
  lines.push(
    `    var __force = !(changedKeys && changedKeys.length)`,
  )
  lines.push(`    var __dirty = {}`)
  lines.push(`    if (!__force) {`)
  lines.push(`      for (var __i = 0; __i < changedKeys.length; __i++) {`)
  lines.push(`        __dirty[changedKeys[__i]] = true`)
  lines.push(`      }`)
  lines.push(`    }`)
  const needsDevice =
    computed.some((f) => /\bgetDeviceInfo\s*\(/.test(f.computeBody || '')) ||
    computed.some((f) => f.name.trim() === 'offsetTop')
  if (needsDevice) {
    lines.push(
      `    var getDeviceInfo = require('../../utils/api.js').getDeviceInfo`,
    )
  }
  lines.push(`    var $props = {}`)
  lines.push(`    var $query = that.__pageQuery || {}`)
  lines.push(`    var $route = $query`)
  for (const prop of propNames) {
    // 末尾加分号，避免 })( 被解析成调用（ASI）
    lines.push(
      `    Object.defineProperty($props, ${JSON.stringify(prop)}, { enumerable: true, get: function () {`,
    )
    lines.push(
      `      var v = that.properties[${JSON.stringify(prop)}] !== undefined ? that.properties[${JSON.stringify(prop)}] : that.data[${JSON.stringify(prop)}]`,
    )
    lines.push(`      return v`)
    lines.push(`    } });`)
  }
  for (const name of dataLocals) {
    lines.push(`    var ${name} = that.data[${JSON.stringify(name)}]`)
  }
  lines.push(`    var patch = {}`)
  const baseArgs = ['$props', '$query', '$route', ...dataLocals]
  const computedNames = computed.map((f) => f.name.trim()).filter(isValidIdent)
  for (let i = 0; i < computed.length; i++) {
    const field = computed[i]!
    const name = field.name.trim()
    if (!isValidIdent(name)) continue
    const body = (field.computeBody || '').trim()
    const deps = depsByComputed.get(name) ?? []
    // 后续计算字段可引用前面已算出的值（如 height 用 offsetTop）
    const prior = computedNames.slice(0, i)
    const argList = [...baseArgs, ...prior].join(', ')
    const callList = [
      ...baseArgs,
      ...prior.map(
        (n) =>
          `(patch[${JSON.stringify(n)}] !== undefined ? patch[${JSON.stringify(n)}] : that.data[${JSON.stringify(n)}])`,
      ),
    ].join(', ')

    lines.push(`    var __need_${name} = __force`)
    lines.push(`    if (!__need_${name}) {`)
    if (deps.length) {
      lines.push(`      var __deps_${name} = ${JSON.stringify(deps)}`)
      lines.push(
        `      for (var __d = 0; __d < __deps_${name}.length; __d++) {`,
      )
      lines.push(
        `        if (__dirty[__deps_${name}[__d]]) { __need_${name} = true; break }`,
      )
      lines.push(`      }`)
    }
    lines.push(`    }`)
    lines.push(`    if (__need_${name}) {`)
    lines.push(`      try {`)
    const fieldRemark = lineComment(field.remark || '', '        ')
    if (fieldRemark) lines.push(fieldRemark)
    lines.push(
      `        patch[${JSON.stringify(name)}] = (function (${argList}) {`,
    )
    lines.push(`          "use strict";`)
    for (const line of body.split('\n')) {
      // 小程序部分环境对 computed IIFE 里的 const/let 不友好，统一降成 var
      lines.push(
        `          ${line.replace(/\bconst\b/g, 'var').replace(/\blet\b/g, 'var')}`,
      )
    }
    lines.push(`        })(${callList})`)
    lines.push(`        __dirty[${JSON.stringify(name)}] = true`)
    lines.push(`      } catch (err) {`)
    lines.push(`        console.error('computed ${name} failed', err)`)
    lines.push(
      `        patch[${JSON.stringify(name)}] = that.data[${JSON.stringify(name)}]`,
    )
    lines.push(`      }`)
    // 编辑器侧常用 isFillScreen=false 短路 offsetTop；真机 custom 导航仍须状态栏占位。
    // 导出层保底，避免项目计算体面向预览时把小程序顶栏顶飞。
    if (name === 'offsetTop') {
      lines.push(`      try {`)
      lines.push(`        var __diOff = getDeviceInfo()`)
      lines.push(
        `        var __sbOff = Number(__diOff && __diOff.statusBarHeight) || 0`,
      )
      lines.push(`        if (__sbOff > 0) {`)
      lines.push(
        `          var __curOff = Number(patch[${JSON.stringify(name)}]) || 0`,
      )
      lines.push(
        `          if (__curOff < __sbOff) patch[${JSON.stringify(name)}] = __sbOff`,
      )
      lines.push(`        }`)
      lines.push(`      } catch (__eOff) {}`)
    }
    lines.push(`    }`)
  }
  lines.push(`    var __hasPatch = false`)
  lines.push(`    for (var __k in patch) { if (Object.prototype.hasOwnProperty.call(patch, __k)) { __hasPatch = true; break } }`)
  lines.push(`    if (__hasPatch) this.setData(patch)`)
  lines.push(`  }`)
  return lines.join('\n')
}

type EventBinding = {
  method?: string
  args?: Record<string, unknown>
}

function parseEventBindings(raw: string | undefined): EventBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item) => item && typeof item === 'object' && typeof (item as EventBinding).method === 'string',
    ) as EventBinding[]
  } catch {
    return []
  }
}

function evalArgLiteral(raw: unknown): string {
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (raw == null) return 'null'
  if (typeof raw !== 'string') {
    try {
      return JSON.stringify(raw)
    } catch {
      return 'null'
    }
  }
  const text = raw.trim()
  if (!text) return '""'
  // 已是 JSON 字面量
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']')) ||
    text === 'true' ||
    text === 'false' ||
    text === 'null' ||
    /^-?\d+(\.\d+)?$/.test(text)
  ) {
    return text
  }
  // 标识符 / 简单表达式：原样（运行时从 data/props 取）
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return text
  try {
    JSON.parse(text)
    return text
  } catch {
    return JSON.stringify(text)
  }
}

/** 组件 attached：跑 onMounted 事件链 */
export function generateComponentAttached(
  lifecycle: LifecycleConfig | undefined,
  methodNames: string[],
  options?: { recomputeOnAttach?: boolean },
): string {
  const bindings = parseEventBindings(
    lifecycle?.onMounted || lifecycle?.onCreated || lifecycle?.onInit,
  )
  const methodSet = new Set(methodNames.filter(isValidIdent))
  const stmts: string[] = []

  if (options?.recomputeOnAttach) {
    stmts.push(`    this.__recomputeComputed()`)
  }

  for (const bind of bindings) {
    const method = (bind.method || '').trim()
    if (!method) continue
    const args = bind.args ?? {}

    if (method === 'updateProps') {
      const prop = String(args.prop ?? '').trim()
      const valueExpr = evalArgLiteral(args.value)
      if (!prop || !isValidIdent(prop)) continue
      stmts.push(`    ;(function () {`)
      stmts.push(`      var value = ${valueExpr}`)
      stmts.push(`      var patch = {}`)
      stmts.push(`      patch['${prop}'] = value`)
      stmts.push(`      this.setData(patch)`)
      stmts.push(`      this.triggerEvent('update:' + '${prop}', { value: value })`)
      stmts.push(`    }).call(this)`)
      continue
    }

    if (method === 'setData') {
      const prop = String(args.prop ?? '').trim()
      const valueExpr = evalArgLiteral(args.value)
      if (!prop || !isValidIdent(prop)) continue
      stmts.push(`    this.setData({ ${prop}: ${valueExpr} })`)
      continue
    }

    if (method === 'showToast') {
      const message = evalArgLiteral(args.message ?? args.msg ?? '')
      stmts.push(
        `    wx.showToast({ title: String(${message}), icon: 'none' })`,
      )
      continue
    }

    if (methodSet.has(method)) {
      // 延后到下一宏任务，确保页面 onLoad 里 setData 的 props（如 params）已下发
      stmts.push(
        `    ;(function (that) { setTimeout(function () { that.${method}() }, 0) })(this)`,
      )
      continue
    }
  }

  if (!stmts.length) {
    return `  attached() {},`
  }

  return `  attached() {\n${stmts.join('\n')}\n  },`
}

/** 页面侧双向同步：bind:updateXxx */
export function generatePageSyncHandlers(
  handlers: Array<{ handlerName: string; fieldName: string }>,
): string {
  if (!handlers.length) return ''
  return handlers
    .map(
      ({ handlerName, fieldName }) => `  ${handlerName}(e) {
    var value = e && e.detail ? e.detail.value : undefined
    this.setData({ ${fieldName}: value })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed([${JSON.stringify(fieldName)}])
  }`,
    )
    .join(',\n')
}

function indentBlock(src: string, pad: string): string {
  return src
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n')
}

/** 控制器加载钩子（onLoading / onSuccess / onError / onFinally）→ setData / toast 等 */
function generateControllerHookStmts(
  raw: string | undefined,
  indent: string,
  thatExpr: string,
): string[] {
  const stmts: string[] = []
  for (const bind of parseEventBindings(raw)) {
    const method = (bind.method || '').trim()
    if (!method) continue
    const args = bind.args ?? {}

    if (method === 'setData') {
      const prop = String(args.prop ?? '').trim()
      const valueExpr = evalArgLiteral(args.value)
      if (!prop || !isValidIdent(prop)) continue
      stmts.push(`${indent}${thatExpr}.setData({ ${prop}: ${valueExpr} })`)
      continue
    }

    if (method === 'showToast') {
      const message = evalArgLiteral(args.message ?? args.msg ?? '')
      stmts.push(
        `${indent}wx.showToast({ title: String(${message}), icon: 'none' })`,
      )
      continue
    }

    if (isValidIdent(method) && method !== '__custom__') {
      stmts.push(`${indent}${thatExpr}.${method}()`)
    }
  }
  return stmts
}

/**
 * 页面 onLoad：自动拉取 binding===controller 的数据池字段。
 * 「加载事件」onLoading/onSuccess/onError/onFinally 是可选钩子，空配置仍会请求。
 */
export function generateControllerBoundPageLoad(options: {
  fields: DataField[]
  resolveApi: (raw: string) => MpApiBinding | null
}): {
  methods: string
  /** 本页用到的 API（写入 apis/，不再塞进 data） */
  usedApis: MpApiBinding[]
  hasLoader: boolean
} {
  const usedApis: MpApiBinding[] = []
  const loadBlocks: string[] = []
  const moduleVars = new Map<string, string>()

  for (const field of options.fields ?? []) {
    if (field.binding !== 'controller') continue
    const cfg = field.controllerBinding
    const name = field.name.trim()
    if (!cfg || !name || !isValidIdent(name)) continue
    const serviceId = cfg.serviceId?.trim() ?? ''
    const controllerId = cfg.controllerId?.trim() ?? ''
    const apiId = cfg.apiId?.trim() ?? ''
    if (!serviceId || !controllerId || !apiId) continue

    const resolved = options.resolveApi(
      JSON.stringify({ serviceId, controllerId, apiId }),
    )
    if (!resolved || !resolved.path) continue
    usedApis.push(resolved)

    const moduleRel = apiModuleRelPath(resolved)
    const exportName = apiMethodExportName(resolved)
    let moduleVar = moduleVars.get(moduleRel)
    if (!moduleVar) {
      moduleVar = `__apiMod${moduleVars.size}`
      moduleVars.set(moduleRel, moduleVar)
    }

    const argLines: string[] = [`          var args = {}`]
    for (const [varName, inp] of Object.entries(cfg.inputs ?? {})) {
      const key = varName.trim()
      if (!key || !isValidIdent(key)) continue
      if (!inp || inp.source !== 'binding') {
        const lit =
          inp && 'literal' in inp ? JSON.stringify(inp.literal ?? null) : 'undefined'
        argLines.push(`          args[${JSON.stringify(key)}] = ${lit}`)
        continue
      }
      const path = (inp.binding ?? '').trim()
      argLines.push(
        `          args[${JSON.stringify(key)}] = that.__resolveCtrlBinding(${JSON.stringify(path)}, query)`,
      )
    }

    const parseBody = (cfg.parseBody ?? '').trim()
    const parseCall = parseBody
      ? `(function (data) {\n${indentBlock(parseBody, '            ')}\n          })(data)`
      : 'data'

    const loadingStmts = generateControllerHookStmts(cfg.onLoading, '          ', 'that')
    const successStmts = generateControllerHookStmts(cfg.onSuccess, '          ', 'that')
    const errorStmts = generateControllerHookStmts(cfg.onError, '          ', 'that')
    const finallyStmts = generateControllerHookStmts(cfg.onFinally, '          ', 'that')

    const fieldRemark = lineComment(field.remark || '', '    ')
    const remarkPrefix = fieldRemark ? `${fieldRemark}\n` : ''

    loadBlocks.push(`${remarkPrefix}    tasks.push(
      Promise.resolve()
        .then(function () {
${loadingStmts.length ? `${loadingStmts.join('\n')}\n` : ''}${argLines.join('\n')}
          return ${moduleVar}.${exportName}(args)
        })
        .then(function (data) {
          var parsed = ${parseCall}
          var patch = {}
          patch[${JSON.stringify(name)}] = parsed
          that.setData(patch)
          if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed([${JSON.stringify(name)}])
${successStmts.length ? `${successStmts.join('\n')}\n` : ''}        })
        .catch(function (err) {
          console.error(${JSON.stringify(`[voider] controller ${name}`)}, err)
${errorStmts.length ? `${errorStmts.join('\n')}\n` : ''}        })
        .then(function () {
${finallyStmts.length ? `${finallyStmts.join('\n')}\n` : ''}        })
    )`)
  }

  if (!loadBlocks.length) {
    return { methods: '', usedApis: [], hasLoader: false }
  }

  const requireLines = [...moduleVars.entries()]
    .map(
      ([moduleRel, varName]) =>
        `    var ${varName} = require(${JSON.stringify('../../' + moduleRel)})`,
    )
    .join('\n')

  const methods = `  __resolveCtrlBinding(path, query) {
    var p = String(path == null ? '' : path).trim()
    if (!p) return undefined
    var root = null
    var rest = ''
    if (p === '$query' || p === 'query' || p === '$route' || p === 'route') {
      return query || {}
    }
    if (p.indexOf('$query.') === 0) {
      root = query || {}
      rest = p.slice(7)
    } else if (p.indexOf('query.') === 0) {
      root = query || {}
      rest = p.slice(6)
    } else if (p.indexOf('$route.') === 0) {
      root = query || {}
      rest = p.slice(7)
    } else if (p.indexOf('route.') === 0) {
      root = query || {}
      rest = p.slice(6)
    } else {
      root = this.data
      rest = p
    }
    if (!rest) return root
    var parts = rest.split('.')
    var cur = root
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = cur[parts[i]]
    }
    return cur
  },
  __loadControllerBoundData(options) {
    var that = this
${requireLines}
    var query = options || {}
    var tasks = []
${loadBlocks.join('\n')}
    return Promise.all(tasks)
  }`

  return { methods, usedApis, hasLoader: true }
}
