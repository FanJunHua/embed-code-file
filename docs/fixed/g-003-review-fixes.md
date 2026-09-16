# g-003 复核缺陷修复归档

> 来源：主管复核 2026-09-16（判据⑤⑥客观通过、①–④代码级通过、钦定需求实现正确；一处疑似缺陷需修复）。

## F-1 Vault 模糊搜索建议列表排序方向颠倒

- **现象**：Vault 模式输入搜索词后，建议列表把 Top20 中匹配质量最差的结果排在最前。
- **原因**：Obsidian `prepareFuzzySearch` 返回的 `score` 语义为「越高表示匹配越好」（官方 QuickSwitcher 与社区插件惯例均按 score **降序**取优）；`add-embed-modal.ts` 的 `searchVaultFiles` 误用升序比较器 `scored.sort((a, b) => a.score - b.score)`，导致最差匹配排最前。
- **修复**：比较器反转为降序 `scored.sort((a, b) => b.score - a.score);`（add-embed-modal.ts `searchVaultFiles`，单点修复，其余代码未动）。
- **验证结果**：
  1. `node node_modules\typescript\bin\tsc --noEmit --skipLibCheck` → exit 0；
  2. esbuild 0.14.47 CLI 重打包（production 配置）→ exit 0，22.8kb；
  3. 产物核验：`output/embed-code-file/` 三件套更新（main.js 23,326B / manifest.json 288B / styles.css 2,093B），并在 bundle 中确认存在降序比较器 `scored.sort((a, b) => b.score - a.score)`；
  4. 提交：fix(g-003) 至 g-003-att-01 分支。

## F-2 建议下拉溢出 Modal 边界、长路径撑破容器且被裁切（来源：负责人实测 2026-09-16）

- **现象**（负责人截图取证）：① 建议列表右边缘越过 Modal 边界，右半内容不可见，长路径显示为残段（如 `docs/GameHelper/Remot…`）且无省略号；② 列表项长路径（等宽、无空格）横向撑破容器；③ 下拉覆盖层压住「语言/行范围/标题」三行，候选看不清，模糊搜索实测不可用。
- **原因**：下拉挂在路径行 `.setting-item-control` 内（add-embed-modal.ts），宽度被绑定为其宽度；Obsidian 部分版本该 control 为 `flex-shrink: 0` + 固定宽度，弹窗描述文案较长时被推出 Modal 内容区，锚点越界带动下拉整体越界；叠加列表项/路径 span 无 `white-space/overflow/text-overflow` 截断规则，长路径进一步横向溢出被 Modal 裁切。
- **修复内容**（CSS/结构加固，功能逻辑零改动）：
  1. add-embed-modal.ts：路径输入框包进 `position: relative` 的 wrapper `embed-add-path-wrap`（`controlEl.createDiv` 后 `appendChild(pathInput)` 移入），建议下拉改挂 wrapper 内（`left:0; right:0; top:calc(100% + 2px)`），与输入框左右对齐；
  2. styles.css：`.embed-add-modal .setting-item-control` 补 `min-width:0; max-width:100%; overflow:visible`；新增 `.embed-add-path-wrap { position:relative; width:100%; min-width:0 }` 及其 `input[type="text"] { width:100% }`；
  3. `.embed-add-suggest` 补 `overflow-x:hidden; max-width:100%`（保留 `max-height:220px; overflow-y:auto` 与 popover z-index）；
  4. `.embed-add-suggest-item` 与 `.embed-add-suggest-path`（block 化）补 `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`，长路径以 `…` 结尾不再撑破；
  5. 下拉保持覆盖层定位（打字时临时覆盖下方字段、选择后消失），宽度约束为输入框宽度。
- **验证结果**：
  1. `node node_modules\typescript\bin\tsc --noEmit --skipLibCheck` → exit 0；
  2. esbuild 0.14.47 CLI 重打包（production 配置）→ exit 0（22.9kb）；
  3. 产物核验：`output/embed-code-file/` 三件套更新（main.js 23,432B / manifest.json 288B / styles.css 2,541B）；bundle 含 `embed-add-path-wrap` 结构、F-1 降序比较器保留；styles.css 规则落位自查：`text-overflow`×2、`overflow-x`×1、`min-width`×2、`max-width:100%`×2；
  4. 提交：fix(g-003) 至 g-003-att-01 分支，待主管复核后由负责人复测同一位置截图确认。

## F-3 路径输入框窄右列导致建议列表展示过短（来源：负责人复测 2026-09-16）

- **现象**（负责人复测，原话：「将红框选中部分改为蓝色部分，即变长，让输入文件后给的 suggestion 能够完整展示」）：F-2 后列表已不越界、长路径有省略号，但路径输入框仍处 Obsidian Setting 的窄右列且右端被裁切（显示为 `vault://Code/main.c…`），下拉锚定输入框随之受限，候选项只能显示很短一段。
- **原因**：Setting 默认「左 label/描述 + 右 control」两列布局，路径输入框宽度被右列约束；下拉以输入框为锚，宽度随之受限。
- **修复内容**（只改路径行，功能逻辑零改动，保留 F-2 全部溢出/截断规则）：
  1. add-embed-modal.ts：`this.pathSetting.settingEl.addClass('embed-add-path-item');`（仅路径行加类）；
  2. styles.css 新增：`.embed-add-modal .setting-item.embed-add-path-item { flex-direction: column; align-items: stretch; }` 与 `.embed-add-modal .setting-item.embed-add-path-item .setting-item-control { width: 100%; justify-content: flex-start; margin-top: 4px; }`——label/描述在上、输入框在下占满整行，下拉随之获得整行宽度（超长仍以 … 截断）；语言/行范围/标题行保持原右列布局。
- **验证结果**：
  1. `node node_modules\typescript\bin\tsc --noEmit --skipLibCheck` → exit 0；
  2. esbuild 0.14.47 CLI 重打包（production 配置）→ exit 0；
  3. 产物核验：`output/embed-code-file/` 三件套更新；styles.css 含 `embed-add-path-item` 两条规则；bundle 含该类名；F-2 溢出/截断规则保留（`overflow-x:hidden`、`text-overflow:ellipsis`、`min-width:0` 均在位）；
  4. 提交：fix(g-003) 至 g-003-att-01 分支，待主管复核后由负责人再次复测截图确认。
