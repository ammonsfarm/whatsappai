import 'dotenv/config';
import path from 'node:path';

const asBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
};

const asPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const csv = (value: string | undefined) => {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const resolvePath = (value: string) => {
  if (path.isAbsolute(value)) return value;
  return path.resolve(process.cwd(), value);
};

export const config = {
  silo: {
    baseUrl: (process.env.SILO_BASE_URL || 'http://127.0.0.1:4040').replace(/\/+$/, ''),
    apiKey: process.env.SILO_API_KEY?.trim() || '',
    model: process.env.SILO_MODEL?.trim() || 'proxima/gpt-5.4',
    fallbackModels: csv(process.env.SILO_FALLBACK_MODELS || 'openai-codex/gpt-5.5'),
    instructions: process.env.SILO_INSTRUCTIONS?.trim()
      || 'You are chatting over WhatsApp. Keep replies clear, useful, and concise. Avoid markdown tables.',
  },
  whatsapp: {
    authDir: resolvePath(process.env.WHATSAPP_AUTH_DIR?.trim() || '.data/whatsapp/default'),
    allowFrom: csv(process.env.WHATSAPP_ALLOW_FROM),
    selfChatMode: asBool(process.env.WHATSAPP_SELF_CHAT_MODE, false),
    enableGroups: asBool(process.env.WHATSAPP_ENABLE_GROUPS, false),
    allowGroups: csv(process.env.WHATSAPP_ALLOW_GROUPS),
    textChunkLimit: asPositiveInt(process.env.WHATSAPP_TEXT_CHUNK_LIMIT, 3500),
    attachmentDir: resolvePath(process.env.WHATSAPP_ATTACHMENT_DIR?.trim() || '.data/attachments'),
    attachmentMaxMb: asPositiveInt(process.env.WHATSAPP_ATTACHMENT_MAX_MB, 25),
  },
  gog: {
    enabled: asBool(process.env.GOG_ENABLED, true),
    path: process.env.GOG_PATH?.trim() || '/home/openclaw/.local/bin/gog',
    account: process.env.GOG_ACCOUNT?.trim() || '',
    allowSend: asBool(process.env.GOG_ALLOW_SEND, false),
    defaultSearch: process.env.GOG_DEFAULT_EMAIL_SEARCH?.trim() || 'is:unread newer_than:7d',
  },
  logLevel: process.env.LOG_LEVEL?.trim() || 'info',
};
