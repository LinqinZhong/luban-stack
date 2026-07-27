Component({
  options: {
    multipleSlots: true,
    // 有对外方法时不能 virtualHost，否则页面 selectComponent 取不到实例
    virtualHost: true,
    // 允许使用 app.wxss / 页面工具类（默认 isolated 会导致 class 全部失效）
    styleIsolation: 'apply-shared',
  },
  properties: {
    "bottomText": {
      type: String,
      value: "没有更多了~"
    },
    "fetchApi": {
      type: Object,
      value: null
    },
    "data": {
      type: Array,
      value: []
    }
  },
  data: {
    "pagination": {
      "current": 2,
      "pageSize": 10
    },
    "loading": false,
    "hasNext": true,
    "isReachTop": true,
    "pullText": "",
    "pullHeight": 0,
    "touchStartY": 0,
    "refreshing": false,
    "arrowSize": 0,
    "arrowRotate": 0
  },
  observers: {
    'bottomText, fetchApi, data, refreshing, pullHeight': function () {
      this.__recomputeComputed()
    },
  },
  lifetimes: {
  attached() {
    this.__recomputeComputed()
    ;(function () {
      var value = []
      var patch = {}
      patch['data'] = value
      this.setData(patch)
      this.triggerEvent('update:' + 'data', { value: value })
    }).call(this)
    this.loadData()
  },
  },
  methods: {
  loadData() {
    var that = this
    var voiderApi = require('../../utils/voider-api.js')
    var setData = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
    }
    var updateProps = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
      that.triggerEvent('update:' + String(prop), { value: value })
    }
    var showToast = function (message, duration) {
      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })
    }
    var emit = function (event) {
      var args = Array.prototype.slice.call(arguments, 1)
      that.triggerEvent(String(event), { args: args })
    }
    var refresh = function () { return that.refresh.apply(that, arguments) }
    var pagination = that.data.pagination
    var loading = that.data.loading
    var hasNext = that.data.hasNext
    var isReachTop = that.data.isReachTop
    var pullText = that.data.pullText
    var pullHeight = that.data.pullHeight
    var touchStartY = that.data.touchStartY
    var refreshing = that.data.refreshing
    var arrowSize = that.data.arrowSize
    var arrowRotate = that.data.arrowRotate
    var $props = {}
    Object.defineProperty($props, 'bottomText', { enumerable: true, get: function () { return that.properties.bottomText !== undefined ? that.properties.bottomText : that.data.bottomText } })
    $props.fetchApi = function (args) {
      return voiderApi.invoke(that.properties.fetchApi || that.data.fetchApi, args)
    }
    Object.defineProperty($props, 'data', { enumerable: true, get: function () { var v = that.properties.data !== undefined ? that.properties.data : that.data.data; return Array.isArray(v) ? v : [] } })
    if(loading || !hasNext) return
    setData('loading', true)
    $props.fetchApi({
      page: pagination
    }).then((res) => {
      setData('hasNext', res.hasNext)
      setData('pagination',{
        current: res.current+1,
        pageSize: res.pageSize
      })
      if(refreshing){
        updateProps('data', res.records || [])
        showToast('刷新成功')
      }else{
        updateProps('data', [...$props.data ,...(res.records || [])])
      }
    }).catch((err) => {
      console.error(err)
    }).then(function (__ok) { return __ok }, function (err) { console.error(err) }).then(function () {
      setData('refreshing', false)
      setData('loading', false)
    })
  },
  refresh() {
    var that = this
    var voiderApi = require('../../utils/voider-api.js')
    var setData = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
    }
    var updateProps = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
      that.triggerEvent('update:' + String(prop), { value: value })
    }
    var showToast = function (message, duration) {
      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })
    }
    var emit = function (event) {
      var args = Array.prototype.slice.call(arguments, 1)
      that.triggerEvent(String(event), { args: args })
    }
    var loadData = function () { return that.loadData.apply(that, arguments) }
    var pagination = that.data.pagination
    var loading = that.data.loading
    var hasNext = that.data.hasNext
    var isReachTop = that.data.isReachTop
    var pullText = that.data.pullText
    var pullHeight = that.data.pullHeight
    var touchStartY = that.data.touchStartY
    var refreshing = that.data.refreshing
    var arrowSize = that.data.arrowSize
    var arrowRotate = that.data.arrowRotate
    var $props = {}
    Object.defineProperty($props, 'bottomText', { enumerable: true, get: function () { return that.properties.bottomText !== undefined ? that.properties.bottomText : that.data.bottomText } })
    $props.fetchApi = function (args) {
      return voiderApi.invoke(that.properties.fetchApi || that.data.fetchApi, args)
    }
    Object.defineProperty($props, 'data', { enumerable: true, get: function () { var v = that.properties.data !== undefined ? that.properties.data : that.data.data; return Array.isArray(v) ? v : [] } })
    if(loading) return
    setData('hasNext', true)
    setData('pagination',{
      current: 1,
      pageSize: 10
    })
    setData('refreshing', true)
    loadData()
  },
  __onRefresherPulling(e) {
    var that = this
    var dy = e && e.detail && e.detail.dy != null ? Number(e.detail.dy) : 0
    if (!(dy > 0)) dy = 0
    // ??????????????? sin ??
    var maxPull = 200
    var t = Math.min(1, dy / 500)
    var h = maxPull * Math.sin(t * Math.PI * 0.5)
    that.setData({ pullHeight: h })
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
  },
  __onRefresherRefresh(e) {
    var that = this
    if (that.data.loading) {
      that.setData({ refreshing: false, pullHeight: 0 })
      if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
      return
    }
    that.setData({ pullHeight: 40 })
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
    if (typeof that.refresh === 'function') that.refresh()
    else that.setData({ refreshing: true })
  },
  __onRefresherRestore(e) {
    var that = this
    that.setData({ pullHeight: 0 })
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
  },
  __onScroll_0(e) {
    var that = this
    var setData = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
    }
    var showToast = function (message, duration) {
      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })
    }
    var loadData = function () { return that.loadData.apply(that, arguments) }
    var refresh = function () { return that.refresh.apply(that, arguments) }
    var pagination = that.data.pagination
    var loading = that.data.loading
    var hasNext = that.data.hasNext
    var isReachTop = that.data.isReachTop
    var pullText = that.data.pullText
    var pullHeight = that.data.pullHeight
    var touchStartY = that.data.touchStartY
    var refreshing = that.data.refreshing
    var arrowSize = that.data.arrowSize
    var arrowRotate = that.data.arrowRotate
    var scrollTop = e && e.detail && e.detail.scrollTop != null ? e.detail.scrollTop : 0
    var scrollLeft = e && e.detail && e.detail.scrollLeft != null ? e.detail.scrollLeft : 0
    var scrollHeight = e && e.detail && e.detail.scrollHeight != null ? e.detail.scrollHeight : 0
    setData('isReachTop', scrollTop <= 30)
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
  },
  __onScrollToLower_1(e) {
    var that = this
    var setData = function (prop, value) {
      var patch = {}
      patch[prop] = value
      that.setData(patch)
    }
    var showToast = function (message, duration) {
      wx.showToast({ title: String(message == null ? '' : message), icon: 'none', duration: duration === 'long' ? 3000 : 1500 })
    }
    var loadData = function () { return that.loadData.apply(that, arguments) }
    var refresh = function () { return that.refresh.apply(that, arguments) }
    var pagination = that.data.pagination
    var loading = that.data.loading
    var hasNext = that.data.hasNext
    var isReachTop = that.data.isReachTop
    var pullText = that.data.pullText
    var pullHeight = that.data.pullHeight
    var touchStartY = that.data.touchStartY
    var refreshing = that.data.refreshing
    var arrowSize = that.data.arrowSize
    var arrowRotate = that.data.arrowRotate
    if (that.data.loading || that.data.refreshing) return
    loadData()
    if (typeof that.__recomputeComputed === 'function') that.__recomputeComputed()
  },
  __recomputeComputed: function () {
    var that = this
    var $props = {}
    Object.defineProperty($props, "bottomText", { enumerable: true, get: function () {
      var v = that.properties["bottomText"] !== undefined ? that.properties["bottomText"] : that.data["bottomText"]
      return v
    } });
    Object.defineProperty($props, "fetchApi", { enumerable: true, get: function () {
      var v = that.properties["fetchApi"] !== undefined ? that.properties["fetchApi"] : that.data["fetchApi"]
      return v
    } });
    Object.defineProperty($props, "data", { enumerable: true, get: function () {
      var v = that.properties["data"] !== undefined ? that.properties["data"] : that.data["data"]
      return v
    } });
    var pagination = that.data["pagination"]
    var loading = that.data["loading"]
    var hasNext = that.data["hasNext"]
    var isReachTop = that.data["isReachTop"]
    var pullHeight = that.data["pullHeight"]
    var touchStartY = that.data["touchStartY"]
    var refreshing = that.data["refreshing"]
    var patch = {}
    try {
      patch["pullText"] = (function ($props, pagination, loading, hasNext, isReachTop, pullHeight, touchStartY, refreshing) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        return refreshing ? '刷新中...' : pullHeight > 100 ? '释放立即刷新' : '下拉即可刷新'
      })($props, pagination, loading, hasNext, isReachTop, pullHeight, touchStartY, refreshing)
    } catch (err) {
      console.error('computed pullText failed', err)
      patch["pullText"] = that.data["pullText"]
    }
    try {
      patch["arrowSize"] = (function ($props, pagination, loading, hasNext, isReachTop, pullHeight, touchStartY, refreshing, pullText) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        return Math.min(pullHeight, 100)/100 *10 + 5
      })($props, pagination, loading, hasNext, isReachTop, pullHeight, touchStartY, refreshing, patch["pullText"])
    } catch (err) {
      console.error('computed arrowSize failed', err)
      patch["arrowSize"] = that.data["arrowSize"]
    }
    try {
      patch["arrowRotate"] = (function ($props, pagination, loading, hasNext, isReachTop, pullHeight, touchStartY, refreshing, pullText, arrowSize) {
        "use strict";
        // 可直接使用同级数据池字段名作为变量（无需形参）
        // return 的值即为该字段的计算值
        return pullHeight > 100 ? 180 : 0
      })($props, pagination, loading, hasNext, isReachTop, pullHeight, touchStartY, refreshing, patch["pullText"], patch["arrowSize"])
    } catch (err) {
      console.error('computed arrowRotate failed', err)
      patch["arrowRotate"] = that.data["arrowRotate"]
    }
    this.setData(patch)
  }
  },
})
