import type { VoiderProjectConfig } from '../../types/voider-project.js'
import { generateVoiderApiJs, generateVoiderDeviceJs } from './api-runtime.js'

const DEFAULT_MP_API_BASE = 'http://127.0.0.1:6630'

export function scaffoldMpWxFiles(options: {
  config: VoiderProjectConfig
  pages: Array<{ id: string; title: string }>
  /** 绝对项目路径，写入 globalData 供网关识别 */
  projectPath: string
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
  const appId = options.config.wechatAppId?.trim() || ''
  const apiBaseUrl =
    options.config.wechatApiBaseUrl?.trim() || DEFAULT_MP_API_BASE
  const projectPath = options.projectPath.replace(/\\/g, '/')
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
      navigationBarTitleText: options.config.name || 'Voider',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
      backgroundColor: '#f5f7fa',
    },
    style: 'v2',
    sitemapLocation: 'sitemap.json',
  }

  const projectConfig = {
    description: `${options.config.name || 'Voider'} 微信小程序（Voider 导出）`,
    packOptions: {
      ignore: [],
      include: [],
    },
    setting: {
      bundle: false,
      es6: true,
      postcss: true,
      minified: true,
      /** 本地联调 127.0.0.1:6630，关闭合法域名校验 */
      urlCheck: false,
    },
    compileType: 'miniprogram',
    libVersion: '3.5.5',
    appid: appId,
    projectname: options.config.name || 'voider-mp',
    condition: {},
  }

  return {
    'app.js': `App({
  globalData: {
    /** Voider MP 网关（默认 6630，与控制器 path 拼接，如 /goods/page） */
    apiBaseUrl: ${JSON.stringify(apiBaseUrl)},
    /** 供网关 X-Voider-Project 识别当前工程 */
    projectPath: ${JSON.stringify(projectPath)},
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
    'utils/voider-api.js': generateVoiderApiJs(),
    'utils/voider-device.js': generateVoiderDeviceJs(),
    'README.md': `# ${options.config.name || 'Voider'} · 微信小程序

由 Voider 导出的原生微信小程序工程。

## 使用

1. 启动 Voider server（会同时监听 \`3000\` 与 **\`6630\` MP 网关**）
2. 用微信开发者工具打开本目录（\`output/mp-wx\`）
3. AppID：\`${appId || '（未配置）'}\`
4. 详情 → 本地设置：**不校验合法域名**
5. 代理设置建议选 **「不使用任何代理」**（请求直连 \`http://127.0.0.1:6630\`）。若使用「手动设置代理」，请指向 \`127.0.0.1:6630\`，且 \`apiBaseUrl\` 不要再写成同一地址以免绕圈。

入口页：\`${entry}\`

## API

\`wx.request\` → \`{apiBaseUrl}{controller.path}{api.path}\`  
例如：\`http://127.0.0.1:6630/goods/page\`

请求头自动带 \`X-Voider-Project\`（当前工程路径），由 6630 网关按 path 匹配并执行控制器流程。
`,
  }
}
