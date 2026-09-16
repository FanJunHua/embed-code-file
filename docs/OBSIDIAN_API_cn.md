# Obsidian API 现状核对（API 篇 · 中文）

> **用途**：本文件是《embed-code-file》插件 fork 现代化改造的 **API 参考篇**：以官方 `obsidian.d.ts` 与开发者文档为准，逐一核对**本插件直接使用的 API** 的当前状态（存在 / 更名 / 废弃 / 签名变化），并单列「对本插件有影响的废弃/变更」。
> 配套的规范篇见 [OBSIDIAN_PLUGIN_GUIDE_cn.md](./OBSIDIAN_PLUGIN_GUIDE_cn.md)。
>
> **取用 / 核验日期**：2026-09-16

---

## 0. 文档信息与核验基线

**权威依据**：

| 来源 | 说明 | 快照 | 取用日期 |
| --- | --- | --- | --- |
| [`obsidian.d.ts`](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) | 官方 TypeScript API 类型库（`obsidianmd/obsidian-api` master 分支） | commit `cc17443`（2026-07-14），全文 8498 行 | 2026-09-16 |
| [`CHANGELOG.md`](https://github.com/obsidianmd/obsidian-api/blob/master/CHANGELOG.md) | 官方 API 破坏性变更/新增日志（版本号 = Obsidian app 版本） | 同上仓库 | 2026-09-16 |
| [docs.obsidian.md](https://docs.obsidian.md) 及其源仓库 [`obsidian-developer-docs`](https://github.com/obsidianmd/obsidian-developer-docs) | 官方开发者文档 | commit `c56c7e7`（2026-08-10） | 2026-09-16 |
| 本插件源码 | `main.ts` / `settings.ts` / `utils.ts` | fork 基线 `712f5d2`（worktree `g-002-att-01`） | 2026-09-16 |

**重要口径说明** 【官方确认】：

- `obsidian.d.ts` 内每个成员的 `@since X.Y.Z` 标注即「该成员自 Obsidian app X.Y.Z 起可用」；`@deprecated` 标注即官方废弃标记。本文签名均摘自该快照，并附行号（行号仅对 commit `cc17443` 有效，复核时以符号检索为准）。
- 官方 `CHANGELOG.md` 最后一条为 **v1.7.2（Insider）**，而同一份 `obsidian.d.ts` 已包含 `@since 1.8.7`～`@since 1.13.0` 的声明 —— 说明 CHANGELOG 更新滞后于类型库。**版本追溯以 d.ts 内 `@since` 为准**。【官方确认·间接（两份官方文件对比）】
- 截至 2026-09-16，类型库声明到的最新 API 线为 **1.13.x**（`@since 1.13.0`，如 `Plugin#settings`、声明式设置）；公开发布渠道对应的稳定版本号请以官方 Release 为准。【推断·待确认（稳定版具体号）】

**标注体系**：【官方确认】/【官方确认·间接】/【推断·待确认】/【项目现状】（同规范篇 §0）。

---

## 1. API 总览表（本插件使用的全部 API）

本插件实际触达的官方 API 共 **12 项**（目标要求的 9 项全部覆盖，另补充 3 项源码中实际用到），外加 1 项**非官方 API**（易混淆项）：

| # | API | 本插件调用点 | 当前状态（判定） | 签名变化 | 对插件影响 |
| --- | --- | --- | --- | --- | --- |
| 1 | `Plugin`（类） | `main.ts:5` 继承；`loadData/saveData/addSettingTab` | ✅ 存在，稳定 | 无破坏；新增成员（见 §2.1） | 无 |
| 2 | `MarkdownRenderer`（类） | `main.ts:42,48,58,69,74,95` `renderMarkdown` | ⚠️ 存在，但 `renderMarkdown` **已废弃**（`@deprecated`） | 替代：静态 `render()`（多一个 `app` 参数） | **高**：官方废弃，应迁移（§4.1） |
| 3 | `MarkdownPostProcessorContext`（接口） | post processor / code block 处理器回调参数 | ✅ 存在 | 无破坏；新增 `docId`/`frontmatter`/`addChild` | 低 |
| 4 | `Plugin#registerMarkdownPostProcessor` | `main.ts:13` | ✅ 存在，稳定 | 新增可选 `sortOrder` 参数 | 无 |
| 5 | `Plugin#registerMarkdownCodeBlockProcessor` | `main.ts:34`（经自定义 `registerRenderer`） | ✅ 存在，稳定 | 新增可选 `sortOrder` 参数 | 无 |
| 6 | `registerRenderer` | `main.ts:21,33` | ❌ **官方 API 中不存在** | —— | 易混淆：这是插件**自定义方法**（§2.7） |
| 7 | `TFile`（类） | `main.ts:1,65` | ✅ 存在，稳定（0.9.7+） | 无 | 无 |
| 8 | `Vault#getAbstractFileByPath` | `main.ts:64` | ✅ 存在（0.11.11+）；1.5.7 起有**类型化替代** `getFileByPath/getFolderByPath`（非废弃） | 无变化 | 低：建议改用类型化 API（§4.4） |
| 9 | `Vault#read` | `main.ts:66` | ✅ 存在，稳定（0.9.7+） | 无 | 无 |
| 10 | `requestUrl`（模块函数） | `main.ts:54` | ✅ 存在 | 无破坏；`RequestUrlParam.throw` 默认 `true` 等（§2.9） | 无 |
| 11 | `parseYaml`（模块函数） | `main.ts:40` | ✅ 存在 | 无 | 无（d.ts 无 `@since` 标注） |
| 12 | `PluginSettingTab`（类） | `settings.ts:17` 继承 | ✅ 存在；1.13.0 新增**声明式**成员；`display()` 无限期支持 | 无破坏性变化 | 低：迁移路径见规范篇 §5.4 |
| 补A | `MarkdownView` + `Workspace#getActiveViewOfType` | `main.ts:1,122` | ✅ 存在，稳定 | 无 | 审核条款：改用 `this.app`（§4.2） |
| 补B | `Setting`（类） | `settings.ts:31,42,52` | ✅ 存在，稳定（0.9.7+） | 无 | 无 |
| 补C | `requireApiVersion`（未用，建议采用） | —— | ✅ 存在 | —— | 现代化工具（§6） |

---

## 2. 逐项详解

> 每项给出：官方签名原文（摘自 `obsidian.d.ts` @ `cc17443`，附行号）→ 状态判定 → 官方文档 → 本插件用法与迁移建议。

### 2.1 `Plugin`（类）

**状态：✅ 存在，稳定。** 【官方确认】

签名（d.ts L4901–5086）：

```ts
export abstract class Plugin extends Component {
    app: App;                    // @since 0.9.7
    manifest: PluginManifest;    // @since 0.9.7
    settings?: unknown;          // @since 1.13.0（官方设置字段）
    constructor(app: App, manifest: PluginManifest);
    onload(): Promise<void> | void;                                  // @since 0.9.7
    addCommand(command: Command): Command;                           // @since 0.9.7
    removeCommand(commandId: string): void;                          // @since 1.7.2
    addSettingTab(settingTab: PluginSettingTab): void;               // @since 0.9.7
    registerMarkdownPostProcessor(postProcessor, sortOrder?): MarkdownPostProcessor;   // @since 0.9.7
    registerMarkdownCodeBlockProcessor(language, handler, sortOrder?): MarkdownPostProcessor; // @since 0.9.7
    loadData(): Promise<any>;        // 数据存于插件目录 data.json    // @since 0.9.7
    saveData(data: any): Promise<void>;                              // @since 0.9.7
    onUserEnable(): void;            // 用户启用后一次性初始化        // @since 1.7.2
    onExternalSettingsChange?(): any; // data.json 被外部修改时       // @since 1.5.7
    // 其余 register*/add* 见规范篇 §4.2
}
```

- 无任何已用成员被废弃或更名。【官方确认】
- 1.5.7 / 1.7.2 / 1.13.0 的新增成员是**增量**，不影响旧代码。【官方确认】
- 来源：d.ts L4901–5086（2026-09-16）；[TypeScript API/Plugin](https://docs.obsidian.md/Reference/TypeScript+API/Plugin)。

**本插件**【项目现状】：`export default class EmbedCodeFile extends Plugin`，`onload` 内完成全部注册；`loadData/saveData` 经 `loadSettings/saveSettings` 封装。✅ 合规。

### 2.2 `MarkdownRenderer`（类）—— ⚠️ 重点：`renderMarkdown` 已废弃

**状态：类存在；静态方法 `renderMarkdown` 官方标注 `@deprecated`；替代品为静态 `render()`。**【官方确认】

签名（d.ts L4121–4148）：

```ts
export abstract class MarkdownRenderer extends MarkdownRenderChild
      implements MarkdownPreviewEvents, HoverParent {
    app: App;
    hoverPopover: HoverPopover | null;
    abstract get file(): TFile;

    /** @deprecated - use MarkdownRenderer.render  @since 0.10.6 */
    static renderMarkdown(markdown: string, el: HTMLElement,
                          sourcePath: string, component: Component): Promise<void>;

    static render(app: App, markdown: string, el: HTMLElement,
                  sourcePath: string, component: Component): Promise<void>;
}
```

判定要点：

- `renderMarkdown` **没有被移除**，截至快照仍可用，且**签名未变**（仍是本插件调用的 4 参形式）——但官方明确标注废弃。【官方确认】
- 官方替代 `render()` 多一个首参 `app`；官方生命周期指南已把 `MarkdownRenderer.render(app, md, el, "", component)` 作为标准用法示范，并强调 `component` 决定渲染生命周期归属（孤儿 Component 泄漏问题，见规范篇 §4.4）。【官方确认】
- `render()` 在 d.ts 中**无 `@since` 标注**；结合官方 CHANGELOG（v1.1.0 时期文档与示例已采用）判断：1.x 早期即已可用，`minAppVersion 0.15.0` 下可用性高，但非严格证明。【推断·待确认（可用 `requireApiVersion` 或特性检测兜底，见 §6）】

来源：d.ts L4121–4148（2026-09-16）；[Manage plugin lifecycle](https://docs.obsidian.md/Plugins/Guides/Manage+plugin+lifecycle)（2026-09-16）。

**本插件**【项目现状】：`main.ts` 六处调用 `MarkdownRenderer.renderMarkdown(markdown, el, '', this)` —— 与当前（已废弃的）签名完全匹配，**运行不受影响**；迁移建议见 §4.1。另注意第三参 `sourcePath` 固定传 `''`，官方语义为「Markdown 文件路径，用于解析相对内链」，传空串意味着代码块内的相对链接无法解析 —— 建议传 `ctx.sourcePath`。【推断·基于官方参数语义】

### 2.3 `MarkdownPostProcessorContext`（接口）

**状态：✅ 存在。**【官方确认】

签名（d.ts L3996–4025）：

```ts
export interface MarkdownPostProcessorContext {
    docId: string;                       // 文档标识（无 @since 标注）
    sourcePath: string;                  // 关联文件路径；内链相对它解析
    frontmatter: any | null | undefined; // 文档 frontmatter（无 @since 标注）
    addChild(child: MarkdownRenderChild): void;  // 渲染器托管生命周期的子组件
    getSectionInfo(el: HTMLElement): MarkdownSectionInformation | null;
}
```

- 现有成员无废弃/更名。【官方确认】
- `docId`/`frontmatter` 的引入版本未在 d.ts 标注；对本插件无影响（未使用）。【官方确认（存在）+ 推断（引入版本）】
- `getSectionInfo` 官方注明：**可能返回 null，调用方必须处理**；且「在恰好需要时再调用以拿到最新信息」。【官方确认】
- 配套：`MarkdownPostProcessor`（d.ts L3980–3991）为可调用接口，带可选 `sortOrder?: number`（数值越小越先执行）。
- 来源：d.ts L3980–4025（2026-09-16）；[Markdown post processing](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing)（2026-09-16）。

**本插件**【项目现状】：`addTitle(el, context)` 用 `context.getSectionInfo(pre)` 取行号，**已做 null 处理**（`if (!codeSection) return`）✅；`sourcePath` 未使用。

### 2.4 `Plugin#registerMarkdownPostProcessor`

**状态：✅ 存在，稳定（@since 0.9.7）。**【官方确认】

签名（d.ts L4986–4992）：

```ts
registerMarkdownPostProcessor(
    postProcessor: MarkdownPostProcessor,
    sortOrder?: number            // 可选；引入版本未标注
): MarkdownPostProcessor;
```

- 语义：阅读视图（Reading view）Markdown 转 HTML **之后**回调，可增删改渲染元素；官方示例见 [Markdown post processing](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing)（2026-09-16）。
- `sortOrder` 为 1.x 增量参数，无破坏。【官方确认（存在）；引入版本推断】

**本插件**【项目现状】：`main.ts:13-15` 注册 `addTitle`，为阅读视图代码块补标题行 —— 用法与官方范式一致；卸载自动清理 ✅。

### 2.5 `Plugin#registerMarkdownCodeBlockProcessor`

**状态：✅ 存在，稳定（@since 0.9.7）。**【官方确认】

签名（d.ts L4993–5001）：

```ts
registerMarkdownCodeBlockProcessor(
    language: string,
    handler: (source: string, el: HTMLElement,
              ctx: MarkdownPostProcessorContext) => Promise<any> | void,
    sortOrder?: number
): MarkdownPostProcessor;
```

官方语义（d.ts 原文）：这是**特殊的 post processor**——「负责移除 `<pre><code>` 并创建一个 `<div>` 传给 handler，handler 应向其中填充自定义元素」。

判定与注意事项：

- 传入 handler 的 `el` **不再是 `<pre><code>`** 而是一个空 `<div>` 容器。【官方确认】
- 代码块源码变化时会**重新渲染**该容器；官方未明文承诺「调用前自动清空 el」。【推断·待确认】本插件 `insertTitlePreElement()` 在插入标题前先移除自身旧标题节点（`querySelectorAll(".obsidian-embed-code-file").forEach(x => x.remove())`），正是对「el 可能被复用」的防御式写法，与该行为一致。【推断·基于源码行为】
- `el` 内可用 `MarkdownRenderer.render*` 渲染嵌套 Markdown（本插件即如此）；注意 §4.1 的组件归属。
- 来源：d.ts L4993–5001 + Markdown post processing（2026-09-16）。

**本插件**【项目现状】：经自定义 `registerRenderer(lang)` 为 `embed-<lang>` 语言注册处理器 ✅；handler 为 async，符合 `Promise<any> | void`。

### 2.6 `TFile` 与 `TAbstractFile`

**状态：✅ 存在，稳定（均 @since 0.9.7）。**【官方确认】

签名（d.ts L6953–6975、L7129–7165）：

```ts
export abstract class TAbstractFile {
    vault: Vault; path: string; name: string; parent: TFolder | null;
}
export class TFile extends TAbstractFile {
    stat: FileStats;        // { ctime: number; mtime: number; size: number }（毫秒时间戳/字节）
    basename: string;       // 不含扩展名的文件名
    extension: string;
}
export class TFolder extends TAbstractFile {
    children: TAbstractFile[]; isRoot(): boolean;
}
```

- 字段无废弃/更名；`FileStats`（d.ts L2974–2990）三字段稳定。【官方确认】
- 来源：d.ts（2026-09-16）；[TFile](https://docs.obsidian.md/Reference/TypeScript+API/TFile)。

**本插件**【项目现状】：`main.ts:65` 用 `tFile instanceof TFile` 判型 ✅（官方推荐的判型方式，见 Plugin guidelines「Vault」节）。

### 2.7 `registerRenderer` —— ⚠️ 官方 API 中**不存在**

**状态：❌ 非官方 API；这是本插件的自定义方法。**【官方确认（基于 d.ts 全文检索，master `cc17443` 中不存在任何名为 `registerRenderer` 的导出符号、类成员或接口成员）】

- `main.ts:33` 定义的 `async registerRenderer(lang: string)` 是 `EmbedCodeFile` 子类自己的方法，内部调用 `this.registerMarkdownCodeBlockProcessor(`embed-${lang}`, ...)`；`onload` 中按设置的语言列表逐个调用（`main.ts:18-22`）。【项目现状】
- 易混淆点澄清：
  - 官方 `Plugin`/`Component` 上**没有** `registerRenderer` 成员；
  - 官方另有名称相近的 `MarkdownPreviewRenderer`（d.ts L4036–4055，静态 `registerPostProcessor` 等，属低层 API，本插件未用）；
  - 因此任何把 `this.registerRenderer(...)` 当成官方 API 的阅读/移植都会踩坑 —— 现代化时可考虑更名为 `registerEmbedRenderer` 之类的项目内名字以消除歧义。【推断·建议】
- 判定性质：**不影响运行**，仅是命名混淆与可维护性问题。

### 2.8 `Vault#getAbstractFileByPath` / `Vault#read`

**状态：✅ 两者均存在；`getAbstractFileByPath` 自 1.5.7 起有类型化替代（非废弃）。**【官方确认】

签名（d.ts L7337–7594 节选）：

```ts
export class Vault extends Events {
    configDir: string;                                   // @since 0.11.1，通常为 ".obsidian"
    getAbstractFileByPath(path: string): TAbstractFile | null;  // @since 0.11.11
    getFileByPath(path: string): TFile | null;           // @since 1.5.7（类型化替代）
    getFolderByPath(path: string): TFolder | null;       // @since 1.5.7
    read(file: TFile): Promise<string>;                  // @since 0.9.7（将修改内容时用）
    cachedRead(file: TFile): Promise<string>;            // @since 0.9.7（仅展示时用，走缓存更快）
    process(file, fn, options?): Promise<string>;        // @since 1.1.0（原子读改写）
    // create/modify/delete/rename/trash/copy(...) 略
}
```

- `getAbstractFileByPath` **未废弃**；官方审核条款也只是建议「按需选更精确的 `getFileByPath`/`getFolderByPath`」并强调 `instanceof TFile/TFolder` 判型。【官方确认】
- 1.5.7 官方 CHANGELOG 原文：「`getAbstractFileByPath` 长期困扰开发者……现在可用 `getFileByPath`/`getFolderByPath` 自动完成判型」。【官方确认】
- `read` vs `cachedRead`：官方注明「要修改内容用 `read`，仅展示用 `cachedRead`（性能更好）」。【官方确认】
- 来源：d.ts L7337–7594；CHANGELOG v1.5.7；Plugin guidelines「Vault」（2026-09-16）。

**本插件**【项目现状】：`main.ts:64-66` `getAbstractFileByPath` + `instanceof TFile` + `await vault.read(tFile)`。✅ 功能正确。改进建议【推断】：`vault://` 场景已知要的是文件，可直接 `getFileByPath`（少一次判型；`minAppVersion` 若保持 0.15.0 则**不可用**，需 `requireApiVersion("1.5.7")` 分支）；仅展示场景可评估 `cachedRead`。

### 2.9 `requestUrl`

**状态：✅ 存在。**【官方确认】

签名（d.ts L5430–5486）：

```ts
/** Similar to fetch(), request a URL using HTTP/HTTPS, without any CORS restrictions.
 *  @since 0.12.11 */
export function request(request: RequestUrlParam | string): Promise<string>;

export function requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise; // 无 @since 标注

export interface RequestUrlParam {
    url: string;
    method?: string;
    contentType?: string;
    body?: string | ArrayBuffer;
    headers?: Record<string, string>;
    throw?: boolean;          // 400+ 状态码是否抛错；默认 true
}
export interface RequestUrlResponse {
    status: number;
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
    json: any;
    text: string;
}
export interface RequestUrlResponsePromise extends Promise<RequestUrlResponse> {
    arrayBuffer: Promise<ArrayBuffer>;
    json: Promise<any>;
    text: Promise<string>;
}
```

- 核心语义：**类似 fetch，但无 CORS 限制**（官方原文）——这是插件访问外链的正规通道。【官方确认】
- `throw` 默认 `true`：4xx/5xx 会 reject（本插件 `try/catch` 包裹 `await requestUrl(...)`，行为正确 ✅）。【官方确认（默认值）+ 项目现状】
- 返回值是「Promise + 便捷属性」混合体：既可 `await` 后取 `.text` 属性，也可直接 `requestUrl({url}).text` 拿 Promise。本插件采用前者，清晰 ✅。【官方确认 + 项目现状】
- 版本：`request` 标注 `@since 0.12.11`；`requestUrl` 无标注（同期加入，社区普遍如此记载）。`minAppVersion 0.15.0` 覆盖可用性。【推断·待确认（requestUrl 的确切引入版本）】
- 来源：d.ts L5430–5486（2026-09-16）；[TypeScript API/requestUrl](https://docs.obsidian.md/Reference/TypeScript+API/requestUrl)。

### 2.10 `parseYaml`

**状态：✅ 存在。**【官方确认】

签名（d.ts L4816–4817）：

```ts
/** @public */
export function parseYaml(yaml: string): any;
```

- 官方 d.ts 仅有最小声明：入参 YAML 字符串、返回 `any`；无 `@since` 标注（系早期 API）。【官方确认（存在）；版本推断·待确认】
- 解析失败**抛异常**：d.ts 未写明，但本插件以 `try/catch` 包裹（`main.ts:38-44`）且长期按此工作 —— 属「行为依赖，待官方文档补充确认」。【推断·待确认】
- 内部实现（社区普遍认为基于 js-yaml 安全档）无官方说明，不建议依赖其超出 YAML 规范的行为。【推断·待确认】
- **本项目局限**【项目现状】：代码块 meta 用大写键 `PATH:`/`LINES:`/`TITLE:`，以 `metaYaml.PATH` 等直取；YAML 键区分大小写，用户写小写会静默失效（只报 invalid source path）。属设计取舍，记录备查。

### 2.11 `PluginSettingTab`

**状态：✅ 存在；1.13.0 新增声明式成员；`display()` 命令式**无限期支持**。**【官方确认】

签名（d.ts L5143–5174、L6560–6594 节选）：

```ts
export abstract class PluginSettingTab extends SettingTab {
    constructor(app: App, plugin: Plugin);
    getSettingDefinitions(): SettingDefinitionItem[];        // @since 1.13.0
    getControlValue(key: string): unknown;                   // @since 1.13.0
    setControlValue(key: string, value: unknown): void | Promise<void>;  // @since 1.13.0
}
export abstract class SettingTab {
    icon: IconName;                       // @since 1.11.0
    app: App; containerEl: HTMLElement;
    settingItems: SettingDefinitionItem[]; // @since 1.13.0
    // display() / hide() 等略
}
```

- 继承自 `SettingTab`；`display()` 由子类覆写构建设置 UI（命令式，@since 0.9.7）。
- 官方明确：`display()` 方式「remains supported **indefinitely** as a fallback」；1.13+ 上若 `getSettingDefinitions()` 返回非空数组则 `display()` 被绕过。【官方确认】
- 来源：d.ts（2026-09-16）；[Settings](https://docs.obsidian.md/Plugins/User+interface/Settings)（2026-09-16）。

**本插件**【项目现状】：命令式 `display()` + `Setting` 链式调用，与官方 legacy 范式一致 ✅；§5.4（规范篇）给出三条迁移路径。

### 2.12 补充：`MarkdownView` / `Workspace#getActiveViewOfType` / `Setting`

- `MarkdownView extends TextFileView`（d.ts L4188–4235）：`editor: Editor`、`previewMode`、`getMode()` 等，稳定 ✅。【官方确认】
- `Workspace#getActiveViewOfType<T extends View>(type): T | null`（d.ts L8000–8005，@since 0.9.16）：官方审核条款指定的活动视图获取方式（替代已淘汰的 `workspace.activeLeaf`）。【官方确认】
- `Setting`（d.ts L5695 起，@since 0.9.7）：`setName/setDesc/addText/addToggle/...` 链式 API，稳定 ✅。【官方确认】
- **本插件**【项目现状】：`main.ts:122` `app.workspace.getActiveViewOfType(MarkdownView)`（经全局 `app`）——API 本身用法正确，问题在全局 `app`（见 §4.2）。

---

## 3. API 引入版本速查（本插件相关）

| API | @since | 本插件 `minAppVersion=0.15.0` 下可用？ |
| --- | --- | --- |
| `Plugin` / `loadData` / `saveData` / `addSettingTab` / `addCommand` | 0.9.7 | ✅ |
| `MarkdownRenderer.renderMarkdown` | 0.10.6 | ✅（已废弃但可用） |
| `getActiveViewOfType` | 0.9.16 | ✅ |
| `Vault#getAbstractFileByPath` | 0.11.11 | ✅ |
| `registerObsidianProtocolHandler` | 0.11.0 | ✅（未用） |
| `request`（requestUrl 同族） | 0.12.11 | ✅ |
| `registerEditorExtension` | 0.12.8 | ✅（未用） |
| `Platform` | 0.12.2 | ✅ |
| `registerInterval` | 0.13.8 | ✅（未用） |
| `registerDomEvent` | 0.14.8 | ✅（未用） |
| `Plugin#onExternalSettingsChange` | 1.5.7 | ❌（如需需提门槛或特性检测） |
| `Vault#getFileByPath/getFolderByPath` | 1.5.7 | ❌（同上） |
| `Vault#process` | 1.1.0 | ❌（同上） |
| `Plugin#onUserEnable` / `removeCommand` | 1.7.2 | ❌（同上） |
| `SettingTab#icon` | 1.11.0 | ❌ |
| `Plugin#settings`、声明式设置（`getSettingDefinitions` 等） | 1.13.0 | ❌ |
| `MarkdownRenderer.render` | 无标注（推断 1.x 早期可用） | 大概率 ✅，建议特性检测【推断·待确认】 |
| `parseYaml` / `requestUrl` | 无标注（早期 API） | ✅【推断·待确认（确切版本）】 |

> 结论【推断】：本插件用到的 API 在 0.15.0 全部可用；`0.15.9 → 1.0`（2022-10-13，官方 CHANGELOG）是现代 API 基线的分水岭，本插件基线恰好停在 1.0 之前，后续新增能力（1.5.7 类型化文件查找、1.7.2 延迟视图、1.13 声明式设置）都需提门槛后才能享用。

---

## 4. 对本插件有影响的废弃 / 更名 / 行为变化（单独成节）

> 本章是本篇的**核心输出**：只列对本插件（embed-code-file `712f5d2`）实际相关项，按影响排序。

### 4.1 `MarkdownRenderer.renderMarkdown` → `MarkdownRenderer.render` 【官方确认：废弃】

- **事实**：`renderMarkdown` 在当前 d.ts 标注 `@deprecated - use MarkdownRenderer.render`（L4134）；`render` 是官方推荐替代（L4147），首参多一个 `app: App`。【官方确认】
- **现状**：本插件 6 处调用，签名与废弃方法当前定义**完全匹配**，运行无恙；但属于「随时可能在后续 API 线移除」的官方弃用面。【官方确认（废弃）；移除时间表无官方承诺】
- **迁移**（机械改动，6 处同型）：

  ```ts
  // 现状（已废弃）
  await MarkdownRenderer.renderMarkdown(md, el, '', this);
  // 迁移后
  await MarkdownRenderer.render(this.app, md, el, ctx?.sourcePath ?? '', this);
  ```

  顺带修复两点：【推断·建议】① `sourcePath` 由 `''` 改传 `ctx.sourcePath`，让错误信息里的代码块能解析相对内链；② 组件传 `this`（Plugin）语义正确，但代码块场景更贴切的是 `ctx.addChild(new MarkdownRenderChild(el))` 挂到渲染容器 —— 两者可并存评估。

### 4.2 全局 `app` → `this.app` 【官方确认：审核条款（非废弃，但审查必改）】

- **事实**：Plugin guidelines「General」明确：避免使用全局 `app`（`window.app`），「仅用于调试，未来可能移除」；一律用插件实例的 `this.app`。【官方确认】
- **现状**：`main.ts:64`（`app.vault.getAbstractFileByPath`）、`main.ts:122`（`app.workspace.getActiveViewOfType`）使用全局 `app`。【项目现状】
- **迁移**：两处改为 `this.app.*`，零行为差异。【推断·机械改动】

### 4.3 `registerRenderer` 命名陷阱 【官方确认：官方 API 不存在该符号】

- **事实**：官方 API（d.ts 全文）无 `registerRenderer`；`main.ts:33` 是插件自定义方法（内部即 `registerMarkdownCodeBlockProcessor`）。【官方确认 + 项目现状】
- **风险**： Fork 维护者/贡献者极易误当官方 API 使用或覆盖；与官方未来的潜在同名 API 冲突的可能性无法排除。【推断】
- **建议**：更名（如 `registerEmbedCodeRenderer`）并注释指明其组合本质。【推断·建议】

### 4.4 `Vault#getAbstractFileByPath` → 建议逐步转向类型化 API 【官方确认：新增替代，非废弃】

- **事实**：1.5.7 新增 `getFileByPath`/`getFolderByPath`；官方 CHANGELOG 称 `getAbstractFileByPath`「长期是开发者困惑点」。旧 API 不废弃。【官方确认】
- **现状**：`main.ts:64` 用旧 API + `instanceof` 判型，功能正确。【项目现状】
- **迁移**：提 `minAppVersion` ≥1.5.7 后可改 `this.app.vault.getFileByPath(...)`；维持 0.15.0 则保持现状（可用 `requireApiVersion("1.5.7")` 双轨）。【推断·建议】

### 4.5 `registerMarkdownCodeBlockProcessor` 的 el 语义与重渲染 【官方确认 + 推断】

- **事实**：官方明文——处理器收到的是移除 `<pre><code>` 后新建的 `<div>`，由处理器填充内容；`sortOrder` 可选。【官方确认】
- **待确认**：同一代码块重渲染时是否先清空容器，官方无明文。【推断·待确认】
- **现状**：插件插入标题前先自清理旧标题节点，已具备防御性。【项目现状】现代化验证清单（见规范篇 §4.5 延迟视图）应覆盖：编辑源码触发重渲染、实时预览滚动、延迟加载标签页三种场景。【推断·建议】

### 4.6 Node `path` 引入 vs `isDesktopOnly:false` 【推断·待确认：移动端风险】

- **事实**：`utils.ts` `import path from "path"`（Node 内置模块）；`pathJoin()` 在本插件中**未被调用**（`main.ts` 仅导入 `analyseSrcLines/extractSrcLines`）。esbuild 配置把 Node 内置模块设为 `external` + `format: 'cjs'` → 产物 `main.js` 顶部会保留 `require("path")`。【项目现状 + 推断·基于打包行为】
- **官方规范**：Node/Electron API 移动端不可用，「任何调用都可能崩溃」；用了必须 `isDesktopOnly: true`。【官方确认（条款）】
- **判定**：插件声明 `isDesktopOnly: false`，但产物含顶层 `require("path")` —— 移动端加载 `main.js` 时该 require 即执行，存在崩溃风险（即使 `pathJoin` 是死代码）。**处置**：删除未用的 `path` 导入与 `pathJoin`（或改 esbuild 打包策略），风险即消除。【推断·待确认（以移动端实测为准）】

### 4.7 1.7.2 默认延迟加载视图 【官方确认：行为变化；对本插件影响待实测】

- **事实**：官方 CHANGELOG v1.7.2——标签页默认延迟加载；提供 `onUserEnable`、`WorkspaceLeaf#isDeferred/loadIfDeferred` 与官方迁移指南。【官方确认】
- **影响评估**：本插件全部逻辑挂在渲染回调（post processor / code block processor）上，理论上与延迟加载天然兼容；但注册时机的实际表现需在延迟场景实测。【推断·待确认】

### 4.8 无影响确认（记录核对结论） 【官方确认】

以下本插件所用 API **无**废弃/更名/破坏性签名变化：`Plugin`（及 `loadData/saveData/addSettingTab/registerMarkdown*`）、`MarkdownPostProcessorContext`、`TFile`/`Vault.read`、`requestUrl`、`parseYaml`、`PluginSettingTab`（命令式路径）、`MarkdownView`/`getActiveViewOfType`、`Setting`。

---

## 5. 官方 API 变更史速览（与本项目相关的部分）

摘自官方 [CHANGELOG.md](https://github.com/obsidianmd/obsidian-api/blob/master/CHANGELOG.md)（版本 = app 版本；2026-09-16 取用）：

| 版本 | 与本插件相关的变更 |
| --- | --- |
| **v1.0**（2022-10-13） | 0.15.9 → 1.0 基线：workspace 信息迁移至 `workspace.json`、`getLeaf` 用法建议等（本插件 minAppVersion 0.15.0 恰在分水岭之前） |
| v1.1.0 | `FileManager#processFrontMatter`、`Vault#process`、`registerHoverLinkSource`；manifest 新增可选 `fundingUrl`；`editorCallback` 签名调整（适配 Canvas） |
| v1.1.3 | Canvas 颜色规范、callout CSS 变量 |
| v1.4.0 | **Properties**：`CachedMetadata`/`FrontMatterCache` 结构调整；frontmatter 支持 wikilink |
| v1.4.4 | `setTooltip`、`FileManager#processFrontMatter` 支持 `DataWriteOptions` |
| v1.5.7 | **`Vault#getFileByPath/getFolderByPath`**；`Plugin#onExternalSettingsChange`；`View.scope` 公开；`getFrontMatterInfo` |
| v1.5.11 | `SliderComponent` 行为变更（拖动→释放才更新，需 `setInstant(true)` 兼容旧版） |
| v1.7.0 | 修复；markdown embed 容器 `data-type` |
| **v1.7.2**（Insider） | **标签页默认延迟加载**（附官方指南）；`Plugin#onUserEnable`、`Plugin#removeCommand`；**移除** `prepareQuery`/`fuzzySearch`/`PreparedQuery`（改用 `prepareFuzzySearch`）；API 偏好 `unknown` 替代 `any` |
| （d.ts 已含、CHANGELOG 未记） | `@since 1.8.7`～`1.13.0` 的增量：`App#loadLocalStorage/saveLocalStorage`（1.8.7）、`Vault#copy`（1.8.7）、Bases（1.10.0）、`SettingTab#icon`（1.11.0）、`App#secretStorage`（1.11.4）、`registerCliHandler`（1.12.2）、**声明式设置 / `Plugin#settings`（1.13.0）** 等 |

> 未列入上表的官方变更（如 1.2–1.3 的编辑器/预览内部调整）与本项目所用 API 无直接关联，或未在 CHANGELOG 展开 —— 以 d.ts `@since` 标注为准。【官方确认·间接】

---

## 6. 现代化改造建议汇总（API 侧）

按优先级（**均为建议 = 推断**，供负责人决策）：

1. **迁移 `renderMarkdown` → `render`**（6 处，机械改动；消除唯一一处官方废弃依赖）。§4.1
2. **全局 `app` → `this.app`**（2 处）。§4.2
3. **删除未用的 Node `path` 导入**（或重审打包策略），消除移动端崩溃风险；`isDesktopOnly:false` 才名实相符。§4.6
4. `registerRenderer` 更名消除歧义。§4.3
5. 引入 `requireApiVersion()` 特性检测，为「保 0.15.0 最低线 + 渐进启用新 API（`getFileByPath`、`onExternalSettingsChange` 等）」铺路。【官方确认（该函数存在）+ 推断（用法）】
6. 工具链升级（TS 5.x / esbuild 新版 / eslint-plugin-obsidianmd / es2021+ target）并补 `lint` 脚本 —— 对齐官方模板现状。规范篇 §1.3
7. 视发布目标决定 `minAppVersion` 策略：保持 0.15.0（最大兼容）或升 1.x（换取 1.5.7+/1.13+ 能力，需同步 `versions.json` 回退条目）。规范篇 §3.4

---

## 附录：核验与复现

```bash
# 取用日期 2026-09-16；快照 commit cc17443（obsidian-api master）
git -c http.sslBackend=openssl -c http.proxy= clone --depth 1 https://github.com/obsidianmd/obsidian-api.git

# 本文关键签名在 obsidian.d.ts（8498 行快照）中的行号：
#   Component 1835-1913 · App 406-482 · FileStats 2974-2990 · MarkdownPostProcessor 3980-3991
#   MarkdownPostProcessorContext 3996-4025 · MarkdownRenderChild 4104-4115 · MarkdownRenderer 4121-4148
#   MarkdownView 4188-4235 · parseYaml 4816-4817 · Plugin 4901-5086 · PluginManifest 5094-5141
#   PluginSettingTab 5143-5174 · request/requestUrl/RequestUrl* 5430-5486 · requireApiVersion 5488-5494
#   SettingTab 6565-6594 · TAbstractFile 6953-6975 · TFile 7129-7146 · TFolder 7152-7165
#   Vault 7337-7594 · Workspace.getActiveViewOfType 8000-8005
# 行号仅对快照 commit cc17443 有效；复核请按符号名检索。
```

**逐项状态判定汇总**（复查用一行版）：

```
Plugin=存在稳定 | MarkdownRenderer.renderMarkdown=存在+@deprecated(替代 render) |
MarkdownPostProcessorContext=存在稳定 | registerMarkdownPostProcessor=存在稳定(+sortOrder) |
registerMarkdownCodeBlockProcessor=存在稳定(+sortOrder) | registerRenderer=官方不存在(插件自定义) |
TFile=存在稳定 | Vault.getAbstractFileByPath=存在(1.5.7 有类型化替代,非废弃) | Vault.read=存在稳定 |
requestUrl=存在 | parseYaml=存在 | PluginSettingTab=存在(1.13.0 增声明式; display() 无限期支持)
```

---

*文档生成：2026-09-16 · g-002/att-001 · 基于 2026-09-16 官方源快照（obsidian-api `cc17443` / developer-docs `c56c7e7`）；如官方更新，以最新快照与在线文档为准。*
