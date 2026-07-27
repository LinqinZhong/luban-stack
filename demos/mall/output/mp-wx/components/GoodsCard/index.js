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
      type: Object,
      value: null
    }
  },
  data: {},
  lifetimes: {
  attached() {},
  },
  methods: {
  __onEvt_0(e) {
    this.triggerEvent("select", { id: (this.properties.id !== undefined ? this.properties.id : this.data.id), goods: (this.properties.data !== undefined ? this.properties.data : this.data.data) })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  }
  },
})
