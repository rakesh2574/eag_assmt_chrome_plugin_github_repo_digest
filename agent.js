// agent.js
// The agentic loop. The LLM decides which tool to call next — not us.
// Every LLM call includes the complete prior conversation (condition C3).

const SYSTEM_PROMPT = `You are a GitHub repository analyzer agent. Your job: analyze a repo and produce a verdict.

You have these tools:
1. fetch_readme({owner, repo}) -> what the repo does
2. fetch_commit_activity({owner, repo, days}) -> how active it is (days defaults to 30)
3. fetch_issues_health({owner, repo}) -> maintainer responsiveness
4. fetch_contributors({owner, repo}) -> bus factor / team health

WORKFLOW:
- Call tools in any order YOU think best.
- After each tool result, decide: do I have enough, or do I need more info?
- Typical analysis uses 3-4 tool calls. Don't call the same tool twice.
- When you have enough signal, produce the final verdict.

RESPONSE FORMAT (strict JSON object, no markdown, no commentary):

If calling a tool, respond with exactly:
{"action": "tool_call", "tool_name": "<name>", "args": {"owner": "...", "repo": "..."}}

If giving the final answer, respond with exactly:
{
  "action": "final_answer",
  "report": {
    "what_it_does": "1-2 sentence plain English description",
    "activity_level": "HIGH" | "MEDIUM" | "LOW" | "ABANDONED",
    "activity_reason": "short explanation grounded in the commit data you saw",
    "health_signals": ["bullet", "bullet", "bullet"],
    "verdict": "USE_IT" | "USE_WITH_CAVEATS" | "AVOID",
    "verdict_reason": "2-3 sentences explaining the verdict"
  }
}

Emit ONLY a valid JSON object. No prose around it. No backticks.`;

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in model output");
    return JSON.parse(match[0]);
  }
}

async function runAgent({ owner, repo, apiKey, onStep }) {
  // OpenAI chat format. The entire messages array is resent on every turn
  // — that is condition C3 ("full history carried forward").
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: `Analyze this repository: owner="${owner}", repo="${repo}". Begin.` }
  ];

  const MAX_ITERATIONS = 8;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let rawResponse;
    try {
      rawResponse = await callLLM(apiKey, messages);
    } catch (e) {
      onStep({ type: "error", payload: { message: "LLM call failed: " + e.message } });
      return null;
    }

    let parsed;
    try {
      parsed = safeParseJSON(rawResponse);
    } catch (e) {
      onStep({
        type: "error",
        payload: { message: "Could not parse LLM response as JSON", raw: rawResponse }
      });
      return null;
    }

    onStep({ type: "llm_decision", payload: { iteration: i + 1, parsed } });

    // Keep the model's literal response in history — C3.
    messages.push({ role: "assistant", content: rawResponse });

    if (parsed.action === "final_answer") {
      onStep({ type: "final", payload: parsed.report });
      return parsed.report;
    }

    if (parsed.action === "tool_call") {
      const tool_name = parsed.tool_name;
      const args = parsed.args || {};
      onStep({ type: "tool_call", payload: { tool_name, args } });

      if (!window.TOOLS || !window.TOOLS[tool_name]) {
        const err = { error: `Unknown tool: ${tool_name}` };
        onStep({ type: "tool_result", payload: { tool_name, result: err } });
        messages.push({
          role: "user",
          content: `Tool result from ${tool_name}:\n${JSON.stringify(err)}\n\nDecide next step.`
        });
        continue;
      }

      let result;
      try {
        // Always pass the canonical owner/repo we extracted from the URL,
        // overriding anything the LLM hallucinated in args.
        result = await window.TOOLS[tool_name]({ ...args, owner, repo });
      } catch (e) {
        result = { error: e.message };
      }

      onStep({ type: "tool_result", payload: { tool_name, result } });

      messages.push({
        role: "user",
        content: `Tool result from ${tool_name}:\n${JSON.stringify(result, null, 2)}\n\nDecide next step.`
      });
      continue;
    }

    // Neither a tool_call nor a final_answer — nudge once, then bail.
    onStep({ type: "error", payload: { message: "LLM returned unrecognized action", parsed } });
    messages.push({
      role: "user",
      content: "Your last message was not a valid action. Respond with tool_call or final_answer JSON only."
    });
  }

  onStep({ type: "error", payload: { message: "Max iterations reached without final answer" } });
  return null;
}

window.runAgent = runAgent;
