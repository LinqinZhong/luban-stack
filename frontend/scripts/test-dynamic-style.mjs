import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  contentType: 'text/html',
})
globalThis.DOMParser = dom.window.DOMParser
globalThis.XMLSerializer = dom.window.XMLSerializer
globalThis.Node = dom.window.Node
globalThis.Element = dom.window.Element
globalThis.Document = dom.window.Document

const { parsePageXml } = await import('../src/utils/xml.ts')
const { expandRepeatTree } = await import('../src/utils/repeat.ts')
const { serializeDynamicStyles } = await import('../src/types/dynamic-styles.ts')

const styles = serializeDynamicStyles({
  states: [
    {
      id: 's1',
      name: 'actived',
      scenarios: [
        {
          id: 'sc1',
          name: '场景1',
          conditions: [{ field: 'index', op: 'eq', value: '0' }],
        },
      ],
      styles: {
        textColor: '#ff0000',
        background: '#00ff00',
        color: '#0000ff',
      },
    },
  ],
})

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout width="match_parent" height="match_parent" orientation="vertical">
  <LinearLayout width="match_parent" height="wrap_content" orientation="horizontal" repeat="nav">
    <Text text="{item.label}" textColor="#303133" width="wrap_content" height="wrap_content" dynamicStyles="${escapeXml(styles)}" />
    <Icon iconId="home" color="#303133" size="24" width="wrap_content" height="wrap_content" dynamicStyles="${escapeXml(styles)}" />
  </LinearLayout>
</LinearLayout>
`

const pageData = {
  fields: [
    {
      name: 'nav',
      type: 'array',
      value: [{ label: '首页' }, { label: '我的' }],
    },
  ],
}

const root = parsePageXml(xml)
console.log('raw dynamicStyles sample:', root.children[0].children[0].attrs.dynamicStyles?.slice(0, 100))
const expanded = expandRepeatTree(root, pageData)
console.log('expanded count:', expanded.children.length)
for (const [i, c] of expanded.children.entries()) {
  const text = c.children[0]
  const icon = c.children[1]
  console.log(`#${i} scope=`, c.scope, 'textColor=', text?.attrs.textColor, 'iconColor=', icon?.attrs.color, 'bg=', text?.attrs.background)
}
