Component({
  options: {
    multipleSlots: true,
    virtualHost: true,
  },
  properties: {

  },
  data: {},
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
    var modalRef = that.data.modalRef
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
    var modalRef = that.data.modalRef
    var $props = {}
    modalRef.show()
  }
  },
})
