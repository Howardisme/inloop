# InLoop

InLoop 是在本機執行的 MCP server，讓 GitHub Copilot 為程式碼改動留下結構化的理解紀錄，再由開發者 review、確認並寫下自己的理解。

> **Put learning back in the loop.**

## 需求

- Node.js >= 22.13
- Git
- VS Code 與 GitHub Copilot（使用 MCP 功能時）

## 安裝

```powershell
npm install
npm run build
npm link
```

在要使用 InLoop 的 Git repository 中執行：

```powershell
inloop init
```

### `inloop init` 會改動什麼

預設會：

1. 在 repository 的 hooks 目錄加入 InLoop 區塊，共四個 git hooks：`pre-commit`、`post-commit`、`post-rewrite`、`pre-push`；既有內容會保留。
2. 在 VS Code 使用者的 `mcp.json` 加入 `inloop` server：
   - Windows：`%APPDATA%\Code\User\mcp.json`
   - macOS：`~/Library/Application Support/Code/User/mcp.json`
   - Linux：`~/.config/Code/User/mcp.json`
3. 建立 `<VS Code User>/prompts/inloop.instructions.md`。
4. 在 `~/.copilot/copilot-instructions.md` 加入有起訖標記的 InLoop 區塊；既有內容會保留。

若 `mcp.json` 已存在，第一次改寫前會備份為 `mcp.json.inloop-bak`。因 JSON 會重新序列化，原有註解會被移除，但可從備份取回。

常用選項：

```powershell
inloop init --mcp workspace       # 改寫本 repo 的 .vscode/mcp.json
inloop init --mcp none            # 不設定 MCP
inloop init --instructions repo   # 改寫 .github/copilot-instructions.md
inloop init --instructions none   # 不安裝 instructions
inloop init --no-hooks            # 不安裝 git hooks
```

## 在 Copilot Chat 中使用

- 輸入 `/inloop.review` 顯示尚未 review 的紀錄；在 `copilot-cli` 對話中，這是由 Copilot 依 instructions 呼叫 `show_review`，不是執行 MCP prompt。
- 說「開確認清單」，讓 Copilot 呼叫 `confirm_list` 開啟可複選的確認表單。
- 在 review 內容中反白文字，再用 **Ask in Side Panel** 追問細節。
- 在清單卡片直接使用 **Confirmed**、**說明不正確**、**不重要**與**全部確認**按鈕回覆。

## CLI 日常用法

```powershell
inloop list                         # 列出尚未 review 的紀錄
inloop list --scope all             # 列出全部紀錄
inloop why src/example.ts:42        # 查詢檔案或指定行為何這樣改
inloop confirm 1 2                  # 確認多筆紀錄
inloop confirm 3 --verdict incorrect --note "原因"
inloop pr --base main               # 產生可貼進 PR 的摘要
```

Git hooks 會協助同步紀錄。`pre-push` 預設只提醒；需要阻擋推送時可設定：

```powershell
git config inloop.prePush block
git config inloop.why off           # 關閉 why 查詢
```

移除 InLoop 安裝的 hooks、MCP entry 與 instructions：

```powershell
inloop uninstall
```

`uninstall` 只移除 InLoop 管理的內容；`mcp.json.inloop-bak` 會保留供手動還原。

## 已知限制

- `copilot-cli` 不執行 MCP prompts；`/inloop.review` 等指令靠 instructions 引導 Copilot 呼叫工具。
- Copilot Chat Markdown 不支援 `<details>`，因此 review 內容不使用可收合區塊。
- git hook 無法互動詢問，所以 `pre-push` 預設只提醒，不阻擋推送。
- `init` 重寫 `mcp.json` 時會移除註解；修改前會建立 `mcp.json.inloop-bak`。

## 文件

- [產品報告](docs/product-report.md)
- [設計文件](docs/design-doc.md)
