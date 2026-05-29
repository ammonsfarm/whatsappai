# whatsappai

`whatsappai` is a local WhatsApp Web bridge for `silo_ai_svc`.

It mimics OpenClaw's WhatsApp connection style: link a WhatsApp account with a QR code, listen locally through WhatsApp Web, call `silo_ai_svc`, and reply through the same linked session.

## Flow

```text
WhatsApp Web linked device
        -> whatsappai
        -> http://127.0.0.1:4040/v1/chat/completions
        -> WhatsApp reply
```

## Setup

```bash
cp .env.example .env
npm install
```

Edit `.env`:

- `SILO_BASE_URL`: local `silo_ai_svc` URL, usually `http://127.0.0.1:4040`
- `SILO_API_KEY`: user API key accepted by `silo_ai_svc`
- `SILO_MODEL`: model to use, defaults to `proxima/gpt-5.4`
- `SILO_FALLBACK_MODELS`: comma-separated fallback models, defaults to `openai-codex/gpt-5.5`
- `WHATSAPP_ALLOW_FROM`: comma-separated allowed phone numbers in E.164 format, for example `+15551234567`

Then run:

```bash
npm start
```

On first run, scan the QR code in WhatsApp:

```text
WhatsApp -> Settings -> Linked Devices -> Link a Device
```

Auth state is stored under `.data/whatsapp/default` by default. Treat this directory like a credential.

## Notes

- Direct messages are blocked unless `WHATSAPP_ALLOW_FROM` contains the sender or `*`.
- Group chats are ignored unless `WHATSAPP_ENABLE_GROUPS=true`.
- `WHATSAPP_SELF_CHAT_MODE=true` lets the linked account's own messages be processed, while suppressing replies sent by this bridge to avoid loops.
- Each WhatsApp DM maps to a stable Silo conversation key like `whatsapp:dm:+15551234567`.
- WhatsApp images/documents are saved under `.data/attachments` and attached automatically to the next `/email draft` or `/email send` from that chat.

## Gmail via gog

If `gog` is authenticated, WhatsApp can run a narrow set of Gmail commands before falling back to Silo chat:

```text
/email help
/email check
/email search from:someone@example.com newer_than:7d
/email read THREAD_ID
/email draft to:a@b.com subject:Hello body:Message text
/email send to:a@b.com subject:Hello body:Message text
```

Actual sending is disabled unless `GOG_ALLOW_SEND=true`. Draft creation is enabled by default.

To attach WhatsApp media, send the image/file to the chat first, then send the `/email draft ...` or `/email send ...` command. Recent media from that chat is attached automatically.

## Development

```bash
npm run dev
npm run check
```
