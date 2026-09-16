# g-003 右键快速添加 embed-code · 需求定稿与实现归档

## 1. 需求来源与审批结论

- 原始需求（goal g-003）：在 Obsidian 标签页的 Markdown 文件编辑区，增加右键快速添加 embed-code 的功能：右键弹出菜单 → 选中「Add embed-code」→ 弹出 UI。
- UI 原型：`docs/ui-mockup-add-embed-code.html`（worktree 分支 g-003-att-01，commit `2a6ad9d`），**负责人已审批通过**。
- 负责人钦定新需求（审批时追加，必须实现）：
  Vault 模式选中文件后，语言下拉按文件扩展名自动匹配：`xx.cpp→cpp`、`xxx.js→javascript`、`.ts→typescript`、`.py→python`、`.sh/.bash→bash` 等；映射范围以设置页 Included Languages 登记的语言标识为准，无匹配时保持当前选择不变。

## 2. 字段契约（依据 README.md）

代码块形态：

````yaml
```embed-<language>
PATH: "vault://<path>" 或 "http[s]://<url>"
LINES: "<line>,<other>,...,<range>"
TITLE: "<title>"
```
````

| UI 字段 | 契约 | 行为 |
|---------|------|------|
| 代码来源 | `PATH` 前缀 | Vault 文件 → `vault://…`；远程 → `http(s)://…` |
| 文件路径/URL | `PATH` | Vault 输入即模糊搜索（`prepareFuzzySearch`，Top 20）+ 自动补 `vault://`；远程提示 raw.githubusercontent.com |
| 语言 | 围栏 `embed-<lang>` | 下拉选项来自设置 `includedLanguages`（去重保序）；默认 `cpp`（不在列表则取首个） |
| 行范围 | `LINES` | 支持 `2,9,30-40` 组合；留空嵌入全文；从右键菜单进入且编辑器有选区时预填选区行号（如 `5-12`） |
| 标题 | `TITLE` | 留空省略该行，渲染回退为 `PATH` |

## 3. 扩展名 → 语言映射表（实现于 add-embed-modal.ts `EXTENSION_LANGUAGES`）

每个扩展名对应**有序候选列表**，取第一个在 `includedLanguages` 中登记的标识；全部未登记 → 无匹配，保持当前语言选择：

| 扩展名 | 候选（按序） |
|--------|--------------|
| c | c |
| h | c → cpp |
| cpp | cpp → c++ |
| cc / cxx / hpp / hxx | cpp |
| cs | cs → csharp |
| java | java |
| py | python |
| go | go → golang |
| rb | ruby → rb |
| js / mjs / cjs / jsx | javascript → js |
| ts / tsx / mts / cts | typescript → ts |
| sh / bash | bash → shell → sh |
| zsh | shell → sh → bash |

触发点：① Vault 建议列表选中文件（按 `file.name`）；② 路径/URL 手动输入后失焦或回车（按 basename，远程 URL 取 pathname 末段，非法 URL 忽略）。

## 4. 实现落点

| 文件 | 改动 |
|------|------|
| `add-embed-modal.ts`（新增） | `AddEmbedCodeModal`（Modal 子类）：来源分段切换、Vault 模糊搜索下拉（键盘 ↑↓/Enter/Esc）、扩展名匹配、LINES 选区预填、实时插入预览、插入逻辑 |
| `main.ts` | `onload` 注册 `editor-menu` 事件：菜单项「Add embed-code」（图标 `code-glyph`），点击打开 Modal |
| `styles.css` | 新增 `.embed-add-*` 样式（建议下拉 / 预览块），全部使用 Obsidian 主题 CSS 变量，自动适配亮暗主题 |
| `README.md` | 新增「Quick add via right-click」用法章节 |

插入行为（判据 4）：
- 编辑器仍有选区时，先把光标折叠到选区末尾再插入，避免 `replaceSelection` 清掉被选中的原文；
- 光标前有非空白内容 → 前补 `\n\n`（空行），否则 `\n`；光标后同理；
- 经 `editor.replaceSelection` 写入完整 ```` ```embed-<lang> ```` 代码块，空字段行省略。

## 5. 验收判据对照（g-003 登记 6 条）

1. ✅ `editor-menu` 注册「Add embed-code」，点击弹出 Modal（main.ts + add-embed-modal.ts）；
2. ✅ 来源分段切换 / Vault 模糊搜索 + `vault://` 前缀 / 远程 raw 提示 / 语言来自 Included Languages / LINES 组合与选区预填 / TITLE 留空省略；
3. ✅ 扩展名→语言自动匹配（`EXTENSION_LANGUAGES` + `matchLanguageByExtension`，含于 Included Languages 约束，无匹配保持不变）；
4. ✅ `replaceSelection` 光标处插入完整代码块（前后补空行、空字段省略），插入预览实时更新（`updatePreview` 监听所有字段 input/change）；
5. ✅ `tsc --noEmit --skipLibCheck` 零错误；esbuild 0.14.47 打包成功；三件套产出 `output/embed-code-file/`（main.js 23,326 B 含 "Add embed-code"、manifest.json 288 B、styles.css 2,093 B 含 `.embed-add-modal`）并核验；
6. ✅ 零回归：渲染逻辑（`registerRenderer` / `addTitle` / `insertTitlePreElement`）与 settings 均未改动，仅新增菜单注册与 Modal 模块；README 已增补；源码改动限于上述 4 文件，提交至 g-003-att-01 分支。

## 6. 构建记录

- 依赖：`npm ci --ignore-scripts --cache .npm-cache-tmp`（沙箱禁 spawn，跳过 postinstall）。
- esbuild 二进制：`esbuild-windows-64-0.14.47.tgz` 经 node https 从 registry 下载解出，落位 `node_modules\esbuild\bin\esbuild.exe`（详见 docs/Error/g-003-dev-log.md）。
- 类型检查：`node node_modules\typescript\bin\tsc --noEmit --skipLibCheck` → exit 0。
- 打包：`esbuild.exe main.ts --bundle --format=cjs --target=es2018 --platform=node --external:obsidian … --outfile=main.js`（与 esbuild.config.mjs production 配置一致）→ 22.8kb。
- 产物：`output/embed-code-file/{main.js, manifest.json, styles.css}`（按 AGENTS.md 约定，构建产物不入库）。
