require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./messageHandler');

const sessionPath = process.env.SESSION_DATA_PATH || './.wwebjs_auth';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  // Client adapter for messageHandler.js
  const adapterClient = {
    getChats: async () => {
      try {
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups).map((g) => ({
          isGroup: true,
          name: g.subject,
          id: { _serialized: g.id }
        }));
      } catch (e) {
        return [];
      }
    }
  };

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('RAW QR String:', qr);
      console.log('\n📱 Scan this QR code with WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWaiting for scan...\n');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      const errorMsg = lastDisconnect?.error?.message || lastDisconnect?.error || 'Unknown error';
      console.error(`❌ Connection closed due to: ${errorMsg}. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log('Logged out from WhatsApp. Delete session and rescan.');
        process.exit(1);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp authenticated successfully');
      console.log('🤖 Household bot is online and listening...');
      
      sock.groupFetchAllParticipating().then(groups => {
        const groupList = Object.values(groups);
        if (groupList.length > 0) {
          console.log('\n📋 Available group chats:');
          groupList.forEach(g => console.log(`  "${g.subject}" → ${g.id}`));
          console.log('\nCopy your group ID into WHATSAPP_GROUP_ID in .env\n');
        }
      }).catch(err => console.error('Failed to fetch groups:', err));

      if (process.env.ENABLE_PHASE2 === 'true') {
        const { startPatternDetector } = require('./phase2/patternDetector');
        startPatternDetector(adapterClient);
        console.log('[Phase2] Self-improvement module active');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      if (!m.message) continue;

      const isFromMe = m.key.fromMe;
      const remoteJid = m.key.remoteJid;
      const textBody = m.message?.conversation || m.message?.extendedTextMessage?.text || '';

      const msgAdapter = {
        id: { _serialized: m.key.id },
        fromMe: isFromMe,
        from: remoteJid,
        type: textBody ? 'chat' : 'other',
        body: textBody,
        timestamp: m.messageTimestamp,
        getChat: async () => ({ id: { _serialized: remoteJid } }),
        getContact: async () => ({ id: { _serialized: remoteJid }, pushname: m.pushName || 'Unknown' }),
        reply: async (text) => {
          const sent = await sock.sendMessage(remoteJid, { text }, { quoted: m });
          return { id: { _serialized: sent?.key?.id } };
        }
      };

      const eventName = isFromMe ? 'message_create' : 'message';
      console.log(`[${eventName}]     from=${remoteJid}  fromMe=${isFromMe}  type=${msgAdapter.type}`);

      try {
        await handleMessage(msgAdapter, adapterClient);
      } catch (err) {
        console.error(`Unhandled error in ${eventName} handler:`, err);
      }
    }
  });
}

console.log('🚀 Initializing WhatsApp client...');
connectToWhatsApp();
