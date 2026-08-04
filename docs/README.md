# LubanStack 低代码使用说明

面向在平台里搭建应用的人：如何组织项目、画界面、管数据、写逻辑、接接口。  
不讲编辑器源码，也不绑定某一个示例工程。

## 读什么

| 文档 | 讲什么 |
|------|--------|
| [01-project-structure.md](./01-project-structure.md) | 一个项目由哪些部分组成 |
| [02-pages.md](./02-pages.md) | 页面是什么、怎么配置入口与入参 |
| [03-xml-widgets.md](./03-xml-widgets.md) | 界面用哪些控件拼 |
| [04-xml-attributes.md](./04-xml-attributes.md) | 布局、样式、交互怎么挂到控件上 |
| [05-components-and-slots.md](./05-components-and-slots.md) | 组件、插槽、对外能力 |
| [06-data-pool.md](./06-data-pool.md) | 数据从哪来、怎么更新 |
| [07-bindings-and-expressions.md](./07-bindings-and-expressions.md) | 界面如何读数据、条件显隐 |
| [08-methods-and-events.md](./08-methods-and-events.md) | 点击/生命周期如何触发逻辑 |
| [09-services-for-frontend.md](./09-services-for-frontend.md) | 前端如何用后端能力 |
| [10-types-library.md](./10-types-library.md) | 类型用来约束什么 |
| [11-theming-assets.md](./11-theming-assets.md) | 颜色、图标、构建与环境 |
| [12-usage-overview.md](./12-usage-overview.md) | 推荐搭建顺序（总览） |

## 一句话心智模型

**页面 / 组件** = 界面树 + 数据池 + 方法。  
界面用表达式读数据；交互调方法；需要远程数据时绑服务 API 或在方法里调 API 属性。
