import { extractMessageContent, getContentType, proto, type WAMessage } from '@whiskeysockets/baileys';

const DIRECT_SUFFIX = '@s.whatsapp.net';
const GROUP_SUFFIX = '@g.us';

export const isGroupJid = (jid: string) => jid.endsWith(GROUP_SUFFIX);

export const toPhoneNumber = (jidOrPhone: string) => {
  const withoutDevice = jidOrPhone.split('@')[0]?.split(':')[0] || '';
  const digits = withoutDevice.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
};

export const toWhatsappJid = (target: string) => {
  const trimmed = target.trim();
  if (trimmed.endsWith(DIRECT_SUFFIX) || trimmed.endsWith(GROUP_SUFFIX)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) throw new Error(`Invalid WhatsApp target: ${target}`);
  return `${digits}${DIRECT_SUFFIX}`;
};

export const normalizeAllowList = (entries: string[]) => {
  const allowAll = entries.includes('*');
  const phones = new Set(entries.filter((entry) => entry !== '*').map(toPhoneNumber).filter(Boolean));
  return { allowAll, phones };
};

export const extractText = (message: WAMessage) => {
  const content = extractMessageContent(message.message);
  if (!content) return '';

  const type = getContentType(content);
  switch (type) {
    case 'conversation':
      return content.conversation || '';
    case 'extendedTextMessage':
      return content.extendedTextMessage?.text || '';
    case 'imageMessage':
      return content.imageMessage?.caption || '[image]';
    case 'videoMessage':
      return content.videoMessage?.caption || '[video]';
    case 'documentMessage':
      return content.documentMessage?.caption
        || content.documentMessage?.fileName
        || '[document]';
    case 'audioMessage':
      return '[audio message]';
    case 'stickerMessage':
      return '[sticker]';
    case 'locationMessage': {
      const location = content.locationMessage;
      const lat = location?.degreesLatitude;
      const lon = location?.degreesLongitude;
      return lat !== undefined && lon !== undefined ? `[location: ${lat}, ${lon}]` : '[location]';
    }
    case 'liveLocationMessage': {
      const location = content.liveLocationMessage;
      const lat = location?.degreesLatitude;
      const lon = location?.degreesLongitude;
      return lat !== undefined && lon !== undefined ? `[live location: ${lat}, ${lon}]` : '[live location]';
    }
    case 'contactMessage':
      return content.contactMessage?.displayName
        ? `[contact: ${content.contactMessage.displayName}]`
        : '[contact]';
    case 'contactsArrayMessage':
      return '[contacts]';
    default:
      return '';
  }
};

export const getMessageTimestampMs = (message: WAMessage) => {
  const timestamp = message.messageTimestamp;
  if (timestamp === null || timestamp === undefined) return undefined;
  const numeric = typeof timestamp === 'number'
    ? timestamp
    : typeof timestamp === 'object' && 'toNumber' in timestamp
      ? timestamp.toNumber()
      : Number(timestamp);
  return Number.isFinite(numeric) ? numeric * 1000 : undefined;
};

export const chunkText = (text: string, limit: number) => {
  const normalized = text.trim();
  if (!normalized) return ['I did not get a text response from Silo.'];
  if (normalized.length <= limit) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const splitAt = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf(' '),
    );
    const cut = splitAt > limit * 0.5 ? splitAt + 1 : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

export const messageId = (message: Pick<WAMessage, 'key'>) => message.key.id || '';

export type AnyProtoMessage = proto.IMessage;

