Page({
  data: {
    "titleBarOpacity": 0,
    "titleBarColor": "",
    "titleTextColor": "",
    "statusBarColor": ""
  },
  onLoad() {
    this.__recomputeComputed()
  },
  onShow() {},
  onReady() {},
  __onEvt_0(e) {
    this.setData({ titleBarOpacity: (e && e.detail && e.detail.scrollTop != null) ? e.detail.scrollTop : 0 })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __onClick_1(e) {
    var that = this
    var setData = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
    }
    var showToast = function (message, duration) {
      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })
    }
    var titleBarOpacity = that.data.titleBarOpacity
    var titleBarColor = that.data.titleBarColor
    var titleTextColor = that.data.titleTextColor
    var specSelectRef = that.data.specSelectRef
    var statusBarColor = that.data.statusBarColor
    specSelectRef.open()
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
  },
  __onClick_2(e) {
    var that = this
    var setData = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
    }
    var showToast = function (message, duration) {
      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })
    }
    var titleBarOpacity = that.data.titleBarOpacity
    var titleBarColor = that.data.titleBarColor
    var titleTextColor = that.data.titleTextColor
    var specSelectRef = that.data.specSelectRef
    var statusBarColor = that.data.statusBarColor
    specSelectRef.open()
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
  },
  __recomputeComputed: function () {
    var that = this
    var $props = {}
    var titleBarOpacity = that.data["titleBarOpacity"]
    var specSelectRef = that.data["specSelectRef"]
    var patch = {}
    try {
      patch["titleBarColor"] = (function ($props, titleBarOpacity, specSelectRef) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        return `rgba(255, 255, 255, ${titleBarOpacity})`
      })($props, titleBarOpacity, specSelectRef)
    } catch (err) {
      console.error('computed titleBarColor failed', err)
      patch["titleBarColor"] = that.data["titleBarColor"]
    }
    try {
      patch["titleTextColor"] = (function ($props, titleBarOpacity, specSelectRef, titleBarColor) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        var a = 255 * (1 - titleBarOpacity)
        return `rgb(${a}, ${a}, ${a})`
      })($props, titleBarOpacity, specSelectRef, patch["titleBarColor"])
    } catch (err) {
      console.error('computed titleTextColor failed', err)
      patch["titleTextColor"] = that.data["titleTextColor"]
    }
    try {
      patch["statusBarColor"] = (function ($props, titleBarOpacity, specSelectRef, titleBarColor, titleTextColor) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        return titleBarOpacity > 0.5 ? 'black' : 'white'
      })($props, titleBarOpacity, specSelectRef, patch["titleBarColor"], patch["titleTextColor"])
    } catch (err) {
      console.error('computed statusBarColor failed', err)
      patch["statusBarColor"] = that.data["statusBarColor"]
    }
    this.setData(patch)
    try {
      var __sb = patch["statusBarColor"]
      if (__sb === undefined) __sb = that.data["statusBarColor"]
      var __front = (__sb === 'black' || __sb === '#000000') ? '#000000' : '#ffffff'
      wx.setNavigationBarColor({ frontColor: __front, backgroundColor: '#ffffff' })
    } catch (err) {}
  },
})
