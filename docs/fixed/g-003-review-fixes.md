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
