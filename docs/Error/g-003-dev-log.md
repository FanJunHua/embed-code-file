# g-003 开发 Error / 环境问题记录

> 按 AGENTS.md 要求归档本轮开发过程中遇到的报错与修复。docs/fixed/ 本轮无缺陷修复类归档，未创建。

## E-1 esbuild 平台二进制缺失（环境问题，非代码缺陷）

- **现象**：依赖安装后 `node_modules\esbuild\bin\` 下只有 JS 启动器，无 `esbuild.exe`；直接跑 esbuild CLI 会失败。`esbuild-windows-64` 可选平台包也未出现在 `node_modules` 中。
- **原因**：沙箱禁止 Node 管道 spawn，必须以 `npm ci --ignore-scripts` 安装依赖，esbuild 的 postinstall（负责把平台二进制复制到 `node_modules\esbuild\bin`）被跳过。
- **修复**：用 node `https.get`（curl 会因 schannel 失败）从 registry 下载 `esbuild-windows-64-0.14.47.tgz`（3,429,358 B），`tar -xzf` 解出 `package/esbuild.exe`，复制到 `node_modules\esbuild\bin\esbuild.exe`；`esbuild.exe --version` 验证输出 `0.14.47`。下载脚本与 tgz 置于 `.npm-cache-tmp/`（临时目录，构建后已删除）。

## E-2 npm scripts 无法执行（已知环境约束）

- **现象**：`npm run build`（内部 `tsc && node esbuild.config.mjs`）及 esbuild JS API 报 EPERM。
- **原因**：沙箱禁止程序通过命名管道捕获子进程输出（node child_process spawn 默认 stdio pipe → EPERM）。
- **修复**：绕过 npm scripts，直接以 `node node_modules\typescript\bin\tsc --noEmit --skipLibCheck` 做类型检查，以 `esbuild.exe` CLI 按 `esbuild.config.mjs` 的 production 配置逐参数打包（`--platform=node` 等价覆盖 config 中 builtin-modules 外置列表）。

## 本轮代码错误

- 无。`tsc --noEmit --skipLibCheck` 一次通过（exit 0），esbuild 打包一次通过（exit 0）。
