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

export type MediaInfo = {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mimeType: string;
  fileName?: string;
  extension: string;
};

const extensionFromMime = (mimeType: string) => {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() || '';
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/csv': 'csv',
  };
  return known[normalized] || normalized.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin';
};

export const getMediaInfo = (message: WAMessage): MediaInfo | null => {
  const content = extractMessageContent(message.message);
  if (!content) return null;
  const type = getContentType(content);
  if (type === 'imageMessage' && content.imageMessage) {
    const mimeType = content.imageMessage.mimetype || 'image/jpeg';
    return { kind: 'image', mimeType, extension: extensionFromMime(mimeType) };
  }
  if (type === 'videoMessage' && content.videoMessage) {
    const mimeType = content.videoMessage.mimetype || 'video/mp4';
    return { kind: 'video', mimeType, extension: extensionFromMime(mimeType) };
  }
  if (type === 'audioMessage' && content.audioMessage) {
    const mimeType = content.audioMessage.mimetype || 'audio/ogg';
    return { kind: 'audio', mimeType, extension: extensionFromMime(mimeType) };
  }
  if (type === 'stickerMessage' && content.stickerMessage) {
    const mimeType = content.stickerMessage.mimetype || 'image/webp';
    return { kind: 'sticker', mimeType, extension: extensionFromMime(mimeType) };
  }
  if (type === 'documentMessage' && content.documentMessage) {
    const mimeType = content.documentMessage.mimetype || 'application/octet-stream';
    const fileName = content.documentMessage.fileName || undefined;
    const fileExtension = fileName?.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return {
      kind: 'document',
      mimeType,
      fileName,
      extension: fileExtension || extensionFromMime(mimeType),
    };
  }
  return null;
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
