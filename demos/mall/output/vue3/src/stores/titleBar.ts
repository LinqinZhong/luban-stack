import { defineStore } from 'pinia'

export interface TitleBarState {
  readonly offsetTop: number
  readonly height: number
}

export const useTitleBarStore = defineStore('titleBar', {
  state: (): TitleBarState => ({

  }),
  getters: {
    // // 可直接使用同级数据池字段名作为变量（无需形参）
    // // return 的值即为该字段的计算值
    // const info = getDeviceInfo()
    // if($props.isFillScreen && info.platform !== 'h5'){
    //   return info.statusBarHeight
    // }
    // return 0
    offsetTop(state) {
      try {
        const {  } = state
        return 0
      } catch {
        return 0
      }
    },

    // // 可直接使用同级数据池字段名作为变量（无需形参）
    // // return 的值即为该字段的计算值
    // const info = getDeviceInfo()
    // if(info.platform === 'h5'){
    //   return 45
    // }
    // return offsetTop + info.menuButton.height + (info.menuButton.top-info.statusBarHeight)+5
    height(state) {
      try {
        const {  } = state
        return offsetTop + info.menuButton.height + (info.menuButton.top-info.statusBarHeight)+5
      } catch {
        return 0
      }
    },
  },
  actions: {
    setData(prop: keyof TitleBarState | string, value: any) {
      if (prop in this.$state) {
        ;(this as Record<string, any>)[prop as string] = value
      }
    },
  },
})
