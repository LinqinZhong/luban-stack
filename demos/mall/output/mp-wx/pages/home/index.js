Page({
  data: {
    "messagList": [
      {
        "id": "1",
        "name": "小明",
        "content": "晚上打游戏吗",
        "userId": ""
      }
    ],
    "navs": [
      {
        "label": "首页",
        "color": "#00b2ff",
        "icon": "home",
        "key": "home"
      },
      {
        "label": "消息",
        "color": "#333333",
        "icon": "message",
        "key": "message"
      },
      {
        "label": "我的",
        "color": "#333333",
        "icon": "user",
        "key": "me"
      }
    ],
    "currentNav": "home",
    "goodsList": [],
    "__api_fetchApi_0": {
      "serviceId": "svc_mrqdgnhb_3ktq2g",
      "controllerId": "cmrqed0jzshj7",
      "apiId": "api_mrqedc08_9iml1r",
      "method": "GET",
      "path": "/goods/page"
    }
  },
  onLoad() {
  },
  onShow() {},
  onReady() {},
  __sync_data_goodsList(e) {
    var value = e && e.detail ? e.detail.value : undefined
    this.setData({ goodsList: value })
  },
  __onEvt_0(e) {
    var __payload = (e && e.detail) || {}
    wx.navigateTo({ url: "/pages/goods-detail/index" })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __onEvt_1(e) {
    wx.navigateTo({ url: "/pages/chat/index" })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __onEvt_2(e) {
    this.setData({ currentNav: e.currentTarget.dataset.voiderV0 })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
  __onEvt_3(e) {
    wx.showToast({ title: "你好", icon: 'none' })
    if (typeof this.__recomputeComputed === 'function') this.__recomputeComputed()
  },
})
