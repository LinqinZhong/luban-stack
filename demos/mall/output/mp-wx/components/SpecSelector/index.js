Component({
  options: {
    multipleSlots: true,
    // 有对外方法时不能 virtualHost，否则页面 selectComponent 取不到实例
    virtualHost: false,
    // 允许使用 app.wxss / 页面工具类（默认 isolated 会导致 class 全部失效）
    styleIsolation: 'apply-shared',
  },
  properties: {

  },
  data: {
    "__modal_mask": false
  },
  lifetimes: {
  attached() {},
  },
  methods: {
  close() {
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
    var open = function () { return that.open.apply(that, arguments) }
    var modalRef = {
      show: function () { var p = {}; p["__modal_mask"] = true; that.setData(p) },
      hide: function () { var p = {}; p["__modal_mask"] = false; that.setData(p) },
    }
    var $props = {}
    modalRef.hide()
  },
  open() {
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
    var close = function () { return that.close.apply(that, arguments) }
    var modalRef = {
      show: function () { var p = {}; p["__modal_mask"] = true; that.setData(p) },
      hide: function () { var p = {}; p["__modal_mask"] = false; that.setData(p) },
    }
    var $props = {}
    modalRef.show()
  },
  __hideModal___modal_mask(e) {
    var p = {}; p["__modal_mask"] = false; this.setData(p)
  },
  __modalNoop(e) {
    /* catchtap: 阻止冒泡关闭 */
  }
  },
})
