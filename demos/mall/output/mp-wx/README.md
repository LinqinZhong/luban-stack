# 测试 · 微信小程序

由 Voider 导出的原生微信小程序工程。

## 使用

1. 启动 Voider server（会同时监听 `3000` 与 **`6630` MP 网关**）
2. 用微信开发者工具打开本目录（`output/mp-wx`）
3. AppID：`wx063d4987d9089a28`
4. 详情 → 本地设置：**不校验合法域名**
5. 代理设置建议选 **「不使用任何代理」**（请求直连 `http://127.0.0.1:6630`）。若使用「手动设置代理」，请指向 `127.0.0.1:6630`，且 `apiBaseUrl` 不要再写成同一地址以免绕圈。

入口页：`home`

## API

`wx.request` → `{apiBaseUrl}{controller.path}{api.path}`  
例如：`http://127.0.0.1:6630/goods/page`

请求头自动带 `X-Voider-Project`（当前工程路径），由 6630 网关按 path 匹配并执行控制器流程。
