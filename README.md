# GitHub Repo Digest

An agentic AI Chrome extension that analyzes any GitHub repository using OpenAI's `gpt-4o-mini` plus the live GitHub REST API. Built for the **EAG V3 — Session 3** assignment.

## What it does

You're on any GitHub repo page. One click → an LLM-powered agent fetches the README, recent commits, issues, and contributors, then gives you a verdict: **USE IT**, **USE WITH CAVEATS**, or **AVOID**.

Every reasoning step — each LLM decision, each tool call, each tool result — is rendered live in the popup as a collapsible card.

## How it satisfies the assignment

| # | Condition | How this extension satisfies it |
|---|---|---|
| C1 | Agentic | The LLM picks the next tool to call based on previous results. No hardcoded order. |
| C2 | Multi-turn loop | Typical run makes 3–5 LLM calls (`MAX_ITERATIONS = 8` in `agent.js`). |
| C3 | Full history carried forward | Every LLM call resends the entire `messages` array — system prompt, every user turn, every assistant turn, every tool result. See the loop in `agent.js`. |
| C4 | ≥3 custom tools | 4 tools: `fetch_readme`, `fetch_commit_activity`, `fetch_issues_health`, `fetch_contributors` (`tools.js`). |
| C5 | Tools do things the LLM can't | All four hit the live GitHub REST API (`api.github.com`) for real, current data. |
| C6 | Reasoning chain visible in UI | Popup renders a card for every `llm_decision` / `tool_call` / `tool_result` / `final` / `error` event, color-coded on the left border and expandable to show raw JSON. |
| C7 | Chrome plugin delivered | Manifest V3, popup + options page, loadable via `Load unpacked`. |

## Demo video

https://www.youtube.com/watch?v=jxfF3So1qvU


## The agent loop (example trace)

```
User: "Analyze microsoft/autogen"
  ↓
LLM → fetch_readme                  → "multi-agent LLM framework, 2.3k chars"
  ↓
LLM → fetch_commit_activity(30d)    → 47 commits, 8 authors, last 2d ago
  ↓
LLM → fetch_issues_health           → 234 open, 41 stale, ~3d first response
  ↓
LLM → fetch_contributors            → bus factor: medium
  ↓
LLM → final_answer                  → "USE_WITH_CAVEATS — active but fast-moving"
```

## Install (Load unpacked)

1. Clone this repo (or unzip the folder).
2. Get an OpenAI API key: https://platform.openai.com/api-keys
3. Open `chrome://extensions` in Chrome / Edge / Brave.
4. Toggle **Developer mode** on (top right).
5. Click **Load unpacked** → select the `eag_assmt_chrome_plugin_github_repo_digest` folder.
6. Click the extension icon → **Options** (gear in the popup header, or right-click → Options) → paste your API key → **Save**.
7. Visit any GitHub repo page, e.g. https://github.com/microsoft/autogen.
8. Click the extension icon → **Analyze Repo**.

Watch each reasoning step stream in. When the agent is done, the final verdict card appears below the chain.

## Grabbing the LLM logs

After a run completes, a **Copy logs** button appears next to **Analyze Repo**. Click it — the full transcript is copied to your clipboard in this format:

```
=== GitHub Repo Digest — LLM conversation log ===
Repository : microsoft/autogen
Model      : gpt-4o-mini
Started at : 2026-04-24T...

--- LLM CALL #1 — messages sent (2) ---
[system]
You are a GitHub repository analyzer agent...

[user]
Analyze this repository: owner="microsoft", repo="autogen". Begin.

--- LLM CALL #1 — raw model response ---
{"action":"tool_call","tool_name":"fetch_readme","args":{...}}

--- TOOL CALL: fetch_readme ---
args: {...}

--- TOOL RESULT: fetch_readme ---
{...}

--- LLM CALL #2 — messages sent (4) ---
...

=== FINAL REPORT ===
{...}
```

Paste that straight into your assignment submission. Every LLM request (the full `messages` array, which grows each turn) and every model response is included — that is the audit trail for condition C3. For a second source, right-click the popup → **Inspect** → **Console**: `agent.js` also `console.log`s each call.

## Try it on

- Active: `https://github.com/microsoft/autogen`, `https://github.com/openai/openai-python`
- Solid but mature: `https://github.com/psf/requests`
- Effectively abandoned: `https://github.com/substack/node-optimist`

Each should produce a noticeably different verdict.

## Tech

- Manifest V3 Chrome extension
- OpenAI Chat Completions API, model `gpt-4o-mini`, `response_format: json_object`
- GitHub REST API v3 (unauthenticated — 60 req/hr/IP, plenty for a demo)
- Vanilla JS / HTML / CSS. No bundler, no npm, no Python at runtime.

## Project structure

```
eag_assmt_chrome_plugin_github_repo_digest/
├── manifest.json         Manifest V3 config
├── popup.html            Popup markup
├── popup.css             Dark theme, gold accent
├── popup.js              UI controller + entry point
├── agent.js              Agent loop + message-history management
├── tools.js              The 4 GitHub-API tool functions
├── openai.js             Chat Completions REST wrapper
├── options.html          API-key settings page
├── options.js            Save / load / clear key (chrome.storage.local)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── README.md
├── .gitignore
└── LICENSE               MIT
```

> `gemini.js` is a deprecated shim left over from an earlier Gemini-based draft; it is not loaded anywhere.

## Security notes

- Your OpenAI API key is stored in `chrome.storage.local`, which is per-device and sandboxed to this extension.
- The key is never logged, never sent to any server except `api.openai.com`, and never committed. The `.gitignore` excludes `.env`, `*.key`, etc.
- Requests are made directly from the popup over HTTPS.
- GitHub API calls are unauthenticated, so rate-limited to 60 req/hr per IP. Each analysis uses ~4 GitHub calls, so you can analyze ~15 repos/hour before hitting the cap.

## Known TODOs / limitations

- **Icons** are auto-generated placeholders ("GD" in gold on a dark square). Replace `icons/icon{16,48,128}.png` with proper branding if desired.
- **GitHub rate limiting** is per-IP unauthenticated. For heavy use add a personal-access-token flow.
- **Private repos** are not supported (no GitHub auth).
- **Large READMEs** are truncated to 2,500 chars inside `fetch_readme` to keep token usage predictable.
- **Model responses** occasionally return slightly malformed JSON; `agent.js` tries a `{…}`-regex fallback, and falls back to an error card if even that fails.

## License

MIT — see `LICENSE`.
