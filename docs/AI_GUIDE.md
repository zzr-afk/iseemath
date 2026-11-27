# iseemath AI 工作流指南

本文写给需要**生成或修改 iseemath 项目 JSON** 的外部 AI/自动化工具，同时也可作为人类审阅 AI 产出的检查表。

当前应用内不调用 AI，也没有片段导入/补丁导入。唯一稳定的机器接口是：

```text
用户在应用内导出项目 JSON → AI 修改完整 JSON → 用户在应用内导入
```

因此 AI 的产出必须是一份**完整、自洽、可直接导入**的项目文件，而不是说明文字、diff 或片段。

相关文档：

- 字段的规范性定义：[PROJECT_FORMAT.md](PROJECT_FORMAT.md)
- 人类使用说明：[USER_GUIDE.md](USER_GUIDE.md)
- 可直接导入的完整示例：[formula.project.json](examples/formula.project.json)、[collection.project.json](examples/collection.project.json)、[bishop-6min-graph.project.json](examples/bishop-6min-graph.project.json)（分步计算图的读法见 [bishop-6min-graph.md](examples/bishop-6min-graph.md)）

---

## 1. 必须遵守的协议

1. **以用户导出的完整 JSON 为唯一基线。** 不要凭记忆重建项目；不要遗漏未修改的节点、关系、包、数据集、视图、墓碑。
2. **输出完整项目文件。** 优先保留导出信封（`format/schemaVersion/appVersion/exportedAt/project/viewState/comparisonRuns`），只修改 `project` 中需要变化的部分；也可以输出裸 `project` 对象。不要在 JSON 中写注释、Markdown 代码围栏或解释文字。
3. **未修改对象的字段原样保留。** 尤其是：`id`、`datasetId`、`DatasetColumn.id`、`FieldDef.sourceColumnId`、`schemaHash`、`dataRevision`、各类哈希、`createdAt`。
4. **不要伪造日志数据。** 导出文件不含原始日志；AI 只能修改元数据/模型结构。需要真实数据时，让用户先在应用内导入日志并重新导出。
5. **导入一定创建新项目，且会清空数据可用性。** 所有数据集变成 `dataUnavailable: true`，分析视图和对比配置变成 `broken / data-unavailable`，数据表 `dataMissing: true`。这是预期行为，不是 AI 的错误；但必须在交付说明中告知用户。
6. **导入会校验结构，不会自动修复。** 悬空上级、悬空影响边、坏折叠包、重名等会让导入失败。生成后必须按 §5 自检。
7. **公式/字段名属于代码，不属于文案。** 不要为了“更好看”改符号名；改符号名必须同步改写所有引用。
8. **输出必须可被 `JSON.parse` 解析。** 使用 UTF-8，双引号，无尾随逗号。

---

## 2. 标准工作流

### 步骤 0：读取与确认

- 读取用户导出的 `.json`；若存在 `project` 字段，以它为准，否则整个对象就是项目。
- 记录：项目 id、所有节点 id/name/kind、数据集 id 与列 id、现有折叠包、视图。
- 明确用户目标：新增节点/改公式/建数据表/重命名/删节点/建包等。
- 如果目标依赖不存在的日志列或真实数据，先停止并让用户导入数据、重新导出。

### 步骤 1：列出变更计划

在正式产出前，用一句话列出：

- 新增哪些节点/关系/字段；
- 修改哪些公式；
- 删除哪些对象及其连带清理；
- 是否新建占位数据集；
- 哪些内容会被导入机制标记为不可用。

### 步骤 2：生成完整 JSON

- 从基线复制整个项目，在原对象上做最小修改。
- 新对象使用唯一 id；已有对象不改 id。
- 保持 `nodes` 的键与节点自身 `id` 完全一致。
- 所有数组字段即使为空也要保留（`[]`）。
- 时间戳使用毫秒整数；可以沿用基线时间或使用当前时间。

### 步骤 3：按 §5 自检

逐项检查；任何一项不满足都不要交付。

### 步骤 4：交付

交付内容建议只包含：

1. 一个 JSON 文件（或完整 JSON 代码块）；
2. 一份简短变更摘要（新增/修改/删除、假设、导入后需要用户手动完成的事）。

明确告诉用户：**导入后需要重新绑定数据源/重建分析视图**（如果项目含数据集）。

### 步骤 5：导入后的预期状态

- 模型节点、公式、影响边、折叠包立即可用；
- 数据表结构保留，但 `dataMissing=true`，预览为空，直到用户替换数据源；
- 分析视图显示“失效”，需重新创建；
- 对比分析当前版本不可用。

---

## 3. ID 与命名规则

### 3.1 节点/对象 ID

- 任意非空字符串，建议 ≤64 字符；项目内唯一。
- 建议加前缀便于审阅：`grp_`、`var_`、`col_`、`f_`、`ds_`、`rel_`、`bundle_`、`view_`。
- **不要修改已有对象的 id。** 公式通过 `name` 绑定，但数据表映射、对比配置、视图通过 id 引用。
- 不要复用已删除节点的 id；新 id 加随机后缀，例如 `var_damage_7k2`。
- `project.nodes` 的键必须等于节点对象的 `id`。

### 3.2 符号名 `name`

- 必须匹配：`/^[\p{L}_][\p{L}\p{N}_]*$/u`（字母/下划线开头，后续字母/数字/下划线；中文可用）。
- 不要使用空格、`+ - * / % ^ ( ) , ? : < > = !`、引号、点号。
- 不要使用：`true false PI E and or` 以及任何函数名（`abs ceil floor round sign sqrt exp ln log log10 pow min max clamp lerp isNaN if not`）。
- 变量、分组、数据表各自命名空间内不区分大小写唯一。
- 数据表字段名在该表内唯一，且不能与任何全局变量/函数/常量重名。
- 全局变量名不能与任何数据表字段名重名。
- 展示名 `label` 不受这些限制。

### 3.3 改名协议（原子）

重命名变量时，必须同时：

1. 修改该节点的 `name`；
2. 扫描**所有** `variableKind:"formula"` 的 `formula`；
3. 扫描**所有**数据表的 `fields[].formula`；
4. 只替换作为标识符出现的旧名：不能替换字符串字面量里的内容、函数名、数据表列参数；
5. 不能替换另一个数据表中同名字段（如果有遮蔽，字段优先，不应改全局引用）。

建议先建立 `旧名 -> 新名` 映射，再统一替换，最后重新扫描是否还有旧名残留。改完后检查是否与字段名/其它变量冲突。

### 3.4 删除协议

删除节点时，必须同步完成：

1. 从 `project.nodes` 删除；
2. 其直接子节点的 `parentId` 提升为被删节点的 `parentId`（不级联删除）；
3. 从所有 `bundles[].memberIds` 移除；
4. 若某包 `summary.memberId` 指向被删节点 → 改为 `{ "mode": "none" }`；
5. 若包成员删空 → 删除整个包；
6. 删除所有 `source` 或 `target` 指向它的 `relations`；
7. 删除 `scenarios[].overrides` 中的对应键（若存在）；
8. 可追加 `tombstones` 记录，但不要依赖它自动修复公式；
9. 公式中对它的引用会变成“未知变量”——如果这不是用户想要的，需改为新符号或删除公式依赖；
10. 若删的是数据表，数据集默认保留；若删的是数据集，相关视图应删除或接受导入后统一失效。

只要第 3/4/5/6 步漏做，导入就会因悬空引用失败。

---

## 4. 常用配方

### 4.1 新增常量 + 公式（无数据）

在 `project.nodes` 中新增，注意 `parentId` 指向存在的分组或 null：

```json
{
  "var_attack": {
    "id": "var_attack",
    "kind": "variable",
    "variableKind": "constant",
    "role": "input",
    "name": "攻击力",
    "label": "攻击力",
    "tags": [],
    "parentId": null,
    "position": { "x": 80, "y": 240 },
    "value": 100,
    "createdAt": 1730000000000,
    "updatedAt": 1730000000000
  },
  "var_damage": {
    "id": "var_damage",
    "kind": "variable",
    "variableKind": "formula",
    "role": "output",
    "name": "伤害",
    "label": "伤害",
    "tags": [],
    "parentId": null,
    "position": { "x": 360, "y": 240 },
    "formula": "攻击力 * 2",
    "createdAt": 1730000000000,
    "updatedAt": 1730000000000
  }
}
```

不要手写依赖边；依赖由公式自动派生。位置只是展示，建议按 260×140 网格排布，避免重叠。

### 4.2 新增影响边

```json
{
  "id": "rel_balance_damage",
  "source": "var_balance",
  "target": "var_damage",
  "kind": "influence",
  "label": "版本平衡影响伤害"
}
```

两端节点必须存在；不能自连；同一 source→target 只保留一条。

### 4.3 新增折叠包

```json
{
  "id": "bundle_multipliers",
  "name": "乘区",
  "memberIds": ["var_attack", "var_skill"],
  "summary": { "mode": "product" }
}
```

- 成员必须存在、是常量或公式变量、未被其它包占用；
- `memberId` 汇总模式必须指向本包成员；
- 包名不能与其它包重复；
- 折叠状态不必写；如要控制，可在 `viewState.bundleCollapsed` 增删条目。

### 4.4 基于现有数据集新增数据表

前提：导出中已有 `datasets` 条目及 `columns`。这是最可靠的批量建模方式。

1. 选择目标 `dataset.id`。
2. 为每个要用的列创建输入字段，`sourceColumnId` 直接复制 `DatasetColumn.id`（**不要重算**）；字段 `type` 与列类型兼容。
3. 字段名使用合法标识符，避免与全局变量/函数冲突；表内唯一。
4. 派生字段 `role:"derived"`、`type:"number"`、写行作用域公式。
5. 节点：

```json
{
  "col_monster": {
    "id": "col_monster",
    "kind": "collection",
    "name": "怪物表",
    "label": "怪物数据表",
    "tags": [],
    "parentId": null,
    "position": { "x": 120, "y": 240 },
    "datasetId": "ds_monster",
    "dataRevision": 1,
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
        "formula": "HP * 2"
      }
    ],
    "createdAt": 1730000000000,
    "updatedAt": 1730000000000
  }
}
```

数据表节点加入后，`dataMissing` 可省略；导入会统一置 true，等待用户替换数据源。

### 4.5 新建占位数据集（用户尚未导入数据）

仅当用户明确希望“先把结构搭好，之后再导入数据”时使用。新建 DatasetMeta 并让数据表绑定它：

```json
{
  "id": "ds_monster",
  "name": "怪物数据（待导入）.csv",
  "format": "csv",
  "storage": "blob",
  "encoding": "utf-8",
  "delimiter": ",",
  "hasHeader": true,
  "parserVersion": "1",
  "dataUnavailable": true,
  "rawBytesHash": "placeholder",
  "parseParamsHash": "placeholder",
  "contentHash": "placeholder",
  "outputDigest": "placeholder",
  "columns": [
    { "id": "c0:513ad2652efb3a88", "name": "HP", "type": "number", "sourceIndex": 0 },
    { "id": "c1:1261745941ef77f4", "name": "ATK", "type": "number", "sourceIndex": 1 },
    { "id": "c2:c5597e8c08f4a68b", "name": "DEF", "type": "number", "sourceIndex": 2 }
  ],
  "rowCount": 0,
  "datasetHash": "placeholder",
  "createdAt": 1730000000000
}
```

关键：列 `id` 必须按 [PROJECT_FORMAT §5.1](PROJECT_FORMAT.md#51-稳定列-id) 的确定性规则，用**预期 CSV 表头**计算，否则用户之后“替换数据源”时字段映射对不上。

生成占位数据集时必须在交付说明中写明：

- 预期 CSV 表头与列顺序；
- 导入项目后，到「日志分析 → 该数据集 → 替换数据源」上传真实文件；
- 列名/顺序不一致会导致字段缺失，需要在数据表编辑器中重选映射。

若用户只是要纯数学建模，不要创建占位数据集；用标量节点即可。

### 4.6 修改公式

- 只改目标 `formula` 字符串；不要改无关节点。
- 使用 §6 的语法；不要用 `not`、字符串拼接、数组、对象。
- 表调用：`表名(key, "列名")`，列名必须与 `table.columns[].name` 完全一致。
- 曲线调用：`曲线名(x)`。
- 公式是“零或多条局部绑定 + 一个结果表达式”，绑定写成 `let a = ...;`（`let` 可省略），最后写结果；不要写循环、条件语句块或函数定义。
- 局部变量只存在于当前公式，不会生成节点或依赖边；依赖分析只看自由变量。
- 如果引用数据表字段（只能在数据表的派生公式中），字段名优先解析；全局同名变量会被遮蔽。

---

## 5. 自检清单（交付前逐项执行）

### 5.1 JSON 与根对象

- [ ] `JSON.parse` 成功；无注释/尾随逗号/NaN/Infinity。
- [ ] 有 `project`（信封）或整个对象就是项目。
- [ ] `project.schemaVersion === 1`；`id/name` 为非空字符串。
- [ ] 根字段齐全：`nodes datasets views comparisons tombstones relations bundles createdAt updatedAt`。
- [ ] 所有时间戳是非负整数。

### 5.2 节点

- [ ] `Object.entries(nodes)` 中每个 `key === node.id`。
- [ ] 每个节点有 `kind`，且为 `variable|group|collection` 之一。
- [ ] 每个节点有 `name label tags parentId position createdAt updatedAt`。
- [ ] 变量有 `variableKind`（`constant|formula|curve|table`）与 `role`（`input|intermediate|output`）；对应类型的数据字段存在。
- [ ] 分组没有多余的计算字段。
- [ ] 数据表有 `datasetId`、`dataRevision`、`fields`；字段 ≤512。
- [ ] 所有符号名匹配标识符正则；变量/分组/数据表各自不区分大小写唯一。
- [ ] `parentId` 为 null 或指向存在的节点；沿父链不会回到自己。
- [ ] 没有节点同时既是常量又带公式；`input` 常量不带公式。

### 5.3 关系与折叠包

- [ ] 每条影响的 `source/target` 都存在；`source !== target`；同一方向不重复。
- [ ] 包名不区分大小写唯一；成员 ≥1。
- [ ] 每个成员存在、是 `constant` 或 `formula`、只属于一个包。
- [ ] `summary.memberId`（若 `mode:"member"`）在本包 `memberIds` 中。

### 5.4 数据表与数据集

- [ ] `collection.datasetId` 指向存在的数据集（建议；导入不强制，但否则不可用）。
- [ ] 每个输入字段的 `sourceColumnId` 存在于该数据集 `columns`，类型兼容（number↔number、date↔date、string↔string、enum↔enum、string↔enum）。
- [ ] 派生字段 `type === "number"` 且有非空 `formula`。
- [ ] 字段名在表内唯一；不与全局变量/函数/常量冲突。
- [ ] 字段公式中引用的字段名存在且为数值/日期类型，或能解析为全局变量。
- [ ] 新增占位数据集的列 id 满足确定性公式，且与字段映射一致。

### 5.5 视图与对比

- [ ] 如保留现有视图，字段结构不变；否则接受导入后全部 `broken`。
- [ ] `views[].datasetId` 指向存在的数据集；`filters/groupBy/metrics` 中引用的列 id 存在（便于用户重新创建视图）。
- [ ] 对比配置当前无 UI；除非用户明确要求，不要新增。

### 5.6 公式（人工/轻量检查）

- [ ] 括号、引号配对；三元都有 `:`。
- [ ] 没有 `not`、循环/条件语句、数组、对象、字符串拼接；局部变量只使用 `let 名称 = 表达式;` 形式。
- [ ] 使用了允许的函数名与运算符。
- [ ] 没有比较链（`a < b < c` 必须改写为 `a < b and b < c`）。
- [ ] 表格第二参数是字符串字面量且列名存在。
- [ ] 没有引用分组名/数据表名/折叠包名。
- [ ] 没有循环依赖（数据表派生列之间也要检查）。

### 5.7 最终一致性扫描

```text
for 每个公式:
  对每个自由标识符（跳过 `let` 局部绑定名）:
    若在数据表字段作用域 -> 必须是该表数值/日期字段
    否则 -> 必须是存在的变量名，或内置函数/常量
for 每个 nodes key:
  必须等于 node.id
for 每个引用 (parentId / relation endpoints / bundle members / summary member / collection datasetId / field sourceColumnId):
  目标必须存在
```

任何一项失败，先修复再交付。

---

## 6. 常见导入错误与修复

| 错误提示 | 原因 | 修复 |
|---|---|---|
| `项目格式无效：...` | Zod 字段缺失/类型/枚举/长度/数量违规 | 对照 PROJECT_FORMAT 字段表；补必需字段、改枚举值、删除超限对象 |
| `变量「X」的名称不是合法标识符：...` | `name` 含空格/标点/数字开头 | 改成合法标识符；展示名放 `label` |
| `变量名称重复（不区分大小写）：...` | 同类节点重名 | 改名或合并 |
| `节点「X」的上级不存在：...` | `parentId` 指向已删除/错误 id | 改为 null 或现有节点 |
| `归属层级存在环：...` | 父链成环 | 断开环 |
| `影响边起点/终点不存在：...` | 删除节点时漏删关系 | 删除该关系或恢复节点 |
| `折叠包「X」的成员不存在/不可打包/同时属于多个折叠包` | 成员删除、类型不对、重复打包 | 修正 memberIds；成员只能 constant/formula 且唯一归属 |
| `折叠包「X」的汇总成员无效` | `summary.memberId` 不在包内 | 改成本包成员或 `mode:"none"` |
| `折叠包「X」至少需要一个成员` | 空包 | 删除包或补成员 |
| `名称「X」与数据表「Y」的字段冲突` | 全局变量与字段重名 | 改名 |
| `数据表...字段名重复` | 字段重名 | 改名 |
| 导入成功但数据表为空/数据缺失 | 导入机制清空数据源 | 让用户替换数据源后重试 |
| 分析视图全部失效 | 导入机制固定行为 | 让用户重新创建视图 |

导入只显示第一个错误；不要假设修好一个就万事大吉，修完继续导入或继续自检。

---

## 7. 能力边界（必须向用户说明）

- **没有片段导入**：只能整项目导入；导入即新建项目。不要声称“只追加几个节点”。
- **不含日志数据**：JSON 只带元数据。真实日志需要用户在 UI 中导入/替换。
- **导入后数据不可用**：数据表预览为空、视图失效，这是设计行为。
- **对比分析未开放**（M4）：不要生成可运行的对比配置，也不要把对比结果写进项目。
- **曲线/表格节点**：schema 与求值器支持，但 UI 暂无可视化编辑器；AI 可以生成，用户只能看结果/导出，不能在界面里改点表。
- **数据表行数据只读**：不能通过 JSON 写入真实行数据（行数据不在项目文档中）。
- **没有手工数据集**：`storage:"manual"` 为预留，不要依赖。
- **50MB 导入上限**；节点等上限见 PROJECT_FORMAT §9.3。
- **应用内无 AI**：所有 AI 结果都必须通过文件导入。

---

## 8. 给用户的提示词模板

```text
你是 iseemath 项目 JSON 编辑器。下面是当前项目导出文件。

要求：
1. 只修改我指定的内容，其余字段、id、数据集列 id、未修改公式原样保留。
2. 输出完整、可 JSON.parse 的项目文件；不要输出解释、Markdown 围栏或 diff。
3. 新增节点使用唯一 id；符号名必须合法且不与现有同类节点/字段/函数重名。
4. 修改符号名时同步改写所有公式引用。
5. 删除节点时清理 parentId、relations、bundles、summary、scenarios。
6. 遵守 iseemath 公式语法（无 not、比较不能链式、表格第二参数为字符串列名；局部变量只能写成 `let a = ...;` 后接结果表达式）。
7. 若需要真实日志列/数据，先告诉我需要哪些列，不要伪造数据。

我的需求：
<在这里写具体需求，例如：新增“暴击伤害”公式 = 伤害 * 暴击倍率，并把“暴击倍率”和“伤害”打包成 product 折叠包>

交付时另附一段简短摘要：新增/修改/删除清单、假设、导入后需要我手动完成的事项。
```

---

## 9. 让 AI 产出可验证的完整示例

仓库中的两个示例文件由测试校验：

```bash
pnpm vitest run src/core/model/examples.test.ts
```

它们覆盖：

- 信封与裸项目兼容；
- schema + 结构不变量；
- 变量求值（伤害 = 100 × 2 − 30 = 170）；
- 数据表字段映射与行作用域公式分析。

AI 可以复制示例作为模板，但必须保留/替换为当前项目的真实 id 与列 id。
