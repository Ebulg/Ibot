export class ZaiClient {
  constructor({ apiKey, baseUrl, model, timeoutMs = 20000, logger }) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '');
    this.model = model || 'glm-5.1';
    this.timeoutMs = Number(timeoutMs || 20000);
    this.logger = logger;
  }

  async chat({ messages, temperature = 0.6, maxTokens = 500 }) {
    if (!this.apiKey) throw new Error('ZAI_API_KEY no configurada');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.error?.message || data?.message || res.statusText;
        throw new Error(`Z.AI ${res.status}: ${detail}`);
      }
      return data?.choices?.[0]?.message?.content?.trim() || '';
    } finally {
      clearTimeout(timer);
    }
  }
}
