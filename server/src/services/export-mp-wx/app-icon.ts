import type { IconLibrary } from '../../types/icon-library.js'
import type { OssLibrary } from '../../types/oss.js'
import {
  buildIconSvg,
  iconRemoteExportMaps,
  isRemoteIcon,
} from '../export-vue3/icon-export.js'

const SIGN_EXPIRES_IN = 7 * 24 * 3600

/** 微信小程序：本地 SVG 打进代码；外链不打包，私有桶运行时签名并缓存到 Storage */
export function generateAppIconFiles(
  library: IconLibrary,
  ossLibrary?: OssLibrary | null,
): Record<string, string> {
  const icons: Record<string, string> = {}
  for (const icon of library.icons) {
    if (isRemoteIcon(icon)) continue
    icons[icon.id] = buildIconSvg(icon).trim()
  }
  const { publicUrls, privateBindings } = iconRemoteExportMaps(library, ossLibrary)

  const iconsLiteral = JSON.stringify(icons, null, 2)
  const publicLiteral = JSON.stringify(publicUrls, null, 2)
  const privateLiteral = JSON.stringify(privateBindings, null, 2)

  return {
    'components/app-icon/index.json': `${JSON.stringify(
      {
        component: true,
        styleIsolation: 'apply-shared',
      },
      null,
      2,
    )}\n`,
    'components/app-icon/index.wxml': `<image src="{{src}}" mode="aspectFit" class="app-icon-img" />\n`,
    'components/app-icon/index.wxss': `.app-icon-img {
  display: block;
  width: 100%;
  height: 100%;
}
`,
    'components/app-icon/index.js': `const ICONS = ${iconsLiteral}
const REMOTE_URLS = ${publicLiteral}
const PRIVATE_BINDINGS = ${privateLiteral}
const SIGN_EXPIRES_IN = ${SIGN_EXPIRES_IN}
/** 提前 1 小时视为过期，避免边界失效 */
const CACHE_SKEW_MS = 60 * 60 * 1000

function storageKey(iconId, objectKey) {
  return 'icon_url_' + iconId + '_' + String(objectKey || '')
}

function readCachedUrl(iconId, objectKey) {
  try {
    var raw = wx.getStorageSync(storageKey(iconId, objectKey))
    if (!raw) return ''
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!data || typeof data.url !== 'string' || !data.url) return ''
    var expiresAt = Number(data.expiresAt) || 0
    if (expiresAt && expiresAt <= Date.now() + CACHE_SKEW_MS) return ''
    return data.url
  } catch (e) {
    return ''
  }
}

function writeCachedUrl(iconId, objectKey, url, expiresInSec) {
  try {
    var ttl = Number(expiresInSec)
    if (!Number.isFinite(ttl) || ttl <= 0) ttl = SIGN_EXPIRES_IN
    wx.setStorageSync(storageKey(iconId, objectKey), {
      url,
      expiresAt: Date.now() + ttl * 1000,
      objectKey: objectKey || '',
    })
  } catch (e) {
    // storage 满或不可用时忽略
  }
}

function tintSvg(svg, color) {
  const fill = String(color || '').trim() || '#333333'
  return String(svg || '')
    .replace(/currentColor/g, fill)
    .replace(/\\sfill="#(?:[Ff]{3}|[Ff]{6}|FFFFFF|ffffff)"/g, ' fill="transparent"')
}

function toDataUri(svg, color) {
  if (!svg) return ''
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tintSvg(svg, color))
}

function apiBase() {
  var app = typeof getApp === 'function' ? getApp() : null
  var g = (app && app.globalData) || {}
  var map = g.apiBaseUrls && typeof g.apiBaseUrls === 'object' ? g.apiBaseUrls : {}
  var keys = ['oss', 'default']
  for (var i = 0; i < keys.length; i++) {
    var v = map[keys[i]]
    if (typeof v === 'string' && v.trim()) return String(v).replace(/\\/+$/, '')
  }
  var all = Object.keys(map)
  for (var j = 0; j < all.length; j++) {
    var u = map[all[j]]
    if (typeof u === 'string' && u.trim()) return String(u).replace(/\\/+$/, '')
  }
  return ''
}

function fetchText(url) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url,
      method: 'GET',
      dataType: 'text',
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300 && typeof res.data === 'string') {
          resolve(res.data)
          return
        }
        reject(new Error('HTTP ' + res.statusCode))
      },
      fail: function (err) {
        reject(err || new Error('request failed'))
      },
    })
  })
}

function signPrivate(binding) {
  return new Promise(function (resolve, reject) {
    var base = apiBase()
    if (!base) {
      reject(new Error('apiBaseUrls missing（OSS 签名需要 default/oss）'))
      return
    }
    var header = { 'content-type': 'application/json' }
    wx.request({
      url: base + '/oss/sign',
      method: 'POST',
      header,
      data: {
        connectionId: binding.connectionId,
        bucketName: binding.bucketName,
        key: binding.objectKey,
        expiresIn: SIGN_EXPIRES_IN,
      },
      success: function (res) {
        var body = res.data
        var signed =
          (body &&
            body.data &&
            (typeof body.data.signedUrl === 'string'
              ? body.data.signedUrl
              : typeof body.data.url === 'string'
                ? body.data.url
                : '')) ||
          (body && typeof body.signedUrl === 'string'
            ? body.signedUrl
            : body && typeof body.url === 'string'
              ? body.url
              : '')
        var exp =
          body && body.data && body.data.expiresIn != null
            ? Number(body.data.expiresIn)
            : body && body.expiresIn != null
              ? Number(body.expiresIn)
              : SIGN_EXPIRES_IN
        if (res.statusCode >= 200 && res.statusCode < 300 && signed) {
          resolve({ url: signed, expiresIn: exp })
          return
        }
        var msg =
          (body && body.code !== 0 && (body.message || body.msg)) ||
          (!signed ? '签名响应缺少 url' : '') ||
          'HTTP ' + res.statusCode
        reject(new Error(String(msg)))
      },
      fail: function (err) {
        reject(err || new Error('sign failed'))
      },
    })
  })
}

function resolveRemoteUrl(iconId, publicUrl, privateBinding) {
  if (publicUrl) {
    var cachedPublic = readCachedUrl(iconId, 'public')
    if (cachedPublic) {
      return Promise.resolve(cachedPublic)
    }
    writeCachedUrl(iconId, 'public', publicUrl, SIGN_EXPIRES_IN)
    return Promise.resolve(publicUrl)
  }
  if (!privateBinding) return Promise.resolve('')
  var objectKey = privateBinding.objectKey || ''
  var cached = readCachedUrl(iconId, objectKey)
  if (cached) return Promise.resolve(cached)
  return signPrivate(privateBinding).then(function (result) {
    writeCachedUrl(iconId, objectKey, result.url, result.expiresIn)
    return result.url
  })
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'apply-shared',
  },
  properties: {
    name: { type: String, value: '' },
    color: { type: String, value: '#333333' },
  },
  data: {
    src: '',
  },
  lifetimes: {
    created() {
      this._svgCache = Object.create(null)
      this._fetchToken = 0
    },
  },
  observers: {
    'name, color': function (name, color) {
      const id = String(name || '').trim()
      if (!id) {
        this.setData({ src: '' })
        return
      }
      if (ICONS[id]) {
        this.setData({ src: toDataUri(ICONS[id], color) })
        return
      }
      const cached = this._svgCache[id]
      if (cached) {
        this.setData({ src: toDataUri(cached, color) })
        return
      }
      const token = ++this._fetchToken
      const self = this
      const publicUrl = REMOTE_URLS[id]
      const privateBinding = PRIVATE_BINDINGS[id]

      function applySvg(text) {
        if (token !== self._fetchToken) return
        if (!text) {
          self.setData({ src: '' })
          return
        }
        self._svgCache[id] = text
        self.setData({ src: toDataUri(text, color) })
      }

      if (!publicUrl && !privateBinding) {
        this.setData({ src: '' })
        return
      }

      resolveRemoteUrl(id, publicUrl, privateBinding)
        .then(function (url) {
          if (!url) throw new Error('empty url')
          return fetchText(url)
        })
        .then(applySvg)
        .catch(function () {
          if (token !== self._fetchToken) return
          // 缓存外链可能已失效：清掉后重签一次
          try {
            var key = privateBinding
              ? storageKey(id, privateBinding.objectKey || '')
              : storageKey(id, 'public')
            wx.removeStorageSync(key)
          } catch (e) {}
          if (!privateBinding) {
            self.setData({ src: '' })
            return
          }
          signPrivate(privateBinding)
            .then(function (result) {
              writeCachedUrl(id, privateBinding.objectKey || '', result.url, result.expiresIn)
              return fetchText(result.url)
            })
            .then(applySvg)
            .catch(function () {
              if (token !== self._fetchToken) return
              self.setData({ src: '' })
            })
        })
    },
  },
})
`,
  }
}
