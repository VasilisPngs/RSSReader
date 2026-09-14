# RSSReader

**English** · [Ελληνικά](#ελληνικά)

Single-user RSS/Atom reader. Cloudflare Worker with static assets, D1 database, a Cron
Trigger that fetches feeds server-side, offline-first PWA client, Cloudflare Access for
authentication.

The interface ships in English and Greek. It follows the browser language on first run and
can be switched any time in Settings → Language; the choice is stored per device. Dates,
relative times and every label follow the selected language. Article content is shown in
whatever language the feed publishes — it is never translated.

## Architecture

```
Browser (PWA)                        Cloudflare edge
┌──────────────────────────┐         ┌────────────────────────────────┐
│ IndexedDB  ← source of   │         │ Cloudflare Access (Google)     │
│              truth       │         │            ↓                   │
│ outbox     ← read/star   │  HTTPS  │ Worker  /api/sync              │
│              changes     │ ──────► │         /api/discover          │
│ Service Worker (shell)   │         │         /api/refresh           │
└──────────────────────────┘         │            ↓                   │
                                     │ D1 ◄── cron "* * * * *"        │
                                     │        fetches feeds           │
                                     └────────────────────────────────┘
```

Feeds are fetched by the Worker, never by the browser: cross-origin feed requests are
blocked by CORS, and a server-side fetch also means the phone does no work. All reading,
filtering and search happen against IndexedDB, so the UI is instant and works offline.

## Data model

| Table | Owner | Purpose |
| --- | --- | --- |
| `folders` | client | Grouping for feeds |
| `feeds` | client | Subscription: title, feed URL, site URL, folder, order |
| `feed_state` | server | ETag, Last-Modified, next fetch time, adaptive interval, last error |
| `articles` | server | Item: guid, url, title, author, summary, content, published date |
| `article_state` | client | Read flag, starred flag, timestamps — one row per touched article |
| `sync_rev` | server | Monotonic revision counter driving incremental pulls |

Splitting `feeds` from `feed_state` is deliberate: the client owns the subscription row and
the server owns the fetch bookkeeping, so a client push can never clobber a stored ETag.
`article_state` is separate from `articles` for the same reason — marking something read
never races with the poller writing new items.

## Fetching

A Cron Trigger runs every minute and refreshes only the feeds that are due:

- **Adaptive scheduling.** Each feed carries its own `next_fetch_at` and interval. Feeds
  that produce new items halve their interval (floor 10 minutes); quiet feeds grow it by
  50% (ceiling 3 hours); failing feeds back off exponentially to a maximum of 6 hours.
  Nothing is hard-coded to a feed count — 10 feeds or 200 feeds use the same loop.
- **Conditional GET.** Stored `ETag`/`Last-Modified` are sent as `If-None-Match` and
  `If-Modified-Since`. A 304 costs one subrequest, no parsing and no writes.
- **Bounded work per tick.** At most 3 feeds are fetched per invocation, with a 600,000
  character parse budget, a 1.5 MB body cap and 40 items per feed. Anything left over stays
  due and is picked up by the next tick.
- **Parsing.** A purpose-built scanner over `indexOf` handles RSS 2.0, RSS 1.0/RDF and Atom,
  including CDATA, numeric and named entities, `content:encoded`, `dc:creator` and Atom
  `link rel="alternate"`. `<script>` and `<style>` blocks are dropped at parse time.

Throughput: roughly 180 feed checks per hour. With the intervals above that comfortably
keeps 100+ feeds fresh; beyond that, raise `MAX_FEEDS_PER_TICK` in `src/poller.js` and watch
the CPU metric.

## Sync protocol

`POST /api/sync` with `{ cursors, mutations }`:

- `mutations` are full-row upserts, accepted only for `folders`, `feeds` and `article_state`.
  A push to `articles` or `feed_state` is rejected with 400.
- The server bumps `sync_rev` once per request and stamps written rows with it.
- `cursors` is a per-table `{ rev, id }` position; responses are ordered by `rev, id`,
  paginated, and additionally capped at ~220,000 characters so serialization cannot blow the
  10 ms CPU limit. `hasMore` tells the client to keep looping.
- Conflict resolution is last-write-wins. Single user, so this is sufficient by design.

Client-side, every change writes the row plus an outbox entry keyed by `[table, id]`, which
coalesces repeated edits. Remote rows are never applied over a row with a pending push.

## Security

- The Worker holds no login code. It rejects any request without the
  `Cf-Access-Jwt-Assertion` header that Access injects, so a missing policy fails closed.
- Feed HTML is sanitized in the browser with an element/attribute allowlist before it is
  inserted: scripts, iframes, objects, event handlers and `javascript:` URLs are removed,
  links get `rel="noopener noreferrer nofollow"`, images get `referrerpolicy="no-referrer"`.
- A Content-Security-Policy meta tag blocks inline scripts, framing and third-party
  connections.
- `/api/discover` refuses non-HTTP schemes and loopback hosts.

## Free plan budget

Verified against Cloudflare documentation (September 2026):

| Resource | Free limit | This app |
| --- | --- | --- |
| Worker requests | 100,000/day | 1,440 cron invocations plus sync calls |
| CPU per cron invocation | 10 ms | 3 feeds max, parse budget enforced |
| Subrequests per invocation | 50 — **shared between `fetch()` and D1** | ~19 in the worst tick |
| D1 queries per invocation | 50 | Push capped at 35 statements + 5 pulls + 1 revision bump |
| D1 bound parameters per query | 100 | Batches chunked to ≤90 |
| D1 rows written | 100,000/day | One row per new article, one per read/star change |
| D1 rows read | 5,000,000/day | Incremental pulls only |
| D1 storage | 5 GB account / 500 MB per database | 45-day retention, content capped at 24 KB |
| Cron Triggers | 5 per account | 1 |

Workers KV is deliberately not used: its free tier allows 1,000 writes per day to distinct
keys, which a feed poller would exhaust immediately.

## Setup

```sh
npm install
npx wrangler login
npx wrangler d1 create rssreader
```

Copy the returned `database_id` into `wrangler.jsonc`, then:

```sh
npm run db:migrate:remote
npm run deploy
```

### Cloudflare Access

1. Enable Zero Trust on the account (free plan covers up to 50 users).
2. Dashboard → **Workers & Pages** → `rssreader` → **Access** tab.
3. **Protect this Worker behind Access** → **All traffic**.
4. Google login policy restricted to the owner's email address.
5. Session duration up to one month.

## Retention

Articles older than 45 days are deleted hourly unless they are starred. The client prunes
its local copy on the same rule at startup, so IndexedDB stays small. Starred articles are
kept indefinitely.

## Toolchain

Zero runtime dependencies: the browser and the Worker both run the source as
written, with no bundler, transpiler or framework in between.

Build tooling stays on the latest stable release: wrangler pinned to an exact
version in `package.json`, Node on the Active LTS line in `.nvmrc`. Stable
means the release line the upstream project supports for production, so Node
follows LTS rather than Current.

Clock times are always rendered on a 24-hour cycle (`hourCycle: "h23"`),
in every language, regardless of what the locale would pick by default.

## Local development

```sh
npm run db:migrate
npm run dev
```

Local requests bypass the Access check by hostname. To exercise the cron handler locally,
temporarily add `"/__scheduled*"` to `assets.run_worker_first`, then call
`/__scheduled?cron=*+*+*+*+*`.

---

## Ελληνικά

Προσωπικός αναγνώστης RSS/Atom για έναν χρήστη. Τρέχει σε Cloudflare Worker με static assets
και βάση D1, με Cron Trigger που κατεβάζει τις ροές από τον server, PWA που δουλεύει offline
και προστασία από Cloudflare Access. Δεν υπάρχει κώδικας σύνδεσης στην εφαρμογή.

**Γλώσσα:** η διεπαφή είναι στα αγγλικά και στα ελληνικά. Στην πρώτη εκτέλεση ακολουθεί τη
γλώσσα του browser και αλλάζει από Ρυθμίσεις → Γλώσσα. Οι ημερομηνίες και οι σχετικοί χρόνοι
ακολουθούν τη γλώσσα. Το περιεχόμενο των άρθρων μένει στη γλώσσα της ροής — δεν μεταφράζεται.

**Γιατί server-side:** ο browser δεν μπορεί να κατεβάσει ροές λόγω CORS. Το κατέβασμα γίνεται
στον Worker, οπότε το κινητό δεν κάνει καμία δουλειά.

**Πώς γίνεται η λήψη:** ένα cron τρέχει κάθε λεπτό και ανανεώνει μόνο όσες ροές είναι
ληξιπρόθεσμες, το πολύ 3 ανά εκτέλεση. Κάθε ροή έχει δικό της διάστημα που προσαρμόζεται μόνο
του: όσες βγάζουν νέα άρθρα πυκνώνουν στα 10 λεπτά, οι ήσυχες αραιώνουν ως τις 3 ώρες, οι
χαλασμένες κάνουν backoff ως 6 ώρες. Με ETag και If-Modified-Since, μια ροή που δεν άλλαξε
κοστίζει ένα subrequest και μηδέν parsing.

**Τι κάνεις με τα άρθρα:** διάβασμα, αστέρι, φάκελοι, αναζήτηση (τοπικά, δουλεύει και offline),
εισαγωγή και εξαγωγή OPML, συντομεύσεις πληκτρολογίου. Η κατάσταση διαβασμένων συγχρονίζεται σε
όλες τις συσκευές.

**Ασφάλεια:** το HTML των άρθρων καθαρίζεται στον browser με λίστα επιτρεπόμενων στοιχείων και
attributes — scripts, iframes, event handlers και `javascript:` σύνδεσμοι αφαιρούνται — με CSP
από πάνω.

**Εγκατάσταση:**

```sh
npm install
npx wrangler login
npx wrangler d1 create rssreader     # βάλε το database_id στο wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

**Cloudflare Access (υποχρεωτικό):** Workers & Pages → `rssreader` → καρτέλα Access →
Protect this Worker behind Access → All traffic → πολιτική Google μόνο για το email σου →
διάρκεια συνεδρίας έως έναν μήνα. Χωρίς αυτό τα API απαντούν 403 σε όλους.

**Διατήρηση:** άρθρα παλαιότερα από 45 ημέρες διαγράφονται αυτόματα, εκτός αν έχουν αστέρι.
