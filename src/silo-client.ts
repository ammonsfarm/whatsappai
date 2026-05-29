type SiloClientConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModels: string[];
  instructions: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class SiloClient {
  constructor(private readonly cfg: SiloClientConfig) {}

  async complete(params: { conversationKey: string; text: string; senderName?: string }) {
    if (!this.cfg.apiKey) {
      throw new Error('SILO_API_KEY is not configured.');
    }

    const content = params.senderName
      ? `${params.senderName}: ${params.text}`
      : params.text;

    const models = [this.cfg.model, ...this.cfg.fallbackModels]
      .map((model) => model.trim())
      .filter(Boolean)
      .filter((model, index, list) => list.indexOf(model) === index);

    const failures: string[] = [];
    for (const model of models) {
      try {
        return await this.completeWithModel(model, { ...params, content });
      } catch (error) {
        failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`All Silo models failed. ${failures.join(' | ')}`);
  }

  private async completeWithModel(
    model: string,
    params: { conversationKey: string; content: string },
  ) {
    const response = await fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        instructions: this.cfg.instructions,
        session: {
          conversation_key: params.conversationKey,
          persist: true,
        },
        messages: [{ role: 'user', content: params.content }],
      }),
    });

    const body = await response.json().catch(() => null) as ChatCompletionResponse | null;
    if (!response.ok) {
      throw new Error(body?.error?.message || `silo_ai_svc returned HTTP ${response.status}`);
    }

    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('silo_ai_svc returned an empty response.');
    return text;
  }
}
