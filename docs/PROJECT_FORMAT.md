# iseemath 项目格式规范

本文是导入/导出 JSON 的规范性说明，对应 `schemaVersion: 1`（应用版本 0.1.0）。实现以 `src/core/model/projectSchema.ts`、`src/core/model/invariants.ts` 与 `src/platform/storage/autosave.ts` 为准。

> 面向 AI 的生成/修改协议、模板与自检清单见 [AI 工作流指南](AI_GUIDE.md)。

## 1. 文件与信封

项目文件是 UTF-8 编码的 JSON，扩展名建议 `.numlab.json` 或 `.json`。不允许注释、尾随逗号。

标准导出信封：

```json
{
  "format": "numlab",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "exportedAt": 1730000000000,
  "project": { "...": "见 §3" },
  "viewState": { "...": "见 §8.6" },
  "comparisonRuns": []
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `format` | string | 导出时写 `"numlab"` | 导入只认 `project` 字段；该字段不参与校验 |
| `schemaVersion` | number | 导出时为 `1` | 信封版本；导入不校验 |
| `appVersion` | string | 导出时写应用版本 | 仅供诊断 |
| `exportedAt` | number | 导出时为毫秒时间戳 | 仅供诊断 |
| `project` | object | 是（信封形式） | 见 §3 |
| `viewState` | object | 否 | 折叠/视口状态；导入时原样恢复，不做结构校验 |
| `comparisonRuns` | array | 导出时为 `[]` | 预留；当前导入完全忽略 |

**导入兼容裸项目**：如果没有 `project` 字段，解析器把整个 JSON 当作 `project` 对象。因此最小可导入文件就是一个 `Project`。

Zod 默认**丢弃未知字段**，不会因多余字段报错。字段拼写错误可能被静默忽略，生成 JSON 时请严格按本文拼写。

## 2. 命名空间与名称规则

### 2.1 标识符

变量、分组、数据表的符号名 `name` 以及数据表字段名 `FieldDef.name` 必须满足：

```regex
/^[\p{L}_][\p{L}\p{N}_]*$/u
```

即：首字符为任意 Unicode 字母或下划线，后续为字母、数字或下划线。允许中文；禁止空格、运算符、标点和以数字开头。长度 1–128。

`label`（展示名）可自由填写，最长 256。

### 2.2 唯一性

- 变量、分组、数据表各自是独立命名空间：变量名在变量内唯一、分组名在分组内唯一、数据表名在数据表内唯一；均**不区分大小写**。
- 数据表字段名在**该表内**唯一，不区分大小写。
- 折叠包名项目内唯一，不区分大小写。
- 字段名与全局变量名**跨命名空间互斥**：字段不能遮蔽全局变量/函数/常量；变量也不能与任一数据表字段重名。UI 命令会拒绝；导入校验只检查部分项，AI 生成时必须自行遵守。
- 保留字/内置名不要用作符号名：`true`、`false`、`PI`、`E`、`and`、`or`，以及全部函数名（`abs`、`if` 等）。它们会优先按语法/函数解析，导致变量无法被引用。
- 分组名、数据表名、折叠包名**不是数值符号**，不能出现在公式中。

## 3. Project 对象

```json
{
  "schemaVersion": 1,
  "id": "proj_damage_example",
  "name": "伤害公式示例",
  "description": "可选",
  "nodes": { "<NodeId>": { "...": "见 §4" } },
  "datasets": [],
  "views": [],
  "comparisons": [],
  "tombstones": [],
  "relations": [],
  "bundles": [],
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `schemaVersion` | `1` | 是 | 必须是数字 1 |
| `id` | string | 是 | 项目 id；导入时会被替换为新 id |
| `name` | string | 是 | 非空项目名 |
| `description` | string | 否 | 项目说明 |
| `nodes` | object | 是 | 键为节点 id，值见 §4；最多 10,000 个 |
| `datasets` | DatasetMeta[] | 是 | 日志数据集元数据，见 §5 |
| `views` | AnalysisView[] | 是 | 保存的分析视图，见 §8.1 |
| `comparisons` | ComparisonConfig[] | 是 | 对比配置（M4 使用），见 §8.2 |
| `tombstones` | Tombstone[] | 是 | 删除节点墓碑，见 §8.3 |
| `scenarios` | Scenario[] | 否 | 预留，当前无 UI；`{ id, name, overrides: {nodeId: number} }` |
| `relations` | Relation[] | 是 | 手动影响边，最多 50,000 条，见 §8.4 |
| `bundles` | Bundle[] | 是 | 折叠包，最多 500 个，见 §8.5 |
| `createdAt` | number | 是 | 非负整数毫秒时间戳 |
| `updatedAt` | number | 是 | 非负整数毫秒时间戳 |

所有时间戳使用 Unix 毫秒。所有 `id` 是字符串；建议 ≤64 字符、全局唯一。

## 4. 节点

### 4.1 公共字段

变量、分组、数据表共有：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 1–64 字符；项目内唯一 |
| `kind` | `"variable" \| "group" \| "collection"` | 是 | 判别字段 |
| `name` | string | 是 | 符号名，规则见 §2 |
| `label` | string | 是 | 展示名，可重复 |
| `description` | string | 否 | 最长 4096 |
| `tags` | string[] | 是 | 每个最长 64，最多 64 个；没有时写 `[]` |
| `parentId` | string \| null | 是 | 归属上级 id；根节点写 `null` |
| `position` | `{x:number,y:number}` | 是 | 画布坐标，有限数值 |
| `color` | string | 否 | 最长 32 |
| `createdAt` | number | 是 | 非负整数毫秒 |
| `updatedAt` | number | 是 | 非负整数毫秒 |

层级约束：`parentId` 必须存在（或为 null），且不能形成环；自引用也是环。

### 4.2 变量节点

```json
{
  "id": "var_damage",
  "kind": "variable",
  "variableKind": "formula",
  "role": "output",
  "name": "伤害",
  "label": "最终伤害",
  "description": "可选",
  "tags": ["核心"],
  "parentId": "grp_combat",
  "position": { "x": 320, "y": 420 },
  "unit": "点",
  "precision": 2,
  "formula": "攻击力 * 技能倍率 - 防御力",
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `kind` | `"variable"` | 是 | |
| `variableKind` | `"constant" \| "formula" \| "curve" \| "table"` | 是 | |
| `role` | `"input" \| "intermediate" \| "output"` | 是 | 分析元数据；`input` 约定为无公式依赖的常量 |
| `unit` | string | 否 | 最长 32 |
| `precision` | number | 否 | 0–12 的整数 |
| `value` | number | constant 必需（语义） | 常量值；缺省按 0 求值 |
| `formula` | string | formula 必需（语义） | 最长 8KB；空公式会报错 |
| `curve` | CurveData | curve 必需（语义） | 见 §4.5 |
| `table` | TableData | table 必需（语义） | 见 §4.5 |

语义约束：

- `variableKind: "constant"` 不应同时带 `formula`；若 `role: "input"`，更不允许带公式（导入不变量会拒绝 `input + formula`）。
- `variableKind: "formula"` 使用 `formula` 字段；`curve`/`table` 节点本身不产生标量值（显示为 `—`），只能作为函数被调用。
- 只有 `constant` / `formula` 节点可以加入折叠包。
- 只有 `curve` 节点可被 `名称(x)` 调用；只有 `table` 节点可被 `名称(key, "列名")` 调用。

### 4.3 分组节点

```json
{
  "id": "grp_combat",
  "kind": "group",
  "name": "战斗",
  "label": "战斗",
  "tags": [],
  "parentId": null,
  "position": { "x": 80, "y": 80 },
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

分组是逻辑节点，不是 React Flow 容器；无额外字段。不能作为数值标识符引用，不参与计算。

### 4.4 数据表节点（Collection）

```json
{
  "id": "col_monster",
  "kind": "collection",
  "name": "怪物表",
  "label": "怪物数据表",
  "tags": ["批量"],
  "parentId": null,
  "position": { "x": 120, "y": 240 },
  "datasetId": "ds_monster",
  "dataRevision": 1,
  "dataMissing": false,
  "fields": [
    {
      "id": "f_hp",
      "name": "HP",
      "label": "生命值",
      "type": "number",
      "role": "input",
      "sourceColumnId": "c0:513ad2652efb3a88"
    },
    {
      "id": "f_power",
      "name": "Power",
      "label": "战力",
      "type": "number",
      "role": "derived",
      "formula": "HP * ATK / (DEF + 100) * 伤害倍率"
    }
  ],
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `kind` | `"collection"` | 是 | |
| `datasetId` | string | 是 | 绑定数据集 id；语义上应存在 |
| `fields` | FieldDef[] | 是 | 最多 512 个；字段单一事实源 |
| `dataRevision` | number | 是 | 非负整数；数据/映射变化时递增，参与求值缓存 |
| `dataMissing` | boolean | 否 | 数据不可用或字段映射失效；为 true 时禁止批量求值 |

FieldDef：

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 表内唯一 |
| `name` | string | 是 | 行作用域符号名，规则见 §2 |
| `label` | string | 是 | 展示名 |
| `type` | `"number" \| "string" \| "date" \| "enum"` | 是 | 输入列须与映射列类型兼容；派生列只能 `number` |
| `role` | `"input" \| "derived"` | 是 | |
| `sourceColumnId` | string | input 必需 | 必须指向绑定数据集的 `DatasetColumn.id` |
| `formula` | string | derived 必需 | 行作用域公式，最长 8KB |
| `unit` | string | 否 | 最长 32 |
| `missing` | boolean | 否 | 该字段映射失效；由重新校验写入 |

类型兼容规则：`number↔number`、`date↔date`、`string↔string`、`enum↔enum`，以及 `string↔enum`。其它组合不兼容。数值/日期字段才能参与派生公式（日期在内部是 epoch 毫秒）。

### 4.5 曲线与表格数据

CurveData：

```json
{
  "points": [{ "x": 1, "y": 10 }, { "x": 2, "y": 18 }],
  "interpolation": "linear",
  "extrapolation": "clamp"
}
```

- `points` 最多 2000 个，坐标必须有限。
- `interpolation`: `linear` / `step` / `monotone`。注意：当前求值器对 `monotone` 也按线性插值处理。
- `extrapolation`: `clamp` / `extend` / `error`。求值时会先按 x 排序；建议生成时保持 x 严格递增。
- 空曲线运行时报“曲线没有数据点”。

TableData：

```json
{
  "keyColumn": "k",
  "columns": [
    { "id": "k", "name": "等级", "type": "number" },
    { "id": "atk", "name": "攻击", "type": "number" }
  ],
  "rows": [[1, 10], [2, 18]],
  "lookup": "linear"
}
```

- `keyColumn` 必须是 `columns[].id` 之一。
- `rows` 最多 5000 行，单元格为 number 或 string。
- `lookup`: `exact` / `linear`。`linear` 仅对数值 key 生效；非数值 key 退化为精确匹配。
- 调用形式 `表名(key, "列名")`；第二参数必须是字符串，且与 `columns[].name` **精确匹配**（当前实现按显示名查找，不是按列 id）。
- 精确查找找不到 key 时报错；线性查找会排序后插值，超出范围取端点值。

## 5. 数据集元数据

日志原始字节和解析结果**不进入项目 JSON**，只保存元数据。

```json
{
  "id": "ds_monster",
  "name": "怪物样例.csv",
  "format": "csv",
  "storage": "blob",
  "blobKey": "proj_monster_example:demo-blob",
  "encoding": "utf-8",
  "delimiter": ",",
  "hasHeader": true,
  "timeZone": "Asia/Shanghai",
  "dateFormat": "auto",
  "parserVersion": "1.0.0",
  "dataUnavailable": false,
  "rawBytesHash": "...",
  "parseParamsHash": "...",
  "contentHash": "...",
  "outputDigest": "...",
  "columns": [
    { "id": "c0:513ad2652efb3a88", "name": "HP", "type": "number", "sourceIndex": 0 }
  ],
  "rowCount": 3,
  "datasetHash": "...",
  "createdAt": 1730000000000
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 数据集 id |
| `name` | string | 是 | 原文件名或展示名 |
| `format` | `"csv" \| "jsonl" \| "xlsx" \| "manual"` | 是 | 当前 UI 支持 csv/jsonl；xlsx/manual 为预留 |
| `storage` | `"blob" \| "manual"` | 是 | blob = 原始文件在 IndexedDB；manual 为预留 |
| `blobKey` | string | 否 | `${projectId}:${随机串}`；导入时被清空 |
| `encoding` | string | 否 | `utf-8` / `gb18030` / `utf-16le` 等 |
| `delimiter` | string | 否 | CSV 分隔符 |
| `hasHeader` | boolean | 否 | CSV 是否有表头；JSONL 忽略 |
| `sheet` | string | 否 | 预留（Excel） |
| `timeZone` | string | 否 | IANA 时区，用于日期列 |
| `dateFormat` | string | 否 | `auto` / `epoch-ms` / `epoch-s` |
| `parserVersion` | string | 是 | 解析器版本，进入 `datasetHash` |
| `dataUnavailable` | boolean | 否 | 数据源不可用；为 true 时禁止运行相关分析 |
| `rawBytesHash` | string | 是 | 原始字节哈希；manual 为固定值 |
| `parseParamsHash` | string | 是 | 解析参数哈希 |
| `contentHash` | string | 是 | `hashString(rawBytesHash + "|" + parseParamsHash)` |
| `outputDigest` | string | 是 | 列式输出摘要 |
| `columns` | DatasetColumn[] | 是 | 最多 4096 列 |
| `rowCount` | number | 是 | 非负整数 |
| `datasetHash` | string | 是 | `hashString(contentHash + "|" + parserVersion + "|" + outputDigest)` |
| `createdAt` | number | 是 | 非负整数毫秒 |

DatasetColumn：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定列 id，见 §5.1 |
| `name` | string | 规范化后的列名（重复表头会变为 `名称 (2)`） |
| `type` | `"number" \| "string" \| "date" \| "enum"` | 列类型 |
| `sourceIndex` | number | 原始列序号（0 起） |

### 5.1 稳定列 id

```text
columnId = "c" + sourceIndex + ":" + hashString(name.trim().toLowerCase())
```

`hashString` 是两条 FNV-1a 32 位通道，对 UTF-16 code unit 迭代，输出 16 位十六进制：

```js
function hashString(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") +
         (h2 >>> 0).toString(16).padStart(8, "0");
}
```

示例（`sourceIndex` / 规范化列名 → id）：

| 列 | id |
|---|---|
| 0 / `hp` | `c0:513ad2652efb3a88` |
| 1 / `atk` | `c1:1261745941ef77f4` |
| 2 / `def` | `c2:c5597e8c08f4a68b` |
| 3 / `区服` | `c3:1a438b209001b54f` |

重命名表头会改变列 id。**能从现有项目读到列 id 时，永远直接复用，不要重算。**

## 6. 公式语言

### 6.1 词法与值

- 空白（含换行）忽略。
- 数字：十进制，可带小数点和指数，如 `1`、`.5`、`1.`、`2e-3`。不支持十六进制。必须解析为有限数。
- 字符串：双引号；转义 `\"`、`\\`、`\n`、`\t`、`\uXXXX`（恰好 4 位十六进制）。字符串只能用于表格列名，不能参与算术或拼接。
- 标识符：`/^[\p{L}_][\p{L}\p{N}_]*$/u`。
- 字面量：`true`、`false`、`PI`、`E`。
- 运算符：`+ - * / % ^`、`< <= > >= == !=`、`and`、`or`、`? :`、`()`、`,`；绑定语句还使用 `=` 和 `;`。
- 值类型：number、boolean、string。没有 null/数组/对象。

### 6.2 优先级（低 → 高）

| 级别 | 运算符 | 结合性 |
|---|---|---|
| 1 | `条件 ? 值1 : 值2` | 右结合 |
| 2 | `or` | 左结合 |
| 3 | `and` | 左结合 |
| 4 | `< <= > >= == !=` | 非链式（禁止 `1<2<3`） |
| 5 | `+ -` | 左结合 |
| 6 | `* / %` | 左结合 |
| 7 | 一元 `+ -` | 前缀；低于 `^` |
| 8 | `^` | 右结合 |

关键例子：

| 表达式 | 结果/说明 |
|---|---|
| `-2^2` | `-4`（一元负号低于幂） |
| `2^-3` | `0.125` |
| `2^3^2` | `512`（右结合） |
| `-5 % 3` | `-2`（符号随被除数，同 JS `%`） |
| `1 < 2 and 2 < 3` | `true` |
| `1 < 2 < 3` | 解析错误：比较不能链式 |
| `true ? 1 : 1/0` | `1`（只求选中分支） |
| `false and 1/0 > 0` | `false`（短路） |

### 6.3 运算语义

- 算术与关系比较只接受 number；布尔/字符串不会隐式转数值。
- `==` / `!=` 是严格相等（`===`/`!==`），可比较任意值，不做类型转换。
- 除零、取余除零报错；`0^-1` 报错；`0^0 = 1`。
- 任何中间结果非有限（Infinity/NaN）都报错，不会静默返回 Infinity。
- `and` / `or` 的操作数必须是 boolean，且短路。
- 三元条件必须是 boolean，只求选中分支。
- `if(cond, a, b)` 是惰性特殊形式，恰好 3 个参数；未选中分支不求值。
- 单次标量求值步数上限 200,000；批量派生列每行上限 50,000。
- 公式不再使用 `eval` / `new Function`。

### 6.4 函数

| 函数 | 参数 | 语义 |
|---|---|---|
| `abs(x)` | 1 | 绝对值 |
| `ceil(x)` / `floor(x)` | 1 | 向上/向下取整 |
| `round(x)` | 1 | 四舍五入，半远离零 |
| `sign(x)` | 1 | -1 / 0 / 1 |
| `sqrt(x)` | 1 | 平方根；负数结果 NaN → 报域错误 |
| `exp(x)` | 1 | e^x |
| `ln(x)` | 1 | 自然对数 |
| `log10(x)` | 1 | 以 10 为底 |
| `log(x)` | 1 | 等价 `log10(x)` |
| `log(x, base)` | 2 | 任意底 |
| `pow(a, b)` | 2 | 幂（同 `^`，含 0 的负次幂检查） |
| `min(...)` / `max(...)` | ≥1 | 数值最值 |
| `clamp(x, lo, hi)` | 3 | `lo <= hi`，否则报错 |
| `lerp(a, b, t)` | 3 | `a + (b-a)*t` |
| `isNaN(x)` | 1 | `x` 为 NaN 或非数值时返回 true |
| `if(cond, a, b)` | 3 | 惰性条件 |

**未实现 `not`**。自动补全可能提示它，但求值会报“未知函数：not”。取反请写 `x == false` 或 `if` 分支。

### 6.5 局部变量

公式可以先用 `let` 定义局部变量，再写结果表达式。`let` 可省略；每条绑定必须以 `;` 结束：

```
let a = 基础主属性 * (1 + 主属性提成);
let b = 最终主属性 + 100;
a * b
```

`a = 基础主属性 * (1 + 主属性提成); b = a + 100; a * b` 与上式等价。

- 局部变量名遵循标识符规则，大小写不敏感；同一公式内不能重复定义。
- 初始化表达式只能引用**之前**的局部变量和全局变量；结果表达式可以引用全部局部变量。
- 局部变量优先于同名全局变量（遮蔽），但不会创建项目节点，也不会出现在画布或依赖边中。
- 局部变量只存在于当前公式，不能跨节点使用；需要复用时仍应建全局变量。
- `let`、`true`、`false`、`and`、`or`、`PI`、`E` 不能作为局部变量名。
- 依赖分析只收集未被局部绑定的自由标识符，因此局部变量不会产生“未知变量”或依赖边。

### 6.6 依赖、曲线与表格调用

- 依赖来源：公式中的**自由**标识符 + 函数调用名（`collectIdentifiers` + `collectCalls`）；局部绑定名会被排除。
- 内置函数名从依赖中排除；其它名字若匹配到变量（先精确、再大小写不敏感），建立依赖边；否则进入“未知变量”。
- 分组/数据表/折叠包不是变量，无法解析为数值符号。
- 调用用户对象：`曲线名(x)`（1 个数值参数）；`表名(key, "列名")`（2 个参数，第二参数必须是字符串）。常量/公式节点不可调用。
- 静态依赖覆盖所有分支：即使某分支永远不会执行，其中引用的未知变量仍会导致绑定错误。
- 环检测使用 Tarjan SCC；环内节点以及无法拓扑排序的下游节点都显示“循环引用”并不参与求值。其余节点按拓扑顺序求值。
- 解析失败时该节点错误为具体解析信息；不会保留旧值。

## 7. 数据表语义

### 7.1 字段分析

对每个 `role: "derived"` 字段：

1. 解析公式；空公式 → “派生列公式为空”；解析失败 → 解析错误信息。
2. 收集标识符与调用名；先按字段名解析（精确优先，其次大小写不敏感）。
3. 命中字段：
   - 若字段类型不是 number/date，记录“公式引用了非数值字段”；
   - 否则加入列级依赖。
4. 未命中字段的名字保留为全局引用，由项目级求值解析。
5. 对派生列做列级 DAG + Tarjan：
   - 环内字段 → “派生列存在循环引用”；
   - 依赖环但不在环内的字段 → “依赖的派生列存在循环引用”；
   - 其余按拓扑顺序求值。

### 7.2 逐行求值

- 行作用域：字段优先；字段不存在时回落到全局变量/曲线/表格。
- 输入字段：
  - number/date 字段直接复制列向量（date 为 epoch ms）；文本/enum 字段可展示，但不能参与数值公式。
  - 映射列缺失/类型不兼容 → 字段级错误，整列不可计算。
- 派生字段逐行执行：
  - 引用字段时，该行无效（空/坏）→ 报“字段在该行为空”；
  - 引用全局时，全局值缺失/非有限 → 报“变量没有有效数值”；
  - 单个派生列某行失败只让该行该列无效。
- `errorRows` 统计“至少一个派生列失败”的行数；`firstError` 记录该列第一个错误行与消息。
- 预览只取前 50 行；批量求值本身可以处理整表。
- `dataMissing` 或绑定问题存在时，不进行批量求值。

### 7.3 与全局变量的关系

- 派生列可以引用全局常量/公式/曲线/表格。
- 全局变量不能引用数据表字段；标量公式中写字段名会变成“未知变量”。
- 画布只画“全局变量 → 数据表”的类型级依赖边；不会展开行级边。

## 8. 其余项目结构

### 8.1 AnalysisView（分析视图）

```json
{
  "id": "view_1",
  "name": "按等级统计",
  "datasetId": "ds_1",
  "filters": [
    { "fieldId": "c1:...", "op": "gte", "value": 10 }
  ],
  "groupBy": ["c0:..."],
  "metrics": [
    { "id": "m1", "op": "avg", "fieldId": "c2:...", "alias": "平均伤害" }
  ],
  "chart": { "type": "line", "xFieldId": "c0:...", "yMetricIds": ["m1"] },
  "timeBucket": { "fieldId": "c3:...", "unit": "day" },
  "schemaHash": "...",
  "status": "active",
  "createdAt": 1730000000000,
  "updatedAt": 1730000000000
}
```

- `filters[].fieldId`、`groupBy[]`、`metrics[].fieldId`、`chart.xFieldId`、`timeBucket.fieldId` 都是 `DatasetColumn.id`。
- `Filter.op`：`eq neq gt gte lt lte in contains isNull notNull`；`value` 可为 string/number/boolean/null/数组。
- `Metric.op`：`count sum avg min max median p90 p95`；`count` 可无 `fieldId`。
- `ChartSpec.type`：`line bar scatter histogram`；当前 UI 只生成 line/bar。
- `groupBy` 当前 UI 最多 3 个字段。
- `timeBucket.unit`：`minute hour day month`。
- `schemaHash` 是视图引用列（id + type）的稳定哈希；数据集列变化后与当前哈希不一致，视图失效。
- `status`：`active` / `broken`；`brokenReason` 为可选说明。失效视图不会被自动恢复。

### 8.2 ComparisonConfig（对比配置，M4）

当前 UI 不提供。schema 已预留三种判别联合，导入时全部强制 `status: "broken"`、`brokenReason: "data-unavailable"`。AI 除非用户明确要求，不应生成。

公共字段：`id name datasetId configHash status brokenReason? createdAt updatedAt`。

| `mode` | 额外字段 |
|---|---|
| `curve-vs-aggregate` | `analysisViewId`, `modelNodeId`, `keyFieldId`, `metricId`, `tolerance?` |
| `column-to-input` | `mapping: Record<NodeId, columnId>`, `truthColumnId`, `tolerance?` |
| `collection-vs-log` | `collectionNodeId`, `collectionFieldId`, `truthColumnId`, `tolerance?` |

`tolerance`：`{ abs?: number, rel?: number }`，非负。

### 8.3 Tombstone

```json
{ "nodeId": "var_old", "name": "旧变量", "deletedAt": 1730000000000 }
```

删除节点时记录；运行时最多保留最近 500 条。导入时 schema 只校验类型，不校验 id 是否与现存节点冲突（UI 当前不自动重绑定）。

### 8.4 Relation（影响边）

```json
{
  "id": "rel_1",
  "source": "var_balance",
  "target": "var_damage",
  "kind": "influence",
  "label": "可选说明"
}
```

- `kind` 只能是 `"influence"`。
- `source` / `target` 必须指向存在的节点；不能自连；同一对 source→target 不能重复。
- 不参与计算，允许成环。
- 导入时端点不存在会直接拒绝。

### 8.5 Bundle（折叠包）

```json
{
  "id": "bundle_1",
  "name": "乘区",
  "memberIds": ["var_attack", "var_skill"],
  "summary": { "mode": "product" },
  "color": "#4f9dff"
}
```

- `memberIds` 至少 1 个；成员必须是 `constant` 或 `formula` 变量；不能重复；一个节点最多属于一个包。
- `summary.mode`：`none member sum product avg min max`。
- `mode: "member"` 时 `summary.memberId` 必须是本包成员。
- 折叠状态不在 Bundle 内，而在 `viewState.bundleCollapsed`。
- 不支持包嵌套。

### 8.6 ProjectViewState

```json
{
  "schemaVersion": 1,
  "bundleCollapsed": { "bundle_1": true },
  "groupCollapsed": { "grp_combat": false },
  "nodeSizes": { "var_attack": { "width": 200, "height": 72 } },
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

导入时如果信封带 `viewState` 会原样恢复；当前没有额外的结构校验，生成时应保证字段类型正确。可省略整个 `viewState`。

## 9. 导入校验与导入时改写

### 9.1 校验顺序

1. 文本长度 ≤ 50MB（按字符串长度）。
2. `JSON.parse`。
3. 取 `envelope.project ?? 整个对象`。
4. Zod `parseProject`：校验必需字段、类型、枚举、长度、数量上限；只报告**第一个**错误。
5. `validateProject` 结构不变量：名称/唯一性/层级/字段重复/影响边/折叠包。也只报告第一个错误。

`validateProject` 当前检查：

- 变量、分组、数据表符号名符合标识符规则，且各自命名空间不区分大小写唯一；
- `parentId` 存在且无环；
- 数据表内字段名不重复（不校验字段名是否为合法标识符）；
- 影响边两端存在且 id 不重复；
- 折叠包名唯一、至少一个成员、成员存在、不能重复打包、成员必须是 constant/formula、`summary.memberId` 合法；
- `variableKind: "constant" && role: "input"` 不应带 `formula`。

**导入不会检查**（这些是语义/运行时问题）：公式是否能解析、未知变量、循环引用、数据表 `datasetId` 是否存在、字段映射/类型、字段与全局名冲突、派生列是否 number、分析视图引用列、对比配置、`viewState` 结构。导入成功后这些会以卡片/问题面板/“失效”标签的形式出现。

### 9.2 强制改写

导入成功后会构造一个**新项目**：

- 新 `project.id = nanoid()`；名称、节点、关系、视图等保留；
- 每个数据集：`blobKey = undefined`、`dataUnavailable = true`；
- 每个分析视图：`status = "broken"`、`brokenReason = "data-unavailable"`；
- 每个对比配置：`status = "broken"`、`brokenReason = "data-unavailable"`；
- 每个数据表节点：`dataMissing = true`；
- `createdAt` / `updatedAt` 改为当前时间；
- 作为新的本地项目保存并打开；不覆盖任何现有项目；
- 若信封提供 `viewState`，尝试写入（失败忽略）；
- `comparisonRuns` 忽略。

因此：**导入不会带回日志数据**。需要用户在「日志分析」里重新导入或“替换数据源”，之后重新创建/运行分析视图。

### 9.3 上限

| 项 | 上限 |
|---|---|
| 导入 JSON 文本 | 50MB |
| 节点数 | 10,000 |
| 影响边 | 50,000 |
| 折叠包 | 500 |
| 单条公式 | 8KB |
| 曲线点 | 2,000 |
| 表格行 | 5,000 |
| 数据表字段 | 512 |
| 数据集列 | 4,096 |
| 日志文件 | 50MB |

## 10. 求值哈希

`evalHash` 只用于判断求值结果是否过期，不写入导出文件。当前实现（`src/core/eval/hash.ts`，`EVAL_VERSION = "1"`）：

- 节点按 id 排序；
- 变量指纹：`id kind variableKind role`，以及按类型取 `value` / `formula` / `curve` / `table`；
- 数据表指纹：`id kind datasetId dataRevision dataMissing fields`；
- **不包含**：`position`、`color`、`label`、`tags`、`parentId`、`precision`、折叠状态、视口、bundles、relations、views。

因此移动节点、改色、改展示名、折叠包不会让求值失效；改常量/公式/曲线/表格、改字段、改 `dataRevision` 会。

## 11. 最小示例

完整可导入文件见：

- [formula.project.json](examples/formula.project.json) — 分组、三个常量、一个公式、影响边、折叠包；
- [collection.project.json](examples/collection.project.json) — 数据集元数据、输入字段映射、派生列、全局常量引用；

最小项目骨架：

```json
{
  "schemaVersion": 1,
  "id": "p1",
  "name": "最小项目",
  "nodes": {},
  "datasets": [],
  "views": [],
  "comparisons": [],
  "tombstones": [],
  "relations": [],
  "bundles": [],
  "createdAt": 0,
  "updatedAt": 0
}
```

## 12. 版本演进

- 当前只接受 `project.schemaVersion === 1`；没有迁移管线时会直接报错。
- 新增字段应保持向后兼容（可选）；删除/改名字段需要提升 `schemaVersion` 并实现迁移。
- `format` / 信封 `schemaVersion` 目前不参与导入判断，但外部工具应继续写入标准值。
