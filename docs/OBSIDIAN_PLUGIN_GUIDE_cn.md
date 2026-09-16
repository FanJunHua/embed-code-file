# Obsidian 插件开发规范指南（规范篇 · 中文）

> **用途**：本文件是《embed-code-file》插件 fork 现代化改造的**规范参考篇**，系统整理 Obsidian 插件开发的官方规范要点：仓库结构与构建、`manifest.json` 字段、三处版本一致性、插件生命周期与 `register*` 自动清理、设置持久化、样式注入、社区插件发布与审核、开发调试接入 vault。
> 与本文配套的 **API 篇**（逐 API 现状核对）见 [OBSIDIAN_API_cn.md](./OBSIDIAN_API_cn.md)；项目侧代码分析见 `docs/PROJECT_ANALYSIS_cn.md`（主工作树）。
>
> **取用 / 核验日期**：2026-09-16

---

## 0. 文档信息与核验基线

**信息来源与快照基线**（全部为官方源，本机直连 GitHub 克隆取证）：

| 来源 | 内容 | 快照 commit | 快照日期 | 在线地址 |
| --- | --- | --- | --- | --- |
| `obsidianmd/obsidian-api` | `obsidian.d.ts`、`CHANGELOG.md` | `cc17443` | 2026-07-14 | <https://github.com/obsidianmd/obsidian-api> |
| `obsidianmd/obsidian-developer-docs` | docs.obsidian.md 全部开发者文档源文件 | `c56c7e7` | 2026-08-10 | <https://docs.obsidian.md>（源仓库 <https://github.com/obsidianmd/obsidian-developer-docs>） |
| `obsidianmd/obsidian-sample-plugin` | 官方插件模板（构建/发布脚本） | `07ceb81` | 2026-08-02 | <https://github.com/obsidianmd/obsidian-sample-plugin> |

**本仓库对照基线**：fork 基线 commit `712f5d2`（分支 `main`；本 attempt 工作树 `g-002-att-01`）。

**标注体系**（全文统一，用于区分信息强度）：

- 【官方确认】：直接来自官方源（docs.obsidian.md、obsidianmd GitHub 仓库），给出来源 URL。
- 【官方确认·间接】：官方文档未用单句明说，但由多个官方事实唯一推出（注明推理）。
- 【推断·待确认】：基于官方材料的合理推断或社区通行做法，**尚未**在官方材料中逐字核实。
- 【项目现状】：对本仓库（`712f5d2`）文件/源码的核对结果，属事实描述而非规范。

> 官方文档持续演进，本文仅代表 2026-09-16 快照状态；复核方法见附录 A。

---

## 1. 插件仓库结构与构建链

### 1.1 仓库必备文件 【官方确认】

提交社区目录前，仓库根目录必须有：

- `README.md`：说明插件用途与用法；目录页会截取展示，相对链接/图片（如 `./images/screenshot.png`）会自动改写为指向仓库。
- `LICENSE`：明确许可证。
- `manifest.json`：插件清单（见 §2）。

来源：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)（2026-09-16）。

### 1.2 官方构建链（sample-plugin） 【官方确认】

官方模板（`obsidian-sample-plugin`，2026-08-02 快照）的构建与发布配套：

| 文件 | 作用 | 要点 |
| --- | --- | --- |
| `esbuild.config.mjs` | 打包 TS → `main.js` | `bundle: true`；`external`：`obsidian`、`electron`、`@codemirror/*`、`@lezer/*`、Node 内置模块（运行时由宿主提供，**不得**打进产物）；`format: 'cjs'`；`target: 'es2021'`；`sourcemap` 仅 dev；`treeShaking` |
| `package.json` 脚本 | `dev` / `build` / `version` / `lint` | `build = tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`（先全量类型检查再打包） |
| `version-bump.mjs` | 三处版本联动 | `npm version X.Y.Z` 触发：把 `manifest.json` 的 `version` 改为 `npm_package_version`；`versions.json` **仅在缺该版本条目时**追加 `"<新版本>": "<manifest 的 minAppVersion>"`；并 `git add manifest.json versions.json` |
| `styles.css` | 插件样式（见 §6） | 模板自带 |
| `manifest.json` | 清单 | 模板含 `fundingUrl` 示例 |
| `.github/`、`eslint.config.mts` | CI 与 lint | 含 `eslint-plugin-obsidianmd`（官方维护的插件 lint 规则包） |

来源：`obsidian-sample-plugin` 仓库 `package.json` / `esbuild.config.mjs` / `version-bump.mjs`（2026-09-16）。

### 1.3 本项目对照 【项目现状】

| 项 | 本仓库（`712f5d2`） | 与官方模板差异 |
| --- | --- | --- |
| 入口/产物 | `esbuild.config.mjs`：`entryPoints: ['main.ts']`，`outfile: 'main.js'`（仓库根） | 模板已改为 `src/main.ts` 入口；本仓库仍是根目录平铺（`main.ts`/`settings.ts`/`utils.ts`） |
| target | `es2018` | 模板为 `es2021`（现代化可跟进） |
| 脚本 | `dev` / `build` / `version` 同构（无 `lint` 脚本，有 `.eslintrc`） | 模板新增 `lint`（eslint 9 flat config + `eslint-plugin-obsidianmd`） |
| 依赖年代 | `esbuild 0.14.47`、`typescript 4.7.4`、`@types/node ^16` | 模板：`esbuild 0.25.5`、`typescript ^5.8`、`@types/node ^22` |
| 产物归集 | `AGENTS.md` 约定 build 产物保存在 `output/embed-code-file/`（`main.js`、`manifest.json`、`styles.css`） | 官方规范只要求 Release 附件含这三个文件；`output/` 归集属本项目约定，非官方要求 |

> 插件运行形态说明 【官方确认】：Obsidian 加载的是插件目录下的 `main.js`（CommonJS），`'obsidian'` 模块由宿主在运行时注入，因此打包必须 external。

---

## 2. manifest.json 字段规范

### 2.1 完整字段表 【官方确认】

来源：[Reference/Manifest](https://docs.obsidian.md/Reference/Manifest)（2026-09-16）。

**插件与主题通用：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `author` | string | **是** | 作者名 |
| `minAppVersion` | string | **是** | 最低可用 Obsidian 版本 |
| `name` | string | **是** | 显示名 |
| `version` | string | **是** | 版本号，[Semantic Versioning](https://semver.org/) `x.y.z` 格式 |
| `authorUrl` | string | 否 | 作者网站 |
| `fundingUrl` | string 或 object | 否 | 赞助链接（单链接字符串，或多平台对象） |

**插件专属：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `description` | string | **是** | 描述 |
| `id` | string | **是** | 插件 ID；**仅允许小写字母与连字符**；不能以 `plugin` 结尾；不能包含 `obsidian` |
| `isDesktopOnly` | boolean | **是** | 是否仅限桌面端（例如使用了 Node.js/Electron API 时必须为 `true`） |

> 官方注记：本地开发时 `id` 应与插件目录名一致，否则部分机制（如 `onExternalSettingsChange`）不会触发。【官方确认】

`fundingUrl` 多链接写法示例（官方原文摘录）：

```json
{
  "fundingUrl": {
    "Buy Me a Coffee": "https://buymeacoffee.com",
    "GitHub Sponsor": "https://github.com/sponsors",
    "Patreon": "https://www.patreon.com/"
  }
}
```

`fundingUrl` 于 API v1.1.0 引入（官方 CHANGELOG「Notable Changes」）。【官方确认】
来源：<https://github.com/obsidianmd/obsidian-api/blob/master/CHANGELOG.md>（2026-09-16）。

### 2.2 类型库与文档的差异 【官方确认·间接】

`obsidian.d.ts`（master `cc17443`）中的 `PluginManifest` 接口仅声明了 `dir? / id / name / author / version / minAppVersion / description / authorUrl? / isDesktopOnly?`，**未包含 `fundingUrl`**；而官方 Manifest 文档与 sample-plugin 实例均使用 `fundingUrl`。结论：`fundingUrl` 是官方支持的字段，只是类型库未同步声明；TS 中如需引用可自行扩展类型。【官方确认·间接：文档+模板实例 vs d.ts 接口差异】

### 2.3 `name` 与 `description` 的目录规范 【官方确认】

- `name`：简短描述性；优先英文且仅用 Basic Latin 字符；除连字符/加号/括号外不用标点、不用 emoji；不得使用核心插件/核心功能名（如 "Live Preview"、"Bases" 单独作名）；不得含 "Obsidian" 或变体（"Obsi-"、"-sidian"）；全目录唯一；插件名不得含 "Plugin"，主题名不得含 "Theme"。（来源：Manifest 参考页，2026-09-16）
- `description`：≤250 字符；以句号结尾；建议动作式开头（"Translate selected text into..."），**避免** "This is a plugin" 开头；遵循官方 Style Guide。（来源：[Submission requirements for plugins](https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins)，2026-09-16）

### 2.4 本项目 manifest 对照 【项目现状】

本仓库 `manifest.json`（`712f5d2`）：

```json
{
  "id": "embed-code-file",
  "name": "Embed Code File",
  "version": "1.2.0",
  "minAppVersion": "0.15.0",
  "description": "This is a plugin for Obsidian that allows for embedding code files.",
  "author": "Obsidian",
  "authorUrl": "https://obsidian.md",
  "isDesktopOnly": false
}
```

对照规范的待改进点（**均为项目事实核对，改造建议属推断**）：

1. `description` 以 "This is a plugin" 开头 —— 官方明确建议避免。【官方确认条款】
2. `author: "Obsidian"` / `authorUrl: obsidian.md` 沿用上游模板值；若以 fork 名义重新发布，应改为实际维护者（涉及 §7.5 Fork 政策）。【推断·待确认：需负责人决策】
3. `minAppVersion: "0.15.0"` 合法（`x.y.z`），但对应 2022 年 API 基线（见 API 篇 §6）。【推断·改造评估】

---

## 3. 三处版本一致性（manifest.json / versions.json / package.json）

### 3.1 三个版本号的角色 【官方确认·间接】

| 位置 | 角色 | 谁消费 |
| --- | --- | --- |
| `manifest.json` → `version` | 插件当前版本（semver `x.y.z`，强制格式） | 社区目录按 **仓库默认分支 HEAD 的 manifest** 建档；Obsidian 按 **GitHub Release tag === manifest.version** 下载附件 |
| `package.json` → `version` | npm 工程版本，是 `npm version` 流程的**源头** | `npm version X.Y.Z` → 触发 `version` 脚本 → 联动写入 manifest 与 versions.json |
| `versions.json` | 插件版本 → 最低 Obsidian 版本 的映射表 | 用户 app 低于 manifest `minAppVersion` 时，用于**回退**到兼容的旧插件版本 |

### 3.2 versions.json 语义与版本回退 【官方确认】

来源：[Reference/Versions](https://docs.obsidian.md/Reference/Versions)（2026-09-16）。

- `versions.json` 是 JSON 对象：**key = 插件版本，value = 该插件版本对应的 `minAppVersion`**。
- 回退机制：若用户 Obsidian 版本 < 当前 manifest 的 `minAppVersion`，Obsidian 查 `versions.json` 找到「app 版本仍满足」的**最新插件版本**供安装（官方示例：app 1.1.0、manifest minAppVersion 1.2.0 → 按 `{"0.1.0":"1.0.0","0.12.0":"1.1.0"}` 回退到 0.12.0）。
- **官方重要提示**：不需要为每次发布都更新 `versions.json`；**只有当 `minAppVersion` 发生变化时**才需要新增条目。

### 3.3 发布联动流程 【官方确认】

来源：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)（2026-09-16）。

1. `manifest.json` 的 `version` 更新为 semver 新版本；
2. 创建 GitHub Release，**Release 的 tag 必须等于 manifest 的 `version`**；
3. Release 附件（二进制）上传：`main.js`、`manifest.json`、`styles.css`（可选）；
4. 首次提交后在 community.obsidian.md 建档；此后用户端直接从 GitHub Release 拉取更新，无需再次提交审核。

版本号联动可用官方 `version-bump.mjs` + `npm version` 自动完成（见 §1.2）。【官方确认】

### 3.4 本项目核对结果 【项目现状】

```
package.json  "version": "1.2.0"      ├─ 一致 ✓
manifest.json "version": "1.2.0"      ├─ 一致 ✓
versions.json { "1.0.0":"0.15.0", "1.1.0":"0.15.0", "1.2.0":"0.15.0" }
```

- 三处当前版本一致（1.2.0）✓；
- `versions.json` 三个条目的 value 均为 `0.15.0`，即各版本发布时的 `minAppVersion`，语义正确（虽然 minAppVersion 从未变化时按官方口径只需保留条目即可，多余条目无害）；
- `version-bump.mjs` 与官方模板同构 ✓。
- 隐含约束【官方确认·间接】：若未来提升 `minAppVersion`（如现代化后升到 1.x），**必须**在 `versions.json` 为旧版本保留条目，否则 0.15.x 老用户无法回退安装旧插件版本。

---

## 4. 插件生命周期与 register* 自动清理机制

### 4.1 Plugin 与 Component 【官方确认】

- `Plugin` 继承自 `Component`（`obsidian.d.ts` L4901：`export abstract class Plugin extends Component`）。
- `Component` 提供加载/卸载骨架：`load()/unload()/onload()/onunload()`（@since 0.9.7），`addChild()/removeChild()`（@since 0.12.0）。
- 生命周期入口：
  - `onload()`：插件被启用/启动时调用，注册大部分能力的地方；
  - `onunload()`：插件被禁用时调用，必须释放插件占用的资源。
  （来源：[Anatomy of a plugin](https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin)，2026-09-16）

### 4.2 register* / add* 家族：自动清理清单 【官方确认】

`Plugin`/`Component` 的注册类方法在**插件卸载时自动清理**，无需在 `onunload` 手工撤销（d.ts 签名 + 官方生命周期指南确认）。

**Component 上的基础注册（`obsidian.d.ts` L1835–1913）：**

| 方法 | 作用 | @since |
| --- | --- | --- |
| `register(cb)` | 卸载时执行任意回调 | 0.9.7 |
| `registerEvent(eventRef)` | 注册 Obsidian 事件（`app.vault.on` / `app.workspace.on` 返回值），卸载时自动 offref | 0.9.7 |
| `registerDomEvent(el, type, cb, opts?)` | 注册 DOM 事件，卸载时自动移除 | 0.14.8 |
| `registerInterval(id)` | 注册 `setInterval` id，卸载时自动 clear（建议用 `window.setInterval`） | 0.13.8 |

**Plugin 上的注册（`obsidian.d.ts` L4901–5086）：**

| 方法 | 作用 | @since |
| --- | --- | --- |
| `addCommand(cmd)` | 全局注册命令（id 自动加插件 id 前缀） | 0.9.7 |
| `removeCommand(commandId)` | 动态移除命令 | 1.7.2 |
| `addRibbonIcon(icon, title, cb)` | 左侧功能区图标 | 0.9.7 |
| `addStatusBarItem()` | 状态栏项（移动端不可用） | 0.9.7 |
| `addSettingTab(tab)` | 注册设置页 | 0.9.7 |
| `registerView(type, creator)` | 注册自定义视图 | 0.9.7 |
| `registerExtensions(exts, viewType)` | 按扩展名接管文件 | 0.9.7 |
| `registerMarkdownPostProcessor(fn, sortOrder?)` | 阅读视图渲染后处理 | 0.9.7 |
| `registerMarkdownCodeBlockProcessor(lang, handler, sortOrder?)` | 代码块处理器 | 0.9.7 |
| `registerEditorExtension(ext)` | CodeMirror 6 扩展 | 0.12.8 |
| `registerEditorSuggest(suggest)` | 输入建议 | 0.12.7 |
| `registerObsidianProtocolHandler(action, handler)` | `obsidian://` 协议处理 | 0.11.0 |
| `registerHoverLinkSource(id, info)` | 页面预览（hover 链接）来源 | 1.1.0 |
| `registerBasesView(viewId, reg)` | Bases 视图 | 1.10.0 |
| `registerCliHandler(...)` | CLI 命令 | 1.12.2 |

来源：`obsidian.d.ts`（2026-09-16 取用）；生命周期机制官方指南：[Manage plugin lifecycle](https://docs.obsidian.md/Plugins/Guides/Manage+plugin+lifecycle)（2026-09-16）。

### 4.3 需要手动清理的资源 【官方确认】

官方指南口径：「onload（或之后）创建的任何资源，都应在 onunload 清理」，典型包括：

- 挂在 `window`/`document` 等长生命周期对象上的事件监听（**应改用 `registerDomEvent`**）；
- `setInterval` / `setTimeout`（interval 应改用 `registerInterval`）；
- Web Worker、网络连接、WebSocket 等外部连接；
- 需要显式 dispose 的第三方库、WASM 实例、大块内存。

例外：生命周期随 DOM 元素一起销毁的监听（例如元素内的 `mouseenter`）无需手动清理。【官方确认】
来源：Manage plugin lifecycle（2026-09-16）；Plugin guidelines「Resource management」（2026-09-16）。

### 4.4 组件层级与「孤儿 Component」陷阱 【官方确认】

- 组件树：父组件卸载时**自动卸载全部子组件**；子组件总是晚于父创建、先于父销毁。
- `MarkdownRenderer.render(app, md, el, sourcePath, component)` 的 `component` 参数决定渲染产物的生命周期归属：传入的组件卸载时渲染器自动清理。
- **常见错误**：专门 `new Component()` 传给渲染 API 却从不 unload → 资源泄漏；正确做法是传入生命周期明确匹配的组件（如 View 自身 `this`）。

来源：Manage plugin lifecycle（2026-09-16）。

### 4.5 延迟加载视图（1.7.2+）与 `onUserEnable` 【官方确认】

官方 CHANGELOG v1.7.2（Insider）：

- Obsidian 开始**默认延迟（defer）加载标签页**；官方发布了迁移指南 [Understanding deferred views](https://docs.obsidian.md/Plugins/Guides/Understanding+deferred+views)；
- 新增 `Plugin#onUserEnable()`：在用户安装并启用插件后执行一次性初始化；有自定义视图的插件建议把视图初始化放这里，而不是在 `onload` 里重建视图；
- 新增 `WorkspaceLeaf#isDeferred / loadIfDeferred`。

对本插件的影响评估：【推断·待确认】`registerMarkdownPostProcessor` / 代码块处理器是在**渲染发生时**回调的，理论上对延迟视图天然兼容；但属于行为时机变化，现代化验证时应在延迟场景实测（阅读视图 + 实时预览 + 延迟打开的标签页）。

### 4.6 本插件对照 【项目现状 + 推断】

`main.ts`（`712f5d2`）在 `onload` 中：`loadSettings()` → `addSettingTab(...)` → `registerMarkdownPostProcessor(...)` → 对每个支持语言调用自定义 `registerRenderer(lang)`（内部为 `registerMarkdownCodeBlockProcessor`）。

- 所有注册均走自动清理机制，**当前无需 `onunload`**，符合规范；【推断·基于源码】
- `onload` 中有 `console.log`（`registering renderer for ${l}`）——官方审核意见要求避免不必要的 console 输出。【官方确认条款；项目现状】
- 未使用 `addCommand`/视图/interval，无手动清理需求。【项目现状】

---

## 5. 设置持久化（loadData / saveData / data.json）

### 5.1 机制 【官方确认】

- `Plugin#loadData(): Promise<any>` / `Plugin#saveData(data: any): Promise<void>`（均 @since 0.9.7）：数据以 JSON 形式存放在**插件目录下的 `data.json`**（即 `<vault>/.obsidian/plugins/<plugin-id>/data.json`）。
- 本仓库 `.gitignore` 排除了 `data.json`（用户数据不入库），与社区惯例一致。【项目现状】

来源：`obsidian.d.ts` L5050–5064（2026-09-16）；[Settings](https://docs.obsidian.md/Plugins/User+interface/Settings)（2026-09-16）。

### 5.2 官方推荐的设置模式 【官方确认】

官方 Settings 文档的示例与本项目 `main.ts` 的实现**同构**：

```ts
async loadSettings() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}
async saveSettings() {
  await this.saveData(this.settings);
}
// onload(): await this.loadSettings(); this.addSettingTab(new ExampleSettingTab(this.app, this));
```

要点：默认值对象 + `Object.assign` 浅合并；`onChange` 里更新内存对象后立即 `await saveData()`（「保存即时发生，离开设置页不是保存动作」——官方风格指南原文要求）。

### 5.3 响应外部修改（1.5.7+） 【官方确认】

`Plugin#onExternalSettingsChange()`（@since 1.5.7）：当 `data.json` 被外部（同步服务如 Obsidian Sync、外部程序）修改时回调，可在其中重新加载设置。前提之一是插件目录名与 `id` 一致（见 §2.1 官方注记）。

### 5.4 声明式设置 API（1.13.0+）与命令式的长期共存 【官方确认】

来源：Settings（2026-09-16）；`obsidian.d.ts` L5143–5174、L6560–6594。

- **1.13.0 起官方主推声明式设置**：`PluginSettingTab` 新增 `getSettingDefinitions()`；配合 `Plugin#settings?: unknown` 官方字段（@since 1.13.0，L4913–4919），控件 `control: { type, key }` 直接绑定 `this.plugin.settings` 的键，**由 Obsidian 自动读写并调用 `saveData()`**；支持 `toggle/text/textarea/number/slider/dropdown/file/folder/color` 等控件、`validate` 校验、`visible/disabled` 谓词、分组/列表/子页。
- 自定义存储可覆写 `getControlValue()` / `setControlValue()`（@since 1.13.0）。
- **兼容性红线**：声明式 API 要求 **Obsidian ≥ 1.13.0**；`minAppVersion` 低于 1.13.0 的插件必须继续用命令式 `display()` 或官方给出的「双轨支持」模式。
- **`display()` 命令式 API 无限期支持**（官方原文："The imperative API remains supported indefinitely as a fallback on 1.13+"）；注意 1.13+ 上若 `getSettingDefinitions()` 返回非空，`display()` 会被绕过。
- `SettingTab` 基类新增：`icon`（@since 1.11.0）、`settingItems`（@since 1.13.0）。

### 5.5 设置 UI 风格条款（审核会看） 【官方确认】

来源：Settings「Style guide」+ Plugin guidelines「UI text」（2026-09-16）：

- UI 文案一律 sentence case（"Template folder location"，而非 Title Case）；
- 设置页**不要**放顶级标题（"General"/"Settings"/插件名都不行）；多分区时首个（通用区）不带标题，后续分区才用标题，且标题里**不要带 "settings" 字样**；
- 标题用 `new Setting(containerEl).setName('...').setHeading()`，不用裸 `<h1>/<h2>`；
- 一行一个控件；避免在主设置页放大 textarea；描述保持一句话长度；
- 修改即保存（不要「提交才存」）。

### 5.6 本插件对照 【项目现状 + 推断】

- `settings.ts`：`EmbedCodeFileSettingTab extends PluginSettingTab`，命令式 `display()` + `new Setting(...).setName/setDesc/addText` + `onChange` 内 `await this.plugin.saveSettings()` —— 与官方命令式范式一致；【项目现状】
- 由于 `minAppVersion 0.15.0`，**不能**直接迁移到声明式 API；可选路径：【推断·待确认】
  1. 保持命令式（长期受支持，零风险）；
  2. 提升 `minAppVersion` 至 1.13.0+ 后迁移声明式（需在 `versions.json` 为旧版本保留回退条目，见 §3.4）；
  3. 官方「双轨模式」（`Migrate to declarative settings` 指南，1.13.0+ 生效）。
- 设置页含 `<h2>`（`containerEl.createEl('h2', ...)`）——违反 §5.5 两条（顶级标题 + 未用 setHeading）。【官方确认条款；项目现状】

---

## 6. 样式注入（styles.css）

### 6.1 文件角色与加载方式 【官方确认·间接】

- 插件根目录的 `styles.css` 是**官方认定的插件样式文件**：官方审核条款直接表述「In the plugins CSS add the following」；发布时 `styles.css` 是随 Release 下载的附件之一（§3.3）；官方 sample-plugin 模板自带该文件。
- 【官方确认·间接】由此可推：启用插件后由 Obsidian 自动加载该文件、禁用后随之失效，代码中**不需要**手工引入；但官方文档**没有一句话**明确描述「自动注入」的机制细节，如需精确行为（注入顺序、何时移除）以实测为准。【推断·待确认（机制细节）】

### 6.2 CSS 变量与主题兼容 【官方确认】

来源：[About styling](https://docs.obsidian.md/Reference/CSS+variables/About+styling)、Plugin guidelines「Styling」（2026-09-16）：

- Obsidian 内置数百个 CSS 变量（`--background-secondary`、`--text-normal`、`--background-modifier-error` 等），插件自定义元素应使用这些变量以获得原生外观并兼容社区主题；
- **禁止硬编码样式**：不要 `el.style.color = 'white'`，而应 `createDiv({ cls: 'warning-container' })` + 在 styles.css 里写类样式；硬编码会让用户无法通过主题/snippet 调整。

### 6.3 本插件对照 【项目现状 + 推断】

`main.ts` 的 `insertTitlePreElement()` 直接 `style.color = this.settings.titleFontColor; style.backgroundColor = ...`（用户可配置颜色，属动态值）。【项目现状】

- 审核口径上，硬编码样式条款针对的是**不可由用户/主题调整**的固定样式；颜色来自用户设置的动态值不算典型违规，但更合规的做法是【推断·待确认】：给标题元素挂类名（本项目已有 `.obsidian-embed-code-file`），颜色走 CSS 变量（如 `--obsidian-embed-code-file-title-color`，默认值回落到主题变量），styles.css 中定义，插件仅在用户显式配置时覆写变量。
- `styles.css` 当前为空/近空，标题样式全部内联 —— 现代化时可整理进 styles.css。【项目现状 + 推断】

---

## 7. 社区插件发布与审核规范要点

### 7.1 提交流程 【官方确认】

来源：[Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)（2026-09-16）：

1. 前置：GitHub 账号 + Obsidian 账号；仓库根有 `README.md`、`LICENSE`、`manifest.json`；
2. 发布 GitHub Release（tag == manifest.version，附件 `main.js`/`manifest.json`/`styles.css`）；
3. 到 [community.obsidian.md](https://community.obsidian.md) 登录并**关联 GitHub 账号**，添加插件；目录读取**仓库默认分支 HEAD** 的 `manifest.json`（`id` 全目录唯一、不得含 `obsidian`）；
4. 自动审查 + 指引修正；修正需发布新版本 Release；自动化错误清零前插件不会在应用内可安装；
5. 只需**首次**提交审核；发布后更新直接走 GitHub Releases。

### 7.2 Developer policies 红线 【官方确认】

来源：[Developer policies](https://docs.obsidian.md/Community+directory/Developer+policies)（2026-09-16）。目录内插件**不得**：

- 混淆代码以隐藏用途；
- 加载动态网络广告；在插件自身界面之外投放静态广告；
- 客户端遥测；
- 自安装/自更新（含依赖）。

**披露要求**（允许但必须在 README 明示）：付费解锁、账号要求、网络用途（说明用了哪些远程服务及原因）、访问 vault 之外文件、插件界面内静态广告、服务端遥测（附隐私政策链接）、闭源（个案审核）。

**版权与许可**：必须含 LICENSE 并标明许可证；遵守所用代码的原始许可；遵守 Obsidian 商标政策（不得让用户误认为官方出品）。

### 7.3 Forks 政策 —— 对本项目关键 【官方确认】

官方政策原文要点（Developer policies「Forks」，2026-09-16）：

> 社区目录**不允许 fork**，除非满足以下之一：
> 1. 得到原作者**书面同意**（公开可验证）；
> 2. 能证明**原作者不可达**且项目**至少 6 个月未更新**；即便如此，也须先联系原作者并留出 **30 天**公开回应窗口。
>
> 两种情况下都必须**把原作者署名为新项目的贡献者**。
> 若项目与现有选项已分化，不应做成 fork，而应另起新仓库、不继承原仓库代码（除非获明确许可）。

对本项目的意义：【推断·待负责人决策】embed-code-file 属于「多年未更新的上游 fork」——若计划进入社区目录，第 2 条路径（原作不可达 + ≥6 个月未更新 + 30 天窗口 + 署名致谢）是唯一适用通道；若只做自用分发，政策不适用（政策仅约束社区目录上架）。

### 7.4 Submission requirements 附加要求 【官方确认】

来源：[Submission requirements for plugins](https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins)（2026-09-16）：

- `fundingUrl` 只用于赞助链接，不接受赞助就删掉；
- `minAppVersion` 设为真实兼容的最低 app 版本；不确定就用最新稳定版号；
- 描述规范（见 §2.3）；
- **Node.js/Electron API 仅桌面可用**：用了就必须 `isDesktopOnly: true`（Web API 替代：SubtleCrypto、`navigator.clipboard` 等）；
- 命令 id 不用带插件 id（系统自动加前缀）；
- 移除所有 sample 模板代码。

### 7.5 审核常见条目（Plugin guidelines） 【官方确认】

来源：[Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)（2026-09-16）。高频审核意见摘要：

| 类别 | 要求 |
| --- | --- |
| 全局 app | **避免使用全局 `app`（`window.app`）**，一律用插件实例的 `this.app`（全局对象仅调试用途，未来可能移除） |
| 日志 | 避免不必要的 console 输出（默认控制台只应显示 error） |
| 代码组织 | 多文件应分目录；改掉模板占位类名（`MyPlugin` 等） |
| 安全 | 禁 `innerHTML`/`outerHTML`/`insertAdjacentHTML` 拼用户输入（XSS）；用 `createEl()/createDiv()/createSpan()`，清空用 `el.empty()` |
| 资源 | 卸载时清理资源；尽量用 `registerEvent()`/`addCommand()` 等自动清理；**onunload 里不要 detach leaves** |
| 命令 | 不设默认热键；按条件选回调类型（`callback`/`checkCallback`/`editorCallback`/`editorCheckCallback`） |
| 工作区 | 不要直接访问 `workspace.activeLeaf`；用 `getActiveViewOfType()` 或 `workspace.activeEditor`；自定义视图引用交给框架 |
| Vault | 改当前笔记用 Editor API；后台改文件用 `Vault.process`（原子）；改 frontmatter 用 `FileManager.processFrontMatter`；优先 Vault API 而非 Adapter API；**不要遍历全部文件找路径**（用 `getFileByPath`/`getFolderByPath`/`getAbstractFileByPath`）；用户路径过 `normalizePath()` |
| 样式 | 不硬编码（见 §6.2） |
| TS/JS | 用 `const/let` 不用 `var`；用 async/await 而非裸 Promise 链 |

### 7.6 本插件对照审核条款速查 【项目现状 + 推断】

| 条款 | 本插件（`712f5d2`） | 判定 |
| --- | --- | --- |
| 全局 `app` | `main.ts` 两处使用全局 `app`（`app.vault`/`app.workspace`，L64、L122） | ⚠ 违反审核条款；应改 `this.app` 【官方确认条款】 |
| console 日志 | `onload` 中 `console.log(...)`（L20） | ⚠ 应移除/降级 【官方确认条款】 |
| innerHTML | 未使用 ✓ | 通过 |
| 资源清理 | 全部走 register* ✓ | 通过 |
| 样式硬编码 | 见 §6.3（动态用户值，边缘） | ⚠ 建议改造 【推断】 |
| `path`（Node API） | `utils.ts` `import path from "path"`（`pathJoin` 实际未被引用）；esbuild 把 Node 内置模块设为 external，CJS 产物会保留对 `path` 的 require | ⚠ 移动端加载风险 + `isDesktopOnly:false` 相互矛盾，见 API 篇 §4.6 【推断·待确认】 |

---

## 8. 开发调试接入 vault 的方式

### 8.1 使用独立测试 vault 【官方确认】

官方教程明确要求：**绝不在主 vault 里开发插件**（一次失误可能破坏数据），应新建一个专用于插件开发的空 vault。
来源：[Build a plugin](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)（2026-09-16）。

### 8.2 安装与启用 【官方确认】

1. 在测试 vault 下准备目录：`<vault>/.obsidian/plugins/<plugin-id>/`（`id` 与目录名一致，见 §2.1）；
2. 放入构建产物 `main.js`、`manifest.json`、`styles.css`（官方教程直接把 sample-plugin 克隆到 `.obsidian/plugins/` 下构建）；
3. Obsidian → 设置 → Community plugins → 打开社区插件 → 在 Installed plugins 中启用。

### 8.3 改码后的重载方式 【官方确认】

- 开发期改的是 `main.js` 等运行文件：在已安装插件列表中**关闭再开启**该插件即完成重载；或用命令面板执行 **"Reload app without saving"**；
- 改了 `manifest.json`：必须**重启 Obsidian**；
- 自动热重载：官方文档推荐第三方插件 [Hot-Reload](https://github.com/pjeby/hot-reload)（作者 pjeby），配合 `npm run dev` 的 esbuild watch 模式，源码保存即自动重载。（第三方工具，官方文档背书引用）

来源：Build a plugin、[Development workflow](https://docs.obsidian.md/Plugins/Getting+started/Development+workflow)（2026-09-16）。

### 8.4 开发者工具 【官方确认】

- 打开 DevTools：Windows/Linux `Ctrl+Shift+I`；macOS `Cmd+Option+I`；Console 标签页查看 `console` 输出与报错。
- 桌面模拟移动端：DevTools Console 执行 `this.app.emulateMobile(true)`（关闭传 `false`）；平台判断用 `Platform.isIosApp / isAndroidApp / isMobile`（`Platform` @since 0.12.2）。
- 真机调试：Android 开启 USB 调试后桌面 Chrome 访问 `chrome://inspect`；iOS 需 ≥16.4 + macOS（Safari Web Inspector）。

来源：Anatomy of a plugin、[Mobile development](https://docs.obsidian.md/Plugins/Getting+started/Mobile+development)（2026-09-16）。

### 8.5 移动端注意事项 【官方确认】

- Node.js / Electron API 在移动端**不可用**，插件或其依赖对这些库的任何调用都可能**崩溃**；
- 用了 Node/Electron API 就必须 `isDesktopOnly: true`（禁止移动端安装）；
- 正则 lookbehind 仅 iOS 16.4+ 支持，需做平台回退。

### 8.6 本项目工作流建议 【推断·待确认】

- 日常：`npm run dev`（esbuild watch，产物 `main.js` 在仓库根）→ 复制/链接 `main.js`、`manifest.json`、`styles.css` 到测试 vault 的 `.obsidian/plugins/embed-code-file/` → 启用插件；安装 Hot-Reload 后免手动重载；
- 发布前：`npm run build`（`tsc -noEmit` 类型检查 + production 打包）→ 按 `AGENTS.md` 归集到 `output/embed-code-file/`；
- 本仓库 `demo/` 目录可作为测试素材；建议再建一个**空测试 vault** 用于插件装载验证（官方要求与主 vault 隔离）。

---

## 9. 本插件规范缺口清单（汇总）

下表汇总 §2–§8 中与 embed-code-file（`712f5d2`）直接相关的规范差距，供现代化改造排期参考（详细 API 层面问题见 API 篇）：

| # | 问题 | 规范依据 | 严重度（评估） |
| --- | --- | --- | --- |
| 1 | 全局 `app` 使用（2 处） | Plugin guidelines「Avoid using global app instance」 | 高（审核必改）【官方确认条款】 |
| 2 | `onload` 中 console.log | Plugin guidelines「Avoid unnecessary logging」 | 中 【官方确认条款】 |
| 3 | `utils.ts` 引入 Node `path`（未使用）+ `isDesktopOnly:false` | Submission requirements「Node.js and Electron APIs」 | 高（移动端崩溃风险）【推断·待确认】 |
| 4 | 设置页 `<h2>` 顶级标题（未用 setHeading） | Settings style guide | 低-中 【官方确认条款】 |
| 5 | 标题样式内联硬编码（动态用户色） | Plugin guidelines「No hardcoded styling」 | 低（建议改 CSS 变量）【推断】 |
| 6 | `description` 以 "This is a plugin" 开头 | Submission requirements | 低（若重新上架需改）【官方确认条款】 |
| 7 | `author` 沿用上游 "Obsidian" | Developer policies（商标/Fork 政策） | 视发布计划而定 【推断·待负责人决策】 |
| 8 | 工具链年代（TS 4.7 / esbuild 0.14 / es2018 target，无 lint 脚本） | 官方模板现状（es2021 + eslint-plugin-obsidianmd） | 中 【官方确认（模板现状）；差距评估属推断】 |
| 9 | `MarkdownRenderer.renderMarkdown` 已废弃 | API 篇 §4.1（d.ts @deprecated） | 高（API 层）【官方确认】 |

---

## 附录 A：核验方法与复现命令 【官方确认（方法）】

本文所有官方事实均可通过克隆官方仓库在本地复核（2026-09-16 执行过）：

```bash
# 官方 API 类型库与 CHANGELOG（取用日期 2026-09-16，commit cc17443）
git -c http.sslBackend=openssl -c http.proxy= clone --depth 1 https://github.com/obsidianmd/obsidian-api.git

# 官方开发者文档源（docs.obsidian.md 的源仓库，commit c56c7e7）
git -c http.sslBackend=openssl -c http.proxy= clone --depth 1 https://github.com/obsidianmd/obsidian-developer-docs.git
# en/ 目录下的 .md 即 docs.obsidian.md 各页面源文件，如：
#   en/Reference/Manifest.md            -> https://docs.obsidian.md/Reference/Manifest
#   en/Reference/Versions.md            -> https://docs.obsidian.md/Reference/Versions
#   en/Plugins/Guides/Manage plugin lifecycle.md -> 生命周期指南
#   en/Plugins/Releasing/Plugin guidelines.md    -> 审核常见条目
#   en/Community directory/Developer policies.md -> 社区政策（含 Forks）

# 官方插件模板（commit 07ceb81）
git -c http.sslBackend=openssl -c http.proxy= clone --depth 1 https://github.com/obsidianmd/obsidian-sample-plugin.git
```

核对某 API 签名时，在 `obsidian-api/obsidian.d.ts` 内检索符号名即可；`@since`/`@deprecated` 标注以文件内注释为准。

## 附录 B：官方资源索引

| 资源 | URL |
| --- | --- |
| 开发者文档首页 | <https://docs.obsidian.md> |
| Manifest 参考 | <https://docs.obsidian.md/Reference/Manifest> |
| Versions 参考 | <https://docs.obsidian.md/Reference/Versions> |
| 插件入门（Build a plugin） | <https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin> |
| 插件解剖 | <https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin> |
| 开发工作流 | <https://docs.obsidian.md/Plugins/Getting+started/Development+workflow> |
| 生命周期管理指南 | <https://docs.obsidian.md/Plugins/Guides/Manage+plugin+lifecycle> |
| 延迟视图指南 | <https://docs.obsidian.md/Plugins/Guides/Understanding+deferred+views> |
| 设置 | <https://docs.obsidian.md/Plugins/User+interface/Settings> |
| Markdown 后处理 | <https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing> |
| 样式与 CSS 变量 | <https://docs.obsidian.md/Reference/CSS+variables/About+styling> |
| 提交插件 | <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin> |
| 审核常见条目 | <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines> |
| 插件提交要求 | <https://docs.obsidian.md/Community+directory/Submission+requirements+for+plugins> |
| 开发者政策 | <https://docs.obsidian.md/Community+directory/Developer+policies> |
| 移动开发 | <https://docs.obsidian.md/Plugins/Getting+started/Mobile+development> |
| TypeScript API 索引 | <https://docs.obsidian.md/Reference/TypeScript+API> |
| obsidian.d.ts | <https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts> |
| API CHANGELOG | <https://github.com/obsidianmd/obsidian-api/blob/master/CHANGELOG.md> |
| 官方插件模板 | <https://github.com/obsidianmd/obsidian-sample-plugin> |
| Hot-Reload（第三方，官方文档引用） | <https://github.com/pjeby/hot-reload> |

---

*文档生成：2026-09-16 · g-002/att-001 · 基于 2026-09-16 官方源快照；如官方文档更新，以在线版与最新快照为准。*
