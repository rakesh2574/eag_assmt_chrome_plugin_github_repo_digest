// tools.js
// Four tools that hit the live GitHub REST API.
// Every tool SUMMARIZES its payload before returning so we don't blow the LLM context.
// On error they return { error: "..." } instead of throwing.

const GH = "https://api.github.com";

async function ghFetch(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...extraHeaders
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${text.slice(0, 200)}`);
  }
  // readme w/ raw accept returns plain text
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

// ---------- TOOL 1 ----------
async function fetch_readme({ owner, repo }) {
  try {
    const raw = await ghFetch(
      `${GH}/repos/${owner}/${repo}/readme`,
      { "Accept": "application/vnd.github.v3.raw" }
    );
    const text = typeof raw === "string" ? raw : "";
    return {
      content: text.slice(0, 2500),
      length_chars: text.length,
      truncated: text.length > 2500
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- TOOL 2 ----------
async function fetch_commit_activity({ owner, repo, days = 30 }) {
  try {
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const commits = await ghFetch(
      `${GH}/repos/${owner}/${repo}/commits?since=${since}&per_page=100`
    );
    if (!Array.isArray(commits)) {
      return { error: "Unexpected commits response" };
    }
    const authors = new Set();
    const messages = [];
    let lastDate = null;
    for (const c of commits) {
      const login = c.author?.login || c.commit?.author?.name || "unknown";
      authors.add(login);
      if (messages.length < 5) {
        const firstLine = (c.commit?.message || "").split("\n")[0].slice(0, 140);
        messages.push(firstLine);
      }
      const d = c.commit?.author?.date || c.commit?.committer?.date;
      if (d && (!lastDate || d > lastDate)) lastDate = d;
    }
    // If no commits in window, fall back to newest commit on default branch
    if (commits.length === 0) {
      try {
        const latest = await ghFetch(
          `${GH}/repos/${owner}/${repo}/commits?per_page=1`
        );
        if (Array.isArray(latest) && latest[0]) {
          lastDate = latest[0].commit?.author?.date || latest[0].commit?.committer?.date || null;
        }
      } catch (_) { /* ignore */ }
    }
    const days_since_last = lastDate
      ? Math.floor((Date.now() - new Date(lastDate).getTime()) / (86400 * 1000))
      : null;
    return {
      window_days: days,
      total_commits: commits.length,
      unique_authors: authors.size,
      last_commit_date: lastDate,
      days_since_last,
      recent_messages: messages
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- TOOL 3 ----------
async function fetch_issues_health({ owner, repo }) {
  try {
    const [open, closed] = await Promise.all([
      ghFetch(`${GH}/repos/${owner}/${repo}/issues?state=open&per_page=50`),
      ghFetch(`${GH}/repos/${owner}/${repo}/issues?state=closed&per_page=50`)
    ]);
    if (!Array.isArray(open) || !Array.isArray(closed)) {
      return { error: "Unexpected issues response" };
    }
    // Filter out PRs — GitHub treats PRs as issues in this endpoint
    const openIssues = open.filter(i => !i.pull_request);
    const closedIssues = closed.filter(i => !i.pull_request);

    const sixMonthsAgo = Date.now() - 180 * 86400 * 1000;
    let stale_open = 0;
    for (const i of openIssues) {
      if (new Date(i.created_at).getTime() < sixMonthsAgo) stale_open++;
    }

    const recent_open_titles = openIssues
      .slice(0, 5)
      .map(i => (i.title || "").slice(0, 120));

    // Response time proxy: for open issues with comments, created->updated gap
    const gaps = [];
    for (const i of openIssues) {
      if (i.comments > 0 && i.created_at && i.updated_at) {
        const gap = (new Date(i.updated_at).getTime() - new Date(i.created_at).getTime()) / (86400 * 1000);
        if (gap >= 0) gaps.push(gap);
      }
    }
    const avg_days_to_first_response = gaps.length
      ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)
      : null;

    return {
      open_count: openIssues.length,
      closed_count: closedIssues.length,
      stale_open,
      recent_open_titles,
      avg_days_to_first_response,
      note: "counts capped at 50 per state (GitHub API page size)"
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- TOOL 4 ----------
async function fetch_contributors({ owner, repo }) {
  try {
    const list = await ghFetch(
      `${GH}/repos/${owner}/${repo}/contributors?per_page=20`
    );
    if (!Array.isArray(list)) {
      return { error: "Unexpected contributors response" };
    }
    const total = list.length;
    const totalContribs = list.reduce((s, c) => s + (c.contributions || 0), 0);
    const top_5 = list.slice(0, 5).map(c => ({
      login: c.login,
      contributions: c.contributions
    }));
    let bus_factor_score = "medium";
    if (totalContribs > 0 && top_5[0]) {
      const topShare = top_5[0].contributions / totalContribs;
      if (topShare > 0.8) bus_factor_score = "low";
      else if (topShare < 0.4) bus_factor_score = "high";
    }
    return {
      total,
      top_5,
      bus_factor_score,
      note: "listing capped at 20"
    };
  } catch (e) {
    return { error: e.message };
  }
}

const TOOLS = {
  fetch_readme,
  fetch_commit_activity,
  fetch_issues_health,
  fetch_contributors
};

// Expose for popup.js (classic script, no modules)
window.TOOLS = TOOLS;
