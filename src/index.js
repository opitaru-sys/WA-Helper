require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./messageHandler');

const sessionPath = process.env.SESSION_DATA_PATH || './.wwebjs_auth';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('\n📱 Scan this QR code with WhatsApp:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nWaiting for scan...\n');
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
  process.exit(1);
});

client.on('ready', async () => {
  console.log('🤖 Household bot is online and listening...');

  // Print all group chat IDs so you can find your group's ID
  const chats = await client.getChats();
  const groups = chats.filter((c) => c.isGroup);
  if (groups.length > 0) {
    console.log('\n📋 Available group chats:');
    groups.forEach((g) => console.log(`  "${g.name}" → ${g.id._serialized}`));
    console.log('\nCopy your group ID into WHATSAPP_GROUP_ID in .env\n');
  }

  // Start Phase 2 pattern detector if enabled
  if (process.env.ENABLE_PHASE2 === 'true') {
    const { startPatternDetector } = require('./phase2/patternDetector');
    startPatternDetector(client);
    console.log('[Phase2] Self-improvement module active');
  }
});

client.on('message', async (msg) => {
  console.log(`[message]        from=${msg.from}  fromMe=${msg.fromMe}  type=${msg.type}`);
  try {
    await handleMessage(msg, client);
  } catch (err) {
    console.error('Unhandled error in message handler:', err);
  }
});

// Also process messages sent FROM this account (e.g. Omri writing from his phone
// while the bot runs on his session). The standard 'message' event only fires for
// incoming messages; 'message_create' fires for everything including self-sent.
client.on('message_create', async (msg) => {
  console.log(`[message_create] from=${msg.from}  fromMe=${msg.fromMe}  type=${msg.type}`);
  if (!msg.fromMe) return; // 'message' already handles the other side
  try {
    await handleMessage(msg, client);
  } catch (err) {
    console.error('Unhandled error in message_create handler:', err);
  }
});

client.on('disconnected', (reason) => {
  console.error('❌ Client disconnected:', reason);
  console.log('Restarting in 5 seconds...');
  setTimeout(() => {
    client.initialize();
  }, 5000);
});

console.log('🚀 Initializing WhatsApp client...');
client.initialize();
