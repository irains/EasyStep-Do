# EasyStep-Do 开发文档

## 项目简介

**行简 (EasyStep-Do)** 是一款基于 Tauri 2 的跨平台桌面待办事项应用，使用 Rust + React + TypeScript 构建。

- 本地数据持久化：SQLite（rusqlite，内嵌 SQLite）
- 数据同步：WebDAV 协议双向同步
- 国际化：中文 / 英文，首次启动自动检测系统语言
- 主题：跟随系统 / 日间 / 夜间

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 前端框架 | React 19 + TypeScript 6 |
| 样式 | Tailwind CSS v4 |
| 状态/主题 | next-themes |
| 国际化 | i18next + react-i18next |
| 拖拽排序 | @dnd-kit |
| Markdown | react-markdown + remark-gfm + rehype-sanitize |
| 图标 | lucide-react |
| 数据库 | SQLite（rusqlite 0.33，bundled） |
| HTTP 客户端 | reqwest（rustls-tls） |
| 构建 | Vite 8 |
| CI/CD | GitHub Actions |

## 项目结构

```
EasyStep-Do/
├── src/                          # 前端源码
│   ├── api/
│   │   ├── todo.ts               # 待办事项 API 封装
│   │   └── sync.ts               # 同步 API 封装
│   ├── components/
│   │   ├── ui/                   # 基础 UI 组件（Button, Input, Card...）
│   │   ├── markdown-editor.tsx   # Markdown 编辑器
│   │   ├── mode-toggle.tsx       # 主题快捷切换
│   │   ├── settings-panel.tsx    # 统一设置面板（主题/语言/同步）
│   │   ├── sync-status.tsx       # 同步状态指示器
│   │   └── theme-provider.tsx    # 主题 Provider
│   ├── i18n/
│   │   ├── index.ts              # i18next 初始化
│   │   └── locales/
│   │       ├── zh.json           # 中文翻译
│   │       └── en.json           # 英文翻译
│   ├── App.tsx                   # 主应用组件
│   ├── main.tsx                  # 入口
│   └── index.css                 # 全局样式 + CSS 变量
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 程序入口
│   │   ├── lib.rs                # 应用初始化（托盘/窗口/命令注册）
│   │   ├── db.rs                 # 数据库连接与迁移
│   │   ├── todo.rs               # 待办事项命令处理
│   │   └── sync/
│   │       ├── mod.rs            # 模块声明
│   │       ├── config.rs         # WebDAV 配置读写
│   │       ├── webdav.rs         # WebDAV 客户端
│   │       ├── merge.rs          # 数据库合并（last-write-wins）
│   │       └── commands.rs       # 同步相关 Tauri 命令
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
│       └── default.json          # 权限配置
├── docs/
│   └── development.md            # 本文档
├── .github/workflows/
│   └── build-tauri.yml           # CI 构建发布
├── CLAUDE.md                     # Claude Code 指导文件
└── package.json
```

## 前后端通信

前端通过 `@tauri-apps/api/core` 的 `invoke()` 调用 Rust 命令。

### 命令列表

| 命令 | 文件 | 说明 |
|------|------|------|
| `list_todos` | todo.rs | 列出所有待办 |
| `add_todo` | todo.rs | 添加待办 |
| `toggle_todo` | todo.rs | 切换完成状态 |
| `update_todo` | todo.rs | 更新标题/详情 |
| `delete_todo` | todo.rs | 删除（含 tombstone） |
| `reorder_todo` | todo.rs | 拖拽排序 |
| `open_external_url` | lib.rs | 安全打开浏览器链接 |
| `update_tray_language` | lib.rs | 更新托盘菜单语言 |
| `get_sync_config` | sync/commands.rs | 获取同步配置 |
| `save_sync_config` | sync/commands.rs | 保存同步配置 |
| `test_sync_connection` | sync/commands.rs | 测试 WebDAV 连接 |
| `sync_now` | sync/commands.rs | 立即同步 |
| `get_sync_history` | sync/commands.rs | 获取同步历史 |

### 约定

- 命令使用 `rename_all = "snake_case"`
- TypeScript 类型定义在 `src/api/` 下，与 Rust struct 对应
- 参数和返回值通过 serde 自动序列化/反序列化

## 数据模型

### todos 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (UUID) | 主键 |
| title | TEXT | 标题 |
| detail_md | TEXT | Markdown 详情 |
| completed | BOOLEAN | 是否完成 |
| created_at | TEXT (ISO 8601) | 创建时间 |
| updated_at | TEXT (ISO 8601) | 更新时间 |
| sort_order | REAL | 浮点排序值（gap-based） |
| journal_date | TEXT (YYYY-MM-DD) | 关联日期 |

### 同步相关表

- `sync_config` — WebDAV 配置（server_url, username, password 等）
- `sync_meta` — 同步元数据（device_id, remote_etag, last_sync_time）
- `deleted_records` — 删除记录（tombstone），用于跨设备删除同步
- `sync_history` — 同步历史记录

## WebDAV 同步机制

### 同步流程

1. 读取本地 WebDAV 配置
2. 备份本地数据库（`todos.sync-backup`）
3. 确保远程目录存在（MKCOL）
4. 下载远程数据库文件（GET）
5. 如果远程不存在 → 首次上传本地数据库
6. 如果远程存在 → 执行合并：
   - 打开远程数据库（只读）
   - 逐条比较 `updated_at`，采用 last-write-wins
   - 传播 tombstone（已删除记录）
   - 在事务中写入合并结果
7. 上传合并后的数据库（PUT with ETag）
8. 记录同步历史

### 认证

- 支持自动检测（PROPFIND → 检查 WWW-Authenticate 头）
- 支持 Basic / Digest 认证
- 预置坚果云、Nextcloud、Synology 地址模板

### ETag 并发控制

- 下载时记录 ETag
- 上传时携带 If-Match 头
- 防止并发写入覆盖

## 国际化 (i18n)

### 架构

- `i18next` + `react-i18next` + `i18next-browser-languagedetector`
- 语言存储在 `localStorage`（key: `easystep-lang`）
- 首次访问读取 `navigator.language`
- 所有 UI 文本使用 `t('key')` 函数调用

### 添加新翻译

1. 在 `src/i18n/locales/zh.json` 和 `en.json` 中添加键值对
2. 在组件中使用 `const { t } = useTranslation()` + `t('key')`

### 日期格式化

使用 `Intl.DateTimeFormat` 并根据 `i18n.language` 切换 locale（`zh-CN` / `en-US`）。

### 托盘菜单

托盘菜单文字在 Rust 端管理，通过 `update_tray_language` 命令从前端触发更新。
全局静态变量 `CURRENT_LANG` 存储当前语言，`on_menu_event` 中读取以保持一致。

## 主题系统

- `next-themes` 管理 CSS class 切换（`class="dark"`）
- Tauri `setTheme()` API 同步原生标题栏主题
- 设置面板提供三种选项：跟随系统 / 日间模式 / 夜间模式
- CSS 变量定义在 `src/index.css`，light/dark 两套

## 自动同步

- 前端 `useEffect` + `setInterval` 实现
- 读取 `auto_sync_enabled` 和 `auto_sync_interval_mins` 配置
- 定时调用 `loadTodos()` 刷新数据
- 设置面板中可开关和配置间隔

## 开发指南

### 环境要求

- Node.js >= 18
- Rust >= 1.77
- 系统依赖参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)

### 开发流程

```bash
# 安装依赖
npm ci

# 启动开发模式（推荐）
npm run tauri:dev

# 仅前端开发
npm run dev

# 类型检查
npx tsc --noEmit

# Rust 检查
cargo check --manifest-path src-tauri/Cargo.toml

# 生产构建
npm run tauri:build
```

### 代码风格

- TypeScript strict mode
- Rust 遵循标准 cargo fmt
- 组件使用函数式 + hooks
- 不添加不必要的注释，通过命名表达意图
- 翻译键使用点分路径（如 `app.name`、`settings.sync.title`）

### 版本号规范

- 格式：`MAJOR.MINOR.PATCH`
- 功能更新：MINOR +1, PATCH 归 0
- 修改位置：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`
- 提交时打 tag（如 `v1.2.0`）并 push
