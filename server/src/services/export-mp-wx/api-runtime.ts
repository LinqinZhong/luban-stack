/** 导出到小程序的 `utils/api.js` 源码 */

export function generateApiJs(): string {
  return `/**
 * runtime: wx.request API + getDeviceInfo
 * binding: { serviceId, serviceName?, controllerId, apiId, method, path }
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

function resolveApiBase(serviceId, serviceName) {
  var app = typeof getApp === 'function' ? getApp() : null
  var g = (app && app.globalData) || {}
  var map = g.apiBaseUrls && typeof g.apiBaseUrls === 'object' ? g.apiBaseUrls : {}
  var keys = [serviceName, serviceId, 'default', 'oss']
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
 * @param {object|null|undefined} binding
 * @param {object} [args]
 * @returns {Promise<any>}
 */
function invoke(binding, args) {
  if (!binding || typeof binding !== 'object') {
    return Promise.reject(new Error('API binding missing'))
  }
  var path = typeof binding.path === 'string' ? binding.path.trim() : ''
  if (!path) {
    return Promise.reject(
      new Error(
        'API missing path (serviceId=' +
          (binding.serviceId || '') +
          ', apiId=' +
          (binding.apiId || '') +
          ')',
      ),
    )
  }

  var base = resolveApiBase(binding.serviceId, binding.serviceName)
  if (!base) {
    return Promise.reject(
      new Error(
        'API baseUrl missing for serviceId=' +
          (binding.serviceId || '') +
          '（请在 app.js globalData.apiBaseUrls 配置）',
      ),
    )
  }
  var url = path.indexOf('http://') === 0 || path.indexOf('https://') === 0
    ? path
    : base + (path.charAt(0) === '/' ? path : '/' + path)

  var method = String(binding.method || 'GET').toUpperCase()
  var payload = args && typeof args === 'object' ? args : {}

  var header = {
    'content-type': 'application/json',
  }

  return new Promise(function (resolve, reject) {
    var opts = {
      url,
      method,
      header,
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
    if (method === 'GET' || method === 'DELETE') {
      opts.data = serializeQuery(payload)
    } else {
      opts.data = payload
    }
    wx.request(opts)
  })
}

${getDeviceInfoFnSource()}

module.exports = {
  invoke,
  resolveApiBase,
  getDeviceInfo,
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

export type MpApiBinding = {
  serviceId: string
  /** 服务名，便于 apiBaseUrls 用可读 key */
  serviceName?: string
  controllerId: string
  apiId: string
  method: string
  path: string
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
