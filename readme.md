# iseemath

面向游戏策划的**纯前端数值建模 + 真实日志分析**工具。变量关系是一张可拖拽、可编辑的节点图；同一个工作台里可以导入线上日志、做筛选/分组/聚合，并让模型与真实数据在同一处对照。

- 所有项目数据保存在浏览器 IndexedDB；没有后端，没有账号，不发起网络请求。
- 纯静态构建，可部署在任意静态服务器（推荐 HTTPS，`file://` 直接打开不可用）。
- 项目可导出/导入 `.json`；导出不含日志原始字节，导入后需要重新绑定数据源。

## 快速开始

环境：Node 24、pnpm 11。

Windows 可以直接双击 [start.bat](start.bat)：首次运行会自动安装依赖，然后启动开发服务器并打开浏览器。加 `--no-open` 参数（`start.bat --no-open`）则只启动、不打开浏览器。

手动启动：

```bash
pnpm install
pnpm dev        # 以终端输出的本地地址为准（端口被占用时 Vite 会自动换端口）
pnpm test       # Vitest
pnpm typecheck  # tsc -b --noEmit
pnpm build      # tsc -b && vite build
pnpm preview    # 预览生产构建
```

首次打开会自动创建一个空项目。顶栏「项目」菜单可以新建、打开、导入、导出项目。

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 工程骨架、Zod schema、IndexedDB 持久化、CAS 自动保存、多标签页租约、patch 撤销 | 完成 |
| M1a | 常量/公式变量/分组、三类边、公式解析与求值、环检测、重命名、导入导出 | 完成 |
| M1b | 折叠包、可见图代理、代理边聚合、汇总 | 完成 |
| M1c | 影响边 UI、边过滤、树拖拽改归属、包汇总 avg/min/max | 核心完成（批量编辑、结构/计算视图模式未做） |
| M2 | CSV/JSONL 导入、GB18030、列式解析、日志重建、聚合、图表、分析视图、数据源替换 | 完成 |
| M3 | 数据表（Collection）节点、字段映射、行作用域派生列、列级环检测、批量预览、类型级依赖 | 完成 |
| M4 | 三种模型×日志对比、100MB 验收、Excel、项目复制 | 未开始 |
| M5 | AnalyzerRegistry、AI Proposal 预览、OPFS、`.numlab` zip、增量求值 | 未开始 |

当前可用的核心闭环：**建模型 → 导入日志 → 聚合分析 → 用数据表批量定义同类型数据 → 保存项目/导出 JSON**。对比分析页目前是占位。

## 文档

- [用户指南](docs/USER_GUIDE.md)：界面、建模、折叠包、数据表、日志分析、导入导出、快捷键与限制。
- [项目格式规范](docs/PROJECT_FORMAT.md)：导入/导出 JSON 的完整字段、公式语法、批量表语义、列 ID 与导入校验规则。
- [AI 工作流指南](docs/AI_GUIDE.md)：外部 AI 生成/修改项目 JSON 的标准协议、稳定 ID 规则、模板与自检清单。
- [性能基准](docs/BENCHMARKS.md)：50MB CSV 导入/重建/聚合的实测数据。

可直接导入的示例：

- [伤害公式示例](docs/examples/formula.project.json)：分组、常量、公式、影响边、折叠包。
- [数据表示例](docs/examples/collection.project.json)：数据集元数据、字段映射、行作用域派生列（导入后数据源需替换）。

示例由 `src/core/model/examples.test.ts` 在测试中校验，保证与当前 schema/不变量一致。

## 技术栈

React 18 + TypeScript + Vite 6；Ant Design 5 + CSS Modules；React Flow 12；Zustand 5 + Immer patch 撤销；Dexie 4（IndexedDB）；自研公式 lexer/parser/evaluator；Vitest + jsdom。

`src/core` 是纯 TypeScript 领域层，不依赖 React；UI 位于 `src/features`，持久化位于 `src/platform`。

## 数据与隐私

日志文件和项目文档只写入本机浏览器的 IndexedDB。导出 JSON 只包含项目结构与元数据，不包含日志原始文件；把导出文件交给他人或 AI 前请自行确认是否包含敏感的项目名称/字段名。

## date 示例项目

本仓库只保留一份 date 数值推演：

- `projects/date_当前平衡推演_v0.numlab.json`
- `reports/date_数值工具平衡推演_v0.md`

导入方式：顶栏「项目」→「导入」，选择项目 JSON。

新增的「数据列表」页签提供：左侧变量列表，右侧显示该量的上下游局域关系图；画布工具栏的「整理」按钮可按依赖层级自动排列节点。

## 在线界面

GitHub Pages 部署后入口：

https://zzr-afk.github.io/iseemath/

首次部署需要在仓库 `Settings → Pages → Build and deployment → Source` 选择 **GitHub Actions**，
之后推送到 `main` 会自动构建并发布 `dist`。
