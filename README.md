# chat_restore_note

Chrome extension for saving important AI chat history into note-friendly Markdown.

## Supported Sites

- ChatGPT: `chatgpt.com`, `chat.openai.com`
- Claude: `claude.ai`
- Gemini: `gemini.google.com`
- DeepSeek: `chat.deepseek.com`, `deepseek.com`

## First Version

This version exports the current open conversation page:

- Detects the AI chat platform.
- Extracts visible conversation messages.
- Builds Obsidian-friendly Markdown with YAML frontmatter.
- Sends the note to Obsidian through the official `obsidian://new` URI.
- Optionally runs AI Summary before export to turn the transcript into a cleaner knowledge-base note.
- Copies Markdown to the clipboard.
- Downloads a `.md` file.
- Keeps Pro-only features behind a cloud membership boundary.

Notion sync is not included yet. Notion requires an integration token and page/database configuration. That can be added after the extraction layer is stable.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chat_restore_note`.

## Use

1. Open a conversation in ChatGPT, Claude, Gemini, or DeepSeek.
2. Click the `chat_restore_note` extension icon.
3. Click **提取当前聊天**.
4. Optional: enable **AI Summary**, enter your MiniMax API key, and edit the prompt if needed.
5. For Obsidian, enter your Vault name and optional folder, then click **保存到 Obsidian**.
6. You can also click **复制 Markdown** or **下载 .md**.

## AI Summary

AI Summary is a Pro feature. The extension no longer stores model endpoints or API keys in the browser. It calls the product cloud API, and the server owns provider selection, API keys, rate limits, and billing checks.

The first cloud MVP lives in `cloud/server.mjs` and exposes:

- `GET /v1/me` for membership state.
- `GET /auth/login` and `GET /auth/checkout` for account and payment entry points.
- `POST /v1/ai/summary` for server-side AI summary.

## Bulk Export

Bulk Export is a Pro feature. Click **批量导出** in the popup to open the bulk workspace after membership verification. The workspace follows the platform of the current page. ChatGPT and Claude are supported first.

1. Keep a ChatGPT or Claude tab open.
2. Click **扫描左侧历史**.
3. Select the conversations to export.
4. Click **选择导出目录** and choose the target local folder, such as your Obsidian `Raw/Chat_history` folder.
5. Click **导出选中**.

The first bulk version scans the conversations already loaded in the left sidebar. If you need older conversations, scroll the sidebar first so the site loads them, then scan again.

The folder picker can open the system directory chooser, but Chrome extensions do not expose the full local path to web pages. The picker fills the selected folder name; nested vault-relative paths can still be edited manually, such as `Knowledge/AI Chats`.

For Obsidian URI, **Vault 名称 is the Obsidian vault name, not a Finder path**. If your vault folder is `Raw` and you want notes inside `Raw/Chat_history`, use:

- Vault 名称: `Raw`
- 文件夹: `Chat_history`

## Obsidian Save

The Obsidian button uses the official Obsidian URI flow:

- Action: `obsidian://new`
- Target: your configured vault and folder.
- Content: copied to clipboard first, then passed with `clipboard=true`.

Using the clipboard avoids oversized URLs for long conversations.

## Notes

AI chat UIs change often. The extractor uses platform-specific selectors first, then falls back to visible conversation blocks. If a platform changes its DOM, the Markdown preview helps verify before saving.
