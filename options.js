// options.js - save/load/clear OpenAI API key

const keyInput = document.getElementById("apiKey");
const maskedEl = document.getElementById("masked");
const savedMsg = document.getElementById("savedMsg");

function maskKey(k) {
  if (!k) return "";
  if (k.length <= 8) return "Stored: " + "*".repeat(k.length);
  return "Stored: " + k.slice(0, 4) + "\u2022".repeat(Math.max(6, k.length - 8)) + k.slice(-4);
}

async function load() {
  const { openaiApiKey } = await chrome.storage.local.get(["openaiApiKey"]);
  if (openaiApiKey) {
    maskedEl.textContent = maskKey(openaiApiKey);
    keyInput.placeholder = "Enter a new key to replace";
  } else {
    maskedEl.textContent = "No key saved yet.";
  }
}

document.getElementById("saveBtn").addEventListener("click", async () => {
  const val = keyInput.value.trim();
  if (!val) {
    savedMsg.textContent = "Enter a key first.";
    savedMsg.style.color = "var(--red)";
    return;
  }
  if (!val.startsWith("sk-")) {
    // Not fatal — OpenAI project keys start with sk-proj-, user keys with sk-.
    // We warn but still save, in case the format changes.
    savedMsg.textContent = "Warning: key does not start with 'sk-'. Saved anyway.";
    savedMsg.style.color = "var(--gold)";
  }
  await chrome.storage.local.set({ openaiApiKey: val });
  keyInput.value = "";
  if (!savedMsg.textContent.startsWith("Warning")) {
    savedMsg.textContent = "Saved.";
    savedMsg.style.color = "var(--green)";
  }
  await load();
  setTimeout(() => (savedMsg.textContent = ""), 2800);
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["openaiApiKey"]);
  keyInput.value = "";
  savedMsg.textContent = "Cleared.";
  savedMsg.style.color = "var(--muted)";
  await load();
  setTimeout(() => (savedMsg.textContent = ""), 2500);
});

load();
