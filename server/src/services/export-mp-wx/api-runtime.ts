/** 导出到小程序的 `utils/api.js` 源码 */

export function generateApiJs(): string {
  return `/**
 * 网络请求：wx.request 封装
 * base: getApp().globalData.apiBaseUrls[serviceName|default]
 */

function unwrapResult(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  if (!('data' in data)) return data
  var keys = Object.keys(data)
  var looksLikeResult =
    'code' in data || 'message' in data || 'msg' in data || keys.length <= 4
  return looksLikeResult ? data.data : data
}

function serializeQuery(data) {
  var out = {}
  if (!data || typeof data !== 'object') return out
  Object.keys(data).forEach(function (k) {
    var v = data[k]
    if (v == null) return
    if (typeof v === 'object') {
      try {
        out[k] = JSON.stringify(v)
      } catch (e) {
        out[k] = String(v)
      }
    } else {
      out[k] = v
    }
  })
  return out
}

function resolveApiBase(serviceName) {
  var app = typeof getApp === 'function' ? getApp() : null
  var g = (app && app.globalData) || {}
  var map = g.apiBaseUrls && typeof g.apiBaseUrls === 'object' ? g.apiBaseUrls : {}
  var keys = [serviceName, 'default', 'oss']
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i]
    if (!k || typeof k !== 'string') continue
    var v = map[k]
    if (typeof v === 'string' && v.trim()) {
      return String(v).replace(/\\/+$/, '')
    }
  }
  var values = Object.keys(map).map(function (key) { return map[key] })
  for (var j = 0; j < values.length; j++) {
    if (typeof values[j] === 'string' && values[j].trim()) {
      return String(values[j]).replace(/\\/+$/, '')
    }
  }
  return ''
}

/**
 * @param {string} method GET|POST|...
 * @param {string} path 如 /goodsRemark/page
 * @param {object} [args] 请求参数
 * @param {string} [serviceName] 对应 apiBaseUrls 的 key，默认 default
 */
function request(method, path, args, serviceName) {
  var p = typeof path === 'string' ? path.trim() : ''
  if (!p) {
    return Promise.reject(new Error('API path missing'))
  }
  var base = resolveApiBase(serviceName)
  if (!base && p.indexOf('http://') !== 0 && p.indexOf('https://') !== 0) {
    return Promise.reject(
      new Error(
        'API baseUrl missing' +
          (serviceName ? ' for ' + serviceName : '') +
          '（请在 app.js globalData.apiBaseUrls 配置）',
      ),
    )
  }
  var url =
    p.indexOf('http://') === 0 || p.indexOf('https://') === 0
      ? p
      : base + (p.charAt(0) === '/' ? p : '/' + p)

  var m = String(method || 'GET').toUpperCase()
  var payload = args && typeof args === 'object' ? args : {}

  return new Promise(function (resolve, reject) {
    var opts = {
      url: url,
      method: m,
      header: { 'content-type': 'application/json' },
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(unwrapResult(res.data))
        } else {
          var msg =
            (res.data && (res.data.message || res.data.msg)) ||
            'request failed ' + res.statusCode
          reject(new Error(String(msg)))
        }
      },
      fail: function (err) {
        reject(err || new Error('network error'))
      },
    }
    if (m === 'GET' || m === 'DELETE') {
      opts.data = serializeQuery(payload)
    } else {
      opts.data = payload
    }
    wx.request(opts)
  })
}

/** 组件 api prop：传入注册表 key（如 shop/goods.page）时走 apis/index */
function invoke(keyOrFn, args) {
  if (typeof keyOrFn === 'function') {
    return keyOrFn(args)
  }
  if (typeof keyOrFn === 'string') {
    var key = keyOrFn.trim()
    if (!key) {
      return Promise.reject(new Error('API key missing'))
    }
    var registry
    try {
      registry = require('../apis/index.js')
    } catch (e) {
      return Promise.reject(new Error('apis/index.js missing'))
    }
    var fn = registry && registry[key]
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('API not found: ' + key))
    }
    return fn(args)
  }
  return Promise.reject(new Error('API invoke target invalid'))
}

${getDeviceInfoFnSource()}

module.exports = {
  request: request,
  invoke: invoke,
  resolveApiBase: resolveApiBase,
  getDeviceInfo: getDeviceInfo,
}
`
}

function getDeviceInfoFnSource(): string {
  return `function readStatusBarHeight() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      var w = wx.getWindowInfo()
      var n = Number(w && w.statusBarHeight)
      if (isFinite(n) && n >= 0) return n
    }
  } catch (e) {}
  try {
    var sys = wx.getSystemInfoSync()
    var h = Number(sys && sys.statusBarHeight)
    if (isFinite(h) && h >= 0) return h
  } catch (e2) {}
  return 20
}

function readMenuButton() {
  var status = readStatusBarHeight()
  var fallback = {
    width: 87,
    height: 32,
    top: status + 6,
    right: 0,
    bottom: status + 38,
    left: 0,
  }
  try {
    if (typeof wx.getMenuButtonBoundingClientRect !== 'function') return fallback
    var rect = wx.getMenuButtonBoundingClientRect()
    if (!rect || typeof rect !== 'object') return fallback
    var height = Number(rect.height) || 0
    var top = Number(rect.top) || 0
    if (!(height > 0)) return fallback
    return {
      width: Number(rect.width) || fallback.width,
      height,
      top: top || fallback.top,
      right: Number(rect.right) || 0,
      bottom: Number(rect.bottom) || 0,
      left: Number(rect.left) || 0,
    }
  } catch (e) {
    return fallback
  }
}

function getDeviceInfo() {
  return {
    statusBarHeight: readStatusBarHeight(),
    userAgent: '',
    menuButton: readMenuButton(),
    platform: 'miniprogram',
  }
}`
}

/** 兼容旧路径；完整实现避免二次 require 失败 */
export function generateDeviceJs(): string {
  return `/**
 * getDeviceInfo (miniprogram)
 */
${getDeviceInfoFnSource()}

module.exports = {
  getDeviceInfo,
}
`
}

/** 页面/组件事件与自定义方法共用的预置能力 */
export function generateRuntimeJs(): string {
  return `/**
 * 设计器预置方法（navigateTo / showToast 等）
 * 页面与组件通过 require('../../utils/runtime.js') 引用，勿在各 handler 内复制。
 */

function showToast(message, duration) {
  wx.showToast({
    title: String(message == null ? '' : message),
    icon: 'none',
    duration: duration === 'long' ? 3000 : 1500,
  })
}

function navigateTo(to, params) {
  var url =
    '/pages/' + String(to == null ? '' : to).replace(/^\\/+/, '') + '/index'
  if (params && typeof params === 'object') {
    var qs = []
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue
      var v = params[k]
      if (v == null || v === '') continue
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    }
    if (qs.length) url += '?' + qs.join('&')
  }
  wx.navigateTo({ url: url })
}

function navigateBack() {
  wx.navigateBack()
}

/** 绑定页面/组件实例的 setData(prop, value)；写入后按 prop 选择性重算 */
function createSetData(that, opts) {
  return function setData(prop, value) {
    if (that.data[prop] === value) return
    var patch = {}
    patch[prop] = value
    // this.data 同步更新；先重算依赖字段（如 pagerParams），再交给视图层
    that.setData(patch)
    if (typeof that.__recomputeComputed === 'function') {
      that.__recomputeComputed([prop])
    }
  }
}

module.exports = {
  showToast: showToast,
  navigateTo: navigateTo,
  navigateBack: navigateBack,
  createSetData: createSetData,
}
`
}

export type MpApiBinding = {
  serviceId: string
  /** 服务名，便于 apiBaseUrls 用可读 key */
  serviceName?: string
  controllerId: string
  /** 控制器名，用于 apis/{service}/{controller}.js */
  controllerName?: string
  apiId: string
  /** API 方法名，导出为同名函数 */
  apiName?: string
  /** 接口说明（导出为注释） */
  remark?: string
  /** 入参说明：varName → remark */
  inputRemarks?: Array<{ name: string; remark: string }>
  method: string
  path: string
}

/** shop / goods-remark */
export function slugifyApiSegment(name: string, fallback: string): string {
  const raw = String(name || '').trim()
  if (!raw) return fallback
  const kebab = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return kebab || fallback
}

/** 合法 JS 导出名 */
export function apiMethodExportName(binding: MpApiBinding): string {
  const raw = String(binding.apiName || '').trim()
  if (/^[A-Za-z_$][\w$]*$/.test(raw)) return raw
  const fromId = String(binding.apiId || '')
    .replace(/^api[_-]?/i, '')
    .replace(/[^A-Za-z0-9_$]+/g, '_')
  if (/^[A-Za-z_$][\w$]*$/.test(fromId)) return fromId
  return 'request'
}

export function apiServiceSlug(binding: MpApiBinding): string {
  return slugifyApiSegment(
    binding.serviceName || binding.serviceId,
    'service',
  )
}

export function apiControllerSlug(binding: MpApiBinding): string {
  return slugifyApiSegment(
    binding.controllerName || binding.controllerId,
    'resource',
  )
}

/** apis/shop/goods.js */
export function apiModuleRelPath(binding: MpApiBinding): string {
  return `apis/${apiServiceSlug(binding)}/${apiControllerSlug(binding)}.js`
}

/** shop/goods.one — 组件 api prop / invoke 注册表 key */
export function apiRefKey(binding: MpApiBinding): string {
  return `${apiServiceSlug(binding)}/${apiControllerSlug(binding)}.${apiMethodExportName(binding)}`
}

/** 转义注释内容，避免提前结束块注释 */
function escapeJsComment(text: string): string {
  return String(text || '')
    .replace(/\*\//g, '*\\/')
    .replace(/\r\n/g, '\n')
    .trim()
}

function buildApiMethodJsDoc(binding: MpApiBinding): string[] {
  const method = String(binding.method || 'GET').toUpperCase()
  const path = binding.path || ''
  const remark = escapeJsComment(binding.remark || '')
  const lines: string[] = ['/**']
  if (remark) {
    for (const line of remark.split('\n')) {
      lines.push(` * ${line}`)
    }
  }
  lines.push(` * ${method} ${path}`)
  const inputs = binding.inputRemarks ?? []
  if (inputs.length) {
    lines.push(` *`)
    lines.push(` * @param {object} [args]`)
    for (const inp of inputs) {
      const r = escapeJsComment(inp.remark)
      lines.push(` * @param {*} [args.${inp.name}] ${r}`)
    }
  }
  lines.push(` */`)
  return lines
}

/**
 * 生成 apis/{service}/{controller}.js 与 apis/index.js
 */
export function generateApisFiles(
  bindings: MpApiBinding[],
): Record<string, string> {
  const byModule = new Map<string, Map<string, MpApiBinding>>()
  const registry: Array<{ key: string; moduleRel: string; exportName: string }> =
    []

  for (const b of bindings) {
    if (!b?.path?.trim()) continue
    const moduleRel = apiModuleRelPath(b)
    const exportName = apiMethodExportName(b)
    const key = apiRefKey(b)
    if (!byModule.has(moduleRel)) byModule.set(moduleRel, new Map())
    const methods = byModule.get(moduleRel)!
    // 同名方法保留首次（同一 apiId 通常一致）
    if (!methods.has(exportName)) methods.set(exportName, b)
    if (!registry.some((r) => r.key === key)) {
      registry.push({ key, moduleRel, exportName })
    }
  }

  const files: Record<string, string> = {}
  for (const [moduleRel, methods] of byModule) {
    const lines: string[] = [
      `/** ${moduleRel} — 由设计器导出 */`,
      `var api = require('../../utils/api.js')`,
      ``,
    ]
    // 同一模块内服务名通常一致，取第一个有值的
    let serviceName = ''
    for (const b of methods.values()) {
      if (b.serviceName?.trim()) {
        serviceName = b.serviceName.trim()
        break
      }
    }
    for (const [exportName, b] of methods) {
      const method = JSON.stringify(String(b.method || 'GET').toUpperCase())
      const pathLit = JSON.stringify(b.path)
      const svcLit = JSON.stringify(serviceName || apiServiceSlug(b))
      lines.push(...buildApiMethodJsDoc(b))
      lines.push(`function ${exportName}(args) {`)
      lines.push(
        `  return api.request(${method}, ${pathLit}, args, ${svcLit})`,
      )
      lines.push(`}`)
      lines.push(``)
    }
    lines.push(`module.exports = {`)
    for (const exportName of methods.keys()) {
      lines.push(`  ${exportName}: ${exportName},`)
    }
    lines.push(`}`)
    lines.push(``)
    files[moduleRel] = lines.join('\n')
  }

  const indexLines: string[] = [
    `/** API 注册表：key → 方法（组件 api prop / api.invoke(key)） */`,
    ``,
  ]
  const imported = new Map<string, string>()
  let i = 0
  for (const row of registry) {
    if (!imported.has(row.moduleRel)) {
      const varName = `__m${i++}`
      imported.set(row.moduleRel, varName)
      indexLines.push(
        `var ${varName} = require(${JSON.stringify('./' + row.moduleRel.replace(/^apis\//, ''))})`,
      )
    }
  }
  indexLines.push(``)
  indexLines.push(`module.exports = {`)
  for (const row of registry) {
    const varName = imported.get(row.moduleRel)!
    indexLines.push(
      `  ${JSON.stringify(row.key)}: ${varName}.${row.exportName},`,
    )
  }
  indexLines.push(`}`)
  indexLines.push(``)
  files['apis/index.js'] = indexLines.join('\n')

  return files
}

export type ApiPropBindingIds = {
  serviceId: string
  controllerId: string
  apiId: string
}

export function parseApiPropBinding(
  raw: string | undefined | null,
): ApiPropBindingIds | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    const serviceId = typeof row.serviceId === 'string' ? row.serviceId.trim() : ''
    const controllerId =
      typeof row.controllerId === 'string' ? row.controllerId.trim() : ''
    const apiId = typeof row.apiId === 'string' ? row.apiId.trim() : ''
    if (!serviceId || !controllerId || !apiId) return null
    return { serviceId, controllerId, apiId }
  } catch {
    return null
  }
}

export function joinControllerApiPath(
  controllerPath: string,
  apiPath: string,
): string {
  const a = (controllerPath || '').trim().replace(/\/+$/, '')
  const b = (apiPath || '').trim()
  if (!b) return a || '/'
  if (/^https?:\/\//i.test(b)) return b
  if (b.startsWith('/')) return `${a}${b}` || b
  return a ? `${a}/${b}` : `/${b}`
}
