Component({
  options: {
    multipleSlots: true,
    virtualHost: true,
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
