import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type GogConfig = {
  enabled: boolean;
  path: string;
  account: string;
  allowSend: boolean;
  defaultSearch: string;
};

type EmailParts = {
  to?: string;
  subject?: string;
  body?: string;
};

export type EmailAttachment = {
  path: string;
  label: string;
};

const EMAIL_HELP = [
  'Gmail commands:',
  '/email check',
  '/email search from:someone@example.com newer_than:7d',
  '/email read THREAD_ID',
  '/email draft to:a@b.com subject:Hello body:Message text',
  '/email send to:a@b.com subject:Hello body:Message text',
  '',
  'Sending requires GOG_ALLOW_SEND=true. Drafts are safer and enabled by default.',
].join('\n');

export class GogGmail {
  constructor(private readonly cfg: GogConfig) {}

  async maybeHandle(text: string, recentAttachments: EmailAttachment[] = []) {
    const trimmed = text.trim();
    if (!this.cfg.enabled) return null;

    const lower = trimmed.toLowerCase();
    if (lower === '/email help' || lower === 'email help' || lower === 'gmail help') {
      return EMAIL_HELP;
    }

    if (/^\/?(email|gmail)\s+(check|unread|inbox)\b/i.test(trimmed)
      || /\b(check|show|read|any|what'?s|whats)\b.*\b(email|gmail|inbox)\b/i.test(trimmed)) {
      return this.search(this.cfg.defaultSearch);
    }

    const searchMatch = trimmed.match(/^\/?(?:email|gmail)\s+search\s+(.+)$/i);
    if (searchMatch?.[1]) return this.search(searchMatch[1]);

    const readMatch = trimmed.match(/^\/?(?:email|gmail)\s+(?:read|thread)\s+(\S+)$/i);
    if (readMatch?.[1]) return this.readThread(readMatch[1]);

    const draftMatch = trimmed.match(/^\/?(?:email|gmail)\s+draft\s+(.+)$/i);
    if (draftMatch?.[1]) return this.createDraft(this.parseEmailParts(draftMatch[1]), recentAttachments);

    const sendMatch = trimmed.match(/^\/?(?:email|gmail)\s+send\s+(.+)$/i);
    if (sendMatch?.[1]) return this.send(this.parseEmailParts(sendMatch[1]), recentAttachments);

    return null;
  }

  private async search(query: string) {
    const output = await this.run(['gmail', 'search', query, '--max', '5', '--json', '--no-input']);
    const parsed = this.parseJson(output);
    const threads = this.pickArray(parsed, ['threads', 'data', 'results', 'items']);
    if (!threads.length) return `No Gmail results for: ${query}`;

    return [
      `Gmail results for: ${query}`,
      ...threads.slice(0, 5).map((thread, index) => this.formatThread(thread, index + 1)),
    ].join('\n\n');
  }

  private async readThread(threadId: string) {
    const output = await this.run(['gmail', 'thread', 'get', threadId, '--json', '--no-input']);
    const parsed = this.parseJson(output);
    return this.formatThreadDetail(parsed);
  }

  private async createDraft(parts: EmailParts, attachments: EmailAttachment[]) {
    this.requireEmailParts(parts);
    const output = await this.run([
      'gmail', 'drafts', 'create',
      '--to', parts.to!,
      '--subject', parts.subject!,
      '--body', parts.body!,
      ...this.attachmentArgs(attachments),
      '--json',
      '--no-input',
    ]);
    const parsed = this.parseJson(output);
    const id = this.findString(parsed, ['id', 'draftId', 'message.id']);
    return `Created Gmail draft${id ? ` ${id}` : ''} to ${parts.to}: ${parts.subject}${this.attachmentSummary(attachments)}`;
  }

  private async send(parts: EmailParts, attachments: EmailAttachment[]) {
    if (!this.cfg.allowSend) {
      return 'Gmail sending is disabled. Set GOG_ALLOW_SEND=true, restart whatsappai, then use /email send to:... subject:... body:...';
    }
    this.requireEmailParts(parts);
    const output = await this.run([
      'gmail', 'send',
      '--to', parts.to!,
      '--subject', parts.subject!,
      '--body', parts.body!,
      ...this.attachmentArgs(attachments),
      '--json',
      '--no-input',
    ]);
    const parsed = this.parseJson(output);
    const id = this.findString(parsed, ['id', 'message.id']);
    return `Sent Gmail message${id ? ` ${id}` : ''} to ${parts.to}: ${parts.subject}${this.attachmentSummary(attachments)}`;
  }

  private attachmentArgs(attachments: EmailAttachment[]) {
    return attachments.flatMap((attachment) => ['--attach', attachment.path]);
  }

  private attachmentSummary(attachments: EmailAttachment[]) {
    if (attachments.length === 0) return '';
    const labels = attachments.map((attachment) => attachment.label).join(', ');
    return `\nAttached ${attachments.length} WhatsApp file(s): ${labels}`;
  }

  private async run(args: string[]) {
    const finalArgs = [...args];
    if (this.cfg.account) finalArgs.push('--account', this.cfg.account);
    try {
      const { stdout } = await execFileAsync(this.cfg.path, finalArgs, {
        timeout: 45_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const message = [err.stderr, err.stdout, err.message].filter(Boolean).join('\n').trim();
      if (/invalid_grant/i.test(message)) {
        throw new Error(`Gmail auth expired. Run: gog login ${this.cfg.account || '<your-email>'}`);
      }
      throw new Error(message || 'gog command failed');
    }
  }

  private parseEmailParts(input: string): EmailParts {
    const read = (key: string, nextKeys: string[]) => {
      const next = nextKeys.map((item) => `${item}:`).join('|');
      const pattern = new RegExp(`${key}:\\s*([\\s\\S]*?)(?=\\s+(?:${next})|$)`, 'i');
      return input.match(pattern)?.[1]?.trim();
    };
    return {
      to: read('to', ['subject', 'body']),
      subject: read('subject', ['to', 'body']),
      body: read('body', ['to', 'subject']),
    };
  }

  private requireEmailParts(parts: EmailParts) {
    if (!parts.to || !parts.subject || !parts.body) {
      throw new Error('Use: /email draft to:a@b.com subject:Hello body:Message text');
    }
  }

  private parseJson(output: string): unknown {
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  }

  private pickArray(value: unknown, keys: string[]) {
    if (Array.isArray(value)) return value as unknown[];
    for (const key of keys) {
      const found = this.getPath(value, key);
      if (Array.isArray(found)) return found as unknown[];
    }
    return [];
  }

  private formatThread(thread: unknown, index: number) {
    const subject = this.findString(thread, ['subject', 'snippet.subject']) || '(no subject)';
    const from = this.findString(thread, ['from', 'sender', 'snippet.from']) || 'unknown sender';
    const date = this.findString(thread, ['date', 'lastDate', 'last_message_date']) || '';
    const id = this.findString(thread, ['threadId', 'id']) || '';
    const snippet = this.findString(thread, ['snippet', 'preview', 'body']) || '';
    return `${index}. ${subject}\nFrom: ${from}${date ? `\nDate: ${date}` : ''}${id ? `\nThread: ${id}` : ''}${snippet ? `\n${snippet}` : ''}`;
  }

  private formatThreadDetail(value: unknown) {
    const messages = this.pickArray(value, ['messages', 'thread.messages']);
    if (!messages.length) return typeof value === 'string' ? value.slice(0, 3000) : JSON.stringify(value).slice(0, 3000);
    return messages.slice(-5).map((message, index) => {
      const from = this.findString(message, ['from', 'headers.From', 'sender']) || 'unknown sender';
      const subject = this.findString(message, ['subject', 'headers.Subject']) || '(no subject)';
      const date = this.findString(message, ['date', 'headers.Date']) || '';
      const body = this.findString(message, ['text', 'body', 'snippet']) || '';
      return `${index + 1}. ${subject}\nFrom: ${from}${date ? `\nDate: ${date}` : ''}${body ? `\n${body.slice(0, 1200)}` : ''}`;
    }).join('\n\n');
  }

  private findString(value: unknown, paths: string[]) {
    for (const path of paths) {
      const found = this.getPath(value, path);
      if (typeof found === 'string' && found.trim()) return found.trim();
      if (typeof found === 'number') return String(found);
    }
    return '';
  }

  private getPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (typeof current !== 'object' || current === null) return undefined;
      return (current as Record<string, unknown>)[key];
    }, value);
  }
}
