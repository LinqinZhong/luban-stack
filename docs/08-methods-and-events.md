# 方法与事件怎么用

副作用（改数据、跳转、调接口、弹提示）放在方法里；界面通过事件绑定触发这些方法。

## 方法

- 每个方法是一段独立逻辑，带名称、入参类型、返回类型说明。  
- 作用域里可直接使用：数据池字段、组件属性、其它方法、内置能力。  
- 常见内置能力：`setData`、跳转/返回、轻提示、读设备信息；组件另有抛事件、回写可更新属性。  
- 浏览器预览环境还可使用标准定时器：`setTimeout` / `clearTimeout` / `setInterval` / `clearInterval`（例如短延迟后复位按压态）。不要自创其它全局 API。

## 事件绑定

控件的点击、长按、滚动、触摸，以及生命周期钩子，都配置为「动作列表」：

1. 调用某个方法（可带参数）  
2. 或使用内置动作（如改某个数据字段、跳转）  
3. 或写一小段自定义语句  

多条动作按顺序执行。滚动/触摸事件还会带上滚动位置、触点坐标等形参，可在自定义语句里使用。

属性名（必须用这些，不要写 `click`）：

- 通用：`onClick` / `onLongClick` / `onTouchStart` / `onTouchMove` / `onTouchEnd`
- 仅可滚动布局（`overflow="scroll"` 的 LinearLayout / RelativeLayout）：`onScroll` / `onScrollToLower` / `onScrollToUpper`

属性值是 JSON 数组，例如：

```json
[{"id":"bind_1","method":"clear","args":{}},{"id":"bind_2","method":"inputDigit","args":{"digit":"7"}}]
```

`args` 的键必须与方法入参名一致。

## Button 按压反馈

属性 `pressFeedback`（默认无）：

| 值 | 效果 |
| --- | --- |
| `none`（或不写） | 无 |
| `scale` | 缩放 |
| `ripple` | 波纹 |
| `rippleScale` | 波纹+缩放 |

含波纹时可用 `pressRippleColor` 自定义颜色，默认灰色半透明 `rgba(0, 0, 0, 0.22)`。简单点击反馈优先用此能力；复杂条件变色再用 `dynamicStyles`。

## 动态样式（可选）

属性名 `dynamicStyles`，值为 JSON：

```json
{"states":[{"id":"s1","name":"按压","scenarios":[{"id":"sc1","name":"匹配","conditions":[{"field":"pressedKey","op":"eq","value":"7"}]}],"styles":{"background":"#555555"}}]}
```

## 生命周期

在页面或组件挂载、更新、卸载等时机自动跑动作列表。  
典型用途：首次进入拉数、组件挂载时初始化、卸载时清理。

## 使用建议

1. **交互薄、方法厚**：控件上只绑「调用哪个方法」；复杂分支写在方法里。  
2. **组件少直接跳转**：用事件通知父页面，由页面统一导航。  
3. **进页逻辑**：简单用接口字段；有顺序/条件用 `挂载` 生命周期调方法。  
4. 需要滚动联动（如标题栏渐变）时，用滚动事件改数据池，再让样式绑定该字段。
5. 需要短延迟复位时，方法体内可用 `setTimeout`，再配合 `run_frontend_tests` 的 `wait` / `assertStyle` 验证。
