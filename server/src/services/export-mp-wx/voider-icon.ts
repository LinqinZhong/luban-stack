import type { IconLibrary } from '../../types/icon-library.js'
import { buildIconSvg } from '../export-vue3/icon-export.js'

/** 微信小程序：用 data-uri 渲染 SVG（本地 svg + currentColor 在 image 上不可靠） */
export function generateVoiderIconFiles(
  library: IconLibrary,
): Record<string, string> {
  const icons: Record<string, string> = {}
  for (const icon of library.icons) {
    icons[icon.id] = buildIconSvg(icon).trim()
  }

  const iconsLiteral = JSON.stringify(icons, null, 2)

  return {
    'components/voider-icon/index.json': `${JSON.stringify(
      {
        component: true,
        styleIsolation: 'apply-shared',
      },
      null,
      2,
    )}\n`,
    'components/voider-icon/index.wxml': `<image src="{{src}}" mode="aspectFit" class="voider-icon-img" />\n`,
    'components/voider-icon/index.wxss': `.voider-icon-img {
  display: block;
  width: 100%;
  height: 100%;
}
`,
    'components/voider-icon/index.js': `const ICONS = ${iconsLiteral}

function toDataUri(name, color) {
  const id = String(name || '').trim()
  let svg = ICONS[id]
  if (!svg) return ''
  const fill = String(color || '').trim() || '#333333'
  svg = svg
    .replace(/currentColor/g, fill)
    // 图标库常见白底全幅 path，在 image 里会盖住图形
    .replace(/\\sfill="#(?:[Ff]{3}|[Ff]{6}|FFFFFF|ffffff)"/g, ' fill="transparent"')
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'apply-shared',
  },
  properties: {
    name: { type: String, value: '' },
    color: { type: String, value: '#333333' },
  },
  data: {
    src: '',
  },
  observers: {
    'name, color': function (name, color) {
      this.setData({ src: toDataUri(name, color) })
    },
  },
})
`,
  }
}
