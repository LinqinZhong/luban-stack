Component({
  options: {
    multipleSlots: true,
    virtualHost: true,
  },
  properties: {
    "title": {
      type: String,
      value: "标题"
    },
    "showBack": {
      type: Boolean,
      value: true
    },
    "background": {
      type: String,
      value: "#ffffff"
    },
    "color": {
      type: String,
      value: "#000000"
    },
    "isFillScreen": {
      type: Boolean,
      value: false
    }
  },
  data: {
    "offsetTop": 0,
    "height": 0
  },
  observers: {
    'title, showBack, background, color, isFillScreen': function () {
      this.__recomputeComputed()
    },
  },
  lifetimes: {
  attached() {
    this.__recomputeComputed()
  },
  },
  methods: {
  __onEvt_0(e) {
    wx.navigateBack()
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __recomputeComputed: function () {
    var that = this
    var getDeviceInfo = require('../../utils/voider-api.js').getDeviceInfo
    var $props = {}
    Object.defineProperty($props, "title", { enumerable: true, get: function () {
      var v = that.properties["title"] !== undefined ? that.properties["title"] : that.data["title"]
      return v
    } });
    Object.defineProperty($props, "showBack", { enumerable: true, get: function () {
      var v = that.properties["showBack"] !== undefined ? that.properties["showBack"] : that.data["showBack"]
      return v
    } });
    Object.defineProperty($props, "background", { enumerable: true, get: function () {
      var v = that.properties["background"] !== undefined ? that.properties["background"] : that.data["background"]
      return v
    } });
    Object.defineProperty($props, "color", { enumerable: true, get: function () {
      var v = that.properties["color"] !== undefined ? that.properties["color"] : that.data["color"]
      return v
    } });
    Object.defineProperty($props, "isFillScreen", { enumerable: true, get: function () {
      var v = that.properties["isFillScreen"] !== undefined ? that.properties["isFillScreen"] : that.data["isFillScreen"]
      return v
    } });
    var patch = {}
    try {
      patch["offsetTop"] = (function ($props) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        var info = getDeviceInfo()
        // 小程序自定义导航从屏幕顶部绘制，必须预留状态栏；
        // H5 仅在沉浸模式（isFillScreen）下预留
        if (info.platform === 'miniprogram' || ($props.isFillScreen && info.platform !== 'h5')) {
          return info.statusBarHeight || 0
        }
        return 0
      })($props)
    } catch (err) {
      console.error('computed offsetTop failed', err)
      patch["offsetTop"] = that.data["offsetTop"]
    }
    try {
      patch["height"] = (function ($props, offsetTop) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        var info = getDeviceInfo()
        if (info.platform === 'h5') {
          return 45
        }
        var mb = info.menuButton
        if (!mb) {
          return offsetTop + 44
        }
        // 胶囊相对状态栏的上间距，导航区上下对称：gap + capsule + gap
        var gap = Math.max(0, (mb.top || 0) - (info.statusBarHeight || 0))
        return offsetTop + (mb.height || 32) + gap * 2
      })($props, patch["offsetTop"])
    } catch (err) {
      console.error('computed height failed', err)
      patch["height"] = that.data["height"]
    }
    this.setData(patch)
  }
  },
})
