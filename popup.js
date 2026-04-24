// popup.js
// UI controller. Reads the active tab, extracts owner/repo, checks API key,
// runs the agent on click, and streams each reasoning step into the chain.

const $ = (id) => document.getElementById(id);

const repoNameEl   = $("repoName");
const runBtn       = $("runBtn");
const copyBtn      = $("copyBtn");
const statusEl     = $("status");
const chainSection = $("chainSection");
const chainEl      = $("chain");
const reportSection= $("reportSection");
const reportEl     = $("report");
const openOptions  = $("openOptions");

let currentRepo = null;   // { owner, repo } or null
let apiKey = null;
let runLog = [];          // every step event, used to build the copy-paste transcript
let runStartedAt = null;

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  if (chrome.runtime && chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open("options.html");
  }
});

function parseGithubRepo(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const skip = new Set([
      "features", "topics", "collections", "trending", "marketplace",
      "pricing", "settings", "notifications", "new", "login", "join",
      "signup", "explore", "search", "pulls", "issues", "codespaces",
      "sponsors", "about", "organizations", "orgs"
    ]);
    if (skip.has(parts[0])) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch (_) {
    return null;
  }
}

function showNotice(text, { linkHref = null, linkText = null } = {}) {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = text + " ";
  if (linkHref) {
    const a = document.createElement("a");
    a.href = linkHref;
    a.textContent = linkText || linkHref;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
    notice.appendChild(a);
  }
  document.querySelector(".controls").before(notice);
}

async function init() {
  // 1. Active tab -> repo
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = tab && tab.url ? parseGithubRepo(tab.url) : null;
  if (!parsed) {
    repoNameEl.textContent = "Open a GitHub repo tab first";
    runBtn.disabled = true;
    return;
  }
  currentRepo = parsed;
  repoNameEl.textContent = `${parsed.owner}/${parsed.repo}`;

  // 2. API key
  const stored = await chrome.storage.local.get(["openaiApiKey"]);
  apiKey = stored.openaiApiKey || null;
  if (!apiKey) {
    showNotice("No OpenAI API key set.", { linkHref: "options.html", linkText: "Open settings" });
    runBtn.disabled = true;
    return;
  }

  runBtn.disabled = false;
}

// ---------- Step rendering ----------
function makeStep(kind, title) {
  const card = document.createElement("div");
  card.className = `step ${kind}`;
  const head = document.createElement("div");
  head.className = "step-head";
  const t = document.createElement("div");
  t.className = "step-title";
  t.textContent = title;
  const k = document.createElement("div");
  k.className = "step-kind";
  k.textContent = kind === "result" ? "tool result"
                 : kind === "tool" ? "tool call"
                 : kind === "llm"  ? "llm decision"
                 : kind === "final" ? "final"
                 : "error";
  head.appendChild(t);
  head.appendChild(k);

  const body = document.createElement("div");
  body.className = "step-body hidden";

  head.addEventListener("click", () => body.classList.toggle("hidden"));

  card.appendChild(head);
  card.appendChild(body);
  return { card, body };
}

function addPre(parent, text) {
  const pre = document.createElement("pre");
  pre.textContent = text;
  parent.appendChild(pre);
}

function renderStep(step) {
  // Capture every step for the copy-logs button, regardless of whether we also render it.
  runLog.push({ ...step, ts: new Date().toISOString() });

  chainSection.classList.remove("hidden");
  const t = step.type;
  const p = step.payload || {};
  let card, body;

  if (t === "llm_request") {
    const title = `Step ${p.iteration}: sending ${p.messages.length}-message history to LLM`;
    ({ card, body } = makeStep("req", title));
    addPre(body, JSON.stringify(p.messages, null, 2));
  } else if (t === "llm_decision") {
    const action = p.parsed?.action || "?";
    const title = `Step ${p.iteration}: LLM chose "${action}"`;
    ({ card, body } = makeStep("llm", title));
    addPre(body, JSON.stringify(p.parsed, null, 2));
  } else if (t === "tool_call") {
    const title = `Calling tool: ${p.tool_name}`;
    ({ card, body } = makeStep("tool", title));
    addPre(body, JSON.stringify(p.args, null, 2));
  } else if (t === "tool_result") {
    const title = `Result from ${p.tool_name}`;
    ({ card, body } = makeStep("result", title));
    addPre(body, JSON.stringify(p.result, null, 2));
  } else if (t === "final") {
    const title = `Final verdict ready`;
    ({ card, body } = makeStep("final", title));
    addPre(body, JSON.stringify(p, null, 2));
  } else if (t === "error") {
    const title = `Error: ${p.message || "unknown"}`;
    ({ card, body } = makeStep("err", title));
    addPre(body, JSON.stringify(p, null, 2));
  } else {
    return;
  }

  chainEl.appendChild(card);
  chainEl.scrollIntoView({ block: "end", behavior: "smooth" });
}

// ---------- Final report ----------
function renderReport(report) {
  reportSection.classList.remove("hidden");
  reportEl.innerHTML = "";

  const verdictCls = {
    "USE_IT": "use",
    "USE_WITH_CAVEATS": "caveats",
    "AVOID": "avoid"
  }[report.verdict] || "caveats";

  const activityCls = {
    "HIGH": "high", "MEDIUM": "medium", "LOW": "low", "ABANDONED": "abandoned"
  }[report.activity_level] || "medium";

  const add = (label, html) => {
    const row = document.createElement("div");
    row.className = "row";
    const l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "value";
    v.innerHTML = html;
    row.appendChild(l);
    row.appendChild(v);
    reportEl.appendChild(row);
  };

  add("Verdict", `<span class="badge ${verdictCls}">${escapeHtml(report.verdict || "?")}</span>`);
  add("Why", escapeHtml(report.verdict_reason || ""));
  add("What it does", escapeHtml(report.what_it_does || ""));
  add("Activity", `<span class="badge ${activityCls}">${escapeHtml(report.activity_level || "?")}</span> <span style="margin-left:6px; color: var(--muted);">${escapeHtml(report.activity_reason || "")}</span>`);
  if (Array.isArray(report.health_signals) && report.health_signals.length) {
    const items = report.health_signals.map(s => `<li>${escapeHtml(s)}</li>`).join("");
    add("Health signals", `<ul>${items}</ul>`);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Run ----------
runBtn.addEventListener("click", async () => {
  if (!currentRepo || !apiKey) return;

  runBtn.disabled = true;
  statusEl.textContent = "Thinking";
  statusEl.classList.add("running");
  chainEl.innerHTML = "";
  reportEl.innerHTML = "";
  reportSection.classList.add("hidden");

  // Reset log for this run
  runLog = [];
  runStartedAt = new Date().toISOString();
  copyBtn.classList.add("hidden");
  copyBtn.classList.remove("copied");
  copyBtn.textContent = "Copy logs";

  try {
    const report = await window.runAgent({
      owner: currentRepo.owner,
      repo: currentRepo.repo,
      apiKey,
      onStep: renderStep
    });
    if (report) renderReport(report);
  } catch (e) {
    renderStep({ type: "error", payload: { message: e.message } });
  } finally {
    statusEl.classList.remove("running");
    statusEl.textContent = "";
    runBtn.disabled = false;
    if (runLog.length > 0) copyBtn.classList.remove("hidden");
  }
});

// ---------- Log transcript builder ----------
function buildTranscript() {
  const lines = [];
  const repoStr = currentRepo ? `${currentRepo.owner}/${currentRepo.repo}` : "unknown";
  lines.push(`=== GitHub Repo Digest — LLM conversation log ===`);
  lines.push(`Repository : ${repoStr}`);
  lines.push(`Model      : gpt-4o-mini`);
  lines.push(`Started at : ${runStartedAt || "?"}`);
  lines.push(``);

  for (const step of runLog) {
    const p = step.payload || {};
    if (step.type === "llm_request") {
      lines.push(`--- LLM CALL #${p.iteration} — messages sent (${p.messages.length}) ---`);
      for (const m of p.messages) {
        lines.push(`[${m.role}]`);
        lines.push(m.content);
        lines.push(``);
      }
    } else if (step.type === "llm_decision") {
      lines.push(`--- LLM CALL #${p.iteration} — raw model response ---`);
      lines.push(p.raw || JSON.stringify(p.parsed));
      lines.push(``);
    } else if (step.type === "tool_call") {
      lines.push(`--- TOOL CALL: ${p.tool_name} ---`);
      lines.push(`args: ${JSON.stringify(p.args)}`);
      lines.push(``);
    } else if (step.type === "tool_result") {
      lines.push(`--- TOOL RESULT: ${p.tool_name} ---`);
      lines.push(JSON.stringify(p.result, null, 2));
      lines.push(``);
    } else if (step.type === "final") {
      lines.push(`=== FINAL REPORT ===`);
      lines.push(JSON.stringify(p, null, 2));
      lines.push(``);
    } else if (step.type === "error") {
      lines.push(`!!! ERROR !!!`);
      lines.push(JSON.stringify(p, null, 2));
      lines.push(``);
    }
  }
  return lines.join("\n");
}

copyBtn.addEventListener("click", async () => {
  const text = buildTranscript();
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.classList.add("copied");
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyBtn.textContent = "Copy logs";
    }, 1800);
  } catch (e) {
    // Fallback: select into a temp textarea and execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (_) {}
    document.body.removeChild(ta);
    copyBtn.textContent = "Copied (fallback)";
    setTimeout(() => (copyBtn.textContent = "Copy logs"), 1800);
  }
});

init().catch((e) => {
  repoNameEl.textContent = "Error: " + e.message;
});
