const CHATGPT_CONVERSATION_RE =
  /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function extractChatGptConversationId(url) {
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "chatgpt.com" && host !== "chat.openai.com") return null;
  const match = url.pathname.match(CHATGPT_CONVERSATION_RE);
  return match?.[1] ?? null;
}

// Page identity for highlights: origin + pathname only (no query or hash).
// ChatGPT Project URLs (/g/g-p-…/c/{id}) canonicalize to /c/{id}.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";

    const chatId = extractChatGptConversationId(u);
    if (chatId) {
      return `${u.origin}/c/${chatId}`;
    }

    return u.href;
  } catch {
    const stripped = url.split("#")[0].split("?")[0];
    try {
      const u = new URL(stripped);
      const chatId = extractChatGptConversationId(u);
      if (chatId) return `${u.origin}/c/${chatId}`;
    } catch {
      /* fall through */
    }
    return stripped;
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.normalizeUrl = normalizeUrl;
}