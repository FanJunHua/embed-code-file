# Embed Code File (Obsidian Plugin)

This plugin allows to embed code files from Obsidian vault or remote file (eg., GitHub). It works better with live preview feature of Obsidian.

## Quick add via right-click

In the markdown editor, right-click to open the context menu and choose **Add embed-code**:

* A dialog opens where you can pick a **vault file** (type to fuzzy search, the `vault://` prefix is added automatically) or switch to a **remote URL** (for GitHub use a `https://raw.githubusercontent.com/...` link).
* The language dropdown comes from the `Included Languages` setting. After picking a file, the language is matched automatically from the file extension (e.g. `.cpp` → `cpp`, `.js` → `javascript`, `.ts` → `typescript`, `.py` → `python`, `.sh` → `bash`). Extensions without a match keep the current selection.
* `LINES` is prefilled with the lines selected in the editor (e.g. a selection on lines 5–12 → `5-12`). It supports combined sets like `2,9,30-40`; leave it empty to embed the whole file.
* `TITLE` is optional; when left empty the field is omitted and the rendered block falls back to `PATH`.
* The preview at the bottom shows the exact block that will be inserted at the cursor (padded with blank lines, empty fields omitted).

## Settings

The plugin include multiple language by default (`c,cpp,java,python,go,ruby,javascript,js,typescript,ts,shell,sh,bash`). You can include any needed language to the comma separated list.

## How to use

First you need to activate the plugin from Community Plugins. Then you can embed the code as follow:

````yaml
```embed-<some-language>
PATH: "vault://<some-path-to-code-file>" or "http[s]://<some-path-to-remote-file>"
LINES: "<some-line-number>,<other-number>,...,<some-range>"
TITLE: "<some-title>"
```
````

Examples:

#### Vault File:

````yaml
```embed-cpp
PATH: "vault://Code/main.cpp"
LINES: "2,9,30-40,100-122,150"
TITLE: "Some title"
```
````

#### Remote File:

````yaml
```embed-cpp
PATH: "https://raw.githubusercontent.com/almariah/embed-code-file/main/main.ts"
LINES: "30-40"
TITLE: "Some title"
```
````

where `PATH`, `LINES` and `TITLE` properties are set as YAML key-value pairs:

* The `PATH` should be a code file in the vault or remote. If you have used GitHub for example, make sure to use `https://raw.githubusercontent.com/...`

* The `LINES` will include only the specified lines of the code file. Every set of included lines either range or explicit line will append dots (`...`) to included line in a newline. If you want to get rid of dots, minimize the number of sets by using one range as much as you can.

* If `TITLE` is not set, then the title of the code block will be `PATH` value.

You can use also `TITLE` with normal code block (without `embed-`), but make sure that the title value is set with double quotes:

````cpp
```cpp TITLE: "Some title"
// some code
...
```
````

Using live preview feature will enhance the embedding experience.

## Demo

#### Embed code file
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-code-file.gif?raw=true)

#### Embed lines from code file
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-code-file-lines.gif?raw=true)

#### Embed lines from remote file (eg., GitHub)
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/embed-remote-code-file.gif?raw=true)

#### Add title to normal code block
![Gif](https://github.com/almariah/embed-code-file/blob/main/demo/normal-code-block-title.gif?raw=true)
