import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import fs from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import type { EmailAttachment } from './gog-gmail.js';
import { GogGmail } from './gog-gmail.js';
import { RecentSet } from './recent-set.js';
import { SiloClient } from './silo-client.js';
import {
  chunkText,
  extractText,
  getMediaInfo,
  getMessageTimestampMs,
  isGroupJid,
  messageId,
  normalizeAllowList,
  toPhoneNumber,
} from './whatsapp-utils.js';

type WhatsAppConfig = typeof config.whatsapp;

type ConnectionCloseError = {
  output?: {
    statusCode?: number;
  };
};

const RECENT_TTL_MS = 10 * 60 * 1000;
const ATTACHMENT_TTL_MS = 30 * 60 * 1000;

type StoredAttachment = EmailAttachment & {
  expiresAt: number;
  sizeBytes: number;
};

export class WhatsAppBridge {
  private sock: WASocket | null = null;
  private readonly logger = pino({ level: config.logLevel });
  private readonly seenInbound = new RecentSet(RECENT_TTL_MS);
  private readonly recentOutbound = new RecentSet(RECENT_TTL_MS);
  private readonly recentAttachments = new Map<string, StoredAttachment[]>();
  private readonly directAllow: ReturnType<typeof normalizeAllowList>;
  private readonly groupAllow: { allowAll: boolean; groups: Set<string> };
  private startedAtMs = Date.now();
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cfg: WhatsAppConfig,
    private readonly silo: SiloClient,
    private readonly gmail: GogGmail,
  ) {
    this.directAllow = normalizeAllowList(cfg.allowFrom);
    this.groupAllow = {
      allowAll: cfg.allowGroups.includes('*'),
      groups: new Set(cfg.allowGroups.filter((entry) => entry !== '*')),
    };
  }

  async start() {
    await this.connect();
  }

  private async connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    await fs.mkdir(this.cfg.authDir, { recursive: true, mode: 0o700 });
    this.startedAtMs = Date.now();

    const { state, saveCreds } = await useMultiFileAuthState(this.cfg.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      browser: ['whatsappai', 'cli', '0.1.0'],
      logger: this.logger,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
      syncFullHistory: false,
      version,
    });

    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update.lastDisconnect?.error, update.connection, update.qr).catch((error) => {
        this.logger.error({ error }, 'failed handling WhatsApp connection update');
      });
    });
    sock.ev.on('messages.upsert', (upsert) => {
      void this.handleMessages(upsert.type, upsert.messages).catch((error) => {
        this.logger.error({ error }, 'failed handling WhatsApp messages');
      });
    });
  }

  private async handleConnectionUpdate(error: Error | undefined, connection: string | undefined, qr: string | undefined) {
    if (qr) {
      await this.writeQrFiles(qr);
      console.log('\nScan this QR in WhatsApp: Settings > Linked Devices > Link a Device\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      this.logger.info('WhatsApp Web connected.');
      return;
    }

    if (connection !== 'close') return;

    const statusCode = (error as ConnectionCloseError | undefined)?.output?.statusCode;
    this.sock = null;

    if (statusCode === DisconnectReason.loggedOut) {
      this.logger.error('WhatsApp session logged out. Remove the auth dir and scan a new QR.');
      return;
    }

    this.logger.warn({ statusCode, error: error?.message }, 'WhatsApp connection closed; reconnecting soon.');
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((connectError) => {
        this.logger.error({ error: connectError }, 'WhatsApp reconnect failed');
        this.reconnectTimer = setTimeout(() => void this.connect(), 10_000);
      });
    }, 2_000);
  }

  private async writeQrFiles(qr: string) {
    const outDir = path.dirname(this.cfg.authDir);
    const pngPath = path.join(outDir, 'qr.png');
    const htmlPath = path.join(outDir, 'qr.html');
    const visibleDir = path.resolve(process.cwd(), 'qr');
    const visiblePngPath = path.join(visibleDir, 'whatsapp-qr.png');
    const visibleHtmlPath = path.join(visibleDir, 'whatsapp-qr.html');
    await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(visibleDir, { recursive: true, mode: 0o755 });
    const qrOptions = {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 8,
      type: 'png',
    } as const;
    await QRCode.toFile(pngPath, qr, qrOptions);
    await QRCode.toFile(visiblePngPath, qr, qrOptions);
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>whatsappai QR</title>
  <style>
    body { font-family: sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #f6f6f6; color: #111; }
    main { text-align: center; }
    img { width: min(80vw, 420px); background: white; padding: 16px; border: 1px solid #ddd; }
  </style>
</head>
<body>
  <main>
    <h1>WhatsApp Link QR</h1>
    <img src="./qr.png" alt="WhatsApp link QR">
    <p>WhatsApp -> Settings -> Linked Devices -> Link a Device</p>
  </main>
</body>
</html>
`;
    await fs.writeFile(htmlPath, html, { mode: 0o600 });
    await fs.writeFile(visibleHtmlPath, html, { mode: 0o644 });
    this.logger.info({ pngPath, htmlPath, visiblePngPath, visibleHtmlPath }, 'wrote WhatsApp QR files');
  }

  private async handleMessages(type: string, messages: WAMessage[]) {
    if (type !== 'notify' && type !== 'append') return;

    for (const message of messages) {
      try {
        await this.handleMessage(type, message);
      } catch (error) {
        this.logger.error({ error }, 'failed handling WhatsApp message');
      }
    }
  }

  private async handleMessage(type: string, message: WAMessage) {
    const remoteJid = message.key.remoteJid;
    const id = messageId(message);
    if (!remoteJid || !id) return;
    if (remoteJid.endsWith('@status') || remoteJid.endsWith('@broadcast')) return;

    const outboundKey = `${remoteJid}:${id}`;
    if (message.key.fromMe && this.recentOutbound.has(outboundKey)) return;
    if (message.key.fromMe && !this.cfg.selfChatMode) return;

    if (type === 'append') {
      const timestampMs = getMessageTimestampMs(message) || 0;
      if (timestampMs < this.startedAtMs - 60_000) return;
    }

    const inboundKey = `${remoteJid}:${id}`;
    if (!this.seenInbound.claim(inboundKey)) return;

    const group = isGroupJid(remoteJid);
    if (!this.isAllowed(remoteJid, message, group)) {
      this.logger.warn({ remoteJid, participant: message.key.participant }, 'blocked unauthorized WhatsApp message');
      return;
    }

    const text = extractText(message).trim();
    if (!text) return;

    const senderPhone = group
      ? toPhoneNumber(message.key.participant || '')
      : toPhoneNumber(remoteJid);
    const conversationKey = group
      ? `whatsapp:group:${remoteJid}`
      : `whatsapp:dm:${senderPhone || remoteJid}`;
    const savedAttachment = await this.saveInboundMedia(message, conversationKey, id);

    this.logger.info({
      from: senderPhone || remoteJid,
      group,
      text,
      attachment: savedAttachment ? {
        path: savedAttachment.path,
        label: savedAttachment.label,
        sizeBytes: savedAttachment.sizeBytes,
      } : null,
    }, 'inbound WhatsApp message');
    await this.sendPresence(remoteJid);
    await this.markRead(remoteJid, id, message.key.participant || undefined);

    try {
      const attachments = this.getRecentAttachments(conversationKey);
      const gmailReply = await this.gmail.maybeHandle(text, attachments);
      if (gmailReply) {
        await this.sendText(remoteJid, gmailReply);
        if (/^\/?(email|gmail)\s+(draft|send)\b/i.test(text.trim())) {
          this.recentAttachments.delete(conversationKey);
        }
        return;
      }
    } catch (error) {
      this.logger.error({ error }, 'Gmail command failed');
      await this.sendText(remoteJid, error instanceof Error ? error.message : 'Gmail command failed.');
      return;
    }

    try {
      const reply = await this.silo.complete({
        conversationKey,
        text,
        senderName: message.pushName || undefined,
      });
      await this.sendText(remoteJid, reply);
    } catch (error) {
      this.logger.error({ error }, 'silo_ai_svc request failed');
      await this.sendText(remoteJid, 'I could not reach silo_ai_svc or get a valid response. Check the local service and SILO_API_KEY.');
    }
  }

  private isAllowed(remoteJid: string, message: WAMessage, group: boolean) {
    if (message.key.fromMe && this.cfg.selfChatMode) return true;

    if (group) {
      if (!this.cfg.enableGroups) return false;
      return this.groupAllow.allowAll || this.groupAllow.groups.has(remoteJid);
    }

    const phone = toPhoneNumber(remoteJid);
    return this.directAllow.allowAll || this.directAllow.phones.has(phone);
  }

  private async sendPresence(jid: string) {
    try {
      await this.sock?.sendPresenceUpdate('composing', jid);
    } catch (error) {
      this.logger.debug({ error }, 'failed sending WhatsApp composing presence');
    }
  }

  private async markRead(remoteJid: string, id: string, participant?: string) {
    if (this.cfg.selfChatMode) return;
    try {
      await this.sock?.readMessages([{ remoteJid, id, participant, fromMe: false }]);
    } catch (error) {
      this.logger.debug({ error }, 'failed marking WhatsApp message read');
    }
  }

  private async sendText(remoteJid: string, text: string) {
    if (!this.sock) throw new Error('WhatsApp socket is not connected.');
    for (const chunk of chunkText(text, this.cfg.textChunkLimit)) {
      const result = await this.sock.sendMessage(remoteJid, { text: chunk });
      const id = result?.key.id;
      if (id) this.recentOutbound.add(`${remoteJid}:${id}`);
    }
  }

  private async saveInboundMedia(message: WAMessage, conversationKey: string, messageIdValue: string) {
    const media = getMediaInfo(message);
    if (!media || !this.sock) return null;

    const buffer = await downloadMediaMessage(message, 'buffer', {}, {
      reuploadRequest: this.sock.updateMediaMessage,
      logger: this.sock.logger,
    });
    const maxBytes = this.cfg.attachmentMaxMb * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      throw new Error(`WhatsApp attachment is too large (${buffer.byteLength} bytes; max ${maxBytes}).`);
    }

    const safeMessageId = messageIdValue.replace(/[^a-zA-Z0-9_-]/g, '');
    const date = new Date().toISOString().slice(0, 10);
    const dir = path.join(this.cfg.attachmentDir, date);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const baseName = media.fileName?.replace(/[^a-zA-Z0-9._-]/g, '_') || `${safeMessageId || Date.now()}.${media.extension}`;
    const filePath = path.join(dir, baseName);
    await fs.writeFile(filePath, buffer, { mode: 0o600 });

    const attachment: StoredAttachment = {
      path: filePath,
      label: baseName,
      sizeBytes: buffer.byteLength,
      expiresAt: Date.now() + ATTACHMENT_TTL_MS,
    };
    const existing = this.getRecentAttachments(conversationKey);
    this.recentAttachments.set(conversationKey, [...existing, attachment].slice(-5));
    return attachment;
  }

  private getRecentAttachments(conversationKey: string) {
    const now = Date.now();
    const attachments = (this.recentAttachments.get(conversationKey) || []).filter((attachment) => attachment.expiresAt > now);
    if (attachments.length) this.recentAttachments.set(conversationKey, attachments);
    else this.recentAttachments.delete(conversationKey);
    return attachments;
  }
}
