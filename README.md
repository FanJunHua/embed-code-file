# Embed Code File (Obsidian Plugin)

English | [简体中文](README_CN.md)
🎨 [✨ Feature Showcase](https://fanjunhua.github.io/embed-code-file/)

This plugin allows embedding code files from an Obsidian vault or a remote file (e.g., GitHub). It works better with the live preview feature of Obsidian.

## Quick add via right-click

In the markdown editor, right-click to open the context menu and choose **Add embed-code**:

* A dialog opens where you can pick a **vault file** (type to fuzzy search, the `vault://` prefix is added automatically) or switch to a **remote URL** (for GitHub, use a `https://raw.githubusercontent.com/...` link).
* The language dropdown comes from the `Included Languages` setting. After picking a file, the language is matched automatically from the file extension (e.g. `.cpp` → `cpp`, `.js` → `javascript`, `.ts` → `typescript`, `.py` → `python`, `.sh` → `bash`). Extensions without a match keep the current selection.
* `LINES` is prefilled with the lines selected in the editor (e.g. a selection on lines 5-12 → `5-12`). It supports combined sets like `2,9,30-40`; leave it empty to embed the whole file.
* `TITLE` is optional; when left empty the field is omitted and the rendered block falls back to `PATH`.
* The preview at the bottom shows the exact block that will be inserted at the cursor (padded with blank lines, empty fields omitted).

## Settings

The plugin includes multiple languages by default (`c,cs,cpp,java,python,go,ruby,javascript,js,typescript,ts,shell,sh,bash`). You can add any language you need to the comma-separated list.

### Line numbers (new in v1.4.0)

Embedded code blocks can display line numbers. In the plugin settings, **Line Numbers** offers:

* `Hide` (default) — no gutter, rendering identical to previous versions.
* `Source line numbers` — numbers match the original file lines (`LINES: "29-32"` shows `29 30 31 32`).
* `Renumbered` — displayed lines count from 1, continuously across multiple `LINES` segments.

Each number is aligned to its own code line; wrapped continuation lines take no number, and omitted segments keep their `...` markers without numbers.

### Hide code lines (new in v1.5.0)

Hide source lines directly from the rendered block and persist the choice in the embed block:

* With line numbers shown, **click a line number** to hide that line instantly, or **drag across several line numbers** and confirm with the floating **Hide selected lines** button (release with `Ctrl`/`Cmd` held to skip confirmation). Without line numbers, select code inside the block and use the floating button instead.
* Each hidden segment renders as a single `...` marker (never one `...` per line).
* A **Show all (N lines hidden)** button appears at the block's top-right corner, side by side with Obsidian's own copy/edit buttons, to reveal everything again.
* Hidden lines are written back into the block as a `HIDE` key (undoable with `Ctrl+Z` in the editor):

````yaml
```embed-cpp
PATH: "vault://Code/main.cpp"
LINES: "164-208"
HIDE: "182-194"
TITLE: "Some title"
```
````

* Commands: **Hide selected code lines** (`Ctrl/Cmd+Shift+H`) hides the lines under the current selection; **Show all (clear hidden lines)** clears the block's `HIDE`.

### Selection-driven visibility (new in v1.6.0)

* **Show only selected lines** — in blocks without `LINES` (whole-file embeds), drag across several line numbers and pick **Show only selected lines** from the floating bar: the block is rewritten as `LINES: "<selection>"` (the `HIDE` key is removed if present). Undoable with `Ctrl+Z`. Also available as the command **Show only selected code lines**. Blocks that already have `LINES` keep the button hidden, so an existing `LINES` is never rewritten silently.
* **Convert HIDE to LINES** — the command **Convert HIDE to LINES** (also in the editor context menu) rewrites `HIDE` back into an equivalent `LINES` value (identical rendering, `HIDE` key removed; a no-op for blocks without `HIDE`).
* **Temporarily expand hidden segments** — each collapsed `...` segment shows a `▸` symbol in the line-number gutter (with line numbers off, click the `...` line itself). Clicking reveals the hidden lines in place as dimmed "ghost" rows — view-only, never written to the file; any re-render collapses them again. The expanded range is bracketed by `▾` (first row) and `▴` (last row); clicking either collapses it.
* **Restore hidden lines while expanded** — inside an expanded segment, click a ghost row's number to restore that line, or drag across several and confirm with **Restore selected lines** (`Ctrl`/`Cmd`+drag skips confirmation). Restoring writes `LINES ∪ selection` and `HIDE − selection` in a single minimal diff (blocks without `LINES` never get a `LINES` key created).

### Interface language (new in v1.5.0)

The plugin UI (settings, commands, notices, dialogs) follows Obsidian's language: Chinese for locales starting with `zh`, English otherwise. Reload the plugin after changing Obsidian's language to apply it.

## How to use

First you need to activate the plugin from Community Plugins. Then you can embed the code as follows:

````yaml
```embed-<some-language>
PATH: "vault://<some-path-to-code-file>" or "http[s]://<some-path-to-remote-file>"
LINES: "<some-line-number>,<other-number>,...,<some-range>"
TITLE: "<some-title>"
```
````

Examples:

### Vault File

````yaml
```embed-cpp
PATH: "vault://Code/main.cpp"
LINES: "2,9,30-40,100-122,150"
TITLE: "Some title"
```
````

### Remote File

````yaml
```embed-cpp
PATH: "https://raw.githubusercontent.com/almariah/embed-code-file/main/main.ts"
LINES: "30-40"
TITLE: "Some title"
```
````

where the `PATH`, `LINES`, and `TITLE` properties are set as YAML key-value pairs:

* The `PATH` should be a code file in the vault or a remote file. For example, if you use GitHub, make sure to use a `https://raw.githubusercontent.com/...` link.

* The `LINES` will include only the specified lines of the code file. Every set of included lines (a range or an explicit line) appends dots (`...`) after the included lines on a new line. If you want to get rid of the dots, minimize the number of sets by using one range as much as you can.

* If `TITLE` is not set, then the title of the code block will be the `PATH` value.

You can also use `TITLE` with a normal code block (without the `embed-` prefix), but make sure that the title value is set with double quotes:

````cpp
```cpp TITLE: "Some title"
// some code
...
```
````

Using the live preview feature will enhance the embedding experience.

## Demo

### Embed code file
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-code-file.gif?raw=true)

### Embed lines from code file
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-code-file-lines.gif?raw=true)

### Embed lines from remote file (e.g., GitHub)
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-remote-code-file.gif?raw=true)

### Add title to normal code block
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/normal-code-block-title.gif?raw=true)
