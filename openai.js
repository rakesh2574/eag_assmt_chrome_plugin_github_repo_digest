// openai.js
// Thin REST wrapper around OpenAI Chat Completions (gpt-4o-mini).
// The whole `messages` array is sent on every turn — that's how we satisfy
// "full history carried forward" (assignment condition C3).

const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";

async function callLLM(apiKey, messages) {
  // messages is an array of { role: "system"|"user"|"assistant", content: "..." }
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 400)}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  if (!choice) {
    throw new Error("No choices in OpenAI response: " + JSON.stringify(data).slice(0, 400));
  }
  const text = choice.message?.content || "";
  if (!text) throw new Error("Empty content in OpenAI response");
  return text;
}

window.callLLM = callLLM;
