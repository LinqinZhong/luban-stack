/**
 * Voider runtime: wx.request API + getDeviceInfo
 * binding: { serviceId, controllerId, apiId, method, path }
 * base: getApp().globalData.apiBaseUrl (default http://127.0.0.1:6630)
 * project: getApp().globalData.projectPath -> header X-Voider-Project
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

  var app = typeof getApp === 'function' ? getApp() : null
  var g = (app && app.globalData) || {}
  var base =
    (typeof g.apiBaseUrl === 'string' ? g.apiBaseUrl : '') ||
    'http://127.0.0.1:6630'
  base = String(base).replace(/\/+$/, '')
  var url = path.indexOf('http://') === 0 || path.indexOf('https://') === 0
    ? path
    : base + (path.charAt(0) === '/' ? path : '/' + path)

  var method = String(binding.method || 'GET').toUpperCase()
  var payload = args && typeof args === 'object' ? args : {}
  var projectPath = typeof g.projectPath === 'string' ? g.projectPath : ''

  var header = {
    'content-type': 'application/json',
  }
  if (projectPath) {
    header['X-Voider-Project'] = projectPath
  }

  return new Promise(function (resolve, reject) {
    var opts = {
      url: url,
      method: method,
      header: header,
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

function readStatusBarHeight() {
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
      height: height,
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
}

module.exports = {
  invoke: invoke,
  getDeviceInfo: getDeviceInfo,
}
