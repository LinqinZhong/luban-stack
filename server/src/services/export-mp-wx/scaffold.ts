import type { LubanProjectConfig } from '../../types/luban-project.js'
import { generateApiJs, generateDeviceJs, generateRuntimeJs } from './api-runtime.js'

export function scaffoldMpWxFiles(options: {
  config: LubanProjectConfig
  pages: Array<{ id: string; title: string }>
  /** serviceName / default → baseUrl */
  apiBaseUrls: Record<string, string>
  /** 覆盖 luban.json 中的 wechatAppId */
  wechatAppId?: string
}): Record<string, string> {
  const entry =
    options.config.entryPage?.trim() ||
    options.pages[0]?.id ||
    'home'
  const ordered = [
    ...options.pages.filter((p) => p.id === entry),
    ...options.pages.filter((p) => p.id !== entry),
  ]
  const pagePaths = ordered.map((p) => `pages/${p.id}/index`)
  const appId =
    options.wechatAppId?.trim() ||
    options.config.wechatAppId?.trim() ||
    ''
  const apiBaseUrls = options.apiBaseUrls
  const designWidth =
    options.config.canvas?.width > 0
      ? options.config.canvas.width
      : 375
  const pageFontSize = (() => {
    const vw = (14 / designWidth) * 100
    const s = Number.isInteger(vw) ? String(vw) : String(Number(vw.toFixed(6)))
    return `${s}vw`
  })()

  const appJson = {
    pages: pagePaths,
    window: {
      navigationBarTitleText: options.config.name || 'App',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
      backgroundColor: '#f5f7fa',
    },
    style: 'v2',
    sitemapLocation: 'sitemap.json',
  }

  const projectConfig = {
    description: `${options.config.name || 'App'} 微信小程序`,
    packOptions: {
      ignore: [],
      include: [],
    },
    setting: {
      bundle: false,
      es6: true,
      postcss: true,
      minified: true,
      /** 本地联调直连后端时关闭合法域名校验 */
      urlCheck: false,
    },
    compileType: 'miniprogram',
    libVersion: '3.5.5',
    appid: appId,
    projectname: options.config.name || 'mp-app',
    condition: {},
  }

  const urlsLiteral = JSON.stringify(apiBaseUrls, null, 4).replace(
    /\n/g,
    '\n    ',
  )

  return {
    'app.js': `App({
  globalData: {
    /**
     * API 根地址字典（按 serviceName / default）
     * 例：{ "default": "http://127.0.0.1:3030", "shop": "http://127.0.0.1:3030" }
     */
    apiBaseUrls: ${urlsLiteral},
  },
  onLaunch() {},
  onShow() {},
  onHide() {},
})
`,
    'app.json': `${JSON.stringify(appJson, null, 2)}\n`,
    'app.wxss': `page {
  height: 100%;
  width: 100%;
  background: #f5f7fa;
  color: #303133;
  font-size: ${pageFontSize};
  box-sizing: border-box;
}

view, text, image, button, scroll-view {
  box-sizing: border-box;
}
`,
    'project.config.json': `${JSON.stringify(projectConfig, null, 2)}\n`,
    'sitemap.json': `${JSON.stringify(
      {
        desc: '关于本文件的更多信息，请参考文档 https://developers.weixin.qq.com/miniprogram/dev/framework/sitemap.html',
        rules: [{ action: 'allow', page: '*' }],
      },
      null,
      2,
    )}\n`,
    'utils/api.js': generateApiJs(),
    'utils/device.js': generateDeviceJs(),
    'utils/runtime.js': generateRuntimeJs(),
    'README.md': `# ${options.config.name || 'App'} · 微信小程序

独立微信小程序工程（由设计器导出）。

## 使用

1. 启动 Nest 后端（默认 \`3030\`）
2. 用微信开发者工具打开本目录（\`output/mp-wx\`）
3. AppID：\`${appId || '（未配置）'}\`
4. 详情 → 本地设置：**不校验合法域名**
5. 在 \`app.js\` 的 \`globalData.apiBaseUrls\` 配置各服务根地址

入口页：\`${entry}\`

## API

\`wx.request\` → \`{apiBaseUrls[serviceName|default]}{path}\`  

当前默认字典：

\`\`\`json
${JSON.stringify(apiBaseUrls, null, 2)}
\`\`\`

OSS 签名：\`POST {apiBaseUrls.default|/oss}/oss/sign\`
`,
  }
}
