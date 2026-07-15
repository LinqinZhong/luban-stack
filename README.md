# Voider

H5 低代码开发工具（前后端分离本地系统）。

## 项目结构

```
voider/
├── frontend/   # Vue 3 + TypeScript + Element Plus
└── server/     # Node.js + Express + TypeScript
```

## 快速开始

### 1. 启动后端

```bash
cd server
npm install
npm run dev
```

后端默认运行在 `http://localhost:3000`

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认运行在 `http://localhost:5173`

## 项目配置 voider.json

每个项目根目录需包含 `voider.json`，示例：

```json
{
  "name": "活动页",
  "version": "0.1.0",
  "author": "your-name",
  "engineVersion": "1.0.0",
  "canvas": {
    "width": 375
  }
}
```

| 字段 | 说明 |
|------|------|
| `name` | 项目名称 |
| `version` | 项目版本号 |
| `author` | 作者 |
| `engineVersion` | 引擎版本号 |
| `canvas.width` | 画布宽度（px），默认 `375` |

打开项目时，所选文件夹必须已有合法的 `voider.json`；新建项目会写入该文件并创建空的 `pages/` 目录。

## 页面目录 pages/

```
pages/
└── home/
    ├── config.json   # 页面配置
    └── index.xml     # 页面内容（Android 风格布局 XML）
```

`config.json` 示例：

```json
{
  "name": "首页",
  "title": "首页"
}
```

`index.xml` 目前支持以下控件：

| 控件 | 说明 |
|------|------|
| `Text` | 文本 |
| `Button` | 按钮 |
| `Image` | 图片（`src` / `alt` / `title` / `objectFit` / `loading`，尺寸用通用 `width` / `height`） |
| `Icon` | 图标（`iconId` 引用项目 `icons.json`，`size` / `color`） |
| `LinearLayout` | 线性布局（`orientation`: vertical / horizontal） |
| `RelativeLayout` | 相对布局（`layout_alignParent*` / `layout_center*` 等） |

项目根目录 `icons.json` 存放可复用 SVG 符号定义；画布通过 SVG sprite + `<use>` 渲染，页面 XML 不内联 SVG。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api` | 获取 API 基本信息 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/projects/meta` | 获取引擎版本、默认画布宽度等元信息 |
| GET | `/api/projects/browse?path=` | 浏览本地文件夹（空 path 为磁盘根） |
| POST | `/api/projects/open` | 打开项目（校验 voider.json） |
| POST | `/api/projects/create` | 新建项目并写入 voider.json |
| GET | `/api/projects/icons?projectPath=` | 获取项目图标库 |
| PUT | `/api/projects/icons` | 保存项目图标库 |
| GET | `/api/pages?projectPath=` | 列出项目 pages 下的页面 |
| POST | `/api/pages` | 新建页面（写入 config.json + index.xml） |
| GET | `/api/pages/:pageId?projectPath=` | 读取页面配置与 XML |
| PUT | `/api/pages/:pageId/xml` | 保存页面 XML |

## 构建部署

```bash
# 后端
cd server
npm run build
npm start

# 前端
cd frontend
npm run build
npm run preview
```
