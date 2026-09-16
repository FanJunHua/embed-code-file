# Embed Code File（Obsidian 插件）

[English](README.md) | 简体中文
🎨 [✨ 功能展示](https://fanjunhua.github.io/embed-code-file/)

本插件支持嵌入 Obsidian 仓库（vault）内的代码文件或远程文件（如 GitHub）。配合 Obsidian 的实时预览（live preview）功能，体验更佳。

## 右键快速添加

在 Markdown 编辑器中点击右键打开上下文菜单，选择 **Add embed-code**：

* 会弹出一个对话框，你可以选择**仓库内文件**（输入即模糊搜索，自动添加 `vault://` 前缀），也可以切换到**远程 URL**（GitHub 请使用 `https://raw.githubusercontent.com/...` 链接）。
* 语言下拉列表来自 `Included Languages` 设置。选中文件后，会按文件扩展名自动匹配语言（如 `.cpp` → `cpp`、`.js` → `javascript`、`.ts` → `typescript`、`.py` → `python`、`.sh` → `bash`）；没有匹配的扩展名则保持当前选择。
* `LINES` 会自动预填编辑器中当前选中的行（例如选中第 5-12 行 → `5-12`）。支持组合写法如 `2,9,30-40`；留空则嵌入整个文件。
* `TITLE` 为可选项；留空时该行会被省略，渲染后的代码块标题回退为 `PATH`。
* 底部预览区实时显示将要插入光标处的完整代码块（自动补充空行，空字段自动省略）。

## 设置

插件默认包含多种语言（`c,cs,cpp,java,python,go,ruby,javascript,js,typescript,ts,shell,sh,bash`）。你可以把需要的任意语言添加到这个逗号分隔的列表中。

### 行号显示（v1.4.0 新增）

嵌入的代码块可以显示行号。插件设置中的「行号显示」提供三个选项：

* `不显示`（默认）——不渲染行号列，与旧版渲染完全一致。
* `显示原行号`——行号与源文件行号一致（`LINES: "29-32"` 显示 `29 30 31 32`）。
* `显示新行号`——显示出来的行从 1 开始连续编号，多个 `LINES` 段落之间连续。

每个行号按其所在代码行的实测位置对齐；折行的续行不占号，省略段落的 `...` 标记不占号。

## 使用方法

首先在 Community Plugins（社区插件）中启用本插件，然后按如下方式嵌入代码：

````yaml
```embed-<some-language>
PATH: "vault://<some-path-to-code-file>" or "http[s]://<some-path-to-remote-file>"
LINES: "<some-line-number>,<other-number>,...,<some-range>"
TITLE: "<some-title>"
```
````

示例：

### 仓库内文件

````yaml
```embed-cpp
PATH: "vault://Code/main.cpp"
LINES: "2,9,30-40,100-122,150"
TITLE: "Some title"
```
````

### 远程文件

````yaml
```embed-cpp
PATH: "https://raw.githubusercontent.com/almariah/embed-code-file/main/main.ts"
LINES: "30-40"
TITLE: "Some title"
```
````

其中 `PATH`、`LINES`、`TITLE` 以 YAML 键值对的形式设置：

* `PATH` 指向仓库内的代码文件或远程文件。例如使用 GitHub 时，请务必使用 `https://raw.githubusercontent.com/...` 链接。

* `LINES` 表示只嵌入代码文件的指定行。每一组行（范围或单行）都会在所含行之后的新一行附加省略号（`...`）。如果想去掉省略号，请尽量合并为单个范围以减少组数。

* 如果未设置 `TITLE`，代码块标题将使用 `PATH` 的值。

普通代码块（不带 `embed-` 前缀）也可以使用 `TITLE`，但标题值必须用双引号包起来：

````cpp
```cpp TITLE: "Some title"
// some code
...
```
````

使用实时预览（live preview）功能可以获得更好的嵌入体验。

## 演示

### 嵌入代码文件
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-code-file.gif?raw=true)

### 嵌入代码文件的指定行
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-code-file-lines.gif?raw=true)

### 嵌入远程文件（如 GitHub）
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-remote-code-file.gif?raw=true)

### 为普通代码块添加标题
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/normal-code-block-title.gif?raw=true)
