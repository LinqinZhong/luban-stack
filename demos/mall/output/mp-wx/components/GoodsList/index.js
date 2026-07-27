Component({
  options: {
    multipleSlots: true,
    // 有对外方法时不能 virtualHost，否则页面 selectComponent 取不到实例
    virtualHost: true,
    // 允许使用 app.wxss / 页面工具类（默认 isolated 会导致 class 全部失效）
    styleIsolation: 'apply-shared',
  },
  properties: {
    "data": {
      type: Array,
      value: []
    }
  },
  data: {
    "list1": [],
    "list2": []
  },
  observers: {
    'data': function () {
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
    var __payload = (e && e.detail) || {}
    this.triggerEvent("select", { goods: __payload.goods })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __onEvt_1(e) {
    var __payload = (e && e.detail) || {}
    this.triggerEvent("select", { goods: __payload.goods })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __recomputeComputed: function () {
    var that = this
    var $props = {}
    Object.defineProperty($props, "data", { enumerable: true, get: function () {
      var v = that.properties["data"] !== undefined ? that.properties["data"] : that.data["data"]
      return v
    } });
    var patch = {}
    try {
      patch["list1"] = (function ($props) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        var list = $props.data
        if (!list || !list.filter) return []
        return list.filter(function (_, i) { return (i & 1) === 0 })
      })($props)
    } catch (err) {
      console.error('computed list1 failed', err)
      patch["list1"] = that.data["list1"]
    }
    try {
      patch["list2"] = (function ($props, list1) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        var list = $props.data
        if (!list || !list.filter) return []
        return list.filter(function (_, i) { return (i & 1) === 1 })
      })($props, patch["list1"])
    } catch (err) {
      console.error('computed list2 failed', err)
      patch["list2"] = that.data["list2"]
    }
    this.setData(patch)
  }
  },
})
