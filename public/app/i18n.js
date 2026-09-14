const STORAGE_KEY = "rssreader.lang";
const LANGUAGES = ["en", "el"];

const STRINGS = {
  tabArticles: ["Articles", "Άρθρα"],
  tabFeeds: ["Feeds", "Ροές"],
  tabSettings: ["Settings", "Ρυθμίσεις"],

  statusSynced: ["Synced", "Συγχρονισμένο"],
  statusSyncing: ["Syncing", "Συγχρονισμός"],
  statusOffline: ["Offline", "Εκτός σύνδεσης"],
  statusRetry: ["Retry", "Επανάληψη"],
  statusQueued: ["Queued", "Σε ουρά"],
  statusSignIn: ["Sign in", "Σύνδεση"],
  statusIdle: ["idle", "αδρανές"],
  statusError: ["error", "σφάλμα"],
  statusAuth: ["sign-in required", "απαιτείται σύνδεση"],
  sessionExpired: [
    "Access session expired. Read and star changes are queued.",
    "Η συνεδρία Access έληξε. Οι αλλαγές σε διαβασμένα και αστέρια είναι σε ουρά."
  ],
  newVersion: ["New version ready", "Νέα έκδοση έτοιμη"],
  reload: ["Reload", "Επαναφόρτωση"],

  cancel: ["Cancel", "Άκυρο"],
  delete: ["Delete", "Διαγραφή"],
  remove: ["Remove", "Αφαίρεση"],
  create: ["Create", "Δημιουργία"],
  nameRequired: ["Name is required", "Το όνομα είναι υποχρεωτικό"],

  scopeUnread: ["Unread", "Αδιάβαστα"],
  scopeAll: ["All", "Όλα"],
  scopeAllArticles: ["All articles", "Όλα τα άρθρα"],
  scopeStarred: ["Starred", "Με αστέρι"],
  feedFallback: ["Feed", "Ροή"],
  folderFallback: ["Folder", "Φάκελος"],
  refresh: ["Refresh", "Ανανέωση"],
  searchArticles: ["Search titles and summaries", "Αναζήτηση σε τίτλους και περιλήψεις"],
  noFeedsYet: ["No feeds yet.", "Καμία ροή ακόμα."],
  addFirstFeed: ["Add your first feed", "Πρόσθεσε την πρώτη σου ροή"],
  allCaughtUp: ["Nothing here. You are all caught up.", "Τίποτα εδώ. Τα διάβασες όλα."],
  noSearchMatch: ["Nothing matches that search.", "Τίποτα δεν ταιριάζει με την αναζήτηση."],
  showMore: ["Show more ({count} left)", "Δείξε περισσότερα (μένουν {count})"],
  markAllRead: ["Mark all as read", "Σήμανση όλων ως διαβασμένα"],
  markListedRead: ["Mark all listed as read", "Σήμανση όλων της λίστας ως διαβασμένα"],
  markAsRead: ["Mark as read", "Σήμανση ως διαβασμένα"],
  markConfirm: ["Mark {count} as read?", "Να σημανθούν {count} ως διαβασμένα;"],
  markedRead: ["{count} marked read", "{count} σημάνθηκαν ως διαβασμένα"],
  unreadTotal: ["{count} unread total", "{count} αδιάβαστα συνολικά"],
  newArticles: ["{count} new", "{count} νέα"],
  noNewArticles: ["No new articles", "Κανένα νέο άρθρο"],
  refreshFailed: ["Refresh failed", "Η ανανέωση απέτυχε"],
  signInRequired: ["Sign in required", "Απαιτείται σύνδεση"],
  ariaStar: ["star", "αστέρι"],
  ariaMarkRead: ["mark read", "σήμανση ως διαβασμένο"],
  ariaMarkUnread: ["mark unread", "σήμανση ως αδιάβαστο"],

  back: ["← Back", "← Πίσω"],
  starOn: ["★ Starred", "★ Με αστέρι"],
  starOff: ["☆ Star", "☆ Αστέρι"],
  markUnread: ["Unread", "Αδιάβαστο"],
  markedUnread: ["Marked unread", "Σημάνθηκε ως αδιάβαστο"],
  openOn: ["Open on {host} ↗", "Άνοιγμα στο {host} ↗"],
  previous: ["← Previous", "← Προηγούμενο"],
  next: ["Next →", "Επόμενο →"],
  articleNotFound: [
    "Article not found. It may have been removed by retention.",
    "Το άρθρο δεν βρέθηκε. Μπορεί να διαγράφηκε από τη διατήρηση."
  ],
  backToList: ["Back to list", "Πίσω στη λίστα"],

  feedsTitle: ["Feeds", "Ροές"],
  addShort: ["+ Add", "+ Προσθήκη"],
  addFeed: ["Add feed", "Προσθήκη ροής"],
  feedUrlPlaceholder: ["https://example.com or feed URL", "https://example.com ή διεύθυνση ροής"],
  findFeed: ["Find feed", "Εύρεση ροής"],
  lookingForFeed: ["Looking for a feed…", "Αναζήτηση ροής…"],
  feedAlreadyAdded: ["That feed is already in your list.", "Αυτή η ροή υπάρχει ήδη στη λίστα σου."],
  noFeedFound: ["No RSS or Atom feed found at that address.", "Δεν βρέθηκε ροή RSS ή Atom σε αυτή τη διεύθυνση."],
  unreachable: ["Could not reach that address.", "Δεν ήταν δυνατή η προσπέλαση της διεύθυνσης."],
  discoveryFailed: ["Discovery failed.", "Η αναζήτηση ροής απέτυχε."],
  add: ["Add", "Προσθήκη"],
  feedAdded: ["{title} added", "Η {title} προστέθηκε"],
  noSubscriptions: [
    "No subscriptions yet. Add a site address and the server finds its feed.",
    "Καμία συνδρομή ακόμα. Βάλε τη διεύθυνση ενός site και ο server βρίσκει τη ροή του."
  ],
  emptyFolder: ["Empty folder", "Άδειος φάκελος"],
  ungrouped: ["Ungrouped", "Χωρίς φάκελο"],
  organise: ["Organise", "Οργάνωση"],
  newFolder: ["New folder", "Νέος φάκελος"],
  folderNamePlaceholder: ["Folder name", "Όνομα φακέλου"],
  importOpml: ["Import OPML", "Εισαγωγή OPML"],
  exportOpml: ["Export OPML", "Εξαγωγή OPML"],
  feedsImported: ["{count} imported", "{count} εισήχθησαν"],
  noNewFeedsInFile: ["No new feeds in that file", "Καμία νέα ροή σε αυτό το αρχείο"],
  noFolder: ["No folder", "Χωρίς φάκελο"],
  deleteFeed: ["Delete feed", "Διαγραφή ροής"],
  deleteFeedBody: [
    "Remove {title}? Its articles disappear from the list.",
    "Να αφαιρεθεί η {title}; Τα άρθρα της φεύγουν από τη λίστα."
  ],
  deleteFolder: ["Delete folder", "Διαγραφή φακέλου"],
  deleteFolderBody: ["Feeds inside move out of the folder.", "Οι ροές μέσα βγαίνουν από τον φάκελο."],
  feedError: ["error", "σφάλμα"],
  lastError: ["Last error: {message}", "Τελευταίο σφάλμα: {message}"],
  checkedAt: ["checked {time}", "ελέγχθηκε {time}"],
  notFetchedYet: ["not fetched yet", "δεν έχει ληφθεί ακόμα"],
  ariaFeedOptions: ["feed options", "επιλογές ροής"],
  ariaFolderOptions: ["folder options", "επιλογές φακέλου"],

  settingsTitle: ["Settings", "Ρυθμίσεις"],
  language: ["Language", "Γλώσσα"],
  theme: ["Theme", "Θέμα"],
  themeSystem: ["System", "Σύστημα"],
  themeLight: ["Light", "Φωτεινό"],
  themeDark: ["Dark", "Σκοτεινό"],
  sync: ["Sync", "Συγχρονισμός"],
  syncStatus: ["Status: {status}", "Κατάσταση: {status}"],
  queuedChanges: ["{count} queued", "{count} σε ουρά"],
  lastSync: ["Last sync: {value}", "Τελευταίος συγχρονισμός: {value}"],
  never: ["never", "ποτέ"],
  unknown: ["unknown", "άγνωστο"],
  measuringStorage: ["Measuring storage…", "Μέτρηση αποθηκευτικού χώρου…"],
  storageUsed: ["{size} MB cached on this device", "{size} MB στη μνήμη αυτής της συσκευής"],
  storageUnavailable: ["Storage estimate unavailable", "Η εκτίμηση αποθήκευσης δεν είναι διαθέσιμη"],
  syncNow: ["Sync now", "Συγχρονισμός τώρα"],
  library: ["Library", "Βιβλιοθήκη"],
  librarySummary: [
    "{feeds} · {unread} unread · {starred} starred",
    "{feeds} · {unread} αδιάβαστα · {starred} με αστέρι"
  ],
  retentionNote: [
    "Articles older than {days} days are removed automatically unless starred.",
    "Άρθρα παλαιότερα από {days} ημέρες διαγράφονται αυτόματα, εκτός αν έχουν αστέρι."
  ],
  exportBackup: ["Export backup (JSON)", "Εξαγωγή αντιγράφου (JSON)"],
  backupExported: ["Backup exported", "Το αντίγραφο εξήχθη"],
  keyboard: ["Keyboard", "Πληκτρολόγιο"],
  keyNext: ["next article", "επόμενο άρθρο"],
  keyPrevious: ["previous article", "προηγούμενο άρθρο"],
  keyOpen: ["open selected", "άνοιγμα επιλεγμένου"],
  keyToggleRead: ["toggle read", "εναλλαγή διαβασμένου"],
  keyToggleStar: ["toggle star", "εναλλαγή αστεριού"],
  keyRefresh: ["refresh feeds", "ανανέωση ροών"],
  keySearch: ["focus search", "εστίαση στην αναζήτηση"],
  keyBack: ["back to list", "πίσω στη λίστα"],
  howFetchingWorks: ["How fetching works", "Πώς γίνεται η λήψη"],
  howFetchingBody: [
    "A cron trigger runs every minute and refreshes the few feeds that are due, using ETag and If-Modified-Since so unchanged feeds cost nothing. Feeds that publish often are checked more frequently; quiet or broken ones back off automatically.",
    "Ένα cron trigger τρέχει κάθε λεπτό και ανανεώνει τις λίγες ροές που είναι ληξιπρόθεσμες, με ETag και If-Modified-Since ώστε οι αμετάβλητες ροές να μην κοστίζουν τίποτα. Όσες δημοσιεύουν συχνά ελέγχονται πιο συχνά· οι ήσυχες ή χαλασμένες αραιώνουν αυτόματα."
  ],

  sidebarManageFeeds: ["Manage feeds", "Διαχείριση ροών"]
};

const PLURALS = {
  article: [["article", "articles"], ["άρθρο", "άρθρα"]],
  starredArticle: [["starred article", "starred articles"], ["άρθρο με αστέρι", "άρθρα με αστέρι"]],
  newArticle: [["new article", "new articles"], ["νέο άρθρο", "νέα άρθρα"]],
  subscription: [["subscription", "subscriptions"], ["συνδρομή", "συνδρομές"]],
  feed: [["feed", "feeds"], ["ροή", "ροές"]],
  item: [["item", "items"], ["αντικείμενο", "αντικείμενα"]],
  change: [["change", "changes"], ["αλλαγή", "αλλαγές"]]
};

export const i18nEvents = new EventTarget();

function detect() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {}
  return (navigator.language || "en").toLowerCase().startsWith("el") ? "el" : "en";
}

let current = detect();
let index = LANGUAGES.indexOf(current);

export const language = () => current;
export const languages = () => [...LANGUAGES];
export const locale = () => (current === "el" ? "el-GR" : "en-GB");

export function setLanguage(next) {
  if (!LANGUAGES.includes(next) || next === current) return;
  current = next;
  index = LANGUAGES.indexOf(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  document.documentElement.lang = next;
  i18nEvents.dispatchEvent(new CustomEvent("changed"));
}

export function applyLanguage() {
  document.documentElement.lang = current;
}

export function t(key, params) {
  const entry = STRINGS[key];
  if (!entry) return key;
  const value = entry[index] || entry[0];
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

export function tn(count, key) {
  const entry = PLURALS[key];
  if (!entry) return `${count} ${key}`;
  const forms = entry[index] || entry[0];
  return `${count} ${count === 1 ? forms[0] : forms[1]}`;
}
