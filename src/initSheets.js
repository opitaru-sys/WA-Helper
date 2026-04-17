/**
 * One-time initialization script for Airtable.
 * Creates all 6 tables with the correct fields using the Airtable Metadata API.
 * Run with: npm run init-sheets
 *
 * Requires a PAT with scopes: schema.bases:read, schema.bases:write
 */

require('dotenv').config();

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

if (!TOKEN || !BASE_ID) {
  console.error('❌ AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be set in .env');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

const META_URL = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;

// ── Table definitions ─────────────────────────────────────────────────────────
const TABLES = [
  {
    name: 'Notes',
    description: 'General notes and things to remember',
    fields: [
      { name: 'Content', type: 'singleLineText' },
      { name: 'AddedBy', type: 'singleLineText' },
      { name: 'Timestamp', type: 'singleLineText' },
    ],
  },
  {
    name: 'Shopping',
    description: 'Shopping list',
    fields: [
      { name: 'Item', type: 'singleLineText' },
      { name: 'AddedBy', type: 'singleLineText' },
      { name: 'AddedAt', type: 'singleLineText' },
      { name: 'Done', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    ],
  },
  {
    name: 'Tasks',
    description: 'Task delegation between Ilana and Omri',
    fields: [
      { name: 'Task', type: 'singleLineText' },
      { name: 'AssignedTo', type: 'singleLineText' },
      { name: 'AddedBy', type: 'singleLineText' },
      { name: 'AddedAt', type: 'singleLineText' },
      {
        name: 'Status',
        type: 'singleSelect',
        options: { choices: [{ name: 'open', color: 'yellowLight2' }, { name: 'done', color: 'greenLight2' }] },
      },
    ],
  },
  {
    name: 'EmmaLog',
    description: "Emma's daily log: sleep, feeding, health, milestones",
    fields: [
      { name: 'Timestamp', type: 'singleLineText' },
      { name: 'Category', type: 'singleLineText' },
      { name: 'Content', type: 'multilineText' },
    ],
  },
  {
    name: 'Passwords',
    description: 'Saved credentials and access info',
    fields: [
      { name: 'Service', type: 'singleLineText' },
      { name: 'Credentials', type: 'multilineText' },
      { name: 'AddedBy', type: 'singleLineText' },
      { name: 'SavedAt', type: 'singleLineText' },
    ],
  },
  {
    name: 'Changelog',
    description: 'Phase 2: log of every self-improvement attempt',
    fields: [
      { name: 'Date', type: 'singleLineText' },
      { name: 'Type', type: 'singleLineText' },
      { name: 'Description', type: 'multilineText' },
      { name: 'Status', type: 'singleLineText' },
    ],
  },
];

async function initAirtable() {
  console.log('🔧 Connecting to Airtable...');

  // Fetch existing tables
  const res = await fetch(META_URL, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable Metadata API error ${res.status}: ${body}`);
  }

  const { tables: existingTables } = await res.json();
  const existingNames = new Set(existingTables.map((t) => t.name));

  console.log(`\n📊 Base ID: ${BASE_ID}`);
  console.log(`   Existing tables: ${[...existingNames].join(', ') || '(none)'}\n`);

  // Create missing tables
  for (const tableDef of TABLES) {
    if (existingNames.has(tableDef.name)) {
      console.log(`  ℹ️  ${tableDef.name}: already exists, skipping`);
      continue;
    }

    console.log(`  Creating table: ${tableDef.name}...`);

    const createRes = await fetch(META_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: tableDef.name,
        description: tableDef.description,
        fields: tableDef.fields,
      }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      console.error(`  ❌ Failed to create ${tableDef.name}: ${body}`);
    } else {
      console.log(`  ✅ ${tableDef.name}: created`);
    }

    // Small delay to respect rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\n🎉 Airtable initialization complete!');
  console.log(
    `\n👉 Open your base: https://airtable.com/${BASE_ID}\n`
  );
}

initAirtable().catch((err) => {
  console.error('❌ Initialization failed:', err.message);
  process.exit(1);
});
