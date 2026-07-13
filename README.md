# Voider

前后端分离的本地系统项目。

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

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api` | 获取 API 基本信息 |
| GET | `/api/health` | 健康检查 |

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
