const Airtable = require('airtable');

// ── Client setup ──────────────────────────────────────────────────────────────
function getBase() {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token) throw new Error('AIRTABLE_TOKEN is not set');
  if (!baseId) throw new Error('AIRTABLE_BASE_ID is not set');

  Airtable.configure({ apiKey: token });
  return Airtable.base(baseId);
}

// ── Table names ───────────────────────────────────────────────────────────────
const TABLE = {
  notes: 'Notes',
  shopping: 'Shopping',
  tasks: 'Tasks',
  emma: 'EmmaLog',
  passwords: 'Passwords',
  changelog: 'Changelog',
};

// Field to search in for each category (used in fuzzy remove/done queries)
const SEARCH_FIELD = {
  notes: 'Content',
  shopping: 'Item',
  tasks: 'Task',
  emma: 'Content',
  passwords: 'Service',
  changelog: 'Description',
};

// ── Helper: sanitize formula strings (prevent injection) ─────────────────────
function escapeFormula(str) {
  return str.replace(/"/g, '\\"').replace(/'/g, "\\'");
}

// ── Read all tables for Gemini context ────────────────────────────────────────
async function getSheetSnapshot() {
  const base = getBase();
  const snapshot = {};

  const fetches = [
    {
      key: 'notes',
      table: TABLE.notes,
      filter: null,
      fields: ['Timestamp', 'Content', 'AddedBy'],
    },
    {
      key: 'shopping',
      table: TABLE.shopping,
      filter: 'NOT({Done})',
      fields: ['Item', 'AddedBy', 'AddedAt'],
    },
    {
      key: 'tasks',
      table: TABLE.tasks,
      filter: 'NOT({Status} = "done")',
      fields: ['Task', 'AssignedTo', 'AddedBy', 'AddedAt', 'Status'],
    },
    {
      key: 'emma',
      table: TABLE.emma,
      filter: null,
      fields: ['Timestamp', 'Category', 'Content'],
    },
    {
      key: 'passwords',
      table: TABLE.passwords,
      filter: null,
      fields: ['Service', 'Credentials', 'AddedBy', 'SavedAt'],
    },
  ];

  await Promise.all(
    fetches.map(async ({ key, table, filter, fields }) => {
      try {
        const selectOpts = {
          fields,
          maxRecords: 40,
          sort: [{ field: fields[0], direction: 'desc' }],
        };
        if (filter) selectOpts.filterByFormula = filter;

        const records = await base(table).select(selectOpts).all();

        snapshot[table] = records.map((r) => {
          const obj = {};
          fields.forEach((f) => {
            const v = r.fields[f];
            if (v !== undefined && v !== null && v !== '') obj[f] = v;
          });
          return obj;
        });
      } catch (err) {
        console.error(`[Airtable] Error reading ${table}:`, err.message);
        snapshot[table] = [];
      }
    })
  );

  return snapshot;
}

// ── Add a row ─────────────────────────────────────────────────────────────────
async function addRow(category, { content, addedBy, timestamp }) {
  const base = getBase();
  const table = TABLE[category];
  if (!table) throw new Error(`Unknown category: ${category}`);

  let fields;

  switch (category) {
    case 'notes':
      fields = { Content: content, AddedBy: addedBy, Timestamp: timestamp };
      break;

    case 'shopping':
      fields = { Item: content, AddedBy: addedBy, AddedAt: timestamp, Done: false };
      break;

    case 'tasks': {
      // Gemini includes assignee in brackets: "check AC [Omri]"
      const assignMatch = content.match(/\[(Ilana|Omri|אילנה|עומרי)\]\s*$/i);
      const assignee = assignMatch
        ? assignMatch[1]
        : addedBy === 'Ilana' ? 'Omri' : 'Ilana';
      const cleanTask = content.replace(/\[.*?\]\s*$/, '').trim();
      fields = {
        Task: cleanTask,
        AssignedTo: assignee,
        AddedBy: addedBy,
        AddedAt: timestamp,
        Status: 'open',
      };
      break;
    }

    case 'emma': {
      // Gemini prefixes: "[sleep] ישנה ב19:15"
      const catMatch = content.match(/^\[([^\]]+)\]\s*/);
      const emmaCategory = catMatch ? catMatch[1] : 'general';
      const emmaContent = catMatch ? content.replace(catMatch[0], '').trim() : content;
      fields = { Timestamp: timestamp, Category: emmaCategory, Content: emmaContent };
      break;
    }

    case 'passwords': {
      // content format from Gemini: "service: X | creds: Y"
      // Try to extract a service name from the content
      const serviceMatch = content.match(/^([^:|]+)[:|]\s*(.*)$/);
      let serviceName = 'Unknown';
      let creds = content;
      if (serviceMatch) {
        serviceName = serviceMatch[1].trim();
        creds = serviceMatch[2].trim();
      }
      fields = { Service: serviceName, Credentials: creds, AddedBy: addedBy, SavedAt: timestamp };
      break;
    }

    default:
      fields = { Content: content, AddedBy: addedBy, Timestamp: timestamp };
  }

  await base(table).create([{ fields }]);
}

// ── Remove / mark done a row ──────────────────────────────────────────────────
async function removeRow(category, content) {
  const base = getBase();
  const table = TABLE[category];
  const searchField = SEARCH_FIELD[category] || 'Content';
  if (!table) throw new Error(`Unknown category: ${category}`);

  const searchTerm = escapeFormula(content.toLowerCase());

  // Search in the primary text field of each table
  const records = await base(table)
    .select({
      filterByFormula: `SEARCH("${searchTerm}", LOWER({${searchField}}))`,
      maxRecords: 1,
    })
    .firstPage();

  if (records.length === 0) return false;

  if (category === 'shopping') {
    // Mark as done rather than deleting (keeps history)
    await base(table).update(records[0].id, { Done: true });
  } else {
    await base(table).destroy(records[0].id);
  }

  return true;
}

// ── Query rows ────────────────────────────────────────────────────────────────
// Returns raw records — Gemini already formats the reply using the snapshot context
async function queryRows(category, filter) {
  const base = getBase();
  const table = TABLE[category];
  if (!table) throw new Error(`Unknown category: ${category}`);

  const records = await base(table).select({ maxRecords: 50 }).all();
  return records.map((r) => r.fields);
}

// ── Mark a task done ──────────────────────────────────────────────────────────
async function markTaskDone(content) {
  const base = getBase();
  const searchTerm = escapeFormula(content.toLowerCase());

  const records = await base(TABLE.tasks)
    .select({
      filterByFormula: `SEARCH("${searchTerm}", LOWER({Task}))`,
      maxRecords: 1,
    })
    .firstPage();

  if (records.length === 0) return false;

  await base(TABLE.tasks).update(records[0].id, { Status: 'done' });
  return true;
}

// ── Add a changelog entry (Phase 2) ──────────────────────────────────────────
async function addChangelogEntry(type, description, status) {
  const base = getBase();
  await base(TABLE.changelog).create([{
    fields: {
      Date: new Date().toISOString(),
      Type: type,
      Description: description,
      Status: status,
    },
  }]);
}

module.exports = {
  getSheetSnapshot,
  addRow,
  removeRow,
  queryRows,
  markTaskDone,
  addChangelogEntry,
};
