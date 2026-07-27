/**
 * Voider getDeviceInfo (miniprogram)
 */
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
  getDeviceInfo: getDeviceInfo,
}
