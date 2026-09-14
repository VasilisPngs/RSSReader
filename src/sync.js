const MAX_BOUND_PARAMS = 90;
const MAX_INSERT_STATEMENTS = 35;
const MAX_MUTATIONS = 200;
const RESPONSE_CHAR_BUDGET = 220000;

const text = (v) => (v === undefined || v === null ? null : String(v));
const int = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const bool = (v) => (v ? 1 : 0);

export const WRITABLE = {
  folders: {
    id: { cast: text, required: true },
    name: { cast: text, required: true },
    position: { cast: int, required: true },
    created_at: { cast: int, required: true },
    deleted_at: { cast: int }
  },
  feeds: {
    id: { cast: text, required: true },
    folder_id: { cast: text },
    title: { cast: text, required: true },
    feed_url: { cast: text, required: true },
    site_url: { cast: text },
    position: { cast: int, required: true },
    notify: { cast: bool, required: true },
    created_at: { cast: int, required: true },
    deleted_at: { cast: int }
  },
  article_state: {
    article_id: { cast: text, required: true },
    is_read: { cast: bool, required: true },
    is_starred: { cast: bool, required: true },
    read_at: { cast: int },
    updated_at: { cast: int, required: true }
  }
};

const KEYS = { folders: "id", feeds: "id", article_state: "article_id", feed_state: "feed_id", articles: "id" };

export const PULL_TABLES = ["folders", "feeds", "feed_state", "articles", "article_state"];

const PULL_LIMITS = { folders: 200, feeds: 200, feed_state: 200, articles: 60, article_state: 400 };

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

function normalizeRow(table, input) {
  const columns = WRITABLE[table];
  const row = {};
  for (const [column, spec] of Object.entries(columns)) {
    const value = spec.cast(input[column]);
    if (value === null && spec.required) throw new Error(`missing ${table}.${column}`);
    row[column] = value;
  }
  return row;
}

function buildUpserts(table, rows, rev) {
  const columns = Object.keys(WRITABLE[table]);
  const key = KEYS[table];
  const perStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
  const assignments = columns
    .filter((column) => column !== key)
    .map((column) => `${column}=excluded.${column}`)
    .concat("rev=excluded.rev")
    .join(", ");
  const statements = [];
  for (let index = 0; index < rows.length; index += perStatement) {
    const chunk = rows.slice(index, index + perStatement);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")}, ${rev})`).join(", ");
    const params = [];
    for (const row of chunk) for (const column of columns) params.push(row[column]);
    statements.push({
      sql: `INSERT INTO ${table} (${columns.join(", ")}, rev) VALUES ${placeholders} ON CONFLICT(${key}) DO UPDATE SET ${assignments}`,
      params
    });
  }
  return statements;
}

function readCursor(cursors, table) {
  const cursor = cursors && cursors[table];
  const rev = cursor && Number.isFinite(Number(cursor.rev)) ? Math.max(0, Math.trunc(Number(cursor.rev))) : 0;
  const id = cursor && typeof cursor.id === "string" ? cursor.id : "";
  return { rev, id };
}

function rowWeight(row) {
  let weight = 120;
  for (const value of Object.values(row)) if (typeof value === "string") weight += value.length;
  return weight;
}

function capRows(rows, budget) {
  let used = 0;
  for (let index = 0; index < rows.length; index += 1) {
    used += rowWeight(rows[index]);
    if (used > budget && index > 0) return { rows: rows.slice(0, index), capped: true };
  }
  return { rows, capped: false };
}

export async function handleSync(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const mutations = Array.isArray(payload.mutations) ? payload.mutations : [];
  if (mutations.length > MAX_MUTATIONS) return json({ error: "too_many_mutations" }, 413);

  const grouped = new Map();
  try {
    for (const mutation of mutations) {
      const table = mutation && mutation.table;
      if (!WRITABLE[table]) return json({ error: "table_not_writable", table: String(table) }, 400);
      if (!grouped.has(table)) grouped.set(table, new Map());
      const row = normalizeRow(table, mutation.row || {});
      grouped.get(table).set(row[KEYS[table]], row);
    }
  } catch (error) {
    return json({ error: "invalid_row", detail: error.message }, 400);
  }

  let rev = null;
  if (grouped.size > 0) {
    const bumped = await env.DB.prepare("UPDATE sync_rev SET value = value + 1 WHERE id = 1 RETURNING value").first();
    rev = bumped.value;

    const statements = [];
    for (const [table, rows] of grouped) statements.push(...buildUpserts(table, [...rows.values()], rev));
    const feedRows = grouped.get("feeds");
    if (feedRows) {
      for (const feed of feedRows.values()) {
        if (feed.deleted_at) continue;
        statements.push({
          sql: "INSERT INTO feed_state (feed_id, next_fetch_at, interval_seconds, rev) VALUES (?, 0, 1200, ?) ON CONFLICT(feed_id) DO NOTHING",
          params: [feed.id, rev]
        });
      }
    }
    if (statements.length > MAX_INSERT_STATEMENTS) return json({ error: "batch_too_large" }, 413);
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement.sql).bind(...statement.params)));
  }

  const cursors = payload.cursors || {};
  const pulls = PULL_TABLES.map((table) => {
    const cursor = readCursor(cursors, table);
    const key = KEYS[table];
    return env.DB.prepare(
      `SELECT * FROM ${table} WHERE rev > ?1 OR (rev = ?1 AND ${key} > ?2) ORDER BY rev, ${key} LIMIT ?3`
    ).bind(cursor.rev, cursor.id, PULL_LIMITS[table]);
  });

  const results = await env.DB.batch(pulls);
  const changes = {};
  const nextCursors = {};
  let hasMore = false;
  let budget = RESPONSE_CHAR_BUDGET;

  results.forEach((result, index) => {
    const table = PULL_TABLES[index];
    const key = KEYS[table];
    const fetched = result.results || [];
    const capped = capRows(fetched, budget);
    budget = Math.max(2000, budget - capped.rows.reduce((total, row) => total + rowWeight(row), 0));
    changes[table] = capped.rows;
    const last = capped.rows[capped.rows.length - 1];
    nextCursors[table] = last ? { rev: last.rev, id: last[key] } : readCursor(cursors, table);
    if (capped.capped || fetched.length === PULL_LIMITS[table]) hasMore = true;
  });

  return json({ rev, cursors: nextCursors, changes, hasMore, serverTime: Date.now() });
}
