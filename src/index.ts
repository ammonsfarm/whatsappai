import { config } from './config.js';
import { GogGmail } from './gog-gmail.js';
import { SiloClient } from './silo-client.js';
import { WhatsAppBridge } from './whatsapp-bridge.js';

const main = async () => {
  if (!config.silo.apiKey) {
    console.warn('SILO_API_KEY is empty. The bridge can connect to WhatsApp, but Silo requests will fail until it is set.');
  }

  if (!config.whatsapp.allowFrom.includes('*') && config.whatsapp.allowFrom.length === 0 && !config.whatsapp.selfChatMode) {
    console.warn('WHATSAPP_ALLOW_FROM is empty and WHATSAPP_SELF_CHAT_MODE=false. Incoming DMs will be blocked.');
  }

  const silo = new SiloClient(config.silo);
  const gmail = new GogGmail(config.gog);
  const bridge = new WhatsAppBridge(config.whatsapp, silo, gmail);
  await bridge.start();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
