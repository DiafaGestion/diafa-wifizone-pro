import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  LayoutDashboard, UploadCloud, Users, Tag, CalendarRange, Wifi, Moon, Sun,
  Bell, ChevronDown, Plus, Pencil, Trash2, Search, Lock, LockOpen, TrendingUp,
  TrendingDown, Ticket, FileSpreadsheet, CheckCircle2, AlertTriangle, X,
  ArrowUpRight, ArrowDownRight, Save, Menu, Maximize2, RefreshCw, Database,
  ShieldCheck, Activity as ActivityIcon, BarChart3, Trophy, Award, Download, Share2,
  Wallet, Receipt, Eye, EyeOff, LogOut, Archive, Inbox, Paperclip, ChevronRight, Sparkles
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LabelList
} from "recharts";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";

/* ---------------------------------------------------------------------- */
/* Firebase — Firestore only, for shared data sync across every device.   */
/* No login/accounts: anyone with the link has full access, like before.  */
/* ---------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCzZyF__7Rl2oTbzdT8QBms6lT_idYct_Q",
  authDomain: "diafa-wifizone-pro.firebaseapp.com",
  projectId: "diafa-wifizone-pro",
  storageBucket: "diafa-wifizone-pro.firebasestorage.app",
  messagingSenderId: "385302279632",
  appId: "1:385302279632:web:3e5d48665b87534fbdb5d5",
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Nothing that touches Firebase should ever be able to hang a button forever if the
// network drops mid-call — race it against a hard timeout so the UI always recovers
// with a clear error instead of staying stuck on "..." indefinitely.
function withTimeout(promise, ms = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/* ---- accounts — deliberately NOT Firebase Authentication ----------------
   After extensive real-world trouble with Firebase Auth (account creation races,
   session isolation bugs, slow-network timeouts), accounts are stored as plain
   Firestore data (exactly like revendeurs/tarifs/tickets, which were always rock
   solid) and "logged in" is just a per-device pointer kept in localStorage.
   Honest tradeoff: this is a practical, trust-based control for an internal team
   tool — not a hardened defense against a determined attacker reading the
   database directly. Real bulletproof security would need a backend. ------- */
function getLocalSession() {
  try { return window.localStorage.getItem("diafa_session_user_id"); } catch { return null; }
}
function setLocalSession(id) {
  try {
    if (id) window.localStorage.setItem("diafa_session_user_id", id);
    else window.localStorage.removeItem("diafa_session_user_id");
  } catch {}
}

// Local safety-net mirror of the heaviest data (tickets + weeks). If a Firestore write never
// lands (daily quota reached / unstable connection) and the page is then reloaded or the app is
// re-deployed, this lets us recover the data on THIS device instead of losing it — and re-sync
// it to the server. It is intentionally only used as a fallback when the server comes back empty.
const MIRROR_KEY = "diafa_mirror_tickets_v1";
function saveMirror(tickets, weeks) {
  try { window.localStorage.setItem(MIRROR_KEY, JSON.stringify({ tickets, weeks })); } catch {}
}
function loadMirror() {
  try { const raw = window.localStorage.getItem(MIRROR_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function clearMirror() {
  try { window.localStorage.removeItem(MIRROR_KEY); } catch {}
}
function obfuscate(str) {
  try { return btoa(unescape(encodeURIComponent(str || ""))); } catch { return str || ""; }
}
function deobfuscate(str) {
  try { return decodeURIComponent(escape(atob(str || ""))); } catch { return ""; }
}

/* ---------------------------------------------------------------------- */
/* DIAFA WIFIZONE PRO — Phase 1 prototype                                  */
/* Import CSV · Revendeurs · Tarifs · Dashboard · Rapport Hebdomadaire     */
/* Palette from the client's own cahier des charges — not a design choice */
/* ---------------------------------------------------------------------- */

const COLORS = {
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  violet: "#7C3AED",
  secondary: "#10B981",
  accent: "#F59E0B",
  danger: "#EF4444",
  bgLight: "#F5F7FB",
  textLight: "#0F172A",
  bgDark: "#0B1220",
  panelDark: "#111827",
  sidebarDark: "#0F172A",
  textDark: "#F1F5F9",
};

// Reusable premium gradients — used across KPI cards, buttons, sidebar, login, etc.
const GRAD = {
  primary: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.violet} 100%)`,
  primarySoft: `linear-gradient(135deg, rgba(37,99,235,.16) 0%, rgba(124,58,237,.10) 100%)`,
  success: `linear-gradient(135deg, #10B981 0%, #059669 100%)`,
  successSoft: `linear-gradient(135deg, rgba(16,185,129,.16) 0%, rgba(5,150,105,.08) 100%)`,
  danger: `linear-gradient(135deg, #EF4444 0%, #DC2626 100%)`,
  dangerSoft: `linear-gradient(135deg, rgba(239,68,68,.16) 0%, rgba(220,38,38,.08) 100%)`,
  warning: `linear-gradient(135deg, #F59E0B 0%, #D97706 100%)`,
  warningSoft: `linear-gradient(135deg, rgba(245,158,11,.16) 0%, rgba(217,119,6,.08) 100%)`,
  sidebar: `linear-gradient(180deg, ${COLORS.sidebarDark} 0%, #0B1220 100%)`,
};

const GNF = (n) =>
  (Math.round(n || 0)).toLocaleString("fr-FR").replace(/,/g, " ") + " GNF";

const fmtInt = (n) => (n || 0).toLocaleString("fr-FR").replace(/,/g, " ");

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---- Mikhmon date parsing: "jul/23/2026" "00:02:30" ------------------- */
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseMikhmonDate(dateStr, timeStr) {
  if (!dateStr) return null;
  const m = dateStr.trim().toLowerCase().match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (mon === undefined) return null;
  const [h, mi, s] = (timeStr || "00:00:00").split(":").map((x) => parseInt(x, 10) || 0);
  return new Date(parseInt(m[3], 10), mon, parseInt(m[2], 10), h, mi, s || 0);
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---- ticket -> category by PRICE --------------------------------------------
   A ticket belongs to the forfait whose price equals the ticket's price. This is
   robust to Mikhmon profile RENAMES (a 4000 sale is "Heure" whatever the profile
   is called). Any price that matches no forfait falls into "autre" (Autres).
   PRICE_TO_CAT is kept in sync by App whenever the tarifs change. --------------- */
let PRICE_TO_CAT = {};
function rebuildPriceMap(tarifs) {
  const m = {};
  ["heure", "jour", "semaine", "mois"].forEach((k) => { if (tarifs && tarifs[k] != null && tarifs[k] !== "") m[tarifs[k]] = k; });
  PRICE_TO_CAT = m;
}
function catOfPrice(price) { return PRICE_TO_CAT[price] != null ? PRICE_TO_CAT[price] : "autre"; }
const CAT_LABEL = { heure: "Heure", jour: "Jour", semaine: "Semaine", mois: "Mois", autre: "Autre" };
const DEFAULT_CAT_LABELS = { heure: "Heure", jour: "Jour", semaine: "Semaine", mois: "Mois" };
const DEFAULT_SETTINGS = { entreprise: "DIAFA GROUP", logo: null, adresse: "", telephone: "", email: "", devise: "GNF", langue: "Français", fuseauHoraire: "GMT+0 (Conakry)", commissionParTicket: 1000, seuilStockBas: 20 };

/* ---- default tarifs (client's refined spec) ------------------------------ */
const APP_VERSION = "3.9.8"; // bump on every release — used to nudge a precautionary backup after updates
const DEFAULT_TARIFS = { heure: 4000, jour: 9000, semaine: 29000, mois: 99000 };

// Keep ONLY the keys present in `defaults` (dropping any stray key such as a removed
// "deuxJours"), filling any missing one from `defaults`. Used so tarifs/labels loaded from
// Firestore are normalised to exactly the valid categories — and the obsolete field is then
// overwritten out of Firestore on the next save.
function pickKeys(defaults, v) {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = (v && v[k] != null) ? v[k] : defaults[k];
  return out;
}

/* ---- persistent storage helpers — now backed by Firestore (shared across every device) --- */
function sanitizeForFirestore(value) {
  // Firestore rejects `undefined`; round-trip through JSON to strip it safely.
  return JSON.parse(JSON.stringify(value));
}
async function loadKey(key, fallback) {
  try {
    const snap = await withTimeout(getDoc(doc(db, "app_data", key)));
    return snap.exists() ? snap.data().value : fallback;
  } catch (e) {
    console.error("loadKey failed", key, e);
    return fallback;
  }
}
// Same as loadKey, but tells the caller whether the read genuinely failed (network/rules
// timing) vs the document simply not existing yet. This distinction matters a lot for the
// app's initial load: silently treating a *failed* read the same as "nothing here yet" is
// exactly what previously caused real data to be overwritten by empty/seed defaults when a
// read happened to fail right after startup (e.g. during a Firestore rules propagation
// window). Only genuinely-missing documents should ever fall back to a default.
async function loadKeyChecked(key, fallback) {
  try {
    const snap = await withTimeout(getDoc(doc(db, "app_data", key)));
    return { value: snap.exists() ? snap.data().value : fallback, failed: false };
  } catch (e) {
    console.error("loadKeyChecked failed", key, e);
    return { value: fallback, failed: true };
  }
}
async function saveKey(key, value) {
  try {
    await withTimeout(setDoc(doc(db, "app_data", key), { value: sanitizeForFirestore(value), updatedAt: Date.now() }));
    return true;
  } catch (e) {
    console.error("saveKey failed", key, e);
    return false;
  }
}
// Live subscription — fires immediately with the current value, then again whenever
// ANY device changes this key, so every screen stays in sync in real time.
function subscribeKey(key, onChange) {
  return onSnapshot(
    doc(db, "app_data", key),
    (snap) => { if (snap.exists()) onChange(snap.data().value); },
    (err) => console.error("subscribeKey failed", key, err)
  );
}

/* ==========================================================================
   SHARDED TICKETS STORAGE
   The tickets array is the only dataset that grows without bound, and a single
   Firestore document is hard-capped at ~1 MiB (~5000 tickets). So instead of one
   giant `diafa:tickets` document, tickets are stored across several documents:
       diafa:tickets:meta   ->  { chunks: N, count: totalTickets }
       diafa:tickets:0      ->  first TICKETS_PER_CHUNK tickets
       diafa:tickets:1      ->  next TICKETS_PER_CHUNK tickets ...
   The rest of the app is completely unaware of this: it still reads and writes ONE
   plain `tickets` array. Only these functions know about the chunking.
   ========================================================================== */
const TICKETS_PER_CHUNK = 1500; // ~310 KB/chunk at ~207 bytes/ticket — well under the 1 MiB cap

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Load the full tickets array from the sharded layout.
// Returns { value, failed, saved } — same failed-vs-empty discipline as loadKeyChecked:
//   failed=true means a read genuinely errored (network), so the caller MUST refuse to
//   proceed rather than treat it as "no tickets" (which would then overwrite good data).
//   `saved` is the per-chunk fingerprint the caller seeds so it won't re-write on load.
// Falls back once to the OLD single `diafa:tickets` document so existing data migrates.
async function loadTicketsChecked() {
  let metaSnap;
  try {
    metaSnap = await withTimeout(getDoc(doc(db, "app_data", "diafa:tickets:meta")));
  } catch (e) {
    console.error("loadTicketsChecked: meta read failed", e);
    return { value: [], failed: true, saved: { chunkJson: [], count: 0 } };
  }
  if (!metaSnap.exists()) {
    // No sharded index yet -> read the legacy single document (first-run migration path).
    // Seed an EMPTY fingerprint so the first save rewrites everything as chunks.
    try {
      const legacy = await withTimeout(getDoc(doc(db, "app_data", "diafa:tickets")));
      const val = legacy.exists() ? (legacy.data().value || []) : [];
      return { value: val, failed: false, saved: { chunkJson: [], count: 0 } };
    } catch (e) {
      console.error("loadTicketsChecked: legacy read failed", e);
      return { value: [], failed: true, saved: { chunkJson: [], count: 0 } };
    }
  }
  const chunkCount = (metaSnap.data().value && metaSnap.data().value.chunks) || 0;
  let snaps;
  try {
    const reads = [];
    for (let i = 0; i < chunkCount; i++) reads.push(withTimeout(getDoc(doc(db, "app_data", `diafa:tickets:${i}`))));
    snaps = await Promise.all(reads);
  } catch (e) {
    console.error("loadTicketsChecked: a chunk read failed", e);
    return { value: [], failed: true, saved: { chunkJson: [], count: 0 } }; // partial -> refuse
  }
  const all = [];
  const chunkJson = [];
  for (let i = 0; i < snaps.length; i++) {
    if (!snaps[i].exists()) {
      console.error("loadTicketsChecked: chunk missing", i);
      return { value: [], failed: true, saved: { chunkJson: [], count: 0 } };
    }
    const part = snaps[i].data().value;
    const arr = Array.isArray(part) ? part : [];
    all.push(...arr);
    chunkJson.push(JSON.stringify(arr));
  }
  return { value: all, failed: false, saved: { chunkJson, count: chunkCount } };
}

// Write the tickets array back into the sharded layout, writing ONLY the chunks that
// actually changed (so a normal weekly import writes 1-3 small docs, not everything).
// `saved` is mutated in place to reflect what is now persisted. Returns true on success.
async function saveTicketsSharded(tickets, saved) {
  const chunks = chunkArray(tickets, TICKETS_PER_CHUNK);
  const newCount = chunks.length;
  // 1. Write new/changed chunks only.
  for (let i = 0; i < newCount; i++) {
    const json = JSON.stringify(chunks[i]);
    if (saved.chunkJson[i] === json) continue;
    const ok = await saveKey(`diafa:tickets:${i}`, chunks[i]);
    if (!ok) return false;
    saved.chunkJson[i] = json;
  }
  // 2. Update the index only when the number of chunks changed, THEN delete any orphans.
  //    Order matters: update meta first so no reader ever follows meta to a just-deleted chunk.
  if (saved.count !== newCount) {
    const ok = await saveKey("diafa:tickets:meta", { chunks: newCount, count: tickets.length });
    if (!ok) return false;
    for (let i = newCount; i < saved.count; i++) {
      try { await withTimeout(deleteDoc(doc(db, "app_data", `diafa:tickets:${i}`))); } catch (e) { console.error("orphan delete failed", i, e); }
    }
    saved.chunkJson.length = newCount;
    saved.count = newCount;
  } else if (saved.metaCount !== tickets.length) {
    // Keep the informational total fresh (cheap, only when it actually moved).
    await saveKey("diafa:tickets:meta", { chunks: newCount, count: tickets.length });
  }
  saved.metaCount = tickets.length;
  return true;
}

// Live sync for the sharded tickets: watch the index; whenever it changes (any device
// imported/edited), re-read the chunks and hand back the full array. On a failed re-read
// we simply skip the update rather than deliver a partial list.
function subscribeTickets(onChange, onSaved) {
  return onSnapshot(
    doc(db, "app_data", "diafa:tickets:meta"),
    async (snap) => {
      if (!snap.exists()) return;
      const chunkCount = (snap.data().value && snap.data().value.chunks) || 0;
      try {
        const reads = [];
        for (let i = 0; i < chunkCount; i++) reads.push(withTimeout(getDoc(doc(db, "app_data", `diafa:tickets:${i}`))));
        const snaps = await Promise.all(reads);
        const all = [];
        const chunkJson = [];
        for (let i = 0; i < snaps.length; i++) {
          if (!snaps[i].exists()) return; // incomplete -> don't touch local state
          const arr = Array.isArray(snaps[i].data().value) ? snaps[i].data().value : [];
          all.push(...arr);
          chunkJson.push(JSON.stringify(arr));
        }
        if (onSaved) onSaved({ chunkJson, count: chunkCount, metaCount: all.length });
        onChange(all);
      } catch (e) {
        console.error("subscribeTickets: re-read failed", e);
      }
    },
    (err) => console.error("subscribeTickets failed", err)
  );
}

/* ---- one-time migration: Mikhmon's № resets per export, so older data (imported
   before the internal globalId system) needs a stable chronological ID backfilled,
   and already-closed weeks' ticket ranges re-derived in that new ID space. -------- */
function migrateTicketIds(tickets, weeks) {
  if (!tickets.length || !tickets.some((t) => t.globalId == null)) {
    return { tickets, weeks };
  }
  const sorted = tickets.slice().sort((a, b) => {
    const da = parseMikhmonDate(a.date, a.time), db = parseMikhmonDate(b.date, b.time);
    if (da && db && da.getTime() !== db.getTime()) return da - db;
    return (a.num || 0) - (b.num || 0);
  });
  const migratedTickets = sorted.map((t, i) => ({ ...t, globalId: i + 1 }));

  // Weeks were closed sequentially, each consuming exactly `totalTickets` tickets in
  // chronological order — so cumulative counts alone reconstruct correct boundaries.
  let running = 0;
  const migratedWeeks = weeks.map((w) => {
    const startTicket = running + 1;
    running += w.totalTickets || 0;
    return { ...w, startTicket, endTicket: running };
  });

  return { tickets: migratedTickets, weeks: migratedWeeks };
}

/* ------------------------------------------------------------------------ */

export default function App() {
  const [dark, setDark] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 860 : false);
  const [sidebarOpen, setSidebarOpen] = useState(typeof window !== "undefined" ? window.innerWidth >= 860 : true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadRetryTick, setLoadRetryTick] = useState(0);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const [revendeurs, setRevendeurs] = useState([]);
  const [tarifs, setTarifs] = useState(DEFAULT_TARIFS);
  const [catLabels, setCatLabels] = useState(DEFAULT_CAT_LABELS);
  const [tickets, setTickets] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [meta, setMeta] = useState({ lastImportFile: null, lastImportDate: null, lastImportCount: 0 });
  const [activities, setActivities] = useState([]);
  const [updateBanner, setUpdateBanner] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [equipements, setEquipements] = useState([]);
  const [users, setUsers] = useState([]);
  const [depenses, setDepenses] = useState([]);
  const [stockLots, setStockLots] = useState([]);
  const [demandesTickets, setDemandesTickets] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [ticketOwners, setTicketOwners] = useState({}); // { usernameLower: revendeurId } — pending owner assignments for prefix-less tickets
  const [annulations, setAnnulations] = useState([]);
  const [importHistory, setImportHistory] = useState([]);
  const [sessionUserId, setSessionUserId] = useState(() => getLocalSession());
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [lastBackupDate, setLastBackupDate] = useState(undefined); // undefined = not loaded yet
  const [syncedUserIds, setSyncedUserIds] = useState([]); // user ids confirmed saved on the server
  const [expandedGroups, setExpandedGroups] = useState([]); // open menu categories
  const [navSearch, setNavSearch] = useState(""); // header quick-search over the nav menu
  const [navSearchFocus, setNavSearchFocus] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 30000); return () => clearInterval(t); }, []);
  const [installPrompt, setInstallPrompt] = useState(null); // PWA install event
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstallPrompt(null));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const doInstall = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch {}
      setInstallPrompt(null);
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    showToast(isIOS
      ? "iPhone : appuie sur le bouton Partager (carré avec flèche ↑) en bas de Safari, puis « Sur l'écran d'accueil »."
      : "Ouvre le menu du navigateur (⋮ en haut à droite), puis « Installer l'application » / « Ajouter à l'écran d'accueil ».", "error");
  };
  // Is the app already installed (running as a standalone PWA)? If so, hide install prompts.
  const [installedStandalone] = useState(() => {
    try { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; } catch { return false; }
  });
  const [installBannerHidden, setInstallBannerHidden] = useState(false);
  const [saveError, setSaveError] = useState(false);

  /* ---------------------------------------------------------------------------
     Write discipline — this is what stops the "write storm" that could exhaust
     the daily Firestore quota. Three guarantees:
       1. NEVER write a value identical to what's already saved (kills the
          load-time re-save and the onSnapshot -> setState -> save -> onSnapshot echo).
       2. Coalesce rapid changes into a single write (debounce ~1.2s).
       3. If writes keep failing (quota/network), surface a visible banner
          instead of silently looping and losing data.
     `lastSavedRef` holds the last JSON we know is in Firestore for each key.
  --------------------------------------------------------------------------- */
  const lastSavedRef = useRef({});
  const saveTimersRef = useRef({});
  const writeFailRef = useRef(0);
  const pendingRef = useRef({}); // key -> latest value that still needs to reach the server

  // Persist the latest pending value for a key. Skips if it's already saved. On failure it
  // stays in pendingRef so the background retry (below) will try again until it lands.
  const flushKey = useCallback(async (key) => {
    if (!(key in pendingRef.current)) return;
    const value = pendingRef.current[key];
    let json;
    try { json = JSON.stringify(value); } catch { delete pendingRef.current[key]; return; }
    if (lastSavedRef.current[key] === json) { delete pendingRef.current[key]; return; }
    const ok = await saveKey(key, value);
    if (ok) {
      lastSavedRef.current[key] = json;
      if (pendingRef.current[key] === value) delete pendingRef.current[key];
      writeFailRef.current = 0;
      setSaveError((prev) => (prev ? false : prev));
      if (key === "diafa:users" && Array.isArray(value)) setSyncedUserIds(value.map((x) => x.id)); // now confirmed on the server
    } else {
      writeFailRef.current += 1;
      if (writeFailRef.current >= 2) setSaveError(true);
    }
  }, []);

  const scheduleSave = useCallback((key, value) => {
    let json;
    try { json = JSON.stringify(value); } catch { return; }
    if (lastSavedRef.current[key] === json) { delete pendingRef.current[key]; return; } // unchanged -> no write
    pendingRef.current[key] = value; // remember the LATEST value to persist
    clearTimeout(saveTimersRef.current[key]);
    saveTimersRef.current[key] = setTimeout(() => flushKey(key), 1200);
  }, [flushKey]);

  // Self-heal: if writes were failing (daily quota reached, or unstable connection), keep
  // retrying the pending changes in the background so everything reaches the server — and
  // syncs to other devices — as soon as it's reachable again, with no action from the user.
  useEffect(() => {
    const iv = setInterval(() => {
      const keys = Object.keys(pendingRef.current);
      keys.forEach((k) => flushKey(k));
    }, 25000);
    return () => clearInterval(iv);
  }, [flushKey]);

  // Wrap a remote (onSnapshot) update so it seeds lastSavedRef BEFORE setState.
  // Without this, an incoming remote value would look "new" to the save effect and
  // get written straight back — the echo loop. Seeding first makes the save a no-op.
  const remote = useCallback((key, setter, transform) => (v) => {
    const next = transform ? transform(v) : v;
    try { lastSavedRef.current[key] = JSON.stringify(next); } catch {}
    setter(next);
  }, []);

  // Tickets are stored sharded (see saveTicketsSharded). This ref is the fingerprint of
  // what's currently in Firestore, so we only ever write the chunk(s) that actually changed.
  const savedTicketsRef = useRef({ chunkJson: [], count: 0, metaCount: undefined });
  const ticketsTimerRef = useRef(null);
  const ticketsPendingRef = useRef(null);
  const scheduleSaveTickets = useCallback((tickets) => {
    ticketsPendingRef.current = tickets;
    clearTimeout(ticketsTimerRef.current);
    ticketsTimerRef.current = setTimeout(async () => {
      const ok = await saveTicketsSharded(ticketsPendingRef.current, savedTicketsRef.current);
      if (ok) { writeFailRef.current = 0; setSaveError((prev) => (prev ? false : prev)); }
      else { writeFailRef.current += 1; if (writeFailRef.current >= 2) setSaveError(true); }
    }, 1200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        setLoadError(false);
        const [r, t, tk, w, m, a, cl, settingsData, eq, u, dep, ih, sl, dt, nt, an] = await Promise.all([
          loadKeyChecked("diafa:revendeurs", []),
          loadKeyChecked("diafa:tarifs", DEFAULT_TARIFS),
          loadTicketsChecked(),
          loadKeyChecked("diafa:weeks", []),
          loadKeyChecked("diafa:meta", { lastImportFile: null, lastImportDate: null, lastImportCount: 0 }),
          loadKeyChecked("diafa:activities", []),
          loadKeyChecked("diafa:catLabels", DEFAULT_CAT_LABELS),
          loadKeyChecked("diafa:settings", DEFAULT_SETTINGS),
          loadKeyChecked("diafa:equipements", []),
          loadKeyChecked("diafa:users", []),
          loadKeyChecked("diafa:depenses", []),
          loadKeyChecked("diafa:importHistory", []),
          loadKeyChecked("diafa:stockLots", []),
          loadKeyChecked("diafa:demandesTickets", []),
          loadKeyChecked("diafa:notifications", []),
          loadKeyChecked("diafa:annulations", []),
        ]);
        if (cancelled) return;
        // If ANY read genuinely failed (as opposed to the document just not existing yet),
        // refuse to proceed. Continuing with fallback values here is exactly what used to
        // silently wipe real data — the moment "loaded" flips true, every save effect below
        // starts writing, and a fallback masquerading as real data would overwrite Firestore.
        const results = [r, t, tk, w, m, a, cl, settingsData, eq, u, dep, ih, sl, dt, nt, an];
        if (results.some((x) => x.failed)) {
          if (attempt < 2) { await new Promise((res) => setTimeout(res, 2000 * (attempt + 1))); continue; }
          setLoadError(true);
          return;
        }
        setRevendeurs(r.value);
        setTarifs(pickKeys(DEFAULT_TARIFS, t.value));
        // Safety net: if the server returns NO tickets but this device kept a local mirror (an
        // import that never managed to save because writes were failing), recover from it and
        // re-sync — instead of losing everything and forcing a re-import.
        let ticketsSource = tk.value, weeksSource = w.value, recoveredFromMirror = false;
        const mirror = loadMirror();
        if ((!tk.value || tk.value.length === 0) && mirror && Array.isArray(mirror.tickets) && mirror.tickets.length > 0) {
          ticketsSource = mirror.tickets;
          weeksSource = (Array.isArray(mirror.weeks) && mirror.weeks.length) ? mirror.weeks : w.value;
          recoveredFromMirror = true;
        }
        const { tickets: migratedTickets, weeks: migratedWeeks } = migrateTicketIds(ticketsSource, weeksSource);
        setTickets(migratedTickets);
        setWeeks(migratedWeeks);
        setMeta(m.value);
        setActivities(a.value);
        setCatLabels(pickKeys(DEFAULT_CAT_LABELS, cl.value));
        setSettings({ ...DEFAULT_SETTINGS, ...settingsData.value });
        setEquipements(eq.value);
        setUsers(u.value);
        setSyncedUserIds(u.value.map((x) => x.id)); // loaded from the server => all synced
        setDepenses(dep.value);
        setImportHistory(ih.value);
        setStockLots(sl.value);
        setDemandesTickets(dt.value);
        setNotifications(nt.value);
        setAnnulations(an.value);
        // Remember exactly what we just read, so the save effects below don't immediately
        // write the very same data straight back (that redundant re-save on every load was
        // a big chunk of the wasted writes). For tickets/weeks we seed the RAW loaded value
        // so that IF migrateTicketIds actually changed something, it still gets persisted once.
        const seed = (k, v) => { try { lastSavedRef.current[k] = JSON.stringify(v); } catch {} };
        seed("diafa:revendeurs", r.value);
        seed("diafa:tarifs", t.value);
        // Tickets use the sharded fingerprint (from loadTicketsChecked), not a single key.
        // If we recovered from the local mirror, use an EMPTY fingerprint so it re-saves to the server.
        savedTicketsRef.current = recoveredFromMirror ? { chunkJson: [], count: 0, metaCount: undefined } : { ...tk.saved, metaCount: tk.value.length };
        seed("diafa:weeks", w.value);
        seed("diafa:meta", m.value);
        seed("diafa:activities", a.value);
        seed("diafa:catLabels", { ...DEFAULT_CAT_LABELS, ...cl.value });
        seed("diafa:settings", { ...DEFAULT_SETTINGS, ...settingsData.value });
        seed("diafa:equipements", eq.value);
        seed("diafa:users", u.value);
        seed("diafa:depenses", dep.value);
        seed("diafa:importHistory", ih.value);
        seed("diafa:stockLots", sl.value);
        seed("diafa:demandesTickets", dt.value);
        seed("diafa:notifications", nt.value);
        seed("diafa:annulations", an.value);
        // Local session is only valid if that profile still exists (e.g. wasn't deleted).
        if (sessionUserId && !u.value.some((x) => x.id === sessionUserId)) {
          setLocalSession(null);
          setSessionUserId(null);
        }
        setLoaded(true);
        if (recoveredFromMirror) showToast(`Données récupérées depuis la sauvegarde locale de cet appareil (${fmtInt(migratedTickets.length)} tickets) — synchronisation en cours.`, "success");
        return;
      }
    })();
    return () => { cancelled = true; };
  }, [loadRetryTick]);

  // Real-time sync: once the initial load is done, keep listening — any change made from
  // another device (PC, phone, tablet) is reflected here automatically, live.
  useEffect(() => {
    if (!loaded) return;
    const unsubs = [
      subscribeKey("diafa:revendeurs", remote("diafa:revendeurs", setRevendeurs)),
      subscribeKey("diafa:tarifs", remote("diafa:tarifs", setTarifs, (v) => pickKeys(DEFAULT_TARIFS, v))),
      subscribeKey("diafa:catLabels", remote("diafa:catLabels", setCatLabels, (v) => pickKeys(DEFAULT_CAT_LABELS, v))),
      subscribeTickets(setTickets, (fp) => { savedTicketsRef.current = fp; }),
      subscribeKey("diafa:weeks", remote("diafa:weeks", setWeeks)),
      subscribeKey("diafa:meta", remote("diafa:meta", setMeta)),
      subscribeKey("diafa:activities", remote("diafa:activities", setActivities)),
      subscribeKey("diafa:equipements", remote("diafa:equipements", setEquipements)),
      subscribeKey("diafa:settings", remote("diafa:settings", setSettings, (v) => ({ ...DEFAULT_SETTINGS, ...v }))),
      subscribeKey("diafa:users", remote("diafa:users", setUsers)),
      subscribeKey("diafa:depenses", remote("diafa:depenses", setDepenses)),
      subscribeKey("diafa:importHistory", remote("diafa:importHistory", setImportHistory)),
      subscribeKey("diafa:stockLots", remote("diafa:stockLots", setStockLots)),
      subscribeKey("diafa:demandesTickets", remote("diafa:demandesTickets", setDemandesTickets)),
      subscribeKey("diafa:lastBackupDate", setLastBackupDate),
      subscribeKey("diafa:notifications", remote("diafa:notifications", setNotifications)),
      subscribeKey("diafa:annulations", remote("diafa:annulations", setAnnulations)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [loaded, remote]);

  useEffect(() => { if (loaded) scheduleSave("diafa:revendeurs", revendeurs); }, [revendeurs, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:tarifs", tarifs); }, [tarifs, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:catLabels", catLabels); }, [catLabels, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSaveTickets(tickets); }, [tickets, loaded, scheduleSaveTickets]);
  // Keep the local safety-net mirror current so a reload/redeploy never loses unsaved tickets.
  useEffect(() => { if (loaded) saveMirror(tickets, weeks); }, [tickets, weeks, loaded]);
  useEffect(() => { if (loaded) scheduleSave("diafa:weeks", weeks); }, [weeks, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:meta", meta); }, [meta, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:activities", activities); }, [activities, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:equipements", equipements); }, [equipements, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:settings", settings); }, [settings, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:users", users); }, [users, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:depenses", depenses); }, [depenses, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:importHistory", importHistory); }, [importHistory, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:stockLots", stockLots); }, [stockLots, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:demandesTickets", demandesTickets); }, [demandesTickets, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:notifications", notifications); }, [notifications, loaded, scheduleSave]);
  useEffect(() => { if (loaded) scheduleSave("diafa:annulations", annulations); }, [annulations, loaded, scheduleSave]);

  useEffect(() => {
    function onResize() {
      const mobile = window.innerWidth < 860;
      setIsMobile(mobile);
      setSidebarOpen((prev) => (mobile ? false : true));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function goToPage(id) {
    setPage(id);
    if (isMobile) setSidebarOpen(false);
  }

  function showToast(text, kind = "success") {
    setToast({ text, kind, id: uid() });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 3200);
  }

  function addActivity(text, sub) {
    setActivities((prev) => [{ id: uid(), text, sub, time: Date.now() }, ...prev].slice(0, 500));
  }

  // Create a notification. `audience` = "validateurs" (admins/superviseurs/commerciaux who
  // validate requests) or "user" (a specific user, e.g. the reseller who made a request).
  const notify = useCallback((n) => {
    setNotifications((prev) => [{ id: uid(), createdAt: Date.now(), readBy: [], ...n }, ...prev].slice(0, 300));
  }, []);

  function handleRefresh() {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 500);
  }

  const revendeurFor = useCallback(
    (username) => {
      const prefix = (username || "").slice(0, 2).toLowerCase();
      return revendeurs.find((r) => r.codes.some((c) => c.toLowerCase() === prefix)) || null;
    },
    [revendeurs]
  );

  // Classification is by price, so keep the price->category map current before anything renders.
  rebuildPriceMap(tarifs);
  const lastClosedTicket = weeks.length ? Math.max(...weeks.map((w) => w.endTicket)) : 0;
  const maxTicketNum = tickets.length ? Math.max(...tickets.map((t) => t.globalId)) : 0;
  const openWeekTickets = useMemo(
    () => tickets.filter((t) => t.globalId > lastClosedTicket).sort((a, b) => a.globalId - b.globalId),
    [tickets, lastClosedTicket]
  );

  const theme = dark
    ? { bg: COLORS.bgDark, panel: COLORS.panelDark, sidebar: COLORS.sidebarDark, text: COLORS.textDark, sub: "#94A3B8", border: "#1F2937", borderSoft: "rgba(148,163,184,.14)", card: "#111827", cardAlt: "#0F172A", inputBg: "#0B1220", shadow: "0 8px 30px rgba(0,0,0,.35)" }
    : { bg: COLORS.bgLight, panel: "#FFFFFF", sidebar: COLORS.sidebarDark, text: COLORS.textLight, sub: "#64748B", border: "#E5E9F2", borderSoft: "#EEF1F7", card: "#FFFFFF", cardAlt: "#F8FAFC", inputBg: "#F8FAFC", shadow: "0 8px 30px rgba(15,23,42,.06)" };

  const NAV = [
    { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { id: "import", label: "Import CSV", icon: UploadCloud },
    { id: "utilisateurs", label: "Utilisateurs", icon: Users },
    { id: "revendeurs", label: "Revendeurs", icon: Users },
    { id: "tarifs", label: "Tarifs", icon: Tag },
    { id: "hebdo", label: "Rapport Hebdomadaire", icon: CalendarRange },
    { id: "mensuel", label: "Rapport Mensuel", icon: FileSpreadsheet },
    { id: "annuel", label: "Rapport Annuel", icon: BarChart3 },
    { id: "stats", label: "Statistiques", icon: ActivityIcon },
    { id: "classements", label: "Classements", icon: Trophy },
    { id: "mestickets", label: "Mes Tickets", icon: Ticket },
    { id: "soldes", label: "Soldes Revendeurs", icon: Wallet },
    { id: "stock", label: "Stock Tickets", icon: Archive },
    { id: "demandes", label: "Demandes de Tickets", icon: Inbox },
    { id: "annulations", label: "Annulations", icon: Trash2 },
    { id: "depenses", label: "Dépenses", icon: Receipt },
    { id: "exports", label: "Exports", icon: Database },
    { id: "parametres", label: "Paramètres", icon: Tag },
    { id: "reseau", label: "Réseau", icon: Wifi },
    { id: "sauvegarde", label: "Sauvegarde", icon: ShieldCheck },
    { id: "journal", label: "Journal", icon: FileSpreadsheet },
  ];
  const PAGES = NAV.filter((n) => !n.soon);

  // The left menu is organised into collapsible categories to keep it short.
  const NAV_GROUPS = [
    { label: null, items: ["dashboard"] }, // standalone, always shown, no header
    { label: "Rapports", icon: BarChart3, items: ["hebdo", "mensuel", "annuel", "stats", "classements"] },
    { label: "Tickets", icon: Ticket, items: ["mestickets", "stock", "demandes", "annulations"] },
    { label: "Revendeurs & Finances", icon: Wallet, items: ["revendeurs", "soldes", "depenses"] },
    { label: "Configuration", icon: Users, items: ["utilisateurs", "tarifs", "reseau"] },
    { label: "Paramètres", icon: Tag, items: ["import", "parametres", "journal", "sauvegarde", "exports"] },
  ];

  const currentUser = users.find((u) => u.id === sessionUserId) || null;
  const role = currentUser ? currentUser.role : null;
  const isRevendeurRole = role === "revendeur";
  const isCommercial = role === "commercial";
  const isSuperviseur = role === "superviseur";
  // Admins AND superviseurs can manage/mutate everything; only the full "Tout réinitialiser"
  // stays admin-exclusive. Commercial gets its own narrower, explicit exceptions elsewhere.
  const canManage = role === "admin" || role === "superviseur";
  const canResetAll = role === "admin";

  // Notifications visible to the current user (validateurs see request notifs; a reseller sees
  // the responses to their own requests), newest first, plus the unread count for the bell.
  const isValidateur = role === "admin" || role === "superviseur" || role === "commercial";
  const myNotifs = useMemo(
    () => (currentUser ? notifications.filter((n) => (n.audience === "validateurs" ? isValidateur : n.forUserId === currentUser.id)) : []),
    [notifications, currentUser, isValidateur]
  );
  const unreadCount = currentUser ? myNotifs.filter((n) => !(n.readBy || []).includes(currentUser.id)).length : 0;
  const markNotifsRead = useCallback(() => {
    if (!currentUser) return;
    const uid2 = currentUser.id;
    const mineFn = (n) => (n.audience === "validateurs" ? isValidateur : n.forUserId === uid2);
    setNotifications((prev) => prev.map((n) => (mineFn(n) && !(n.readBy || []).includes(uid2)) ? { ...n, readBy: [...(n.readBy || []), uid2] } : n));
  }, [currentUser, isValidateur]);

  // Low-stock alerts: when a reseller's remaining stock (given − sold) falls below the threshold,
  // notify the validators + that reseller — at most once per reseller per day (deduped locally).
  useEffect(() => {
    if (!loaded || !canManage) return;
    const seuil = (settings && settings.seuilStockBas) || 0;
    if (seuil <= 0) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    let store;
    try { store = JSON.parse(window.localStorage.getItem("diafa_stock_alert") || "null"); } catch { store = null; }
    if (!store || store.date !== todayKey) store = { date: todayKey, ids: [] };
    const alerted = new Set(store.ids);
    let changed = false;
    revendeurs.forEach((r) => {
      const alloue = stockLots.filter((l) => l.revendeurId === r.id).reduce((s, l) => s + l.quantite, 0);
      if (alloue <= 0) return;
      const restant = alloue - tickets.filter((t) => t.revendeurId === r.id).length;
      if (restant < seuil && !alerted.has(r.id)) {
        notify({ type: "stock_bas", event: "nouvelle", audience: "validateurs", title: "Stock de tickets bas", message: `${r.nom} — il reste ~${fmtInt(Math.max(0, restant))} ticket(s). Pensez à réapprovisionner.` });
        const u = users.find((x) => x.revendeurId === r.id);
        if (u) notify({ type: "stock_bas", event: "nouvelle", audience: "user", forUserId: u.id, title: "Votre stock de tickets est bas", message: `Il vous reste ~${fmtInt(Math.max(0, restant))} ticket(s). Faites une demande de tickets.` });
        alerted.add(r.id);
        changed = true;
      }
    });
    if (changed) { try { window.localStorage.setItem("diafa_stock_alert", JSON.stringify({ date: todayKey, ids: [...alerted] })); } catch {} }
  }, [loaded, canManage, revendeurs, stockLots, tickets, settings, users, notify]);
  const REVENDEUR_ALLOWED_PAGES = ["dashboard", "mestickets", "classements", "hebdo", "mensuel", "annuel", "reseau", "tarifs", "revendeurs", "soldes", "depenses", "stock", "demandes", "annulations"];
  const VISIBLE_NAV = isRevendeurRole
    ? NAV.filter((n) => REVENDEUR_ALLOWED_PAGES.includes(n.id))
    : NAV.filter((n) => n.id !== "utilisateurs" || canManage || isCommercial);
  const effectivePage = isRevendeurRole ? (REVENDEUR_ALLOWED_PAGES.includes(page) ? page : "dashboard") : page;

  const toggleGroup = (label) => setExpandedGroups((prev) => prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]);
  useEffect(() => {
    const g = NAV_GROUPS.find((grp) => grp.label && grp.items.includes(effectivePage));
    if (g) setExpandedGroups((prev) => prev.includes(g.label) ? prev : [...prev, g.label]);
  }, [effectivePage]);

  function onLoginSuccess(profile) {
    setLocalSession(profile.id);
    setSessionUserId(profile.id);
    setPage("dashboard");
    addActivity("Connexion", `${profile.nom} (${profile.role})`);
  }
  function logout() {
    addActivity("Déconnexion", currentUser ? currentUser.nom : "");
    setLocalSession(null);
    setSessionUserId(null);
    setShowSetup(false);
  }

  // A new version was just deployed (detected via a version marker stored centrally in
  // Firestore, so it's the same for every device) — nudge whoever's managing the app to
  // grab a precautionary backup. Purely a reminder: nothing here can touch or lose data.
  useEffect(() => {
    if (!loaded || !canManage) return;
    (async () => {
      const storedVersion = await loadKey("diafa:appVersion", null);
      if (storedVersion !== APP_VERSION) {
        setUpdateBanner(true);
        await saveKey("diafa:appVersion", APP_VERSION);
      }
    })();
  }, [loaded, canManage]);

  if (loadError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 520, gap: 14, background: theme.bg, fontFamily: "Inter, 'Segoe UI', sans-serif", padding: 20, textAlign: "center" }}>
        <AlertTriangle size={30} color={COLORS.accent} />
        <div style={{ fontWeight: 700, fontSize: 15, color: theme.text }}>Impossible de charger vos données</div>
        <div style={{ color: theme.sub, fontSize: 13, maxWidth: 420 }}>
          La connexion à la base a échoué après plusieurs tentatives (réseau instable, ou changement de règles Firestore encore en cours de propagation). Par sécurité, rien n'a été modifié — vos données sont intactes.
        </div>
        <button className="dz-btn" onClick={() => { setLoaded(false); setLoadError(false); setLoadRetryTick((n) => n + 1); }}
          style={{ background: GRAD.primary, color: "#fff", padding: "10px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13.5 }}>
          Réessayer
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 520, background: theme.bg, fontFamily: "Inter, 'Segoe UI', sans-serif" }}>
        <div style={{ color: theme.sub, fontSize: 14 }}>Chargement de DIAFA WIFIZONE PRO…</div>
      </div>
    );
  }

  // No accounts exist anywhere yet on this shared database — genuine first run.
  if (users.length === 0) {
    return <SetupAdmin theme={theme} dark={dark} users={users} setUsers={setUsers} addActivity={addActivity} showToast={showToast} onLoginSuccess={onLoginSuccess} />;
  }

  // Accounts exist, but this device isn't logged into any of them.
  if (!currentUser) {
    return <Login theme={theme} dark={dark} users={users} onLoginSuccess={onLoginSuccess} settings={settings} />;
  }

  return (
    <div style={{ fontFamily: "Inter, 'Segoe UI', sans-serif", background: theme.bg, color: theme.text, height: "100vh", display: "flex", overflow: "hidden", position: "relative" }}>
      <style>{`
        * { box-sizing: border-box; }
        :root {
          --dz-primary: ${COLORS.primary}; --dz-violet: ${COLORS.violet}; --dz-success: ${COLORS.secondary};
          --dz-danger: ${COLORS.danger}; --dz-warning: ${COLORS.accent}; --dz-border: ${theme.border};
        }
        body, .dz-root { font-family: 'Inter', 'Manrope', -apple-system, 'Segoe UI', sans-serif; }
        ::-webkit-scrollbar { width: 9px; height: 9px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${dark ? "#26324a" : "#CBD5E1"}; border-radius: 99px; border: 2px solid transparent; background-clip: padding-box; }
        ::-webkit-scrollbar-thumb:hover { background: ${dark ? "#334155" : "#B6C0D1"}; }
        ::selection { background: ${COLORS.primary}55; }

        /* ---------- buttons ---------- */
        .dz-btn { cursor: pointer; border: none; font-family: inherit; transition: transform .15s ease, box-shadow .2s ease, filter .15s ease, opacity .15s ease; position: relative; }
        .dz-btn:hover { filter: brightness(1.06); }
        .dz-btn:active { transform: translateY(1px) scale(.98); }
        .dz-btn:disabled { opacity: .55; cursor: not-allowed; filter: none; }
        .dz-btn-primary { background: ${GRAD.primary}; color: #fff; box-shadow: 0 6px 18px rgba(37,99,235,.32); border-radius: 12px; font-weight: 700; }
        .dz-btn-primary:hover { box-shadow: 0 10px 26px rgba(37,99,235,.42); transform: translateY(-1px); }
        .dz-btn-ghost { background: ${dark ? "rgba(148,163,184,.08)" : "#F1F5F9"}; color: ${theme.text}; border-radius: 12px; font-weight: 600; }
        .dz-btn-ghost:hover { background: ${dark ? "rgba(148,163,184,.16)" : "#E5E9F2"}; }
        .dz-btn-danger { background: ${GRAD.danger}; color: #fff; box-shadow: 0 6px 18px rgba(239,68,68,.30); border-radius: 12px; font-weight: 700; }

        /* ---------- cards / glass ---------- */
        .dz-card { background: ${theme.card}; border: 1px solid ${theme.borderSoft}; border-radius: 18px; box-shadow: ${theme.shadow}; transition: box-shadow .2s ease, transform .2s ease, border-color .2s ease; }
        .dz-card-hover:hover { transform: translateY(-3px); border-color: ${dark ? "rgba(37,99,235,.35)" : "rgba(37,99,235,.25)"}; box-shadow: 0 16px 40px rgba(37,99,235,.14); }
        .dz-glass { background: ${dark ? "rgba(17,24,39,.72)" : "rgba(255,255,255,.72)"}; backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%); border: 1px solid ${dark ? "rgba(255,255,255,.08)" : "rgba(15,23,42,.06)"}; }

        /* ---------- nav ---------- */
        .dz-nav-item { display:flex; align-items:center; gap:10px; padding:9.5px 13px; border-radius:11px; font-size:13.3px; font-weight:500; cursor:pointer; transition: background .15s ease, color .15s ease, padding-left .15s ease; }
        .dz-nav-item:hover { background: rgba(255,255,255,.09) !important; padding-left: 15px; }

        /* ---------- inputs ---------- */
        .dz-input { width:100%; padding:10px 13px; border-radius:11px; border:1.5px solid ${theme.border}; background:${theme.inputBg}; color:${theme.text}; font-size:13.5px; font-family:inherit; outline:none; transition: border-color .15s ease, box-shadow .15s ease; }
        .dz-input:focus { border-color: ${COLORS.primary}; box-shadow: 0 0 0 4px rgba(37,99,235,.14); }
        .dz-input::placeholder { color: ${theme.sub}; opacity: .8; }
        label.dz-label { display:block; font-size:12px; font-weight:600; letter-spacing:.01em; color:${theme.sub}; margin-bottom:6px; }

        /* ---------- tables ---------- */
        .dz-table { border-collapse: separate; border-spacing: 0; }
        .dz-table thead th { position: sticky; top: 0; z-index: 2; background: ${theme.cardAlt}; text-align:left; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:${theme.sub}; font-weight:700; padding:11px 14px; border-bottom:1px solid ${theme.border}; }
        .dz-table td { padding:12px 14px; font-size:13px; border-bottom:1px solid ${theme.borderSoft}; }
        .dz-table tbody tr { transition: background .12s ease; }
        .dz-table tbody tr:hover { background: ${dark ? "rgba(37,99,235,.07)" : "rgba(37,99,235,.045)"}; }
        .dz-table tr:last-child td { border-bottom:none; }

        /* ---------- badges ---------- */
        .dz-badge { display:inline-flex; align-items:center; gap:5px; padding:3.5px 10px; border-radius:99px; font-size:11px; font-weight:700; letter-spacing:.02em; white-space:nowrap; }

        /* ---------- animations ---------- */
        .dz-fade-in { animation: dzfade .3s cubic-bezier(.16,1,.3,1); }
        .dz-scale-in { animation: dzscale .2s cubic-bezier(.16,1,.3,1); }
        .dz-slide-in { animation: dzslide .28s cubic-bezier(.16,1,.3,1); }
        @keyframes dzfade { from{opacity:0; transform:translateY(6px);} to{opacity:1; transform:none;} }
        @keyframes dzscale { from{opacity:0; transform:scale(.96);} to{opacity:1; transform:scale(1);} }
        @keyframes dzslide { from{opacity:0; transform:translateX(-8px);} to{opacity:1; transform:none;} }
        @keyframes dzpulse { 0%,100%{opacity:1;} 50%{opacity:.35;} }
        @keyframes dzspin { to { transform: rotate(360deg); } }
        @keyframes dzshimmer { 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }
        @keyframes dzgradientmove { 0%{background-position:0% 50%;} 50%{background-position:100% 50%;} 100%{background-position:0% 50%;} }
        .dz-skeleton { border-radius: 8px; background: linear-gradient(90deg, ${dark ? "#1a2436" : "#EDF1F7"} 25%, ${dark ? "#232f47" : "#F7F9FC"} 37%, ${dark ? "#1a2436" : "#EDF1F7"} 63%); background-size: 400% 100%; animation: dzshimmer 1.4s ease infinite; }
        .dz-spin { animation: dzspin .8s linear infinite; }

        /* ---------- misc ---------- */
        .dz-kpi-icon { width:44px; height:44px; border-radius:13px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        ::-moz-focus-inner { border:0; }
        a { color: inherit; }
        @media (max-width: 859px) {
          .dz-topbar-sub, .dz-user-role, .dz-fullscreen-btn, .dz-search-desktop { display: none !important; }
          .dz-main { padding: 14px !important; }
          .dz-kpi { flex: 1 1 44% !important; min-width: 0 !important; }
        }
        @media (max-width: 480px) {
          .dz-kpi { flex: 1 1 100% !important; }
        }
      `}</style>

      {/* SIDEBAR */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 29 }} />
      )}
      <aside style={{
        width: isMobile ? 252 : (sidebarOpen ? 252 : 0),
        minWidth: isMobile ? 252 : (sidebarOpen ? 252 : 0),
        overflow: "hidden",
        background: GRAD.sidebar,
        borderRight: "1px solid rgba(255,255,255,.06)",
        color: "#fff", display: "flex", flexDirection: "column",
        transition: isMobile ? "transform .25s cubic-bezier(.16,1,.3,1)" : "width .2s cubic-bezier(.16,1,.3,1)",
        position: isMobile ? "fixed" : "relative",
        top: 0, bottom: 0, left: 0, zIndex: 30,
        transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(-100%)") : "none",
      }}>
        <div style={{ padding: "22px 18px 16px", display: "flex", alignItems: "center", gap: 11, borderBottom: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: GRAD.primary, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, boxShadow: "0 4px 14px rgba(37,99,235,.45)" }}>
            {settings.logo ? <img src={settings.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Wifi size={18} strokeWidth={2.4} color="#fff" />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-.01em" }}>{settings.entreprise || "DIAFA"}</div>
            <div style={{ fontSize: 9.5, letterSpacing: ".1em", color: "#93A5C4", fontWeight: 700 }}>WIFIZONE PRO</div>
          </div>
        </div>

        {currentUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
            <div style={{ width: 32, height: 32, borderRadius: 11, background: "rgba(255,255,255,.09)", border: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
              {(currentUser.nom || "?").trim().slice(0, 1).toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.nom}</div>
              <div style={{ fontSize: 10, color: "#93A5C4", textTransform: "capitalize", fontWeight: 600 }}>{currentUser.role}</div>
            </div>
          </div>
        )}

        <nav style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
          {(() => {
            const renderItem = (n) => {
              const Icon = n.icon;
              const active = effectivePage === n.id;
              return (
                <div key={n.id} className="dz-nav-item"
                  onClick={() => n.soon ? showToast(`${n.label} — module disponible en Phase 2`, "error") : goToPage(n.id)}
                  style={{
                    background: active ? GRAD.primary : "transparent",
                    color: n.soon ? "rgba(255,255,255,.42)" : (active ? "#fff" : "#C3CEE0"),
                    cursor: n.soon ? "default" : "pointer", justifyContent: "space-between",
                    boxShadow: active ? "0 4px 14px rgba(37,99,235,.35)" : "none",
                    fontWeight: active ? 700 : 500,
                  }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={16} strokeWidth={2.2} />
                    <span>{n.label}</span>
                  </span>
                  {n.soon && <Lock size={11} strokeWidth={2.4} />}
                </div>
              );
            };
            return NAV_GROUPS.map((grp, gi) => {
              const items = grp.items.map((id) => NAV.find((n) => n.id === id)).filter((n) => n && VISIBLE_NAV.includes(n));
              if (items.length === 0) return null;
              if (!grp.label) return <div key={`g${gi}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>{items.map(renderItem)}</div>;
              const open = expandedGroups.includes(grp.label);
              const hasActive = items.some((n) => n.id === effectivePage);
              const GroupIcon = grp.icon;
              return (
                <div key={grp.label} style={{ marginTop: 4 }}>
                  <div className="dz-nav-item" onClick={() => toggleGroup(grp.label)}
                    style={{ justifyContent: "space-between", color: "#8DA0C2", cursor: "pointer", fontWeight: 700, fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <GroupIcon size={14} strokeWidth={2.2} />
                      <span>{grp.label}</span>
                      {!open && hasActive && <span style={{ width: 6, height: 6, borderRadius: 99, background: GRAD.success, flexShrink: 0, boxShadow: `0 0 0 3px ${COLORS.secondary}33` }} />}
                    </span>
                    <ChevronDown size={13} strokeWidth={2.6} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
                  </div>
                  {open && (
                    <div className="dz-slide-in" style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2, marginLeft: 9, paddingLeft: 8, borderLeft: "1px solid rgba(255,255,255,.10)" }}>
                      {items.map(renderItem)}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </nav>

        <div style={{ margin: "0 12px" }}>
          <button className="dz-btn dz-btn-ghost" onClick={doInstall}
            style={{ width: "100%", background: "rgba(255,255,255,.08)", color: "#fff", padding: "10px 0", fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
            <Download size={14} /> Installer l'appli
          </button>
        </div>
        <div style={{ margin: 12, padding: 14, borderRadius: 14, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: saveError ? "#F59E0B" : COLORS.secondary, boxShadow: `0 0 0 3px ${(saveError ? "#F59E0B" : COLORS.secondary)}30`, animation: saveError ? "none" : "dzpulse 2s ease infinite" }} />
            {saveError ? "Sauvegarde en attente" : "Synchronisé"}
          </div>
          <div style={{ fontSize: 10.5, color: "#8DA0C2", marginTop: 4, lineHeight: 1.35 }}>
            {saveError ? "Le serveur n'accepte pas encore les écritures — la synchro reprendra d'elle-même." : "Vos données sont à jour sur le serveur."}
          </div>
          {saveError && (
            <button className="dz-btn dz-btn-ghost"
              onClick={() => { Object.keys(pendingRef.current).forEach((k) => flushKey(k)); if (loaded) scheduleSaveTickets(tickets); showToast("Nouvelle tentative de synchronisation…"); }}
              style={{ marginTop: 9, width: "100%", background: "rgba(255,255,255,.10)", color: "#fff", padding: "7px 0", borderRadius: 10, fontSize: 11.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <RefreshCw size={12} /> Réessayer maintenant
            </button>
          )}
          <div style={{ fontSize: 9.5, color: "#5E729A", marginTop: 9, letterSpacing: ".03em" }}>DIAFA WIFIZONE · v{APP_VERSION}</div>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* TOPBAR */}
        <header className="dz-glass" style={{
          height: 64, minHeight: 64, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 18px", borderBottom: `1px solid ${theme.border}`, position: "sticky", top: 0, zIndex: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button className="dz-btn dz-btn-ghost" onClick={() => setSidebarOpen((s) => !s)}
              style={{ background: "transparent", color: theme.sub, padding: 7, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Menu size={18} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: theme.sub, fontWeight: 600, marginBottom: 1 }} className="dz-topbar-sub">
                <span>DIAFA</span><ChevronRight size={11} /><span style={{ color: theme.text }}>{NAV.find((n) => n.id === effectivePage)?.label}</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-.01em" }}>{NAV.find((n) => n.id === effectivePage)?.label}</div>
            </div>
          </div>

          {/* live nav search */}
          <div className="dz-search-desktop" style={{ position: "relative", flex: 1, maxWidth: 340, margin: "0 20px" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: theme.sub, pointerEvents: "none" }} />
            <input value={navSearch} onChange={(e) => setNavSearch(e.target.value)}
              onFocus={() => setNavSearchFocus(true)} onBlur={() => setTimeout(() => setNavSearchFocus(false), 120)}
              placeholder="Rechercher une page…" className="dz-input" style={{ paddingLeft: 34, background: theme.inputBg }} />
            {navSearchFocus && navSearch.trim() && (
              <div className="dz-card dz-scale-in" style={{ position: "absolute", top: 42, left: 0, right: 0, padding: 6, zIndex: 41, maxHeight: 280, overflowY: "auto" }}>
                {VISIBLE_NAV.filter((n) => n.label.toLowerCase().includes(navSearch.trim().toLowerCase())).slice(0, 8).map((n) => {
                  const Icon = n.icon;
                  return (
                    <div key={n.id} className="dz-nav-item" onClick={() => { goToPage(n.id); setNavSearch(""); }}
                      style={{ color: theme.text }}>
                      <Icon size={15} strokeWidth={2.2} /><span>{n.label}</span>
                    </div>
                  );
                })}
                {VISIBLE_NAV.filter((n) => n.label.toLowerCase().includes(navSearch.trim().toLowerCase())).length === 0 && (
                  <div style={{ padding: 12, fontSize: 12.5, color: theme.sub, textAlign: "center" }}>Aucun résultat</div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="dz-topbar-sub" style={{ fontSize: 12, color: theme.sub, fontWeight: 600, textAlign: "right", marginRight: 4, lineHeight: 1.3 }}>
              <div style={{ color: theme.text, fontWeight: 700 }}>{clock.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
              <div style={{ fontSize: 10.5, textTransform: "capitalize" }}>{clock.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" })}</div>
            </div>
            <button className="dz-btn dz-btn-ghost" onClick={handleRefresh}
              title="Actualiser"
              style={{ background: "transparent", color: theme.sub, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RefreshCw size={15} className={refreshing ? "dz-spin" : ""} />
            </button>
            <button className="dz-btn dz-btn-ghost dz-fullscreen-btn" onClick={() => document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.()}
              title="Plein écran"
              style={{ background: "transparent", color: theme.sub, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Maximize2 size={15} />
            </button>
            <button className="dz-btn dz-btn-ghost" onClick={() => setDark((d) => !d)}
              style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <div style={{ position: "relative" }} className="dz-fullscreen-btn">
              <button className="dz-btn dz-btn-ghost" onClick={() => setNotifOpen((o) => { const nx = !o; if (nx) markNotifsRead(); return nx; })}
                style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <Bell size={15} />
                {unreadCount > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -4, background: GRAD.danger, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 99, padding: "1px 4.5px", minWidth: 15, textAlign: "center", lineHeight: "13px", boxShadow: "0 0 0 2px " + theme.panel }}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <>
                  <div onClick={() => setNotifOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                  <div className="dz-card dz-scale-in" style={{ position: "absolute", top: 44, right: 0, width: 340, maxWidth: "90vw", maxHeight: 440, overflowY: "auto", zIndex: 41, padding: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px 10px" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>Notifications</span>
                      <span className="dz-badge" style={{ background: theme.cardAlt, color: theme.sub }}>{myNotifs.length}</span>
                    </div>
                    {myNotifs.length === 0 && <div style={{ padding: "16px 8px", fontSize: 12.5, color: theme.sub, textAlign: "center" }}>Aucune notification pour le moment.</div>}
                    {myNotifs.slice(0, 40).map((n) => (
                      <div key={n.id} style={{ display: "flex", gap: 9, padding: "10px 9px", borderRadius: 11, alignItems: "flex-start", background: theme.cardAlt, marginBottom: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, marginTop: 5, flexShrink: 0, background: n.event === "validee" ? COLORS.secondary : n.event === "rejetee" ? COLORS.danger : COLORS.accent }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{n.title}</div>
                          {n.message && <div style={{ fontSize: 11.5, color: theme.sub, marginTop: 1 }}>{n.message}</div>}
                          <div style={{ fontSize: 10.5, color: theme.sub, marginTop: 3 }}>{new Date(n.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div style={{ width: 1, height: 26, background: theme.border }} className="dz-fullscreen-btn" />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 12, background: isRevendeurRole ? GRAD.success : isCommercial ? "linear-gradient(135deg,#8B5CF6,#6D28D9)" : isSuperviseur ? "linear-gradient(135deg,#0EA5E9,#0369A1)" : GRAD.warning, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 12, flexShrink: 0, boxShadow: theme.shadow }}>
                {currentUser.nom.slice(0, 2).toUpperCase()}
              </div>
              <div className="dz-fullscreen-btn" style={{ fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>{currentUser.nom}</div>
                <div className="dz-user-role" style={{ fontSize: 10.5, color: theme.sub }}>{isRevendeurRole ? "Revendeur" : isCommercial ? "Commercial" : isSuperviseur ? "Superviseur" : "Administrateur"}</div>
              </div>
              <button className="dz-btn dz-btn-ghost" onClick={logout} title="Se déconnecter"
                style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>

        {saveError && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: "#EF444418", borderBottom: "1px solid #EF444455", fontSize: 12.5 }}>
            <AlertTriangle size={15} color="#EF4444" style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              <b>Sauvegarde en échec.</b> Le serveur refuse d'enregistrer (souvent : quota journalier atteint, ou connexion instable). Vos données à l'écran sont intactes — évitez de fermer l'onglet. La sauvegarde reprendra d'elle-même dès que le serveur réacceptera les écritures (le quota se réinitialise chaque jour).
            </span>
            <button className="dz-btn" onClick={() => setSaveError(false)} style={{ background: "transparent", color: theme.sub, padding: 4 }}><X size={15} /></button>
          </div>
        )}

        {loaded && !installedStandalone && !installBannerHidden && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: GRAD.primary, color: "#fff", fontSize: 12.5 }}>
            <Download size={16} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, lineHeight: 1.35 }}>
              <b>Installe l'application</b> sur ton écran d'accueil pour l'ouvrir plus vite.
            </span>
            <button className="dz-btn" onClick={doInstall}
              style={{ background: "#fff", color: COLORS.primary, padding: "6px 14px", borderRadius: 10, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
              Installer
            </button>
            <button className="dz-btn" onClick={() => setInstallBannerHidden(true)} style={{ background: "transparent", color: "#fff", padding: 4, opacity: .85 }}><X size={16} /></button>
          </div>
        )}

        {updateBanner && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: COLORS.accent + "18", borderBottom: `1px solid ${COLORS.accent}44`, fontSize: 12.5 }}>
            <ShieldCheck size={15} color={COLORS.accent} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              Nouvelle version de l'app installée ({APP_VERSION}) — vos données sont intactes (elles vivent dans une base séparée du code), mais par précaution, pensez à <b>télécharger une sauvegarde</b>.
            </span>
            <button className="dz-btn" onClick={() => { setPage("sauvegarde"); setUpdateBanner(false); }}
              style={{ background: COLORS.accent, color: "#fff", padding: "6px 12px", borderRadius: 10, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
              Aller à Sauvegarde
            </button>
            <button className="dz-btn" onClick={() => setUpdateBanner(false)} style={{ background: "transparent", color: theme.sub, padding: 4 }}><X size={15} /></button>
          </div>
        )}

        {!updateBanner && loaded && canManage && lastBackupDate !== undefined && (lastBackupDate === null || Date.now() - lastBackupDate > 7 * 86400000) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: COLORS.primary + "14", borderBottom: `1px solid ${COLORS.primary}33`, fontSize: 12.5 }}>
            <ShieldCheck size={15} color={COLORS.primary} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              <b>Sauvegarde recommandée</b> — {lastBackupDate ? `dernière il y a ${Math.floor((Date.now() - lastBackupDate) / 86400000)} jour(s)` : "aucune sauvegarde téléchargée pour l'instant"}. Par sécurité, téléchargez une copie de vos données.
            </span>
            <button className="dz-btn" onClick={() => setPage("sauvegarde")}
              style={{ background: GRAD.primary, color: "#fff", padding: "6px 12px", borderRadius: 10, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
              Sauvegarder
            </button>
          </div>
        )}

        {/* CONTENT */}
        <main style={{ flex: 1, overflowY: "auto", padding: 20 }} className="dz-fade-in dz-main" key={effectivePage}>
          {effectivePage === "dashboard" && (
            isRevendeurRole ? (
              <DashboardRevendeur theme={theme} dark={dark} tickets={tickets} currentUser={currentUser} catLabels={catLabels} tarifs={tarifs} settings={settings} depenses={depenses} setPage={setPage} openWeekTickets={openWeekTickets} />
            ) : (
              <Dashboard theme={theme} tickets={tickets} revendeurs={revendeurs} weeks={weeks} meta={meta} openWeekTickets={openWeekTickets} lastClosedTicket={lastClosedTicket} dark={dark} activities={activities} setPage={setPage} catLabels={catLabels} />
            )
          )}
          {effectivePage === "import" && (
            <ImportCSV theme={theme} dark={dark} tickets={tickets} setTickets={setTickets} revendeurFor={revendeurFor} meta={meta} setMeta={setMeta} showToast={showToast} addActivity={addActivity}
              setWeeks={setWeeks} setActivities={setActivities} setRevendeurs={setRevendeurs} setTarifs={setTarifs} weeks={weeks} setCatLabels={setCatLabels} canManage={canManage} canResetAll={canResetAll}
              importHistory={importHistory} setImportHistory={setImportHistory} />
          )}
          {effectivePage === "revendeurs" && (
            <Revendeurs theme={theme} dark={dark} revendeurs={revendeurs} setRevendeurs={setRevendeurs} tickets={tickets} showToast={showToast} addActivity={addActivity} canManage={canManage} />
          )}
          {effectivePage === "tarifs" && (
            <Tarifs theme={theme} dark={dark} tarifs={tarifs} setTarifs={setTarifs} showToast={showToast} addActivity={addActivity} catLabels={catLabels} setCatLabels={setCatLabels} canManage={canManage} />
          )}
          {effectivePage === "hebdo" && (
            <Hebdo theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} revendeurFor={revendeurFor} weeks={weeks} setWeeks={setWeeks} lastClosedTicket={lastClosedTicket} openWeekTickets={openWeekTickets} maxTicketNum={maxTicketNum} showToast={showToast} addActivity={addActivity} setPage={setPage} catLabels={catLabels} canManage={canManage} isRevendeurRole={isRevendeurRole} />
          )}
          {effectivePage === "mensuel" && (
            <RapportMensuel theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} weeks={weeks} catLabels={catLabels} isRevendeurRole={isRevendeurRole} showToast={showToast} />
          )}
          {effectivePage === "annuel" && (
            <RapportAnnuel theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} weeks={weeks} catLabels={catLabels} isRevendeurRole={isRevendeurRole} showToast={showToast} />
          )}
          {effectivePage === "classements" && (
            <Classements theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} openWeekTickets={openWeekTickets} lastClosedTicket={lastClosedTicket} weeks={weeks} meta={meta} catLabels={catLabels} showToast={showToast} currentUser={currentUser} />
          )}
          {effectivePage === "mestickets" && (
            <TicketsList theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} catLabels={catLabels} showToast={showToast} currentUser={currentUser} annulations={annulations} setAnnulations={setAnnulations} notify={notify} lastClosedTicket={lastClosedTicket} addActivity={addActivity} setTickets={setTickets} canManage={canManage} />
          )}
          {effectivePage === "soldes" && (
            <Soldes theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} depenses={depenses} settings={settings} currentUser={currentUser} isRevendeurRole={isRevendeurRole} openWeekTickets={openWeekTickets} lastClosedTicket={lastClosedTicket} />
          )}
          {effectivePage === "stock" && (
            <StockTickets theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} stockLots={stockLots} setStockLots={setStockLots} currentUser={currentUser} isRevendeurRole={isRevendeurRole} canManage={canManage} isCommercial={isCommercial} catLabels={catLabels} showToast={showToast} addActivity={addActivity} />
          )}
          {effectivePage === "demandes" && (
            <DemandesTickets theme={theme} dark={dark} demandes={demandesTickets} setDemandes={setDemandesTickets} stockLots={stockLots} setStockLots={setStockLots} revendeurs={revendeurs} setRevendeurs={setRevendeurs} currentUser={currentUser} isRevendeurRole={isRevendeurRole} canManage={canManage} isCommercial={isCommercial} catLabels={catLabels} showToast={showToast} addActivity={addActivity} notify={notify} />
          )}
          {effectivePage === "annulations" && (
            <AnnulationsTickets theme={theme} dark={dark} annulations={annulations} setAnnulations={setAnnulations} tickets={tickets} setTickets={setTickets} revendeurs={revendeurs} currentUser={currentUser} canManage={canManage} isCommercial={isCommercial} isRevendeurRole={isRevendeurRole} lastClosedTicket={lastClosedTicket} notify={notify} showToast={showToast} addActivity={addActivity} />
          )}
          {effectivePage === "depenses" && (
            <Depenses theme={theme} dark={dark} depenses={depenses} setDepenses={setDepenses} revendeurs={revendeurs} currentUser={currentUser} canManage={canManage} isCommercial={isCommercial} isRevendeurRole={isRevendeurRole} showToast={showToast} addActivity={addActivity} notify={notify} />
          )}
          {effectivePage === "stats" && (
            <Statistiques theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} catLabels={catLabels} settings={settings} />
          )}
          {effectivePage === "reseau" && (
            <Reseau theme={theme} dark={dark} equipements={equipements} setEquipements={setEquipements} showToast={showToast} addActivity={addActivity} canManage={canManage} isRevendeurRole={isRevendeurRole} revendeurs={revendeurs} />
          )}
          {effectivePage === "sauvegarde" && (
            <Sauvegarde theme={theme} dark={dark} showToast={showToast} addActivity={addActivity}
              revendeurs={revendeurs} setRevendeurs={setRevendeurs}
              tarifs={tarifs} setTarifs={setTarifs}
              catLabels={catLabels} setCatLabels={setCatLabels}
              tickets={tickets} setTickets={setTickets}
              weeks={weeks} setWeeks={setWeeks}
              meta={meta} setMeta={setMeta}
              activities={activities} setActivities={setActivities}
              equipements={equipements} setEquipements={setEquipements} canManage={canManage} />
          )}
          {effectivePage === "journal" && (
            <Journal theme={theme} dark={dark} activities={activities} />
          )}
          {effectivePage === "utilisateurs" && (canManage || isCommercial) && (
            <Utilisateurs theme={theme} dark={dark} users={users} setUsers={setUsers} revendeurs={revendeurs} setRevendeurs={setRevendeurs} showToast={showToast} addActivity={addActivity} currentUser={currentUser} canManage={canManage} isCommercial={isCommercial} syncedUserIds={syncedUserIds} />
          )}
          {effectivePage === "parametres" && (
            <Parametres theme={theme} dark={dark} setDark={setDark} settings={settings} setSettings={setSettings} showToast={showToast} addActivity={addActivity} catLabels={catLabels} tarifs={tarifs} canManage={canManage} />
          )}
          {effectivePage === "exports" && !isRevendeurRole && (
            <Exports theme={theme} dark={dark} tickets={tickets} revendeurs={revendeurs} weeks={weeks} tarifs={tarifs} catLabels={catLabels} settings={settings} showToast={showToast} currentUser={currentUser} isCommercial={isCommercial} />
          )}
        </main>

        <footer style={{
          height: 34, minHeight: 34, display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 14px", borderTop: `1px solid ${theme.border}`, background: theme.panel, fontSize: 11, color: theme.sub,
        }}>
          <span>DIAFA WIFIZONE PRO v1.0.0</span>
          <span className="dz-fullscreen-btn">© 2026 DIAFA GROUP. Tous droits réservés.</span>
          <span className="dz-fullscreen-btn" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: GRAD.success, display: "inline-block" }} />
            Données locales (stockage sécurisé)
          </span>
        </footer>
      </div>

      {toast && (
        <div key={toast.id} className="dz-slide-in" style={{
          position: "absolute", bottom: 22, right: 22, maxWidth: 380,
          background: theme.card, color: theme.text, padding: "13px 16px", borderRadius: 14, fontSize: 13, fontWeight: 600,
          display: "flex", alignItems: "flex-start", gap: 10, boxShadow: "0 16px 40px rgba(0,0,0,.28)",
          border: `1px solid ${theme.borderSoft}`, borderLeft: `3px solid ${toast.kind === "error" ? COLORS.danger : COLORS.secondary}`, zIndex: 60,
        }}>
          <div style={{ width: 26, height: 26, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: toast.kind === "error" ? GRAD.dangerSoft : GRAD.successSoft, color: toast.kind === "error" ? COLORS.danger : COLORS.secondary }}>
            {toast.kind === "error" ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          </div>
          <span style={{ lineHeight: 1.4, paddingTop: 3 }}>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

function seedRevendeurs() {
  // Deliberately empty — a genuine first run starts with zero revendeurs; the admin adds
  // their real ones. Demo/placeholder names here previously leaked into production data
  // whenever a read failed transiently (see loadKey's failure-handling fix below).
  return [];
}

/* ========================== DASHBOARD =================================== */
function KpiCard({ theme, icon: Icon, color, label, value, sub, subGood }) {
  return (
    <div className="dz-card dz-card-hover dz-kpi" style={{ padding: 18, flex: "1 1 150px", minWidth: 150, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -30, right: -30, width: 90, height: 90, borderRadius: "50%", background: color, opacity: .08, filter: "blur(2px)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div className="dz-kpi-icon" style={{ background: color + "1c", boxShadow: `inset 0 0 0 1px ${color}30` }}>
          <Icon size={19} color={color} strokeWidth={2.2} />
        </div>
        {sub && (
          <div className="dz-badge" style={{ background: subGood ? GRAD.successSoft : (theme.cardAlt), color: subGood ? COLORS.secondary : theme.sub }}>
            {subGood ? <ArrowUpRight size={11} /> : null}{sub}
          </div>
        )}
      </div>
      <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.01em", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: theme.sub, fontWeight: 600, marginTop: 6 }}>{label}</div>
    </div>
  );
}

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

function Dashboard({ theme, tickets, revendeurs, weeks, meta, openWeekTickets, lastClosedTicket, dark, activities, setPage, catLabels }) {
  const now = new Date();
  const todayKey = dateKey(now);
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
  const withDate = tickets.map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) })).filter((t) => t._d);

  const caToday = withDate.filter((t) => dateKey(t._d) === todayKey).reduce((s, t) => s + t.price, 0);
  const caWeek = withDate.filter((t) => t._d >= startOfWeek).reduce((s, t) => s + t.price, 0);
  const caMonth = withDate.filter((t) => t._d.getMonth() === now.getMonth() && t._d.getFullYear() === now.getFullYear()).reduce((s, t) => s + t.price, 0);
  const caYear = withDate.filter((t) => t._d.getFullYear() === now.getFullYear()).reduce((s, t) => s + t.price, 0);

  const [evoPeriod, setEvoPeriod] = useState("hebdo");

  const last7 = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = dateKey(d);
      const total = withDate.filter((t) => dateKey(t._d) === key).reduce((s, t) => s + t.price, 0);
      days.push({ label: d.toLocaleDateString("fr-FR", { weekday: "short" }), ca: total });
    }
    return days;
  }, [tickets]);

  const last30 = useMemo(() => {
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = dateKey(d);
      const total = withDate.filter((t) => dateKey(t._d) === key).reduce((s, t) => s + t.price, 0);
      days.push({ label: String(d.getDate()), ca: total });
    }
    return days;
  }, [tickets]);

  const last12Months = useMemo(() => {
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const total = withDate.filter((t) => t._d.getFullYear() === d.getFullYear() && t._d.getMonth() === d.getMonth()).reduce((s, t) => s + t.price, 0);
      months.push({ label: d.toLocaleDateString("fr-FR", { month: "short" }), ca: total });
    }
    return months;
  }, [tickets]);

  const evoData = evoPeriod === "hebdo" ? last7 : evoPeriod === "mensuel" ? last30 : last12Months;

  const byCat = useMemo(() => {
    const acc = {};
    tickets.forEach((t) => { const c = catOfPrice(t.price); acc[c] = (acc[c] || 0) + 1; });
    return Object.entries(acc).map(([k, v]) => ({ name: catLabels[k] || CAT_LABEL[k] || k, value: v }));
  }, [tickets]);
  const PIE_COLORS = [COLORS.primary, COLORS.secondary, COLORS.accent, "#8B5CF6", COLORS.danger, "#64748B"];

  const topRevendeurs = useMemo(() => {
    const acc = {};
    tickets.forEach((t) => {
      const rid = t.revendeurId || "none";
      acc[rid] = acc[rid] || { ca: 0, tickets: 0 };
      acc[rid].ca += t.price; acc[rid].tickets += 1;
    });
    return Object.entries(acc)
      .map(([rid, v]) => ({ nom: revendeurs.find((r) => r.id === rid)?.nom || "Non assigné", ...v }))
      .sort((a, b) => b.ca - a.ca).slice(0, 5);
  }, [tickets, revendeurs]);

  const maxTop = Math.max(1, ...topRevendeurs.map((r) => r.ca));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <KpiCard theme={theme} icon={TrendingUp} color={COLORS.primary} label="CA Aujourd'hui" value={GNF(caToday)} />
        <KpiCard theme={theme} icon={TrendingUp} color={COLORS.secondary} label="CA Semaine" value={GNF(caWeek)} />
        <KpiCard theme={theme} icon={CalendarRange} color={COLORS.accent} label="CA Mois" value={GNF(caMonth)} />
        <KpiCard theme={theme} icon={Sparkles} color={COLORS.violet} label="CA Année" value={GNF(caYear)} />
        <KpiCard theme={theme} icon={Ticket} color={COLORS.primary} label="Tickets importés" value={fmtInt(tickets.length)} />
        <KpiCard theme={theme} icon={Users} color={COLORS.secondary} label="Revendeurs" value={fmtInt(revendeurs.length)} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="dz-card" style={{ flex: "2 1 380px", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em" }}>Évolution des ventes</div>
              <div style={{ fontSize: 11.5, color: theme.sub, marginTop: 2 }}>Chiffre d'affaires dans le temps</div>
            </div>
            <div style={{ display: "flex", gap: 3, background: theme.cardAlt, padding: 3, borderRadius: 12, border: `1px solid ${theme.borderSoft}` }}>
              {[["hebdo", "Hebdomadaire"], ["mensuel", "Mensuel"], ["annuel", "Annuel"]].map(([id, label]) => (
                <button key={id} className="dz-btn" onClick={() => setEvoPeriod(id)}
                  style={{
                    padding: "6.5px 12px", borderRadius: 10, fontSize: 11.5, fontWeight: 700,
                    background: evoPeriod === id ? GRAD.primary : "transparent",
                    color: evoPeriod === id ? "#fff" : theme.sub,
                    boxShadow: evoPeriod === id ? "0 4px 12px rgba(37,99,235,.32)" : "none",
                  }}>{label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={evoData}>
              <defs>
                <linearGradient id="dzGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.38} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.borderSoft} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => (v >= 1000 ? v / 1000 + "k" : v)} />
              <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 12, boxShadow: theme.shadow }} labelStyle={{ color: theme.sub, fontWeight: 700 }} />
              <Area type="monotone" dataKey="ca" stroke={COLORS.primary} strokeWidth={2.5} fill="url(#dzGrad)" activeDot={{ r: 5, fill: COLORS.primary, stroke: theme.card, strokeWidth: 2 }}>
                <LabelList dataKey="ca" position="top" offset={9} style={{ fontSize: 9.5, fontWeight: 700, fill: theme.sub }} formatter={(v) => (v >= 1000 ? Math.round(v / 1000) + "k" : v || "")} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="dz-card" style={{ flex: "1 1 220px", padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 14 }}>Répartition par profil</div>
          {byCat.length === 0 ? (
            <div style={{ color: theme.sub, fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>Aucune donnée importée</div>
          ) : (
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3} cornerRadius={4}>
                  {byCat.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 12, boxShadow: theme.shadow }} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginTop: 6, justifyContent: "center" }}>
            {byCat.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: theme.sub, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: PIE_COLORS[i % PIE_COLORS.length] }} />{c.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="dz-card" style={{ flex: "1 1 300px", padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 16 }}>Top 5 revendeurs</div>
          {topRevendeurs.length === 0 && <div style={{ color: theme.sub, fontSize: 12.5 }}>Importez des tickets pour voir le classement.</div>}
          {topRevendeurs.map((r, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 8, background: i === 0 ? GRAD.warning : theme.cardAlt, color: i === 0 ? "#fff" : theme.sub, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                  {r.nom}
                </span>
                <span style={{ fontWeight: 700 }}>{GNF(r.ca)}</span>
              </div>
              <div style={{ height: 7, borderRadius: 99, background: theme.cardAlt, overflow: "hidden" }}>
                <div style={{ height: 7, borderRadius: 99, width: `${(r.ca / maxTop) * 100}%`, background: GRAD.primary, transition: "width .6s cubic-bezier(.16,1,.3,1)" }} />
              </div>
            </div>
          ))}
        </div>

        <div className="dz-card" style={{ flex: "1 1 220px", padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 14 }}>Dernier import</div>
          {meta.lastImportFile ? (
            <div style={{ fontSize: 12.5, color: theme.sub, display: "flex", flexDirection: "column", gap: 8 }}>
              <Row label="Fichier" value={meta.lastImportFile} theme={theme} />
              <Row label="Tickets ajoutés" value={fmtInt(meta.lastImportCount)} theme={theme} />
              <Row label="Date" value={new Date(meta.lastImportDate).toLocaleString("fr-FR")} theme={theme} />
            </div>
          ) : <div style={{ color: theme.sub, fontSize: 12.5 }}>Aucun import pour le moment.</div>}
        </div>

        <div className="dz-card" style={{ flex: "1 1 220px", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em" }}>Semaine en cours</div>
          </div>
          <div style={{ fontSize: 12.5, color: theme.sub, display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <Row label="Tickets #" value={`${lastClosedTicket + 1} → ${openWeekTickets.length ? Math.max(...openWeekTickets.map(t=>t.globalId)) : "—"}`} theme={theme} />
            <Row label="Tickets en attente" value={fmtInt(openWeekTickets.length)} theme={theme} />
            <Row label="Semaines clôturées" value={fmtInt(weeks.length)} theme={theme} />
          </div>
          <button className="dz-btn dz-btn-primary" onClick={() => setPage("hebdo")}
            style={{ width: "100%", padding: "9px 0", fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            Voir le rapport <ArrowUpRight size={13} />
          </button>
        </div>

        <div className="dz-card" style={{ flex: "1 1 260px", padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 14, display: "flex", alignItems: "center", gap: 7 }}>
            <ActivityIcon size={14} color={theme.sub} /> Activités récentes
          </div>
          {activities.length === 0 ? (
            <div style={{ color: theme.sub, fontSize: 12.5 }}>Aucune activité pour le moment.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 190, overflowY: "auto" }}>
              {activities.slice(0, 6).map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: GRAD.primary, flexShrink: 0, marginTop: 5 }} />
                  <div style={{ flex: 1, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.text}</div>
                      {a.sub && <div style={{ fontSize: 11, color: theme.sub }}>{a.sub}</div>}
                    </div>
                    <div style={{ fontSize: 10.5, color: theme.sub, whiteSpace: "nowrap" }}>{timeAgo(a.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function Row({ label, value, theme }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{label}</span><span style={{ color: theme.text, fontWeight: 600 }}>{value}</span></div>;
}

/* ========================== IMPORT CSV ==================================== */
function ImportCSV({ theme, dark, tickets, setTickets, revendeurFor, meta, setMeta, showToast, addActivity, setWeeks, setActivities, setRevendeurs, setTarifs, weeks, setCatLabels, canManage, canResetAll, importHistory, setImportHistory }) {
  const [preview, setPreview] = useState(null); // { rows, newCount, dupCount, fileName }
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // "tickets" | "all" | null
  const fileRef = useRef(null);

  function parseMikhmonCSV(text) {
    const parsed = Papa.parse(text, { skipEmptyLines: true });
    const rows = parsed.data;
    const clean = (c) => (c || "").toString().trim().toLowerCase().replace(/[;,]+$/g, ""); // strip stray trailing ; or , (Excel re-export artifacts)
    let headerIdx = rows.findIndex((r) => r.some((c) => clean(c) === "username"));
    if (headerIdx === -1) throw new Error("Colonne 'Username' introuvable — ce fichier ne ressemble pas à un export Mikhmon.");
    const header = rows[headerIdx].map(clean);
    const idx = (name) => {
      const exact = header.indexOf(name);
      if (exact !== -1) return exact;
      return header.findIndex((h) => h.startsWith(name)); // tolerate "price;;;;" etc.
    };
    const iNum = idx("№") !== -1 ? idx("№") : idx("n°");
    const iDate = idx("date"), iTime = idx("time"), iUser = idx("username"), iProfile = idx("profile"), iComment = idx("comment"), iPrice = idx("price");

    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const num = parseInt(r[iNum], 10);
      if (!num || !r[iUser]) continue; // skip totals/footer rows
      const price = parseInt((r[iPrice] || "0").toString().replace(/[^\d-]/g, ""), 10) || 0;
      out.push({
        num, date: r[iDate] || "", time: r[iTime] || "", username: (r[iUser] || "").trim(),
        profile: r[iProfile] || "", comment: r[iComment] || "", price,
      });
    }
    return out;
  }

  function ticketKey(r) { return `${r.date}|${r.time}|${r.username}`.toLowerCase(); }

  function handleFile(file) {
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseMikhmonCSV(reader.result);

        // The imported file is always the FULL cumulative export. We split it against the
        // closed watermark: tickets already CLOSED are left completely untouched (they're never
        // re-written — this is what protects the Firebase quota), and we only ever work with the
        // OPEN segment (everything after the last closed week). On each import that open segment
        // is simply refreshed: already-stored open tickets are skipped, only genuinely new ones
        // are added. So re-importing the full file costs nothing for the closed history.
        const lastClosed = weeks.length ? Math.max(...weeks.map((w) => w.endTicket)) : 0;
        const closedKeys = new Set(tickets.filter((t) => t.globalId <= lastClosed).map(ticketKey));
        const openStoredKeys = new Set(tickets.filter((t) => t.globalId > lastClosed).map(ticketKey));

        // De-duplicate within the file itself first (guards against a doubled row in the export).
        const seenInFile = new Set();
        const fileRows = rows.filter((r) => { const k = ticketKey(r); if (seenInFile.has(k)) return false; seenInFile.add(k); return true; });

        const closedInFile = fileRows.filter((r) => closedKeys.has(ticketKey(r)));      // already closed -> ignored
        const openInFile = fileRows.filter((r) => !closedKeys.has(ticketKey(r)));       // the open segment this file represents
        const fresh = openInFile.filter((r) => !openStoredKeys.has(ticketKey(r)));      // genuinely new -> the only ones written
        const alreadyOpenCount = openInFile.length - fresh.length;
        const openStart = lastClosed + 1;
        const openEnd = lastClosed + openInFile.length;

        const zeroPriceCount = fresh.filter((r) => r.price === 0).length;

        // Guard against "late" tickets whose date predates the last closed week — if Mikhmon's
        // export ever includes a ticket that was missed earlier, we don't want it silently
        // inflating the *current* week's report just because it's new to our database.
        const lastClosedWeek = weeks.length ? weeks[weeks.length - 1] : null;
        const lastClosedDate = lastClosedWeek ? parseMikhmonDate(lastClosedWeek.endDate, "23:59:59") : null;
        const lateCount = lastClosedDate
          ? fresh.filter((r) => { const d = parseMikhmonDate(r.date, r.time); return d && d <= lastClosedDate; }).length
          : 0;

        setPreview({
          fileName: file.name, rows: fresh, totalInFile: rows.length,
          dupCount: rows.length - fresh.length, closedIgnored: closedInFile.length,
          alreadyOpenCount, openTotal: openInFile.length, openStart, openEnd,
          zeroPriceCount, lateCount,
        });
      } catch (e) {
        showToast(e.message || "Erreur de lecture du fichier", "error");
      } finally { setBusy(false); }
    };
    reader.onerror = () => { setBusy(false); showToast("Impossible de lire le fichier", "error"); };
    reader.readAsText(file);
  }

  function confirmImport() {
    if (!preview || preview.rows.length === 0) return;
    // Mikhmon's № resets with every export, so it can't be trusted as a stable, ever-growing
    // ticket ID across multiple files. We assign our own internal, always-incrementing globalId
    // — sorted chronologically — which is what "Rapport Hebdomadaire" actually tracks against.
    let nextId = tickets.length ? Math.max(...tickets.map((t) => t.globalId || 0)) : 0;
    const withRevendeur = preview.rows
      .slice()
      .sort((a, b) => {
        const da = parseMikhmonDate(a.date, a.time), db = parseMikhmonDate(b.date, b.time);
        if (da && db) return da - db;
        return a.num - b.num;
      })
      .map((r) => {
        const rev = revendeurFor(r.username);
        nextId += 1;
        return { ...r, prefix: r.username.slice(0, 2), revendeurId: rev ? rev.id : null, globalId: nextId };
      });
    setTickets((prev) => [...prev, ...withRevendeur]);
    setMeta({ lastImportFile: preview.fileName, lastImportDate: Date.now(), lastImportCount: withRevendeur.length });
    setImportHistory((prev) => [...prev, {
      id: uid(), filename: preview.fileName, importDate: Date.now(), count: withRevendeur.length,
      firstGlobalId: withRevendeur[0].globalId, lastGlobalId: withRevendeur[withRevendeur.length - 1].globalId,
    }]);
    addActivity("Import CSV réussi", `${preview.fileName} · ${withRevendeur.length} tickets`);
    showToast(`${withRevendeur.length} nouveaux tickets importés`);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function deleteTicketsOnly() {
    clearMirror();
    setTickets([]);
    setWeeks([]);
    setMeta({ lastImportFile: null, lastImportDate: null, lastImportCount: 0 });
    setImportHistory([]);
    addActivity("Tickets réinitialisés", "Tous les tickets et rapports hebdomadaires supprimés");
    showToast("Tickets et rapports supprimés");
    setConfirmAction(null);
  }

  function resetEverything() {
    clearMirror();
    setTickets([]);
    setWeeks([]);
    setMeta({ lastImportFile: null, lastImportDate: null, lastImportCount: 0 });
    setActivities([]);
    setRevendeurs([]);
    setTarifs(DEFAULT_TARIFS);
    setCatLabels(DEFAULT_CAT_LABELS);
    setImportHistory([]);
    showToast("Application réinitialisée");
    setConfirmAction(null);
  }

  const [deletingImport, setDeletingImport] = useState(null);

  function affectedClosedWeeks(imp) {
    return weeks.filter((w) => imp.firstGlobalId <= w.endTicket && imp.lastGlobalId >= w.startTicket);
  }

  function deleteOneImport(imp) {
    setTickets((prev) => prev.filter((t) => t.globalId < imp.firstGlobalId || t.globalId > imp.lastGlobalId));
    setImportHistory((prev) => prev.filter((x) => x.id !== imp.id));
    const hitWeeks = affectedClosedWeeks(imp);
    if (hitWeeks.length > 0) {
      const hitIds = new Set(hitWeeks.map((w) => w.weekNumber));
      setWeeks((prev) => prev.filter((w) => !hitIds.has(w.weekNumber)));
    }
    addActivity("Import supprimé", `${imp.filename} · ${fmtInt(imp.count)} tickets${hitWeeks.length ? ` · ${hitWeeks.length} semaine(s) clôturée(s) retirée(s)` : ""}`);
    showToast("Import supprimé");
    setDeletingImport(null);
  }

  // ---- Suppression ciblée par période (semaine / mois / année) ------------------------
  const lastClosedTicketNum = weeks.length ? Math.max(...weeks.map((w) => w.endTicket)) : 0;
  const [periodType, setPeriodType] = useState("mois");
  const [periodWeek, setPeriodWeek] = useState("current");
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(now.getMonth());
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [confirmPeriodDelete, setConfirmPeriodDelete] = useState(null);

  const availableYears = useMemo(() => {
    const ys = new Set(tickets.map((t) => { const d = parseMikhmonDate(t.date, t.time); return d ? d.getFullYear() : null; }).filter(Boolean));
    if (ys.size === 0) ys.add(now.getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [tickets]);

  function computePeriodTarget() {
    if (periodType === "semaine") {
      if (periodWeek === "current") {
        const ids = new Set(tickets.filter((t) => t.globalId > lastClosedTicketNum).map((t) => t.globalId));
        return { label: "Semaine en cours (non clôturée)", ticketIds: ids, weekNumbers: new Set() };
      }
      const w = weeks.find((x) => String(x.weekNumber) === periodWeek);
      if (!w) return null;
      const ids = new Set(tickets.filter((t) => t.globalId >= w.startTicket && t.globalId <= w.endTicket).map((t) => t.globalId));
      return { label: `Semaine ${w.weekNumber} (${w.startDate} → ${w.endDate})`, ticketIds: ids, weekNumbers: new Set([w.weekNumber]) };
    }
    const withDate = tickets.map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) }));
    const matching = withDate.filter((t) => t._d && t._d.getFullYear() === periodYear && (periodType === "annee" || t._d.getMonth() === periodMonth));
    const ids = new Set(matching.map((t) => t.globalId));
    const weekNumbers = new Set(
      weeks.filter((w) => {
        const inWeek = tickets.filter((t) => t.globalId >= w.startTicket && t.globalId <= w.endTicket);
        return inWeek.length > 0 && inWeek.every((t) => ids.has(t.globalId));
      }).map((w) => w.weekNumber)
    );
    const label = periodType === "mois" ? `${MOIS_LABEL[periodMonth]} ${periodYear}` : `Année ${periodYear}`;
    return { label, ticketIds: ids, weekNumbers };
  }

  function confirmDeletePeriod() {
    const target = computePeriodTarget();
    if (!target || target.ticketIds.size === 0) { showToast("Aucun ticket ne correspond à cette période", "error"); return; }
    setConfirmPeriodDelete(target);
  }

  function executeDeletePeriod() {
    const target = confirmPeriodDelete;
    if (!target) return;
    setTickets((prev) => prev.filter((t) => !target.ticketIds.has(t.globalId)));
    if (target.weekNumbers.size > 0) {
      setWeeks((prev) => prev.filter((w) => !target.weekNumbers.has(w.weekNumber)));
    }
    addActivity("Tickets supprimés par période", `${target.label} · ${fmtInt(target.ticketIds.size)} tickets${target.weekNumbers.size ? ` · ${target.weekNumbers.size} semaine(s) clôturée(s) retirée(s)` : ""}`);
    showToast(`${fmtInt(target.ticketIds.size)} tickets supprimés`);
    setConfirmPeriodDelete(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 820 }}>
      <div className="dz-card" style={{ padding: 26, textAlign: "center", border: `2px dashed ${theme.border}` }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: COLORS.primary + "1a", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
          <UploadCloud size={22} color={COLORS.primary} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Glissez votre export Mikhmon ici</div>
        <div style={{ color: theme.sub, fontSize: 12.5, margin: "6px 0 14px" }}>Fichier .csv — les tickets déjà importés sont ignorés automatiquement.</div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
        <button className="dz-btn" disabled={busy} onClick={() => fileRef.current.click()}
          style={{ background: GRAD.primary, color: "#fff", padding: "9px 18px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>
          {busy ? "Lecture…" : "Choisir un fichier CSV"}
        </button>
      </div>

      {preview && (
        <div className="dz-card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5 }}>
              <FileSpreadsheet size={16} color={COLORS.primary} /> {preview.fileName}
            </div>
            <button className="dz-btn" onClick={() => setPreview(null)} style={{ background: "transparent", color: theme.sub }}><X size={16} /></button>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <MiniStat label="Lignes dans le fichier" value={preview.totalInFile} theme={theme} />
            <MiniStat label="Déjà importés (ignorés)" value={preview.dupCount} theme={theme} color={COLORS.accent} />
            <MiniStat label="Nouveaux tickets" value={preview.rows.length} theme={theme} color={COLORS.secondary} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, background: COLORS.primary + "10", border: `1px solid ${COLORS.primary}33`, marginBottom: 14, fontSize: 12.5, color: theme.text }}>
            <CalendarRange size={15} color={COLORS.primary} style={{ flexShrink: 0 }} />
            <span>
              {preview.openTotal > 0
                ? <>Segment ouvert (non clôturé) : <b>#{preview.openStart} → #{preview.openEnd}</b> — {fmtInt(preview.openTotal)} ticket(s), dont <b>{fmtInt(preview.rows.length)} nouveau(x)</b> à ajouter.</>
                : <>Aucun ticket ouvert dans ce fichier.</>}
              {preview.closedIgnored > 0 && <> {fmtInt(preview.closedIgnored)} ticket(s) déjà clôturé(s) sont ignorés (la base des semaines clôturées n'est <b>jamais</b> réécrite).</>}
            </span>
          </div>
          {preview.zeroPriceCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, background: COLORS.danger + "12", border: `1px solid ${COLORS.danger}44`, marginBottom: 14, fontSize: 12.5, color: theme.text }}>
              <AlertTriangle size={15} color={COLORS.danger} style={{ flexShrink: 0 }} />
              <span><b>{fmtInt(preview.zeroPriceCount)} ticket(s) à 0 GNF</b> détecté(s) dans ce fichier — vérifiez que la colonne "Price" n'a pas été altérée (ex. export réenregistré depuis Excel) avant de confirmer.</span>
            </div>
          )}
          {preview.lateCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 12, background: COLORS.accent + "12", border: `1px solid ${COLORS.accent}44`, marginBottom: 14, fontSize: 12.5, color: theme.text }}>
              <AlertTriangle size={15} color={COLORS.accent} style={{ flexShrink: 0 }} />
              <span><b>{fmtInt(preview.lateCount)} ticket(s) antérieur(s)</b> à la dernière semaine clôturée — ils seront comptés dans les totaux mensuels/annuels, mais <b>pas</b> dans la semaine en cours, pour ne pas gonfler le rapport actuel des revendeurs.</span>
            </div>
          )}
          {preview.rows.length === 0 ? (
            <div style={{ fontSize: 12.5, color: theme.sub }}>Tous les tickets de ce fichier sont déjà dans la base — rien à importer.</div>
          ) : (
            <>
              <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${theme.border}`, borderRadius: 12, marginBottom: 14 }}>
                <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th>#</th><th>Date</th><th>Username</th><th>Profil</th><th>Revendeur</th><th style={{ textAlign: "right" }}>Prix</th></tr></thead>
                  <tbody>
                    {preview.rows.slice(0, 60).map((r) => {
                      const rev = revendeurFor(r.username);
                      return (
                        <tr key={`${r.num}-${r.date}-${r.time}-${r.username}`}>
                          <td>{r.num}</td><td>{r.date}</td><td>{r.username}</td><td>{r.profile}</td>
                          <td>{rev ? rev.nom : <span style={{ color: COLORS.accent }}>Non assigné</span>}</td>
                          <td style={{ textAlign: "right" }}>{GNF(r.price)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {preview.rows.length > 60 && <div style={{ padding: 10, fontSize: 11.5, color: theme.sub, textAlign: "center" }}>+ {preview.rows.length - 60} autres lignes…</div>}
              </div>
              <button className="dz-btn" disabled={!canManage} onClick={confirmImport}
                style={{ background: GRAD.success, color: "#fff", padding: "10px 20px", borderRadius: 11, fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 7, opacity: canManage ? 1 : .5 }}>
                <CheckCircle2 size={15} /> Confirmer l'import de {preview.rows.length} tickets
              </button>
              {!canManage && <div style={{ fontSize: 11.5, color: theme.sub, marginTop: 8 }}>Votre rôle ne permet pas de confirmer un import.</div>}
            </>
          )}
        </div>
      )}

      {canManage && importHistory.length > 0 && (
        <div className="dz-card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 4 }}>Historique des imports</div>
          <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>
            Supprimez un fichier importé précisément — utile pour corriger une erreur d'import sans tout réinitialiser.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {importHistory.slice().sort((a, b) => b.importDate - a.importDate).map((imp, i) => (
              <div key={imp.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: dark ? "#0F172A" : "#F8FAFC", border: `1px solid ${theme.border}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{imp.filename}</div>
                  <div style={{ fontSize: 11.5, color: theme.sub }}>
                    {new Date(imp.importDate).toLocaleString("fr-FR")} · {fmtInt(imp.count)} tickets · tickets #{imp.firstGlobalId}–#{imp.lastGlobalId}
                  </div>
                </div>
                <button className="dz-btn" onClick={() => setDeletingImport(imp)}
                  style={{ background: "transparent", color: COLORS.danger, padding: 8, borderRadius: 10 }}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {canManage && (
      <div className="dz-card" style={{ padding: 18, border: `1px solid ${COLORS.danger}33` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13.5, color: COLORS.danger, marginBottom: 4 }}>
          <AlertTriangle size={15} /> Zone de danger
        </div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>
          Ces actions sont irréversibles. Utilisez-les pour repartir sur une base propre (ex. après un test).
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", padding: 14, borderRadius: 12, background: dark ? "#0F172A" : "#F8FAFC", border: `1px solid ${theme.border}` }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 3 }}>Supprimer les tickets importés</div>
            <div style={{ fontSize: 11.5, color: theme.sub, marginBottom: 10 }}>
              Efface les {fmtInt(tickets.length)} tickets et les {fmtInt(weeks.length)} semaine(s) clôturée(s). Les revendeurs et tarifs sont conservés.
            </div>
            <button className="dz-btn" disabled={tickets.length === 0} onClick={() => setConfirmAction("tickets")}
              style={{ background: "transparent", border: `1px solid ${COLORS.danger}`, color: COLORS.danger, padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700, opacity: tickets.length ? 1 : .5 }}>
              Supprimer les tickets
            </button>
          </div>
          {canResetAll && (
            <div style={{ flex: "1 1 260px", padding: 14, borderRadius: 12, background: dark ? "#0F172A" : "#F8FAFC", border: `1px solid ${theme.border}` }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 3 }}>Réinitialiser toute l'application</div>
              <div style={{ fontSize: 11.5, color: theme.sub, marginBottom: 10 }}>
                Efface tickets, rapports, activités, et remet revendeurs/tarifs à leurs valeurs de départ.
              </div>
              <button className="dz-btn" onClick={() => setConfirmAction("all")}
                style={{ background: GRAD.danger, color: "#fff", padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
                Tout réinitialiser
              </button>
            </div>
          )}
        </div>
        {!canResetAll && (
          <div style={{ fontSize: 11, color: theme.sub, marginTop: 10 }}>La réinitialisation complète est réservée au compte Administrateur.</div>
        )}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border}` }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 3 }}>Supprimer des tickets par période</div>
          <div style={{ fontSize: 11.5, color: theme.sub, marginBottom: 10 }}>
            Efface uniquement les tickets d'une semaine, d'un mois ou d'une année précise — les autres restent intacts.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="dz-input" style={{ width: 130 }} value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
              <option value="semaine">Semaine</option>
              <option value="mois">Mois</option>
              <option value="annee">Année</option>
            </select>
            {periodType === "semaine" && (
              <select className="dz-input" style={{ width: 260 }} value={periodWeek} onChange={(e) => setPeriodWeek(e.target.value)}>
                <option value="current">Semaine en cours (non clôturée)</option>
                {weeks.slice().sort((a, b) => b.weekNumber - a.weekNumber).map((w) => (
                  <option key={w.weekNumber} value={w.weekNumber}>Semaine {w.weekNumber} ({w.startDate} → {w.endDate})</option>
                ))}
              </select>
            )}
            {periodType === "mois" && (
              <select className="dz-input" style={{ width: 150 }} value={periodMonth} onChange={(e) => setPeriodMonth(parseInt(e.target.value, 10))}>
                {MOIS_LABEL.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
            )}
            {periodType !== "semaine" && (
              <select className="dz-input" style={{ width: 110 }} value={periodYear} onChange={(e) => setPeriodYear(parseInt(e.target.value, 10))}>
                {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
            <button className="dz-btn" onClick={confirmDeletePeriod}
              style={{ background: "transparent", border: `1px solid ${COLORS.danger}`, color: COLORS.danger, padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
              Supprimer cette période
            </button>
          </div>
        </div>
      </div>
      )}

      {confirmPeriodDelete && (
        <Modal theme={theme} onClose={() => setConfirmPeriodDelete(null)} title="Confirmer la suppression">
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            Supprimer définitivement <b>{fmtInt(confirmPeriodDelete.ticketIds.size)}</b> ticket(s) pour <b>{confirmPeriodDelete.label}</b> ?
          </div>
          {confirmPeriodDelete.weekNumbers.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, background: COLORS.accent + "12", color: COLORS.accent, padding: "9px 12px", borderRadius: 11, fontSize: 12, marginBottom: 14 }}>
              <AlertTriangle size={14} /> {confirmPeriodDelete.weekNumbers.size} semaine(s) clôturée(s) seront aussi retirée(s) de "Rapport Hebdomadaire".
            </div>
          )}
          <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>Cette action est irréversible.</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="dz-btn" onClick={() => setConfirmPeriodDelete(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={executeDeletePeriod} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Oui, supprimer</button>
          </div>
        </Modal>
      )}

      {confirmAction && (
        <Modal theme={theme} onClose={() => setConfirmAction(null)} title={confirmAction === "all" ? "Réinitialiser toute l'application ?" : "Supprimer tous les tickets ?"}>
          <div style={{ fontSize: 13, color: theme.sub, marginBottom: 16, lineHeight: 1.5 }}>
            {confirmAction === "all"
              ? "Cette action supprime définitivement tous les tickets, rapports hebdomadaires, activités, et réinitialise les revendeurs et tarifs à leurs valeurs de départ. Cette action est irréversible."
              : `Cette action supprime définitivement les ${fmtInt(tickets.length)} tickets importés et les ${fmtInt(weeks.length)} semaine(s) clôturée(s). Les revendeurs et tarifs restent inchangés. Cette action est irréversible.`}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="dz-btn" onClick={() => setConfirmAction(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={confirmAction === "all" ? resetEverything : deleteTicketsOnly}
              style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>
              {confirmAction === "all" ? "Oui, tout réinitialiser" : "Oui, supprimer"}
            </button>
          </div>
        </Modal>
      )}

      {deletingImport && (
        <Modal theme={theme} onClose={() => setDeletingImport(null)} title="Supprimer cet import ?">
          <div style={{ fontSize: 13, color: theme.sub, marginBottom: 12, lineHeight: 1.5 }}>
            Supprime définitivement les <b>{fmtInt(deletingImport.count)}</b> tickets de <b>{deletingImport.filename}</b> ({new Date(deletingImport.importDate).toLocaleString("fr-FR")}). Cette action est irréversible.
          </div>
          {affectedClosedWeeks(deletingImport).length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: COLORS.danger + "12", color: COLORS.danger, padding: "10px 12px", borderRadius: 11, fontSize: 12, marginBottom: 16 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Attention : {affectedClosedWeeks(deletingImport).length} semaine(s) déjà clôturée(s) (n° {affectedClosedWeeks(deletingImport).map((w) => w.weekNumber).join(", ")}) seront aussi retirée(s) de "Rapport Hebdomadaire", car leurs tickets en font partie.
              </span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="dz-btn" onClick={() => setDeletingImport(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={() => deleteOneImport(deletingImport)}
              style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>
              Oui, supprimer cet import
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function MiniStat({ label, value, theme, color }) {
  return (
    <div style={{ flex: "1 1 140px", padding: "12px 15px", borderRadius: 13, background: theme.cardAlt, border: `1px solid ${theme.borderSoft}`, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color || COLORS.primary, opacity: .7 }} />
      <div style={{ fontSize: 11, color: theme.sub, fontWeight: 600, marginLeft: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || theme.text, marginLeft: 4, marginTop: 2 }}>{fmtInt(value)}</div>
    </div>
  );
}

/* ========================== REVENDEURS ==================================== */
function Revendeurs({ theme, dark, revendeurs, setRevendeurs, tickets, showToast, addActivity, canManage }) {
  const [editing, setEditing] = useState(null); // revendeur object or 'new'
  const [search, setSearch] = useState("");
  const [statutFilter, setStatutFilter] = useState("Tous");

  const caFor = (id) => tickets.filter((t) => t.revendeurId === id).reduce((s, t) => s + t.price, 0);
  const ticketsFor = (id) => tickets.filter((t) => t.revendeurId === id).length;

  const filtered = revendeurs
    .filter((r) => r.nom.toLowerCase().includes(search.toLowerCase()) || r.codes.join(",").toLowerCase().includes(search.toLowerCase()))
    .filter((r) => statutFilter === "Tous" || (r.statut || "Actif") === statutFilter);

  function save(rev) {
    const codes = rev.codesInput.split(",").map((c) => c.trim()).filter(Boolean);
    const dup = revendeurs.find((r) => r.id !== rev.id && r.codes.some((c) => codes.map(x=>x.toLowerCase()).includes(c.toLowerCase())));
    if (dup) { showToast(`Code déjà utilisé par ${dup.nom}`, "error"); return; }
    if (rev.id) {
      setRevendeurs((prev) => prev.map((r) => r.id === rev.id ? { ...r, nom: rev.nom, telephone: rev.telephone, adresse: rev.adresse, codes, statut: rev.statut, couleur: rev.couleur, observations: rev.observations } : r));
      addActivity("Revendeur modifié", rev.nom);
      showToast("Revendeur mis à jour");
    } else {
      setRevendeurs((prev) => [...prev, { id: uid(), nom: rev.nom, telephone: rev.telephone, adresse: rev.adresse, codes, statut: rev.statut || "Actif", couleur: rev.couleur || COLORS.primary, observations: rev.observations || "" }]);
      addActivity("Revendeur ajouté", rev.nom);
      showToast("Revendeur ajouté");
    }
    setEditing(null);
  }
  function remove(id) {
    const rev = revendeurs.find((r) => r.id === id);
    setRevendeurs((prev) => prev.filter((r) => r.id !== id));
    addActivity("Revendeur supprimé", rev?.nom);
    showToast("Revendeur supprimé");
  }
  function toggleStatut(id) {
    const rev = revendeurs.find((r) => r.id === id);
    const next = (rev.statut || "Actif") === "Actif" ? "Inactif" : "Actif";
    setRevendeurs((prev) => prev.map((r) => r.id === id ? { ...r, statut: next } : r));
    addActivity(`Revendeur ${next === "Actif" ? "réactivé" : "désactivé"}`, rev.nom);
  }
  function freeCodes(id) {
    const rev = revendeurs.find((r) => r.id === id);
    if (!rev.codes.length) return;
    setRevendeurs((prev) => prev.map((r) => r.id === id ? { ...r, codes: [] } : r));
    addActivity("Codes libérés", `${rev.nom} — codes disponibles pour un nouveau revendeur, historique conservé`);
    showToast(`Codes de ${rev.nom} libérés — réutilisables pour un nouveau revendeur`);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flex: "1 1 320px" }}>
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 300 }}>
            <Search size={14} style={{ position: "absolute", left: 11, top: 10.5 }} color={theme.sub} />
            <input className="dz-input" style={{ paddingLeft: 32 }} placeholder="Rechercher un revendeur ou un code…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="dz-input" style={{ width: 140 }} value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)}>
            <option>Tous</option><option>Actif</option><option>Inactif</option>
          </select>
        </div>
        {canManage && (
          <button className="dz-btn" onClick={() => setEditing({ id: null, nom: "", telephone: "", adresse: "", codesInput: "", statut: "Actif", couleur: COLORS.primary, observations: "" })}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Nouveau revendeur
          </button>
        )}
      </div>

      <div className="dz-card" style={{ overflowX: "auto", overflowY: "hidden" }}>
        <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>Nom</th><th>Codes</th><th>Statut</th><th>Téléphone</th><th style={{ textAlign: "right" }}>Tickets</th><th style={{ textAlign: "right" }}>CA total</th><th></th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} style={{ opacity: (r.statut || "Actif") === "Inactif" ? .55 : 1 }}>
                <td style={{ fontWeight: 600 }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: r.couleur || COLORS.primary, marginRight: 8 }} />
                  {r.nom}
                </td>
                <td>{r.codes.map((c) => <span key={c} style={{ background: COLORS.primary + "15", color: COLORS.primary, padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, marginRight: 4 }}>{c}</span>)}</td>
                <td>
                  <span className="dz-btn" onClick={() => canManage && toggleStatut(r.id)}
                    style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: (r.statut || "Actif") === "Actif" ? COLORS.secondary + "1a" : theme.sub + "22", color: (r.statut || "Actif") === "Actif" ? COLORS.secondary : theme.sub, cursor: canManage ? "pointer" : "default" }}>
                    {r.statut || "Actif"}
                  </span>
                </td>
                <td style={{ color: theme.sub }}>{r.telephone || "—"}</td>
                <td style={{ textAlign: "right" }}>{fmtInt(ticketsFor(r.id))}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{GNF(caFor(r.id))}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {canManage ? (
                    <>
                      <button className="dz-btn" onClick={() => setEditing({ ...r, codesInput: r.codes.join(", "), statut: r.statut || "Actif", couleur: r.couleur || COLORS.primary, observations: r.observations || "" })} style={{ background: "transparent", color: theme.sub, padding: 5 }}><Pencil size={14} /></button>
                      {r.codes.length > 0 && (
                        <button className="dz-btn" title="Libérer les codes (départ définitif, garde l'historique)"
                          onClick={() => { if (window.confirm(`Libérer les codes de ${r.nom} (${r.codes.join(", ")}) ? Ils deviendront disponibles pour un nouveau revendeur. L'historique de ${r.nom} est conservé.`)) freeCodes(r.id); }}
                          style={{ background: "transparent", color: COLORS.accent, padding: 5 }}><Tag size={14} /></button>
                      )}
                      <button className="dz-btn" onClick={() => remove(r.id)} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><Trash2 size={14} /></button>
                    </>
                  ) : <span style={{ color: theme.sub, fontSize: 11 }}>—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: theme.sub, padding: 24 }}>Aucun revendeur trouvé.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal theme={theme} onClose={() => setEditing(null)} title={editing.id ? "Modifier le revendeur" : "Nouveau revendeur"}>
          <Field label="Nom" theme={theme}><input className="dz-input" value={editing.nom} onChange={(e) => setEditing({ ...editing, nom: e.target.value })} /></Field>
          <Field label="Codes (préfixes username, séparés par des virgules)" theme={theme}>
            <input className="dz-input" placeholder="Mh, Mj, Md" value={editing.codesInput} onChange={(e) => setEditing({ ...editing, codesInput: e.target.value })} />
          </Field>
          <Field label="Téléphone" theme={theme}><input className="dz-input" value={editing.telephone} onChange={(e) => setEditing({ ...editing, telephone: e.target.value })} /></Field>
          <Field label="Adresse" theme={theme}><input className="dz-input" value={editing.adresse} onChange={(e) => setEditing({ ...editing, adresse: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Statut" theme={theme}>
                <select className="dz-input" value={editing.statut} onChange={(e) => setEditing({ ...editing, statut: e.target.value })}>
                  <option>Actif</option><option>Inactif</option>
                </select>
              </Field>
            </div>
            <div>
              <Field label="Couleur" theme={theme}>
                <input type="color" value={editing.couleur} onChange={(e) => setEditing({ ...editing, couleur: e.target.value })}
                  style={{ width: 44, height: 36, padding: 2, border: `1px solid ${theme.border}`, borderRadius: 11, background: "transparent", cursor: "pointer" }} />
              </Field>
            </div>
          </div>
          <Field label="Observations" theme={theme}>
            <textarea className="dz-input" rows={2} style={{ resize: "vertical" }} value={editing.observations} onChange={(e) => setEditing({ ...editing, observations: e.target.value })} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setEditing(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={!editing.nom.trim()} onClick={() => save(editing)} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, opacity: editing.nom.trim() ? 1 : .5 }}>Enregistrer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Field({ label, theme, children }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".01em", color: theme.sub, marginBottom: 6 }}>{label}</div>{children}</div>;
}
function Modal({ theme, onClose, title, children }) {
  return (
    <div className="dz-fade-in" style={{ position: "absolute", inset: 0, background: "rgba(8,12,22,.55)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div className="dz-card dz-scale-in" style={{ width: 400, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: 22, background: theme.card }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-.01em" }}>{title}</div>
          <button className="dz-btn dz-btn-ghost" onClick={onClose} style={{ width: 30, height: 30, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", color: theme.sub }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ========================== TARIFS ==================================== */
function Tarifs({ theme, dark, tarifs, setTarifs, showToast, addActivity, catLabels, setCatLabels, canManage }) {
  const [form, setForm] = useState(tarifs);
  const [labelForm, setLabelForm] = useState(catLabels);
  useEffect(() => setForm(tarifs), [tarifs]);
  useEffect(() => setLabelForm(catLabels), [catLabels]);
  const dirty = JSON.stringify(form) !== JSON.stringify(tarifs) || JSON.stringify(labelForm) !== JSON.stringify(catLabels);

  const rows = [
    { key: "heure", desc: "Validité 24h" },
    { key: "jour", desc: "Validité 50h" },
    { key: "semaine", desc: "Validité 7 jours" },
    { key: "mois", desc: "Validité 30 jours" },
  ];

  function save() {
    setTarifs(form);
    setCatLabels(labelForm);
    addActivity("Tarifs modifiés");
    showToast("Grille tarifaire enregistrée");
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 4 }}>Grille tarifaire</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 18 }}>
          Le nom de chaque forfait est libre (ex. "Forfait Choco" au lieu de "Heure"). Le <b>prix</b> ci-dessous sert à ranger chaque ticket : un ticket vendu à ce prix compte dans ce forfait. Tout ticket dont le prix ne correspond à aucun forfait est classé dans <b>Autres</b>.
        </div>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${theme.border}`, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <input className="dz-input" disabled={!canManage} value={labelForm[r.key]} onChange={(e) => setLabelForm({ ...labelForm, [r.key]: e.target.value })}
                style={{ fontWeight: 700, fontSize: 13.5, padding: "7px 10px", marginBottom: 3, opacity: canManage ? 1 : .7 }} placeholder={CAT_LABEL[r.key]} />
              <div style={{ fontSize: 11.5, color: theme.sub, marginLeft: 2 }}>{r.desc}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input className="dz-input" disabled={!canManage} type="number" style={{ width: 130, textAlign: "right", opacity: canManage ? 1 : .7 }} value={form[r.key] ?? ""} onChange={(e) => setForm({ ...form, [r.key]: parseInt(e.target.value, 10) || 0 })} />
              <span style={{ fontSize: 12, color: theme.sub }}>GNF</span>
            </div>
          </div>
        ))}
        {canManage && (
          <button className="dz-btn" disabled={!dirty} onClick={save}
            style={{ marginTop: 18, background: GRAD.primary, color: "#fff", padding: "10px 18px", borderRadius: 11, fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, opacity: dirty ? 1 : .5 }}>
            <Save size={15} /> Enregistrer les tarifs
          </button>
        )}
      </div>
    </div>
  );
}

/* ========================== RAPPORT HEBDOMADAIRE ========================= */
/* ---- Rapport hebdomadaire -> image PNG (partage WhatsApp) ---------------- */
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "", cy = y;
  words.forEach((w) => {
    const test = line + w + " ";
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, cy);
      line = w + " ";
      cy += lineHeight;
    } else line = test;
  });
  ctx.fillText(line.trim(), x, cy);
  return cy;
}

function drawReportImage({ rows, totalCA, totalTickets, title, subtitle, ticketRange, catLabels, hideTotal }) {
  const L = { ...CAT_LABEL, ...(catLabels || {}) };
  const short = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
  const W = 880, padX = 28, headerH = 132, colHeaderH = 34, rowH = 32, footerH = 78;
  const H = headerH + colHeaderH + Math.max(rows.length, 1) * rowH + (hideTotal ? 0 : 34) /* total row */ + footerH;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#2563EB"); grad.addColorStop(1, "#1D4ED8");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headerH);

  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 24px Arial, sans-serif";
  ctx.fillText("DIAFA WIFIZONE PRO", padX, 42);
  ctx.font = "700 16px Arial, sans-serif";
  ctx.fillText(title, padX, 70);
  ctx.font = "13px Arial, sans-serif";
  ctx.globalAlpha = 0.9;
  ctx.fillText(subtitle, padX, 92);
  ctx.fillText(ticketRange, padX, 112);
  ctx.globalAlpha = 1;

  const hasAutre = rows.some((r) => (r.autre || 0) > 0);
  const cols = [
    { key: "nom", label: "Revendeur", w: 200, align: "left" },
    { key: "heure", label: short(L.heure, 8), w: 64, align: "right" },
    { key: "jour", label: short(L.jour, 8), w: 64, align: "right" },
    { key: "semaine", label: short(L.semaine, 7), w: 64, align: "right" },
    { key: "mois", label: short(L.mois, 6), w: 56, align: "right" },
    ...(hasAutre ? [{ key: "autre", label: short(L.autre, 6), w: 56, align: "right" }] : []),
    { key: "tickets", label: "Tickets", w: 76, align: "right" },
    { key: "ca", label: "CA (GNF)", w: 0, align: "right" },
  ];
  const fixedW = cols.slice(0, -1).reduce((s, c) => s + c.w, 0);
  cols[cols.length - 1].w = W - padX * 2 - fixedW;

  let y = headerH;
  ctx.fillStyle = "#F1F5F9"; ctx.fillRect(0, y, W, colHeaderH);
  ctx.fillStyle = "#475569";
  ctx.font = "700 10.5px Arial, sans-serif";
  let x = padX;
  cols.forEach((c) => {
    ctx.textAlign = c.align;
    ctx.fillText(c.label.toUpperCase(), c.align === "left" ? x : x + c.w, y + 22);
    x += c.w;
  });
  y += colHeaderH;

  rows.forEach((r, i) => {
    ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
    ctx.fillRect(0, y, W, rowH);
    let x = padX;
    cols.forEach((c) => {
      ctx.textAlign = c.align;
      let val;
      if (c.key === "nom") val = r.nom;
      else if (c.key === "ca") val = GNF(r.ca);
      else if (c.key === "tickets") val = fmtInt(r.tickets);
      else val = fmtInt(r[c.key] || 0);
      ctx.fillStyle = "#1E293B";
      ctx.font = (c.key === "nom" || c.key === "ca") ? "700 12.5px Arial, sans-serif" : "500 12.5px Arial, sans-serif";
      ctx.fillText(String(val), c.align === "left" ? x : x + c.w, y + 21);
      x += c.w;
    });
    y += rowH;
    ctx.strokeStyle = "#E2E8F0"; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  if (!hideTotal) {
    ctx.fillStyle = "#EFF6FF"; ctx.fillRect(0, y, W, 34);
    ctx.fillStyle = "#2563EB"; ctx.font = "800 13px Arial, sans-serif";
    ctx.textAlign = "left"; ctx.fillText("TOTAL", padX, y + 22);
    ctx.textAlign = "right"; ctx.fillText(GNF(totalCA), W - padX, y + 22);
    ctx.font = "700 11px Arial, sans-serif";
    ctx.fillText(fmtInt(totalTickets) + " tickets", W - padX - 150, y + 22);
    y += 34 + 14;
  } else {
    y += 14;
  }

  ctx.fillStyle = "#475569";
  ctx.font = "italic 12px Arial, sans-serif";
  ctx.textAlign = "left";
  wrapCanvasText(ctx, "Merci de vérifier votre position et de déposer votre versement auprès de l'agent de recouvrement.", padX, y, W - padX * 2, 16);

  ctx.fillStyle = "#94A3B8"; ctx.font = "10px Arial, sans-serif";
  ctx.fillText("Généré le " + new Date().toLocaleString("fr-FR") + " — DIAFA WIFIZONE PRO", padX, H - 14);

  return canvas;
}

async function exportReportImage(canvas, filename, shareTitle, shareText, showToast) {
  try {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("blob failed");
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: shareTitle, text: shareText });
      showToast && showToast("Rapport partagé");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast && showToast("Image téléchargée — envoyez-la depuis WhatsApp");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    showToast && showToast("Échec de l'export de l'image", "error");
  }
}

// Formatted image of the "AP ranking per reseller" (for WhatsApp sharing / download).
function drawApRankingImage(rows) {
  const W = 720, padX = 28, headerH = 118, colHeaderH = 34, rowH = 32, footerH = 60;
  const totalAP = rows.reduce((s, r) => s + r.total, 0);
  const H = headerH + colHeaderH + Math.max(rows.length, 1) * rowH + 34 + footerH;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext("2d"); ctx.scale(scale, scale);
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#2563EB"); grad.addColorStop(1, "#1D4ED8");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, headerH);
  ctx.textAlign = "left"; ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 24px Arial, sans-serif"; ctx.fillText("DIAFA WIFIZONE PRO", padX, 42);
  ctx.font = "700 16px Arial, sans-serif"; ctx.fillText("Classement — Nombre d'AP par revendeur", padX, 70);
  ctx.font = "13px Arial, sans-serif"; ctx.globalAlpha = 0.9;
  ctx.fillText(`${rows.length} revendeur(s) · ${totalAP} AP au total`, padX, 94);
  ctx.globalAlpha = 1;

  const cols = [
    { key: "rang", label: "#", w: 44, align: "left" },
    { key: "nom", label: "Revendeur", w: 0, align: "left" },
    { key: "total", label: "Total AP", w: 90, align: "right" },
    { key: "Master", label: "Master", w: 80, align: "right" },
    { key: "Mesh", label: "Mesh", w: 74, align: "right" },
    { key: "Transmission", label: "Transmission", w: 112, align: "right" },
  ];
  cols[1].w = W - padX * 2 - cols.reduce((s, c) => s + c.w, 0);

  let y = headerH;
  ctx.fillStyle = "#F1F5F9"; ctx.fillRect(0, y, W, colHeaderH);
  ctx.fillStyle = "#475569"; ctx.font = "700 10.5px Arial, sans-serif";
  let hx = padX;
  cols.forEach((c) => { ctx.textAlign = c.align; ctx.fillText(c.label.toUpperCase(), c.align === "left" ? hx : hx + c.w, y + 22); hx += c.w; });
  y += colHeaderH;

  rows.forEach((r, i) => {
    ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC"; ctx.fillRect(0, y, W, rowH);
    let x = padX;
    cols.forEach((c) => {
      ctx.textAlign = c.align;
      let val;
      if (c.key === "rang") val = String(i + 1);
      else if (c.key === "nom") val = r.nom;
      else val = fmtInt(r[c.key] || 0);
      ctx.fillStyle = c.key === "total" ? "#2563EB" : "#1E293B";
      ctx.font = (c.key === "nom") ? "700 12.5px Arial, sans-serif" : (c.key === "total") ? "800 12.5px Arial, sans-serif" : "500 12.5px Arial, sans-serif";
      ctx.fillText(String(val), c.align === "left" ? x : x + c.w, y + 21);
      x += c.w;
    });
    y += rowH;
    ctx.strokeStyle = "#E2E8F0"; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  });

  ctx.fillStyle = "#EFF6FF"; ctx.fillRect(0, y, W, 34);
  ctx.fillStyle = "#2563EB"; ctx.font = "800 13px Arial, sans-serif";
  ctx.textAlign = "left"; ctx.fillText("TOTAL", padX, y + 22);
  ctx.textAlign = "right"; ctx.fillText(fmtInt(totalAP) + " AP", W - padX, y + 22);
  y += 34;

  ctx.fillStyle = "#94A3B8"; ctx.font = "10px Arial, sans-serif"; ctx.textAlign = "left";
  ctx.fillText("Généré le " + new Date().toLocaleString("fr-FR") + " — DIAFA WIFIZONE PRO", padX, H - 16);
  return canvas;
}

function Hebdo({ theme, dark, tickets, revendeurs, revendeurFor, weeks, setWeeks, lastClosedTicket, openWeekTickets, maxTicketNum, showToast, addActivity, catLabels, canManage, isRevendeurRole }) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [viewWeek, setViewWeek] = useState(null);

  function buildReport(ticketList) {
    const perRev = {};
    let totalCA = 0;
    ticketList.forEach((t) => {
      const rid = t.revendeurId || "none";
      perRev[rid] = perRev[rid] || { heure: 0, jour: 0, semaine: 0, mois: 0, autre: 0, ca: 0, tickets: 0 };
      const cat = catOfPrice(t.price);
      if (perRev[rid][cat] !== undefined) perRev[rid][cat] += 1;
      perRev[rid].ca += t.price;
      perRev[rid].tickets += 1;
      totalCA += t.price;
    });
    const rows = Object.entries(perRev).map(([rid, v]) => ({
      revendeurId: rid, nom: revendeurs.find((r) => r.id === rid)?.nom || "Non assigné", ...v,
    })).sort((a, b) => b.ca - a.ca);
    return { rows, totalCA, totalTickets: ticketList.length };
  }

  const currentReport = useMemo(() => buildReport(openWeekTickets), [openWeekTickets, revendeurs]);

  function exportWeek(report, weekNumber, weekLabel, ticketRangeLabel, withTotal) {
    const canvas = drawReportImage({
      rows: report.rows, totalCA: report.totalCA, totalTickets: report.totalTickets,
      title: `Rapport Hebdomadaire — Semaine ${weekNumber}`, subtitle: weekLabel, ticketRange: ticketRangeLabel, catLabels,
      hideTotal: !withTotal,
    });
    exportReportImage(canvas, `diafa-semaine-${weekNumber}${withTotal ? "" : "-revendeurs"}.png`, `Rapport Semaine ${weekNumber} — DIAFA WIFIZONE`,
      "Merci de vérifier votre position et de déposer votre versement auprès de l'agent de recouvrement.", showToast);
  }

  function closeWeek() {
    if (openWeekTickets.length === 0) return;
    const nums = openWeekTickets.map((t) => t.globalId);
    const dates = openWeekTickets.map((t) => t.date).filter(Boolean);
    const report = buildReport(openWeekTickets);
    const week = {
      id: uid(), weekNumber: weeks.length + 1,
      startTicket: Math.min(...nums), endTicket: Math.max(...nums),
      startDate: dates[0] || "", endDate: dates[dates.length - 1] || "",
      closedAt: Date.now(), ...report,
    };
    setWeeks((prev) => [...prev, week]);
    setConfirmClose(false);
    addActivity(`Rapport hebdomadaire clôturé (S${week.weekNumber})`, `Tickets ${week.startTicket}–${week.endTicket}`);
    showToast(`Semaine ${week.weekNumber} clôturée (tickets ${week.startTicket}–${week.endTicket})`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 7 }}>
              <LockOpen size={15} color={COLORS.accent} /> Semaine en cours — Semaine {weeks.length + 1}
            </div>
            <div style={{ fontSize: 12, color: theme.sub, marginTop: 3 }}>
              Tickets #{lastClosedTicket + 1} → #{maxTicketNum || lastClosedTicket} · {fmtInt(currentReport.totalTickets)} tickets{!isRevendeurRole && ` · ${GNF(currentReport.totalCA)}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!isRevendeurRole && (
              <>
                <button className="dz-btn" disabled={openWeekTickets.length === 0}
                  title="Pour le groupe WhatsApp des revendeurs — sans le total"
                  onClick={() => exportWeek(currentReport, weeks.length + 1, "Semaine en cours", `Tickets #${lastClosedTicket + 1} → #${maxTicketNum || lastClosedTicket}`, false)}
                  style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "10px 14px", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 7, opacity: openWeekTickets.length ? 1 : .5 }}>
                  <Share2 size={14} /> Export revendeurs
                </button>
                <button className="dz-btn" disabled={openWeekTickets.length === 0}
                  title="Pour vous / l'agent de recouvrement — avec le total"
                  onClick={() => exportWeek(currentReport, weeks.length + 1, "Semaine en cours", `Tickets #${lastClosedTicket + 1} → #${maxTicketNum || lastClosedTicket}`, true)}
                  style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "10px 14px", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 7, opacity: openWeekTickets.length ? 1 : .5 }}>
                  <Share2 size={14} /> Export admin (avec total)
                </button>
              </>
            )}
            {canManage && (
              <button className="dz-btn" disabled={openWeekTickets.length === 0} onClick={() => setConfirmClose(true)}
                style={{ background: GRAD.success, color: "#fff", padding: "10px 18px", borderRadius: 11, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 7, opacity: openWeekTickets.length ? 1 : .5 }}>
                <Lock size={14} /> Clôturer la semaine
              </button>
            )}
          </div>
        </div>

        <WeekTable rows={currentReport.rows} theme={theme} catLabels={catLabels} />
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 12 }}>Semaines clôturées</div>
        {weeks.length === 0 ? (
          <div style={{ color: theme.sub, fontSize: 12.5 }}>Aucune semaine clôturée pour le moment.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...weeks].reverse().map((w) => (
              <div key={w.id} className="dz-btn" onClick={() => setViewWeek(w)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderRadius: 12, border: `1px solid ${theme.border}`, background: dark ? "#0F172A" : "#F8FAFC" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Lock size={13} color={theme.sub} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Semaine {w.weekNumber}</div>
                    <div style={{ fontSize: 11.5, color: theme.sub }}>Tickets #{w.startTicket}–#{w.endTicket} · {w.startDate} → {w.endDate}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}>
                  <div>
                    {!isRevendeurRole && <div style={{ fontWeight: 700, fontSize: 13 }}>{GNF(w.totalCA)}</div>}
                    <div style={{ fontSize: 11.5, color: theme.sub }}>{fmtInt(w.totalTickets)} tickets</div>
                  </div>
                  {!isRevendeurRole && (
                    <button className="dz-btn" title="Exporter en image"
                      onClick={(e) => { e.stopPropagation(); exportWeek(w, w.weekNumber, `${w.startDate} → ${w.endDate}`, `Tickets #${w.startTicket}–#${w.endTicket}`, true); }}
                      style={{ background: dark ? "#1E293B" : "#fff", border: `1px solid ${theme.border}`, color: theme.sub, width: 30, height: 30, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Download size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmClose && (
        <Modal theme={theme} onClose={() => setConfirmClose(false)} title="Clôturer la semaine ?">
          <div style={{ fontSize: 13, color: theme.sub, marginBottom: 16, lineHeight: 1.5 }}>
            Cette action verrouille définitivement les tickets #{lastClosedTicket + 1} à #{maxTicketNum} comme <b>Semaine {weeks.length + 1}</b>.
            Elle ne pourra plus être recomptée. {fmtInt(currentReport.totalTickets)} tickets pour {GNF(currentReport.totalCA)}.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="dz-btn" onClick={() => setConfirmClose(false)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={closeWeek} style={{ background: GRAD.success, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Confirmer la clôture</button>
          </div>
        </Modal>
      )}

      {viewWeek && (
        <Modal theme={theme} onClose={() => setViewWeek(null)} title={`Semaine ${viewWeek.weekNumber} — détail`}>
          <div style={{ fontSize: 11.5, color: theme.sub, marginBottom: 10 }}>Tickets #{viewWeek.startTicket}–#{viewWeek.endTicket} · {viewWeek.startDate} → {viewWeek.endDate}</div>
          <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 12 }}><WeekTable rows={viewWeek.rows} theme={theme} compact catLabels={catLabels} /></div>
          {!isRevendeurRole && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="dz-btn" title="Pour le groupe WhatsApp des revendeurs — sans le total"
                onClick={() => exportWeek(viewWeek, viewWeek.weekNumber, `${viewWeek.startDate} → ${viewWeek.endDate}`, `Tickets #${viewWeek.startTicket}–#${viewWeek.endTicket}`, false)}
                style={{ flex: 1, background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "10px 0", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <Share2 size={14} /> Revendeurs
              </button>
              <button className="dz-btn" title="Pour vous / l'agent de recouvrement — avec le total"
                onClick={() => exportWeek(viewWeek, viewWeek.weekNumber, `${viewWeek.startDate} → ${viewWeek.endDate}`, `Tickets #${viewWeek.startTicket}–#${viewWeek.endTicket}`, true)}
                style={{ flex: 1, background: GRAD.primary, color: "#fff", padding: "10px 0", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                <Share2 size={14} /> Admin (avec total)
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function WeekTable({ rows, theme, compact, catLabels }) {
  const L = { ...CAT_LABEL, ...(catLabels || {}) };
  if (rows.length === 0) return <div style={{ color: theme.sub, fontSize: 12.5, padding: "16px 0" }}>Aucun ticket dans cette période.</div>;
  const hasAutre = rows.some((r) => (r.autre || 0) > 0);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: compact ? 0 : 560 }}>
        <thead><tr><th>Revendeur</th><th style={{textAlign:"right"}}>{L.heure}</th><th style={{textAlign:"right"}}>{L.jour}</th><th style={{textAlign:"right"}}>{L.semaine}</th><th style={{textAlign:"right"}}>{L.mois}</th>{hasAutre && <th style={{textAlign:"right"}}>{L.autre}</th>}<th style={{textAlign:"right"}}>Tickets</th><th style={{textAlign:"right"}}>CA</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.revendeurId}>
              <td style={{ fontWeight: 600 }}>{r.nom}</td>
              <td style={{ textAlign: "right" }}>{r.heure || 0}</td>
              <td style={{ textAlign: "right" }}>{r.jour || 0}</td>
              <td style={{ textAlign: "right" }}>{r.semaine || 0}</td>
              <td style={{ textAlign: "right" }}>{r.mois || 0}</td>
              {hasAutre && <td style={{ textAlign: "right" }}>{r.autre || 0}</td>}
              <td style={{ textAlign: "right" }}>{fmtInt(r.tickets)}</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{GNF(r.ca)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========================== RAPPORT MENSUEL ============================= */
const MOIS_LABEL = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function aggregateWeeks(weeksList) {
  const perRev = {};
  let totalCA = 0, totalTickets = 0;
  weeksList.forEach((w) => {
    w.rows.forEach((r) => {
      perRev[r.revendeurId] = perRev[r.revendeurId] || { nom: r.nom, revendeurId: r.revendeurId, heure: 0, jour: 0, semaine: 0, mois: 0, autre: 0, ca: 0, tickets: 0 };
      const acc = perRev[r.revendeurId];
      acc.heure += r.heure || 0; acc.jour += r.jour || 0;
      acc.semaine += r.semaine || 0; acc.mois += r.mois || 0; acc.ca += r.ca; acc.tickets += r.tickets;
    });
    totalCA += w.totalCA; totalTickets += w.totalTickets;
  });
  const rows = Object.values(perRev).sort((a, b) => b.ca - a.ca);
  return { rows, totalCA, totalTickets };
}

// Per-reseller aggregation computed DIRECTLY from a list of tickets (same math as the
// weekly buildReport). Used by the monthly & annual reports so they count by the REAL
// ticket date — a week straddling two months contributes each day to its own month.
function buildReportFromTickets(ticketList, revendeurs) {
  const perRev = {};
  let totalCA = 0;
  ticketList.forEach((t) => {
    const rid = t.revendeurId || "none";
    perRev[rid] = perRev[rid] || { revendeurId: rid, nom: revendeurs.find((r) => r.id === rid)?.nom || "Non assigné", heure: 0, jour: 0, semaine: 0, mois: 0, autre: 0, ca: 0, tickets: 0 };
    const cat = catOfPrice(t.price);
    if (perRev[rid][cat] !== undefined) perRev[rid][cat] += 1;
    perRev[rid].ca += t.price;
    perRev[rid].tickets += 1;
    totalCA += t.price;
  });
  const rows = Object.values(perRev).sort((a, b) => b.ca - a.ca);
  return { rows, totalCA, totalTickets: ticketList.length };
}

function RapportMensuel({ theme, dark, tickets, revendeurs, weeks, catLabels, isRevendeurRole, showToast }) {
  // Group tickets by the REAL calendar month of each ticket's date. A week that straddles
  // two months therefore splits naturally: its July days land in July, its August days in August.
  const ticketsByMonth = useMemo(() => {
    const acc = {};
    tickets.forEach((t) => {
      const d = parseMikhmonDate(t.date, t.time);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      (acc[key] = acc[key] || { key, year: d.getFullYear(), month: d.getMonth(), tickets: [] }).tickets.push(t);
    });
    return acc;
  }, [tickets]);

  const months = useMemo(
    () => Object.values(ticketsByMonth).sort((a, b) => (a.key < b.key ? 1 : -1)),
    [ticketsByMonth]
  );

  const [selectedKey, setSelectedKey] = useState(months[0]?.key || null);
  const current = months.find((m) => m.key === selectedKey) || months[0];
  const idxInList = months.findIndex((m) => m.key === current?.key);
  const previous = months[idxInList + 1]; // months sorted desc, so +1 = previous month

  if (!current) {
    return (
      <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
        Aucun rapport mensuel disponible pour le moment — importez des ventes pour qu'un mois apparaisse ici.
      </div>
    );
  }

  const report = buildReportFromTickets(current.tickets, revendeurs);
  const prevReport = previous ? buildReportFromTickets(previous.tickets, revendeurs) : null;
  const evolution = prevReport && prevReport.totalCA > 0
    ? ((report.totalCA - prevReport.totalCA) / prevReport.totalCA) * 100
    : null;

  // Distinct sale days in the month (replaces the old "weeks included" count).
  const dayCount = new Set(current.tickets.map((t) => { const d = parseMikhmonDate(t.date, t.time); return d ? d.getDate() : 0; })).size;

  // CA grouped by REAL Monday→Sunday weeks (the deposit cycle), from real ticket dates.
  const byWeekChart = (() => {
    const buckets = {};
    current.tickets.forEach((t) => {
      const d = parseMikhmonDate(t.date, t.time);
      if (!d) return;
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const k = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
      if (!buckets[k]) buckets[k] = { monday, ca: 0 };
      buckets[k].ca += t.price;
    });
    return Object.values(buckets).sort((a, b) => a.monday - b.monday)
      .map((b) => ({ label: `Sem. ${String(b.monday.getDate()).padStart(2, "0")}/${String(b.monday.getMonth() + 1).padStart(2, "0")}`, ca: b.ca }));
  })();

  function exportMonth(withTotal) {
    const canvas = drawReportImage({
      rows: report.rows, totalCA: report.totalCA, totalTickets: report.totalTickets,
      title: `Rapport Mensuel — ${MOIS_LABEL[current.month]} ${current.year}`,
      subtitle: `${dayCount} jour(s) de vente`, ticketRange: "", catLabels,
      hideTotal: !withTotal,
    });
    exportReportImage(canvas, `diafa-mensuel-${current.key}${withTotal ? "" : "-revendeurs"}.png`,
      `Rapport ${MOIS_LABEL[current.month]} ${current.year} — DIAFA WIFIZONE`, "Récapitulatif mensuel.", showToast);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select className="dz-input" style={{ width: 220 }} value={current.key} onChange={(e) => setSelectedKey(e.target.value)}>
            {months.map((m) => <option key={m.key} value={m.key}>{MOIS_LABEL[m.month]} {m.year}</option>)}
          </select>
          <div style={{ fontSize: 12, color: theme.sub }}>{dayCount} jour(s) de vente · {fmtInt(report.totalTickets)} tickets (calculé par date réelle)</div>
        </div>
        {!isRevendeurRole && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="dz-btn" onClick={() => exportMonth(false)}
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "8px 12px", borderRadius: 11, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Share2 size={13} /> Export revendeurs
            </button>
            <button className="dz-btn" onClick={() => exportMonth(true)}
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "8px 12px", borderRadius: 11, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Share2 size={13} /> Export (avec total)
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {!isRevendeurRole && (
          <KpiCard theme={theme} icon={TrendingUp} color={COLORS.primary} label={`CA ${MOIS_LABEL[current.month]}`} value={GNF(report.totalCA)}
            sub={evolution !== null ? `${evolution >= 0 ? "+" : ""}${evolution.toFixed(1)}% vs mois précédent` : null} subGood={evolution !== null && evolution >= 0} />
        )}
        <KpiCard theme={theme} icon={Ticket} color={COLORS.secondary} label="Tickets vendus" value={fmtInt(report.totalTickets)} />
        <KpiCard theme={theme} icon={CalendarRange} color={COLORS.accent} label="Jours de vente" value={fmtInt(dayCount)} />
        <KpiCard theme={theme} icon={Users} color="#8B5CF6" label="Revendeurs actifs" value={fmtInt(report.rows.length)} />
      </div>

      {!isRevendeurRole && (
        <div className="dz-card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>CA par semaine (lundi→dimanche) — {MOIS_LABEL[current.month]} {current.year}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byWeekChart}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => (v >= 1000 ? v / 1000 + "k" : v)} />
              <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 12 }} />
              <Bar dataKey="ca" fill={COLORS.primary} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Détail par revendeur — {MOIS_LABEL[current.month]} {current.year}</div>
        <WeekTable rows={report.rows} theme={theme} catLabels={catLabels} />
      </div>
    </div>
  );
}

/* ========================== RAPPORT ANNUEL =============================== */
const CAT_KEYS = ["heure", "jour", "semaine", "mois"];

function RapportAnnuel({ theme, dark, tickets, revendeurs, weeks, catLabels, isRevendeurRole, showToast }) {
  // Group tickets by the REAL calendar year of each ticket's date.
  const ticketsByYear = useMemo(() => {
    const acc = {};
    tickets.forEach((t) => {
      const d = parseMikhmonDate(t.date, t.time);
      if (!d) return;
      (acc[d.getFullYear()] = acc[d.getFullYear()] || []).push(t);
    });
    return acc;
  }, [tickets]);

  const years = useMemo(
    () => Object.entries(ticketsByYear)
      .map(([year, ts]) => ({ year: parseInt(year, 10), tickets: ts }))
      .sort((a, b) => b.year - a.year),
    [ticketsByYear]
  );

  const [selectedYear, setSelectedYear] = useState(years[0]?.year || null);
  const current = years.find((y) => y.year === selectedYear) || years[0];

  const monthly = useMemo(() => {
    const acc = Array.from({ length: 12 }, (_, i) => ({ month: i, label: MOIS_LABEL[i].slice(0, 3), ca: 0, tickets: 0, hasData: false }));
    (current ? current.tickets : []).forEach((t) => {
      const d = parseMikhmonDate(t.date, t.time);
      if (!d) return;
      acc[d.getMonth()].ca += t.price;
      acc[d.getMonth()].tickets += 1;
      acc[d.getMonth()].hasData = true;
    });
    return acc;
  }, [current]);

  if (!current) {
    return (
      <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
        Aucun rapport annuel disponible pour le moment — importez des ventes pour qu'une année apparaisse ici.
      </div>
    );
  }

  const report = buildReportFromTickets(current.tickets, revendeurs);
  const activeMonths = monthly.filter((m) => m.hasData).length;

  const withData = monthly.filter((m) => m.hasData);
  const bestMonth = withData.length ? withData.reduce((a, b) => (b.ca > a.ca ? b : a)) : null;
  const worstMonth = withData.length ? withData.reduce((a, b) => (b.ca < a.ca ? b : a)) : null;
  const bestRevendeur = report.rows[0] || null;

  const profilTotals = CAT_KEYS.map((k) => ({
    key: k, label: (catLabels && catLabels[k]) || CAT_LABEL[k],
    tickets: report.rows.reduce((s, r) => s + (r[k] || 0), 0),
  }));
  const bestProfil = profilTotals.reduce((a, b) => (b.tickets > a.tickets ? b : a), profilTotals[0]);

  function exportYear(withTotal) {
    const canvas = drawReportImage({
      rows: report.rows, totalCA: report.totalCA, totalTickets: report.totalTickets,
      title: `Rapport Annuel — ${current.year}`,
      subtitle: `${activeMonths} mois de vente`, ticketRange: "", catLabels,
      hideTotal: !withTotal,
    });
    exportReportImage(canvas, `diafa-annuel-${current.year}${withTotal ? "" : "-revendeurs"}.png`,
      `Rapport ${current.year} — DIAFA WIFIZONE`, "Récapitulatif annuel.", showToast);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select className="dz-input" style={{ width: 160 }} value={current.year} onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}>
            {years.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
          </select>
          <div style={{ fontSize: 12, color: theme.sub }}>{activeMonths} mois de vente · {fmtInt(report.totalTickets)} tickets (par date réelle)</div>
        </div>
        {!isRevendeurRole && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="dz-btn" onClick={() => exportYear(false)}
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "8px 12px", borderRadius: 11, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Share2 size={13} /> Export revendeurs
            </button>
            <button className="dz-btn" onClick={() => exportYear(true)}
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "8px 12px", borderRadius: 11, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Share2 size={13} /> Export (avec total)
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {!isRevendeurRole && <KpiCard theme={theme} icon={TrendingUp} color={COLORS.primary} label={`CA ${current.year}`} value={GNF(report.totalCA)} />}
        <KpiCard theme={theme} icon={Ticket} color={COLORS.secondary} label="Tickets vendus" value={fmtInt(report.totalTickets)} />
        <KpiCard theme={theme} icon={Users} color="#8B5CF6" label="Revendeurs actifs" value={fmtInt(report.rows.length)} />
        <KpiCard theme={theme} icon={CalendarRange} color={COLORS.accent} label="Mois de vente" value={fmtInt(activeMonths)} />
      </div>

      {!isRevendeurRole && (
        <div className="dz-card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Évolution mensuelle — {current.year}</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => (v >= 1000 ? v / 1000 + "k" : v)} />
              <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 12 }} />
              <Bar dataKey="ca" fill={COLORS.primary} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {!isRevendeurRole && (
          <>
            <HighlightCard theme={theme} dark={dark} icon={Trophy} color={COLORS.secondary}
              label="Meilleur mois" value={bestMonth ? `${MOIS_LABEL[bestMonth.month]}` : "—"} sub={bestMonth ? GNF(bestMonth.ca) : ""} />
            <HighlightCard theme={theme} dark={dark} icon={TrendingDown} color={COLORS.danger}
              label="Mois le plus faible" value={worstMonth ? `${MOIS_LABEL[worstMonth.month]}` : "—"} sub={worstMonth ? GNF(worstMonth.ca) : ""} />
            <HighlightCard theme={theme} dark={dark} icon={Award} color={COLORS.accent}
              label="Meilleur revendeur" value={bestRevendeur ? bestRevendeur.nom : "—"} sub={bestRevendeur ? GNF(bestRevendeur.ca) : ""} />
          </>
        )}
        <HighlightCard theme={theme} dark={dark} icon={Ticket} color="#8B5CF6"
          label="Profil le plus vendu" value={bestProfil ? bestProfil.label : "—"} sub={bestProfil ? `${fmtInt(bestProfil.tickets)} tickets` : ""} />
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Détail par revendeur — {current.year}</div>
        <WeekTable rows={report.rows} theme={theme} catLabels={catLabels} />
      </div>
    </div>
  );
}

function HighlightCard({ theme, dark, icon: Icon, color, label, value, sub }) {
  return (
    <div className="dz-card dz-card-hover" style={{ flex: "1 1 220px", padding: 18, display: "flex", alignItems: "center", gap: 13 }}>
      <div className="dz-kpi-icon" style={{ background: color + "1c", boxShadow: `inset 0 0 0 1px ${color}30` }}>
        <Icon size={19} color={color} strokeWidth={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: theme.sub, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-.01em" }}>{value}</div>
        {sub && <div style={{ fontSize: 11.5, color: theme.sub, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ========================== CLASSEMENTS =================================== */
const RANK_COLORS = ["#F59E0B", "#94A3B8", "#B45309"]; // or / argent / bronze

function buildRanking(ticketList, revendeurs) {
  const acc = {};
  let totalCA = 0;
  ticketList.forEach((t) => {
    const rid = t.revendeurId || "none";
    acc[rid] = acc[rid] || { revendeurId: rid, tickets: 0, ca: 0, heure: 0, jour: 0, semaine: 0, mois: 0, autre: 0 };
    const cat = catOfPrice(t.price);
    if (acc[rid][cat] !== undefined) acc[rid][cat] += 1;
    acc[rid].tickets += 1;
    acc[rid].ca += t.price;
    totalCA += t.price;
  });
  const rows = Object.values(acc)
    .map((r) => {
      const rev = revendeurs.find((x) => x.id === r.revendeurId);
      return { ...r, nom: rev ? rev.nom : "Non assigné", couleur: rev ? rev.couleur : "#94A3B8" };
    })
    .sort((a, b) => b.ca - a.ca)
    .map((r, i) => ({ ...r, rank: i + 1, pct: totalCA > 0 ? (r.ca / totalCA) * 100 : 0 }));
  return { rows, totalCA, totalTickets: ticketList.length };
}

function Classements({ theme, dark, tickets, revendeurs, openWeekTickets, lastClosedTicket, weeks, meta, catLabels, showToast, currentUser }) {
  const isRevendeurViewer = currentUser && currentUser.role === "revendeur";
  const myRevendeurId = currentUser && currentUser.revendeurId;
  const [tab, setTab] = useState("semaine");
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 60000); // refresh "il y a X min" every minute
    return () => window.clearInterval(id);
  }, []);

  const now = new Date();
  const withDate = useMemo(
    () => tickets.map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) })).filter((t) => t._d),
    [tickets]
  );
  const moisTickets = useMemo(
    () => withDate.filter((t) => t._d.getMonth() === now.getMonth() && t._d.getFullYear() === now.getFullYear()),
    [withDate]
  );
  const anneeTickets = useMemo(
    () => withDate.filter((t) => t._d.getFullYear() === now.getFullYear()),
    [withDate]
  );

  const dataFor = {
    semaine: { list: openWeekTickets, title: `Semaine en cours (tickets #${lastClosedTicket + 1}+)`, note: "Se met à jour à chaque import — utile pour la prime hebdomadaire." },
    mois: { list: moisTickets, title: now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), note: "Cumul de toutes les ventes du mois en cours, importées à ce jour." },
    annee: { list: anneeTickets, title: `Année ${now.getFullYear()}`, note: "Cumul de toutes les ventes de l'année en cours." },
  };
  const active = dataFor[tab];
  const ranking = useMemo(() => buildRanking(active.list, revendeurs), [active.list, revendeurs]);
  const top3 = ranking.rows.slice(0, 3);
  const rest = ranking.rows.slice(3);
  const maxCA = Math.max(1, ...ranking.rows.map((r) => r.ca));

  const myRow = myRevendeurId ? ranking.rows.find((r) => r.revendeurId === myRevendeurId) : null;
  const aboveRow = myRow && myRow.rank > 1 ? ranking.rows.find((r) => r.rank === myRow.rank - 1) : null;

  function exportRanking(withTotal) {
    const forced = isRevendeurViewer ? false : withTotal; // revendeurs can never produce a "with total" export
    const canvas = drawReportImage({
      rows: ranking.rows.map((r) => ({ ...r, nom: `${r.rank}. ${r.nom}` })),
      totalCA: ranking.totalCA, totalTickets: ranking.totalTickets,
      title: `Classement — ${active.title}`,
      subtitle: "Nombre de tickets vendus par forfait et par revendeur",
      ticketRange: meta && meta.lastImportDate ? `Mis à jour ${timeAgo(meta.lastImportDate)}` : "",
      catLabels,
      hideTotal: !forced,
    });
    exportReportImage(canvas, `diafa-classement-${tab}${forced ? "" : "-revendeurs"}.png`, `Classement ${active.title} — DIAFA WIFIZONE`,
      "Voici le classement actuel — continuez sur votre lancée ou améliorez votre position !", showToast);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 3, background: dark ? "#0F172A" : "#F1F5F9", padding: 3, borderRadius: 12, width: "fit-content" }}>
          {[["semaine", "Semaine en cours"], ["mois", "Ce mois"], ["annee", "Cette année"]].map(([id, label]) => (
            <button key={id} className="dz-btn" onClick={() => setTab(id)}
              style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, background: tab === id ? COLORS.primary : "transparent", color: tab === id ? "#fff" : theme.sub }}>
              {label}
            </button>
          ))}
        </div>
        {meta && meta.lastImportDate && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: theme.sub }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: GRAD.success, display: "inline-block" }} />
            Dernière mise à jour : {timeAgo(meta.lastImportDate)}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        {isRevendeurViewer ? (
          <button className="dz-btn" disabled={ranking.rows.length === 0} onClick={() => exportRanking(false)}
            style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "9px 14px", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 7, opacity: ranking.rows.length ? 1 : .5 }}>
            <Share2 size={13} /> Exporter / Partager
          </button>
        ) : (
          <>
            <button className="dz-btn" disabled={ranking.rows.length === 0} onClick={() => exportRanking(false)}
              title="Pour le groupe WhatsApp des revendeurs — sans le total"
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "9px 14px", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 7, opacity: ranking.rows.length ? 1 : .5 }}>
              <Share2 size={13} /> Export revendeurs
            </button>
            <button className="dz-btn" disabled={ranking.rows.length === 0} onClick={() => exportRanking(true)}
              title="Pour vous / l'agent de recouvrement — avec le total"
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "9px 14px", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 7, opacity: ranking.rows.length ? 1 : .5 }}>
              <Share2 size={13} /> Export admin (avec total)
            </button>
          </>
        )}
      </div>

      <div className="dz-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: COLORS.accent + "12", border: `1px solid ${COLORS.accent}33` }}>
        <Trophy size={17} color={COLORS.accent} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: theme.text }}>
          <b>{active.title}</b> — {active.note}
        </div>
      </div>

      {myRow && (
        <div className="dz-card" style={{ padding: 18, background: `linear-gradient(135deg, ${COLORS.primary}10, ${COLORS.secondary}10)`, border: `1.5px solid ${COLORS.primary}44` }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: COLORS.primary, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Award size={14} /> MA POSITION
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{
              width: 48, height: 48, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center",
              background: (myRow.rank <= 3 ? RANK_COLORS[myRow.rank - 1] : COLORS.primary) + "22",
              color: myRow.rank <= 3 ? RANK_COLORS[myRow.rank - 1] : COLORS.primary, fontWeight: 800, fontSize: 20, flexShrink: 0,
              border: `2px solid ${myRow.rank <= 3 ? RANK_COLORS[myRow.rank - 1] : COLORS.primary}`,
            }}>{myRow.rank}</div>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{myRow.nom}</div>
              <div style={{ fontSize: 12, color: theme.sub }}>{fmtInt(myRow.tickets)} tickets vendus · {myRow.pct.toFixed(1)}% de votre part sur cette période</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.primary }}>{GNF(myRow.ca)}</div>
              <div style={{ fontSize: 11, color: theme.sub }}>vos ventes</div>
            </div>
          </div>
          {aboveRow && (
            <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 11, background: dark ? "#0F172A" : "#fff", fontSize: 12, color: theme.text, display: "flex", alignItems: "center", gap: 7 }}>
              <TrendingUp size={14} color={COLORS.accent} />
              Il vous manque <b style={{ margin: "0 4px" }}>{GNF(aboveRow.ca - myRow.ca)}</b> pour dépasser <b>{aboveRow.nom}</b> (rang {aboveRow.rank}) !
            </div>
          )}
          {!aboveRow && myRow.rank === 1 && (
            <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 11, background: dark ? "#0F172A" : "#fff", fontSize: 12, color: COLORS.secondary, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
              <Trophy size={14} /> Vous êtes en tête ! Continuez comme ça.
            </div>
          )}
        </div>
      )}

      {ranking.rows.length === 0 ? (
        <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
          Aucune vente enregistrée sur cette période pour le moment.
        </div>
      ) : (
        <>
          {/* Podium top 3 */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {top3.map((r) => (
              <div key={r.revendeurId} className="dz-card" style={{
                flex: "1 1 220px", padding: 18, textAlign: "center", position: "relative",
                border: r.revendeurId === myRevendeurId ? `2px solid ${COLORS.primary}` : `1.5px solid ${RANK_COLORS[r.rank - 1]}55`,
                boxShadow: r.revendeurId === myRevendeurId ? `0 0 0 3px ${COLORS.primary}18` : "none",
              }}>
                {r.revendeurId === myRevendeurId && (
                  <span style={{ position: "absolute", top: 8, right: 8, fontSize: 9.5, fontWeight: 800, color: COLORS.primary, background: COLORS.primary + "18", padding: "2px 7px", borderRadius: 99 }}>VOUS</span>
                )}
                <div style={{
                  width: 44, height: 44, borderRadius: 99, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center",
                  background: RANK_COLORS[r.rank - 1] + "22", color: RANK_COLORS[r.rank - 1], fontWeight: 800, fontSize: 18, border: `2px solid ${RANK_COLORS[r.rank - 1]}`,
                }}>
                  {r.rank}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: r.couleur }} />
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.nom}</div>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: RANK_COLORS[r.rank - 1] }}>{GNF(r.ca)}</div>
                <div style={{ fontSize: 11.5, color: theme.sub, marginTop: 3 }}>{fmtInt(r.tickets)} tickets · {r.pct.toFixed(1)}% des ventes</div>
              </div>
            ))}
          </div>

          {/* Full ranking */}
          <div className="dz-card" style={{ padding: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 14 }}>Classement complet — {active.title}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ranking.rows.map((r) => (
                <div key={r.revendeurId} style={r.revendeurId === myRevendeurId ? { background: COLORS.primary + "0c", borderRadius: 12, padding: "6px 8px", margin: "-6px -8px" } : undefined}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, flexShrink: 0,
                      background: r.rank <= 3 ? RANK_COLORS[r.rank - 1] + "22" : (dark ? "#334155" : "#F1F5F9"),
                      color: r.rank <= 3 ? RANK_COLORS[r.rank - 1] : theme.sub,
                    }}>{r.rank}</span>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: r.couleur, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nom}{r.revendeurId === myRevendeurId ? " (vous)" : ""}</span>
                    <span style={{ fontSize: 11.5, color: theme.sub, whiteSpace: "nowrap" }}>{fmtInt(r.tickets)} tickets</span>
                    <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", minWidth: 90, textAlign: "right" }}>{GNF(r.ca)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: dark ? "#334155" : "#EEF2FF", marginLeft: 32 }}>
                    <div style={{ height: 6, borderRadius: 99, width: `${(r.ca / maxCA) * 100}%`, background: r.rank <= 3 ? RANK_COLORS[r.rank - 1] : COLORS.primary }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail per category — where each reseller is strong/weak */}
          <div className="dz-card" style={{ padding: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 4 }}>Détail par forfait vendu — {active.title}</div>
            <div style={{ fontSize: 11.5, color: theme.sub, marginBottom: 14 }}>
              Chaque revendeur peut voir où il vend bien et où il doit progresser.
            </div>
            <WeekTable
              rows={ranking.rows.map((r) => ({ ...r, nom: `${r.rank}. ${r.nom}` }))}
              theme={theme}
              catLabels={catLabels}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ========================== STATISTIQUES =================================== */
const JOUR_LABEL = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function Statistiques({ theme, dark, tickets, revendeurs, catLabels, settings }) {
  const withDate = useMemo(
    () => tickets.map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) })).filter((t) => t._d),
    [tickets]
  );
  const now = new Date();
  const commission = (settings && settings.commissionParTicket) || 1000;

  const sumCA = (list) => list.reduce((s, t) => s + t.price, 0);

  const thisMonth = withDate.filter((t) => t._d.getMonth() === now.getMonth() && t._d.getFullYear() === now.getFullYear());
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = withDate.filter((t) => t._d.getMonth() === lastMonthDate.getMonth() && t._d.getFullYear() === lastMonthDate.getFullYear());
  const thisYear = withDate.filter((t) => t._d.getFullYear() === now.getFullYear());
  const lastYear = withDate.filter((t) => t._d.getFullYear() === now.getFullYear() - 1);

  const growth = (curr, prev) => (sumCA(prev) > 0 ? ((sumCA(curr) - sumCA(prev)) / sumCA(prev)) * 100 : null);
  const growthMonth = growth(thisMonth, lastMonth);
  const growthYear = growth(thisYear, lastYear);

  const byHour = useMemo(() => {
    const acc = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, "0") + "h", ca: 0, tickets: 0 }));
    withDate.forEach((t) => { acc[t._d.getHours()].ca += t.price; acc[t._d.getHours()].tickets += 1; });
    return acc;
  }, [withDate]);

  const byWeekday = useMemo(() => {
    const acc = Array.from({ length: 7 }, (_, i) => ({ label: JOUR_LABEL[i], ca: 0, tickets: 0 }));
    withDate.forEach((t) => { const idx = (t._d.getDay() + 6) % 7; acc[idx].ca += t.price; acc[idx].tickets += 1; });
    return acc;
  }, [withDate]);

  const [repartPeriod, setRepartPeriod] = useState("mois");
  const repartSource = repartPeriod === "mois" ? thisMonth : repartPeriod === "annee" ? thisYear : withDate;
  const byRevendeur = useMemo(() => {
    const acc = {};
    repartSource.forEach((t) => {
      const rid = t.revendeurId || "none";
      acc[rid] = acc[rid] || { ca: 0, tickets: 0 };
      acc[rid].ca += t.price; acc[rid].tickets += 1;
    });
    const total = Object.values(acc).reduce((s, v) => s + v.ca, 0);
    return Object.entries(acc)
      .map(([rid, v]) => ({ nom: revendeurs.find((r) => r.id === rid)?.nom || "Non assigné", couleur: revendeurs.find((r) => r.id === rid)?.couleur || "#94A3B8", ...v, commission: v.tickets * commission, pct: total ? (v.ca / total) * 100 : 0 }))
      .sort((a, b) => b.ca - a.ca);
  }, [repartSource, revendeurs, commission]);

  const byProfil = useMemo(() => {
    const acc = {};
    repartSource.forEach((t) => { const c = catOfPrice(t.price); acc[c] = acc[c] || { ca: 0, tickets: 0 }; acc[c].ca += t.price; acc[c].tickets += 1; });
    const total = Object.values(acc).reduce((s, v) => s + v.ca, 0);
    return Object.entries(acc).map(([k, v]) => ({ name: (catLabels && catLabels[k]) || CAT_LABEL[k] || k, ...v, pct: total ? (v.ca / total) * 100 : 0 })).sort((a, b) => b.ca - a.ca);
  }, [repartSource]);

  const PIE_COLORS = [COLORS.primary, COLORS.secondary, COLORS.accent, "#8B5CF6", COLORS.danger, "#64748B"];

  // Comparaison entre deux périodes (mois)
  const monthOptions = useMemo(() => {
    const acc = {};
    withDate.forEach((t) => {
      const key = `${t._d.getFullYear()}-${String(t._d.getMonth() + 1).padStart(2, "0")}`;
      acc[key] = acc[key] || { key, year: t._d.getFullYear(), month: t._d.getMonth() };
    });
    return Object.values(acc).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [withDate]);
  const [cmpA, setCmpA] = useState(monthOptions[1]?.key || monthOptions[0]?.key || "");
  const [cmpB, setCmpB] = useState(monthOptions[0]?.key || "");
  const dataForKey = (key) => withDate.filter((t) => `${t._d.getFullYear()}-${String(t._d.getMonth() + 1).padStart(2, "0")}` === key);
  const cmpAList = dataForKey(cmpA), cmpBList = dataForKey(cmpB);
  const cmpDelta = sumCA(cmpAList) > 0 ? ((sumCA(cmpBList) - sumCA(cmpAList)) / sumCA(cmpAList)) * 100 : null;
  const labelForKey = (key) => { const m = monthOptions.find((m) => m.key === key); return m ? `${MOIS_LABEL[m.month]} ${m.year}` : key; };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard theme={theme} icon={TrendingUp} color={COLORS.primary} label="CA ce mois" value={GNF(sumCA(thisMonth))}
          sub={growthMonth !== null ? `${growthMonth >= 0 ? "+" : ""}${growthMonth.toFixed(1)}% vs mois dernier` : "Pas de données mois dernier"} subGood={growthMonth !== null && growthMonth >= 0} />
        <KpiCard theme={theme} icon={BarChart3} color={COLORS.secondary} label="CA cette année" value={GNF(sumCA(thisYear))}
          sub={growthYear !== null ? `${growthYear >= 0 ? "+" : ""}${growthYear.toFixed(1)}% vs année dernière` : "Pas de données année dernière"} subGood={growthYear !== null && growthYear >= 0} />
        <KpiCard theme={theme} icon={Ticket} color={COLORS.accent} label="Tickets (tout historique)" value={fmtInt(tickets.length)} />
        <KpiCard theme={theme} icon={Users} color="#8B5CF6" label="Revendeurs avec ventes" value={fmtInt(byRevendeur.length)} />
        <KpiCard theme={theme} icon={Wallet} color={COLORS.secondary} label="Commissions ce mois" value={GNF(thisMonth.length * commission)}
          sub={`${GNF(commission)} par ticket · ${fmtInt(thisMonth.length)} tickets`} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="dz-card" style={{ flex: "1 1 380px", padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Ventes par heure de la journée</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={byHour}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: theme.sub }} axisLine={false} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => (v >= 1000 ? v / 1000 + "k" : v)} />
              <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 12 }} />
              <Bar dataKey="ca" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="dz-card" style={{ flex: "1 1 300px", padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Ventes par jour de la semaine</div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={byWeekday}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => (v >= 1000 ? v / 1000 + "k" : v)} />
              <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 12 }} />
              <Bar dataKey="ca" fill={COLORS.secondary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>Répartition des ventes</div>
          <div style={{ display: "flex", gap: 3, background: dark ? "#0F172A" : "#F1F5F9", padding: 3, borderRadius: 11 }}>
            {[["semaine", "Global"], ["mois", "Ce mois"], ["annee", "Cette année"]].map(([id, label]) => (
              <button key={id} className="dz-btn" onClick={() => setRepartPeriod(id)}
                style={{ padding: "6px 11px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, background: repartPeriod === id ? COLORS.primary : "transparent", color: repartPeriod === id ? "#fff" : theme.sub }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.sub }}>Commission par revendeur</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: COLORS.secondary }}>{GNF(repartSource.length * commission)}</span>
            </div>
            {byRevendeur.length === 0 && <div style={{ fontSize: 12.5, color: theme.sub }}>Aucune donnée.</div>}
            {byRevendeur.slice(0, 8).map((r, i) => (
              <div key={i} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: r.couleur }} />{r.nom}</span>
                  <span style={{ fontWeight: 700 }}>{GNF(r.commission)} <span style={{ color: theme.sub, fontWeight: 500, fontSize: 11 }}>· {r.pct.toFixed(1)}%</span></span>
                </div>
                <div style={{ height: 5, borderRadius: 99, background: dark ? "#334155" : "#EEF2FF" }}>
                  <div style={{ height: 5, borderRadius: 99, width: `${r.pct}%`, background: r.couleur }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.sub, marginBottom: 10 }}>Par profil</div>
            {byProfil.length === 0 ? <div style={{ fontSize: 12.5, color: theme.sub }}>Aucune donnée.</div> : (() => {
              const totProfil = byProfil.reduce((s, c) => s + c.ca, 0) || 1;
              return (
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ position: "relative", width: 150, height: 150, flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={byProfil} dataKey="ca" nameKey="name" innerRadius={45} outerRadius={68} paddingAngle={2}>
                          {byProfil.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                      <div style={{ fontSize: 9.5, color: theme.sub }}>Total</div>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{GNF(totProfil)}</div>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    {byProfil.map((c, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 11.5, marginBottom: 8 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}><span style={{ width: 9, height: 9, borderRadius: 99, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} /><span style={{ fontWeight: 600 }}>{c.name}</span></span>
                        <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{GNF(c.ca)} <span style={{ color: theme.sub, fontWeight: 500 }}>· {((c.ca / totProfil) * 100).toFixed(0)}%</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Comparaison entre deux périodes</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <select className="dz-input" style={{ width: 180 }} value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
            {monthOptions.map((m) => <option key={m.key} value={m.key}>{MOIS_LABEL[m.month]} {m.year}</option>)}
          </select>
          <div style={{ display: "flex", alignItems: "center", color: theme.sub, fontSize: 12 }}>vs</div>
          <select className="dz-input" style={{ width: 180 }} value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
            {monthOptions.map((m) => <option key={m.key} value={m.key}>{MOIS_LABEL[m.month]} {m.year}</option>)}
          </select>
        </div>
        {monthOptions.length < 1 ? (
          <div style={{ fontSize: 12.5, color: theme.sub }}>Importez des ventes sur au moins deux mois pour comparer.</div>
        ) : (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontSize: 11.5, color: theme.sub, fontWeight: 600 }}>{labelForKey(cmpA)}</div>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{GNF(sumCA(cmpAList))}</div>
              <div style={{ fontSize: 11.5, color: theme.sub }}>{fmtInt(cmpAList.length)} tickets</div>
            </div>
            <div style={{ fontSize: 20, color: theme.sub }}>→</div>
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontSize: 11.5, color: theme.sub, fontWeight: 600 }}>{labelForKey(cmpB)}</div>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{GNF(sumCA(cmpBList))}</div>
              <div style={{ fontSize: 11.5, color: theme.sub }}>{fmtInt(cmpBList.length)} tickets</div>
            </div>
            {cmpDelta !== null && (
              <div style={{
                padding: "8px 14px", borderRadius: 12, fontWeight: 800, fontSize: 14,
                background: (cmpDelta >= 0 ? COLORS.secondary : COLORS.danger) + "18",
                color: cmpDelta >= 0 ? COLORS.secondary : COLORS.danger,
              }}>
                {cmpDelta >= 0 ? "+" : ""}{cmpDelta.toFixed(1)}%
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================== SAUVEGARDE ==================================== */
function activityType(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("import")) return { label: "Import", color: COLORS.primary };
  if (t.includes("revendeur")) return { label: "Revendeurs", color: COLORS.secondary };
  if (t.includes("tarif")) return { label: "Tarifs", color: COLORS.accent };
  if (t.includes("semaine") || t.includes("rapport")) return { label: "Rapport", color: "#8B5CF6" };
  if (t.includes("réinitialis") || t.includes("supprim") || t.includes("restaur") || t.includes("sauvegard")) return { label: "Système", color: COLORS.danger };
  return { label: "Autre", color: "#64748B" };
}

function Sauvegarde({ theme, dark, showToast, addActivity, revendeurs, setRevendeurs, tarifs, setTarifs, catLabels, setCatLabels, tickets, setTickets, weeks, setWeeks, meta, setMeta, activities, setActivities, equipements, setEquipements, canManage }) {
  const [lastBackup, setLastBackup] = useState(null);
  const [confirmRestore, setConfirmRestore] = useState(null); // parsed backup object, pending confirmation
  const fileRef = useRef(null);

  useEffect(() => { loadKey("diafa:lastBackupDate", null).then(setLastBackup); }, []);

  const dataSizeKB = useMemo(() => {
    try {
      const blob = JSON.stringify({ revendeurs, tarifs, catLabels, tickets, weeks, meta, activities });
      return Math.round(new Blob([blob]).size / 1024);
    } catch { return 0; }
  }, [revendeurs, tarifs, catLabels, tickets, weeks, meta, activities]);

  function downloadBackup() {
    const payload = {
      app: "DIAFA WIFIZONE PRO", version: 1, exportedAt: new Date().toISOString(),
      revendeurs, tarifs, catLabels, tickets, weeks, meta, activities, equipements,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url; a.download = `diafa-sauvegarde-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    const now = Date.now();
    setLastBackup(now);
    saveKey("diafa:lastBackupDate", now);
    addActivity("Sauvegarde téléchargée", `${fmtInt(tickets.length)} tickets, ${fmtInt(revendeurs.length)} revendeurs`);
    showToast("Sauvegarde téléchargée");
  }

  function handleBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== "DIAFA WIFIZONE PRO" || !Array.isArray(data.tickets)) {
          throw new Error("Ce fichier ne ressemble pas à une sauvegarde DIAFA WIFIZONE PRO valide.");
        }
        setConfirmRestore(data);
      } catch (e) {
        showToast(e.message || "Fichier de sauvegarde illisible", "error");
      }
    };
    reader.onerror = () => showToast("Impossible de lire le fichier", "error");
    reader.readAsText(file);
  }

  function applyRestore() {
    const d = confirmRestore;
    setRevendeurs(d.revendeurs || []);
    setTarifs(d.tarifs || DEFAULT_TARIFS);
    setCatLabels({ ...DEFAULT_CAT_LABELS, ...(d.catLabels || {}) });
    setTickets(d.tickets || []);
    setWeeks(d.weeks || []);
    setMeta(d.meta || { lastImportFile: null, lastImportDate: null, lastImportCount: 0 });
    setActivities(d.activities || []);
    setEquipements(d.equipements || []);
    addActivity("Sauvegarde restaurée", d.exportedAt ? new Date(d.exportedAt).toLocaleString("fr-FR") : "");
    showToast("Sauvegarde restaurée avec succès");
    setConfirmRestore(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard theme={theme} icon={ShieldCheck} color={COLORS.secondary} label="Dernière sauvegarde" value={lastBackup ? timeAgo(lastBackup) : "Aucune"} />
        <KpiCard theme={theme} icon={Database} color={COLORS.primary} label="Taille des données" value={`${fmtInt(dataSizeKB)} Ko`} />
        <KpiCard theme={theme} icon={Ticket} color={COLORS.accent} label="Tickets enregistrés" value={fmtInt(tickets.length)} />
      </div>

      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 4 }}>Sauvegarde manuelle</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 16 }}>
          Télécharge un fichier contenant toutes vos données (revendeurs, tarifs, tickets, rapports, historique) — à garder de côté pour pouvoir tout restaurer en cas de problème sur cet appareil.
        </div>
        <button className="dz-btn" onClick={downloadBackup}
          style={{ background: GRAD.primary, color: "#fff", padding: "10px 18px", borderRadius: 11, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <Download size={15} /> Télécharger une sauvegarde
        </button>
      </div>

      {canManage ? (
        <div className="dz-card" style={{ padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 4 }}>Restauration</div>
          <div style={{ fontSize: 12, color: theme.sub, marginBottom: 16 }}>
            Restaure toutes les données depuis un fichier de sauvegarde précédemment téléchargé. <b>Remplace entièrement</b> les données actuelles de cet appareil.
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
            onChange={(e) => e.target.files[0] && handleBackupFile(e.target.files[0])} />
          <button className="dz-btn" onClick={() => fileRef.current.click()}
            style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "10px 18px", borderRadius: 11, fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            <UploadCloud size={15} /> Choisir un fichier de sauvegarde
          </button>
        </div>
      ) : (
        <div className="dz-card" style={{ padding: 18, fontSize: 12, color: theme.sub }}>
          La restauration de sauvegarde est réservée aux administrateurs.
        </div>
      )}

      <div className="dz-card" style={{ padding: 18, background: dark ? "#0F172A" : "#F8FAFC" }}>
        <div style={{ fontSize: 12, color: theme.sub, lineHeight: 1.6 }}>
          💡 Vos données vivent uniquement dans ce navigateur (stockage local). Elles ne sont <b>pas</b> automatiquement sauvegardées ailleurs — pensez à télécharger une sauvegarde régulièrement, surtout avant de changer d'ordinateur ou de vider le cache du navigateur.
        </div>
      </div>

      {confirmRestore && (
        <Modal theme={theme} onClose={() => setConfirmRestore(null)} title="Restaurer cette sauvegarde ?">
          <div style={{ fontSize: 13, color: theme.sub, marginBottom: 14, lineHeight: 1.6 }}>
            Cette sauvegarde date du <b>{confirmRestore.exportedAt ? new Date(confirmRestore.exportedAt).toLocaleString("fr-FR") : "—"}</b> et contient :
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <MiniStat label="Tickets" value={(confirmRestore.tickets || []).length} theme={theme} />
            <MiniStat label="Revendeurs" value={(confirmRestore.revendeurs || []).length} theme={theme} />
            <MiniStat label="Semaines clôturées" value={(confirmRestore.weeks || []).length} theme={theme} />
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.danger, marginBottom: 16 }}>
            ⚠ Toutes les données actuelles de cet appareil seront remplacées. Cette action est irréversible.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="dz-btn" onClick={() => setConfirmRestore(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={applyRestore} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Oui, restaurer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ========================== JOURNAL ==================================== */
function Journal({ theme, dark, activities }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("Tous");
  const [period, setPeriod] = useState("tout");

  const withType = useMemo(() => activities.map((a) => ({ ...a, ...activityType(a.text) })), [activities]);
  const types = ["Tous", ...Array.from(new Set(withType.map((a) => a.label)))];

  const now = Date.now();
  const periodMs = { "24h": 86400000, "7j": 7 * 86400000, "30j": 30 * 86400000, tout: Infinity };

  const filtered = withType.filter((a) => {
    if (typeFilter !== "Tous" && a.label !== typeFilter) return false;
    if (now - a.time > periodMs[period]) return false;
    if (search && !(a.text + " " + (a.sub || "")).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 280 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 10.5 }} color={theme.sub} />
          <input className="dz-input" style={{ paddingLeft: 32 }} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="dz-input" style={{ width: 160 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="dz-input" style={{ width: 150 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="24h">Dernières 24h</option>
          <option value="7j">7 derniers jours</option>
          <option value="30j">30 derniers jours</option>
          <option value="tout">Tout l'historique</option>
        </select>
      </div>

      <div className="dz-card" style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>Aucune activité trouvée pour ces filtres.</div>
        ) : (
          <div>
            {filtered.map((a, i) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: i < filtered.length - 1 ? `1px solid ${theme.border}` : "none" }}>
                <span style={{ padding: "3px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 800, background: a.color + "18", color: a.color, flexShrink: 0, whiteSpace: "nowrap" }}>{a.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.text}</div>
                  {a.sub && <div style={{ fontSize: 11.5, color: theme.sub }}>{a.sub}</div>}
                </div>
                <div style={{ fontSize: 11, color: theme.sub, whiteSpace: "nowrap", textAlign: "right", flexShrink: 0 }}>
                  <div>{new Date(a.time).toLocaleDateString("fr-FR")}</div>
                  <div>{new Date(a.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: theme.sub }}>{fmtInt(filtered.length)} action(s) affichée(s) sur {fmtInt(activities.length)} enregistrée(s) (limite : 500 dernières).</div>
    </div>
  );
}

/* ========================== MES TICKETS ==================================== */
function TicketsList({ theme, dark, tickets, revendeurs, catLabels, showToast, currentUser, annulations, setAnnulations, notify, lastClosedTicket, addActivity, setTickets, canManage }) {
  const isRevendeurViewer = currentUser && currentUser.role === "revendeur";
  const L = { ...CAT_LABEL, ...(catLabels || {}) };

  const [annulTicket, setAnnulTicket] = useState(null);
  const [annulMotif, setAnnulMotif] = useState("erreur");
  const [annulNote, setAnnulNote] = useState("");
  const [editTicket, setEditTicket] = useState(null);
  const pendingAnnulIds = useMemo(
    () => new Set((annulations || []).filter((a) => a.statut === "En attente").map((a) => a.ticketGlobalId)),
    [annulations]
  );

  function submitAnnulation() {
    const t = annulTicket;
    if (!t) return;
    if (t.globalId <= lastClosedTicket) { showToast("Ce ticket est déjà clôturé — annulation impossible.", "error"); setAnnulTicket(null); return; }
    if (pendingAnnulIds.has(t.globalId)) { showToast("Une demande d'annulation est déjà en attente pour ce ticket.", "error"); setAnnulTicket(null); return; }
    const entry = {
      id: uid(), ticketGlobalId: t.globalId, ticketNum: t.num, username: t.username, date: t.date, time: t.time, price: t.price, profile: t.profile,
      revendeurId: t.revendeurId || null, motif: annulMotif, commentaire: annulNote.trim(),
      creePar: currentUser.nom, creeParId: currentUser.id, statut: "En attente", creeLe: Date.now(),
      valideePar: null, dateValidation: null, motifRejet: null,
    };
    setAnnulations((prev) => [...prev, entry]);
    notify && notify({ type: "annulation", event: "nouvelle", audience: "validateurs", title: "Demande d'annulation de ticket", message: `${currentUser.nom} — ticket №${t.num} (${GNF(t.price)}) · ${annulMotif === "vol" ? "vol" : annulMotif === "erreur" ? "erreur de saisie" : "autre"}` });
    addActivity && addActivity("Demande d'annulation", `№${t.num} — ${GNF(t.price)}`);
    showToast("Demande d'annulation envoyée");
    setAnnulTicket(null); setAnnulNote(""); setAnnulMotif("erreur");
  }

  function saveTicketEdit() {
    const t = editTicket;
    if (!t) return;
    if (t.globalId <= lastClosedTicket) { showToast("Ce ticket appartient à une semaine clôturée — modification impossible.", "error"); setEditTicket(null); return; }
    const price = parseInt(t.price, 10) || 0;
    setTickets && setTickets((prev) => prev.map((x) => x.globalId === t.globalId
      ? { ...x, username: (t.username || "").trim(), profile: (t.profile || "").trim(), revendeurId: t.revendeurId || null, price }
      : x));
    addActivity && addActivity("Ticket modifié", `№${t.num} — ${GNF(price)}`);
    showToast("Ticket mis à jour");
    setEditTicket(null);
  }

  const [checkNum, setCheckNum] = useState("");

  const [revFilter, setRevFilter] = useState(isRevendeurViewer ? (currentUser.revendeurId || "") : "tous");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("tout");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [bulkRev, setBulkRev] = useState("");
  const [confirmDeleteUnassigned, setConfirmDeleteUnassigned] = useState(false);

  // A revendeur account is locked to its own linked reseller — never shows anyone else's tickets.
  if (isRevendeurViewer && !currentUser.revendeurId) {
    return (
      <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
        Votre compte n'est pas encore lié à une fiche revendeur — demandez à un administrateur de faire ce lien dans <b>Utilisateurs</b> pour voir vos tickets ici.
      </div>
    );
  }

  const withDate = useMemo(
    () => tickets.map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) })),
    [tickets]
  );

  const now = Date.now();
  const periodMs = { "24h": 86400000, "7j": 7 * 86400000, "30j": 30 * 86400000, tout: Infinity };

  const scoped = isRevendeurViewer ? withDate.filter((t) => t.revendeurId === currentUser.revendeurId) : withDate;

  const checkResult = useMemo(() => {
    const n = checkNum.trim();
    if (!n) return null;
    const found = scoped.find((t) => String(t.num) === n);
    return { found, num: n };
  }, [checkNum, scoped]);

  const filtered = useMemo(() => {
    return scoped
      .filter((t) => revFilter === "tous" || t.revendeurId === revFilter || (revFilter === "none" && !t.revendeurId))
      .filter((t) => !t._d || now - t._d.getTime() <= periodMs[period])
      .filter((t) => !search || (t.username + " " + t.profile + " " + (t.comment || "")).toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b._d && a._d ? b._d - a._d : b.globalId - a.globalId));
  }, [scoped, revFilter, period, search]);

  const totalCA = filtered.reduce((s, t) => s + t.price, 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [revFilter, search, period]);

  // Unassigned tickets of the CURRENT (open) week — the only ones we can safely re-assign or delete.
  const unassignedOpen = useMemo(() => filtered.filter((t) => !t.revendeurId && t.globalId > lastClosedTicket), [filtered, lastClosedTicket]);
  function bulkAssign() {
    if (!bulkRev) { showToast("Choisissez un revendeur", "error"); return; }
    const ids = new Set(unassignedOpen.map((t) => t.globalId));
    if (ids.size === 0) { showToast("Aucun ticket non assigné (semaine en cours).", "error"); return; }
    setTickets && setTickets((prev) => prev.map((t) => ids.has(t.globalId) ? { ...t, revendeurId: bulkRev } : t));
    addActivity && addActivity("Tickets attribués", `${fmtInt(ids.size)} tickets → ${revendeurs.find((r) => r.id === bulkRev)?.nom || ""}`);
    showToast(`${fmtInt(ids.size)} ticket(s) attribué(s).`);
    setBulkRev("");
  }
  function bulkDeleteUnassigned() {
    const ids = new Set(unassignedOpen.map((t) => t.globalId));
    setConfirmDeleteUnassigned(false);
    if (ids.size === 0) return;
    setTickets && setTickets((prev) => prev.filter((t) => !ids.has(t.globalId)));
    addActivity && addActivity("Tickets non assignés supprimés", `${fmtInt(ids.size)} tickets`);
    showToast(`${fmtInt(ids.size)} ticket(s) supprimé(s).`);
  }

  function exportCSV() {
    const rows = filtered.map((t) => ({
      "№": t.num, Date: t.date, Heure: t.time, Username: t.username,
      Profil: L[catOfPrice(t.price)] || t.profile, Revendeur: revendeurs.find((r) => r.id === t.revendeurId)?.nom || "Non assigné",
      "Prix (GNF)": t.price,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `diafa-tickets-${isRevendeurViewer ? "mes-ventes" : "toutes-ventes"}-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`${fmtInt(filtered.length)} tickets exportés en CSV`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard theme={theme} icon={Ticket} color={COLORS.primary} label={isRevendeurViewer ? "Mes tickets" : "Tickets (filtre actuel)"} value={fmtInt(filtered.length)} />
        <KpiCard theme={theme} icon={TrendingUp} color={COLORS.secondary} label={isRevendeurViewer ? "Mes ventes" : "CA (filtre actuel)"} value={GNF(totalCA)} />
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 4 }}>Vérifier un ticket</div>
        <div style={{ fontSize: 11.5, color: theme.sub, marginBottom: 12 }}>Tapez un numéro de ticket (№) pour savoir immédiatement s'il a été vendu.</div>
        <div style={{ position: "relative", maxWidth: 280 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 10.5 }} color={theme.sub} />
          <input className="dz-input" style={{ paddingLeft: 32 }} placeholder="Ex. 1021" value={checkNum}
            onChange={(e) => setCheckNum(e.target.value.replace(/[^0-9]/g, ""))} />
        </div>
        {checkResult && (
          checkResult.found ? (
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: COLORS.secondary + "12", border: `1px solid ${COLORS.secondary}44`, display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle2 size={17} color={COLORS.secondary} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: 12.5 }}>
                <b>Ticket №{checkResult.num} — VENDU</b>
                <div style={{ color: theme.sub, marginTop: 2 }}>
                  {checkResult.found.date} à {checkResult.found.time} · {checkResult.found.username} · {L[catOfPrice(checkResult.found.price)] || checkResult.found.profile}
                  {!isRevendeurViewer && <> · {revendeurs.find((r) => r.id === checkResult.found.revendeurId)?.nom || "Non assigné"}</>}
                  {" "}· <b>{GNF(checkResult.found.price)}</b>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: COLORS.danger + "12", border: `1px solid ${COLORS.danger}44`, display: "flex", alignItems: "center", gap: 10 }}>
              <AlertTriangle size={17} color={COLORS.danger} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: 12.5 }}>
                <b>Ticket №{checkResult.num} — NON VENDU</b>
                <div style={{ color: theme.sub, marginTop: 2 }}>Introuvable parmi {isRevendeurViewer ? "vos" : "les"} tickets importés{isRevendeurViewer ? "" : " — vérifiez aussi le filtre revendeur ci-dessous s'il est actif"}.</div>
              </div>
            </div>
          )
        )}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 260 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 10.5 }} color={theme.sub} />
          <input className="dz-input" style={{ paddingLeft: 32 }} placeholder="Rechercher (username, profil…)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {!isRevendeurViewer && (
          <select className="dz-input" style={{ width: 200 }} value={revFilter} onChange={(e) => setRevFilter(e.target.value)}>
            <option value="tous">Tous les revendeurs</option>
            {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
            <option value="none">Non assigné</option>
          </select>
        )}
        <select className="dz-input" style={{ width: 150 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="24h">Dernières 24h</option>
          <option value="7j">7 derniers jours</option>
          <option value="30j">30 derniers jours</option>
          <option value="tout">Tout l'historique</option>
        </select>
        <button className="dz-btn" disabled={filtered.length === 0} onClick={exportCSV}
          style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "9px 14px", borderRadius: 11, fontWeight: 700, fontSize: 12.5, display: "flex", alignItems: "center", gap: 7, opacity: filtered.length ? 1 : .5, marginLeft: "auto" }}>
          <Download size={13} /> Exporter en CSV
        </button>
      </div>

      {revFilter === "none" && canManage && !isRevendeurViewer && unassignedOpen.length > 0 && (
        <div className="dz-card" style={{ padding: 14, marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: COLORS.accent + "0e", border: `1px solid ${COLORS.accent}44` }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{fmtInt(unassignedOpen.length)} ticket(s) non assigné(s) — semaine en cours :</span>
          <select className="dz-input" style={{ maxWidth: 190 }} value={bulkRev} onChange={(e) => setBulkRev(e.target.value)}>
            <option value="">— Choisir un revendeur —</option>
            {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
          </select>
          <button className="dz-btn" onClick={bulkAssign} style={{ background: GRAD.primary, color: "#fff", padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700 }}>Attribuer tout</button>
          <button className="dz-btn" onClick={() => setConfirmDeleteUnassigned(true)} style={{ background: "transparent", border: `1px solid ${COLORS.danger}66`, color: COLORS.danger, padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700 }}>Supprimer les non assignés</button>
          <span style={{ fontSize: 10.5, color: theme.sub, width: "100%" }}>Ne concerne que les tickets non assignés de la semaine en cours (les semaines clôturées ne sont jamais touchées).</span>
        </div>
      )}

      <div className="dz-card" style={{ overflowX: "auto" }}>
        {pageRows.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>Aucun ticket trouvé pour ces filtres.</div>
        ) : (
          <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr>
                <th>#</th><th>Date</th><th>Heure</th><th>Username</th><th>Profil</th>
                {!isRevendeurViewer && <th>Revendeur</th>}
                <th style={{ textAlign: "right" }}>Prix</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.globalId}>
                  <td style={{ fontWeight: 700 }}>№{t.num}</td>
                  <td>{t.date}</td>
                  <td style={{ color: theme.sub }}>{t.time}</td>
                  <td style={{ fontWeight: 600 }}>{t.username}</td>
                  <td>{L[catOfPrice(t.price)] || t.profile}</td>
                  {!isRevendeurViewer && <td style={{ color: theme.sub }}>{revendeurs.find((r) => r.id === t.revendeurId)?.nom || "Non assigné"}</td>}
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{GNF(t.price)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canManage && !isRevendeurViewer && t.globalId > lastClosedTicket && (
                      <button className="dz-btn" title="Modifier ce ticket" onClick={() => setEditTicket({ ...t })} style={{ background: "transparent", color: theme.sub, padding: "3px 7px", border: `1px solid ${theme.border}`, borderRadius: 9, marginRight: 6 }}><Pencil size={12} /></button>
                    )}
                    {pendingAnnulIds.has(t.globalId)
                      ? <span style={{ fontSize: 10.5, color: COLORS.accent, fontWeight: 700 }}>Annulation en attente</span>
                      : (t.globalId > lastClosedTicket
                        ? <button className="dz-btn" onClick={() => { setAnnulTicket(t); setAnnulMotif("erreur"); setAnnulNote(""); }} style={{ background: "transparent", color: COLORS.danger, padding: "3px 8px", fontSize: 11, fontWeight: 700, border: `1px solid ${COLORS.danger}44`, borderRadius: 9 }}>Annuler</button>
                        : null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <button className="dz-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            style={{ background: dark ? "#1E293B" : "#fff", border: `1px solid ${theme.border}`, color: theme.text, padding: "7px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, opacity: page <= 1 ? .5 : 1 }}>
            ← Précédent
          </button>
          <span style={{ fontSize: 12.5, color: theme.sub }}>Page {page} / {totalPages}</span>
          <button className="dz-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
            style={{ background: dark ? "#1E293B" : "#fff", border: `1px solid ${theme.border}`, color: theme.text, padding: "7px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, opacity: page >= totalPages ? .5 : 1 }}>
            Suivant →
          </button>
        </div>
      )}

      {annulTicket && (
        <Modal theme={theme} onClose={() => setAnnulTicket(null)} title="Demander l'annulation d'un ticket">
          <div style={{ fontSize: 12.5, color: theme.sub, marginBottom: 12 }}>
            Ticket <b>№{annulTicket.num}</b> · {annulTicket.username} · {annulTicket.date} · <b>{GNF(annulTicket.price)}</b>.
            La demande part aux responsables pour validation. Une fois validée, le ticket est <b>retiré de la facturation</b>.
          </div>
          <Field label="Motif" theme={theme}>
            <select className="dz-input" value={annulMotif} onChange={(e) => setAnnulMotif(e.target.value)}>
              <option value="erreur">Erreur de saisie</option>
              <option value="vol">Ticket volé</option>
              <option value="autre">Autre</option>
            </select>
          </Field>
          <Field label="Précision (optionnel)" theme={theme}>
            <textarea className="dz-input" rows={2} value={annulNote} onChange={(e) => setAnnulNote(e.target.value)} placeholder="Ex. code jamais remis au client…" style={{ resize: "vertical" }} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="dz-btn" onClick={() => setAnnulTicket(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Retour</button>
            <button className="dz-btn" onClick={submitAnnulation} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Envoyer la demande</button>
          </div>
        </Modal>
      )}
      {confirmDeleteUnassigned && (
        <Modal theme={theme} onClose={() => setConfirmDeleteUnassigned(false)} title="Supprimer les tickets non assignés ?">
          <div style={{ fontSize: 13, color: theme.text, lineHeight: 1.5 }}>
            Vous allez <b>supprimer définitivement {fmtInt(unassignedOpen.length)} ticket(s)</b> non assigné(s) de la semaine en cours. Leur montant sera retiré de la facturation. Cette action est irréversible.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button className="dz-btn" onClick={() => setConfirmDeleteUnassigned(false)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={bulkDeleteUnassigned} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Supprimer</button>
          </div>
        </Modal>
      )}

      {editTicket && (
        <Modal theme={theme} onClose={() => setEditTicket(null)} title={`Modifier le ticket №${editTicket.num}`}>
          <div style={{ fontSize: 12, color: theme.sub, marginBottom: 12 }}>
            Modifiable car ce ticket est dans la <b>semaine en cours</b> (non clôturée). Le prix détermine la catégorie du ticket.
          </div>
          <Field label="Username (code)" theme={theme}>
            <input className="dz-input" value={editTicket.username || ""} onChange={(e) => setEditTicket({ ...editTicket, username: e.target.value })} />
          </Field>
          <Field label="Profil" theme={theme}>
            <input className="dz-input" value={editTicket.profile || ""} onChange={(e) => setEditTicket({ ...editTicket, profile: e.target.value })} />
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Revendeur" theme={theme}>
                <select className="dz-input" value={editTicket.revendeurId || ""} onChange={(e) => setEditTicket({ ...editTicket, revendeurId: e.target.value })}>
                  <option value="">Non assigné</option>
                  {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Prix (GNF)" theme={theme}>
                <input className="dz-input" type="number" value={editTicket.price} onChange={(e) => setEditTicket({ ...editTicket, price: e.target.value })} />
              </Field>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="dz-btn" onClick={() => setEditTicket(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={saveTicketEdit} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Enregistrer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ==================== ANNULATIONS DE TICKETS ============================== */
function AnnulationsTickets({ theme, dark, annulations, setAnnulations, tickets, setTickets, revendeurs, currentUser, canManage, isCommercial, isRevendeurRole, lastClosedTicket, notify, showToast, addActivity }) {
  const canValidate = canManage || isCommercial;
  const [rejecting, setRejecting] = useState(null);
  const [rejetMotif, setRejetMotif] = useState("");
  const [filterStatut, setFilterStatut] = useState("tous");

  const MOTIF_LABEL = { erreur: "Erreur de saisie", vol: "Ticket volé", autre: "Autre" };
  const STATUT_STYLE = {
    "En attente": { c: COLORS.accent, bg: COLORS.accent + "18" },
    "Validée": { c: COLORS.secondary, bg: COLORS.secondary + "18" },
    "Rejetée": { c: COLORS.danger, bg: COLORS.danger + "18" },
    "Rétablie": { c: COLORS.primary, bg: COLORS.primary + "18" },
  };

  const scoped = isRevendeurRole ? annulations.filter((a) => a.creeParId === currentUser.id) : annulations;
  const visible = scoped
    .filter((a) => filterStatut === "tous" || a.statut === filterStatut)
    .slice()
    .sort((a, b) => b.creeLe - a.creeLe);
  const pendingCount = scoped.filter((a) => a.statut === "En attente").length;

  function validate(a) {
    if (!canValidate) return;
    if (a.statut !== "En attente") return;
    const stillOpen = tickets.some((t) => t.globalId === a.ticketGlobalId && t.globalId > lastClosedTicket);
    if (!stillOpen) {
      showToast("Ce ticket a été clôturé ou déjà retiré entre-temps — annulation impossible. Vous pouvez rejeter la demande.", "error");
      return;
    }
    // Remove the ticket from billing (it is an OPEN ticket, so only the current week is affected).
    setTickets((prev) => prev.filter((t) => t.globalId !== a.ticketGlobalId));
    setAnnulations((prev) => prev.map((x) => x.id === a.id ? { ...x, statut: "Validée", valideePar: currentUser.nom, dateValidation: Date.now() } : x));
    notify && notify({ type: "annulation", event: "validee", audience: "user", forUserId: a.creeParId, title: "Annulation acceptée", message: `L'annulation du ticket №${a.ticketNum} (${GNF(a.price)}) a été acceptée — il est retiré de votre facturation.` });
    addActivity && addActivity("Ticket annulé", `№${a.ticketNum} — ${GNF(a.price)}`);
    showToast("Ticket annulé et retiré de la facturation");
  }

  function doReject() {
    const a = rejecting;
    if (!a) return;
    setAnnulations((prev) => prev.map((x) => x.id === a.id ? { ...x, statut: "Rejetée", valideePar: currentUser.nom, dateValidation: Date.now(), motifRejet: rejetMotif.trim() || null } : x));
    notify && notify({ type: "annulation", event: "rejetee", audience: "user", forUserId: a.creeParId, title: "Annulation refusée", message: `L'annulation du ticket №${a.ticketNum} (${GNF(a.price)}) a été refusée.${rejetMotif.trim() ? " Motif : " + rejetMotif.trim() : ""}` });
    addActivity && addActivity("Annulation refusée", `№${a.ticketNum}`);
    showToast("Demande d'annulation rejetée");
    setRejecting(null); setRejetMotif("");
  }

  // Undo a validated cancellation: put the ticket back into billing. Only allowed while its
  // slot is still in the OPEN (non-closed) week, so a closed/deposited week is never altered.
  function restoreTicket(a) {
    if (!canValidate) return;
    if (a.statut !== "Validée") return;
    if (a.ticketGlobalId <= lastClosedTicket) {
      showToast("Ce ticket appartiendrait à une semaine déjà clôturée — rétablissement impossible.", "error");
      return;
    }
    const restored = {
      globalId: a.ticketGlobalId, num: a.ticketNum, date: a.date, time: a.time,
      username: a.username, profile: a.profile || "", price: a.price,
      prefix: (a.username || "").slice(0, 2), revendeurId: a.revendeurId || null,
    };
    setTickets((prev) => prev.some((t) => t.globalId === a.ticketGlobalId) ? prev : [...prev, restored].sort((x, y) => x.globalId - y.globalId));
    setAnnulations((prev) => prev.map((x) => x.id === a.id ? { ...x, statut: "Rétablie", retabliPar: currentUser.nom, dateRetablissement: Date.now() } : x));
    notify && notify({ type: "annulation", event: "validee", audience: "user", forUserId: a.creeParId, title: "Ticket rétabli", message: `Le ticket №${a.ticketNum} (${GNF(a.price)}) a été rétabli dans la facturation.` });
    addActivity && addActivity("Ticket rétabli", `№${a.ticketNum} — ${GNF(a.price)}`);
    showToast("Ticket rétabli dans la facturation");
  }

  return (
    <div>
      <div className="dz-card" style={{ padding: "10px 16px", fontSize: 12, color: theme.sub, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <AlertTriangle size={14} color={COLORS.danger} />
        Les revendeurs demandent l'annulation d'un ticket (erreur ou vol) depuis <b>Mes Tickets</b>. Seuls les tickets de la <b>semaine en cours</b> peuvent être annulés. Une fois validé, le ticket est <b>définitivement retiré de la facturation</b>.
      </div>

      <div style={{ display: "flex", gap: 3, background: dark ? "#0F172A" : "#F1F5F9", padding: 3, borderRadius: 11, marginBottom: 14, width: "fit-content" }}>
        {[["tous", "Toutes"], ["En attente", `En attente${pendingCount ? ` (${pendingCount})` : ""}`], ["Validée", "Validées"], ["Rejetée", "Rejetées"]].map(([id, label]) => (
          <button key={id} className="dz-btn" onClick={() => setFilterStatut(id)}
            style={{ padding: "6px 12px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, background: filterStatut === id ? COLORS.primary : "transparent", color: filterStatut === id ? "#fff" : theme.sub }}>{label}</button>
        ))}
      </div>

      <div className="dz-card" style={{ padding: 0, overflow: "hidden" }}>
        {visible.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>Aucune demande d'annulation.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr><th>Ticket</th><th>Revendeur</th><th>Motif</th><th>Statut</th>{canValidate && <th style={{ textAlign: "right" }}>Action</th>}</tr></thead>
              <tbody>
                {visible.map((a) => {
                  const st = STATUT_STYLE[a.statut] || STATUT_STYLE["En attente"];
                  return (
                    <tr key={a.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>№{a.ticketNum} · {GNF(a.price)}</div>
                        <div style={{ fontSize: 11, color: theme.sub }}>{a.username} · {a.date} {a.time}</div>
                      </td>
                      <td style={{ fontSize: 12.5 }}>{revendeurs.find((r) => r.id === a.revendeurId)?.nom || a.creePar}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {MOTIF_LABEL[a.motif] || a.motif}
                        {a.commentaire && <div style={{ fontSize: 11, color: theme.sub, marginTop: 2 }}>{a.commentaire}</div>}
                        {a.statut === "Rejetée" && a.motifRejet && <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 2 }}>Refus : {a.motifRejet}</div>}
                      </td>
                      <td>
                        <span style={{ fontSize: 11, fontWeight: 700, color: st.c, background: st.bg, padding: "3px 9px", borderRadius: 99 }}>{a.statut}</span>
                        {a.statut !== "En attente" && a.valideePar && <div style={{ fontSize: 10.5, color: theme.sub, marginTop: 3 }}>par {a.valideePar}</div>}
                      </td>
                      {canValidate && (
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          {a.statut === "En attente" ? (
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              <button className="dz-btn" onClick={() => validate(a)} style={{ background: GRAD.success, color: "#fff", padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700 }}>Valider</button>
                              <button className="dz-btn" onClick={() => { setRejecting(a); setRejetMotif(""); }} style={{ background: "transparent", color: COLORS.danger, padding: "6px 10px", borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1px solid ${COLORS.danger}44` }}>Rejeter</button>
                            </div>
                          ) : a.statut === "Validée" ? (
                            a.ticketGlobalId > lastClosedTicket
                              ? <button className="dz-btn" onClick={() => restoreTicket(a)} title="Ramener ce ticket dans la facturation" style={{ background: "transparent", color: COLORS.primary, padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1px solid ${COLORS.primary}55` }}>Rétablir le ticket</button>
                              : <span style={{ fontSize: 10.5, color: theme.sub }}>Semaine clôturée</span>
                          ) : <span style={{ fontSize: 11, color: theme.sub }}>—</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejecting && (
        <Modal theme={theme} onClose={() => setRejecting(null)} title="Rejeter la demande d'annulation">
          <div style={{ fontSize: 12.5, color: theme.sub, marginBottom: 12 }}>Ticket <b>№{rejecting.ticketNum}</b> ({GNF(rejecting.price)}). Le revendeur sera notifié du refus.</div>
          <Field label="Motif du refus (optionnel, visible par le revendeur)" theme={theme}>
            <textarea className="dz-input" rows={2} value={rejetMotif} onChange={(e) => setRejetMotif(e.target.value)} style={{ resize: "vertical" }} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="dz-btn" onClick={() => setRejecting(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Retour</button>
            <button className="dz-btn" onClick={doReject} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700 }}>Confirmer le rejet</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ========================== PARAMÈTRES ==================================== */
function Parametres({ theme, dark, setDark, settings, setSettings, showToast, addActivity, catLabels, tarifs, canManage }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const fileRef = useRef(null);

  function handleLogo(file) {
    if (file.size > 500 * 1024) { showToast("Logo trop volumineux (max 500 Ko)", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm({ ...form, logo: reader.result });
    reader.readAsDataURL(file);
  }

  function save() {
    setSettings(form);
    addActivity("Paramètres modifiés", form.entreprise);
    showToast("Paramètres enregistrés");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 680 }}>
      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 16 }}>Entreprise</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 14, background: dark ? "#0F172A" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, border: `1px solid ${theme.border}` }}>
            {form.logo ? <img src={form.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Wifi size={26} color={theme.sub} />}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files[0] && handleLogo(e.target.files[0])} />
            <button className="dz-btn" onClick={() => fileRef.current.click()}
              style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "8px 14px", borderRadius: 11, fontSize: 12.5, fontWeight: 600 }}>
              Changer le logo
            </button>
            {form.logo && (
              <button className="dz-btn" onClick={() => setForm({ ...form, logo: null })}
                style={{ background: "transparent", color: COLORS.danger, padding: "8px 10px", borderRadius: 11, fontSize: 12.5, fontWeight: 600 }}>
                Retirer
              </button>
            )}
            <div style={{ fontSize: 11, color: theme.sub, marginTop: 5 }}>PNG/JPG, 500 Ko max — remplace l'icône Wifi dans le menu.</div>
          </div>
        </div>
        <Field label="Nom de l'entreprise" theme={theme}><input className="dz-input" value={form.entreprise} onChange={(e) => setForm({ ...form, entreprise: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Téléphone" theme={theme}><input className="dz-input" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Email" theme={theme}><input className="dz-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field></div>
        </div>
        <Field label="Adresse" theme={theme}><input className="dz-input" value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} /></Field>
      </div>

      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 16 }}>Préférences régionales</div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Field label="Devise" theme={theme}>
              <input className="dz-input" value={form.devise} onChange={(e) => setForm({ ...form, devise: e.target.value })} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Langue" theme={theme}>
              <select className="dz-input" value={form.langue} onChange={(e) => setForm({ ...form, langue: e.target.value })}>
                <option>Français</option>
              </select>
            </Field>
          </div>
        </div>
        <Field label="Fuseau horaire" theme={theme}><input className="dz-input" value={form.fuseauHoraire} onChange={(e) => setForm({ ...form, fuseauHoraire: e.target.value })} /></Field>
        <div style={{ fontSize: 11, color: theme.sub, marginTop: -4 }}>
          Note : les montants restent affichés en GNF dans les calculs pour le moment — la devise ci-dessus est informative en attendant la Phase 2 (multi-devises).
        </div>
      </div>

      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 4 }}>Apparence</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>Mode sombre — identique au bouton lune/soleil en haut de l'écran.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="dz-btn" onClick={() => setDark(false)}
            style={{ padding: "8px 16px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, background: !dark ? COLORS.primary : (dark ? "#334155" : "#F1F5F9"), color: !dark ? "#fff" : theme.sub, display: "flex", alignItems: "center", gap: 6 }}>
            <Sun size={14} /> Clair
          </button>
          <button className="dz-btn" onClick={() => setDark(true)}
            style={{ padding: "8px 16px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, background: dark ? COLORS.primary : "#F1F5F9", color: dark ? "#fff" : theme.sub, display: "flex", alignItems: "center", gap: 6 }}>
            <Moon size={14} /> Sombre
          </button>
        </div>
      </div>

      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 4 }}>Commission Revendeur</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>Montant gagné par le revendeur sur chaque ticket vendu, utilisé dans "Soldes Revendeurs".</div>
        <Field label="Commission par ticket (GNF)" theme={theme}>
          <input className="dz-input" type="number" disabled={!canManage} style={{ maxWidth: 200, opacity: canManage ? 1 : .7 }}
            value={form.commissionParTicket} onChange={(e) => setForm({ ...form, commissionParTicket: parseInt(e.target.value, 10) || 0 })} />
        </Field>
      </div>

      <div className="dz-card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.01em", marginBottom: 4 }}>Alerte de stock bas</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>Quand le stock restant d'un revendeur (tickets attribués − vendus) passe sous ce seuil, une notification prévient automatiquement le revendeur et les valideurs (au plus une fois par jour). Mettre 0 pour désactiver.</div>
        <Field label="Seuil (nombre de tickets)" theme={theme}>
          <input className="dz-input" type="number" disabled={!canManage} style={{ maxWidth: 200, opacity: canManage ? 1 : .7 }}
            value={form.seuilStockBas ?? 20} onChange={(e) => setForm({ ...form, seuilStockBas: parseInt(e.target.value, 10) || 0 })} />
        </Field>
      </div>

      <div className="dz-card" style={{ padding: 18, background: dark ? "#0F172A" : "#F8FAFC" }}>
        <div style={{ fontSize: 12, color: theme.sub, lineHeight: 1.6 }}>
          💡 Grille tarifaire et libellés des forfaits ({Object.values({ ...CAT_LABEL, ...catLabels }).slice(0, 5).join(", ")}) se gèrent dans <b>Tarifs</b>. Les préfixes Mikhmon par revendeur se gèrent dans <b>Revendeurs</b>.
        </div>
      </div>

      <button className="dz-btn" disabled={!dirty || !canManage} onClick={save}
        style={{ background: GRAD.primary, color: "#fff", padding: "10px 18px", borderRadius: 11, fontSize: 13.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, opacity: dirty && canManage ? 1 : .5, width: "fit-content" }}>
        <Save size={15} /> Enregistrer les paramètres
      </button>
    </div>
  );
}

/* ========================== EXPORTS ==================================== */
function Exports({ theme, dark, tickets, revendeurs, weeks, tarifs, catLabels, settings, showToast, currentUser, isCommercial }) {
  const L = { ...CAT_LABEL, ...(catLabels || {}) };
  const [revForExport, setRevForExport] = useState("tous");

  function exportTicketsCSV(revendeurId) {
    const scoped = revendeurId === "tous" ? tickets : tickets.filter((t) => t.revendeurId === revendeurId);
    const revName = revendeurId === "tous" ? null : revendeurs.find((r) => r.id === revendeurId)?.nom;
    const rows = scoped.map((t) => ({
      "№": t.num, Date: t.date, Heure: t.time, Username: t.username,
      Profil: L[catOfPrice(t.price)] || t.profile,
      Revendeur: revendeurs.find((r) => r.id === t.revendeurId)?.nom || "Non assigné",
      "Prix (GNF)": t.price,
    }));
    const csv = Papa.unparse(rows);
    const filename = revName
      ? `diafa-tickets-${revName.toLowerCase().replace(/\s+/g, "-")}-${stamp()}.csv`
      : `diafa-tous-les-tickets-${stamp()}.csv`;
    downloadBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), filename);
    showToast(`${fmtInt(rows.length)} tickets exportés en CSV`);
  }
  const exportAllCSV = () => exportTicketsCSV("tous");

  function exportExcel() {
    const wb = XLSX.utils.book_new();

    const ticketRows = tickets.map((t) => ({
      "№": t.num, Date: t.date, Heure: t.time, Username: t.username,
      Profil: L[catOfPrice(t.price)] || t.profile,
      Revendeur: revendeurs.find((r) => r.id === t.revendeurId)?.nom || "Non assigné",
      "Prix (GNF)": t.price,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ticketRows), "Tickets");

    const revRows = revendeurs.map((r) => {
      const revTickets = tickets.filter((t) => t.revendeurId === r.id);
      return {
        Nom: r.nom, Statut: r.statut || "Actif", Téléphone: r.telephone || "",
        Codes: r.codes.join(", "), Tickets: revTickets.length,
        "CA total (GNF)": revTickets.reduce((s, t) => s + t.price, 0),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revRows), "Revendeurs");

    const weekRows = weeks.map((w) => ({
      Semaine: w.weekNumber, "Ticket début": w.startTicket, "Ticket fin": w.endTicket,
      "Date début": w.startDate, "Date fin": w.endDate, Tickets: w.totalTickets, "CA (GNF)": w.totalCA,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weekRows), "Rapports Hebdomadaires");

    const tarifRows = Object.entries(tarifs).map(([k, v]) => ({ Forfait: L[k] || k, "Prix (GNF)": v }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tarifRows), "Tarifs");

    XLSX.writeFile(wb, `diafa-export-complet-${stamp()}.xlsx`);
    showToast("Export Excel généré");
  }

  function printSummary() {
    const revRows = revendeurs.map((r) => {
      const revTickets = tickets.filter((t) => t.revendeurId === r.id);
      return { nom: r.nom, tickets: revTickets.length, ca: revTickets.reduce((s, t) => s + t.price, 0) };
    }).sort((a, b) => b.ca - a.ca);
    const totalCA = revRows.reduce((s, r) => s + r.ca, 0);
    const totalTickets = tickets.length;

    const html = `
      <!doctype html><html><head><meta charset="utf-8"><title>DIAFA WIFIZONE PRO — Récapitulatif</title>
      <style>
        body{font-family:Arial,sans-serif;color:#1E293B;padding:30px;}
        h1{color:#2563EB;font-size:20px;margin-bottom:2px;}
        .sub{color:#64748B;font-size:12px;margin-bottom:20px;}
        table{width:100%;border-collapse:collapse;font-size:13px;}
        th{background:#F1F5F9;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;color:#475569;}
        td{padding:8px 10px;border-bottom:1px solid #E2E8F0;}
        tfoot td{font-weight:bold;background:#EFF6FF;color:#2563EB;}
      </style></head><body>
      <h1>${settings.entreprise || "DIAFA WIFIZONE PRO"} — Récapitulatif des ventes</h1>
      <div class="sub">Généré le ${new Date().toLocaleString("fr-FR")}</div>
      <table>
        <thead><tr><th>Revendeur</th><th style="text-align:right">Tickets</th><th style="text-align:right">CA (GNF)</th></tr></thead>
        <tbody>${revRows.map((r) => `<tr><td>${r.nom}</td><td style="text-align:right">${fmtInt(r.tickets)}</td><td style="text-align:right">${GNF(r.ca)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>TOTAL</td><td style="text-align:right">${fmtInt(totalTickets)}</td><td style="text-align:right">${GNF(totalCA)}</td></tr></tfoot>
      </table>
      </body></html>`;
    const win = window.open("", "_blank");
    if (!win) { showToast("Autorisez les fenêtres pop-up pour imprimer", "error"); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <ExportCard theme={theme} dark={dark} icon={FileSpreadsheet} color={COLORS.secondary} title="Excel (.xlsx)"
          desc="Classeur complet : tickets, revendeurs, rapports hebdomadaires et tarifs, chacun sur sa propre feuille."
          action={exportExcel} label="Télécharger le classeur Excel" />
        <ExportCard theme={theme} dark={dark} icon={Database} color={COLORS.primary} title="CSV brut"
          desc="Tous les tickets importés, au format CSV — pratique pour ré-importer ailleurs ou analyser dans un tableur."
          action={exportAllCSV} label="Télécharger le CSV" />
        <ExportCard theme={theme} dark={dark} icon={CheckCircle2} color={COLORS.accent} title="Imprimer / PDF"
          desc="Récapitulatif par revendeur, prêt à imprimer ou à enregistrer en PDF depuis la fenêtre d'impression du navigateur."
          action={printSummary} label="Aperçu avant impression" />
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 4 }}>Mes Tickets — export ciblé</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 12 }}>Exportez les tickets d'un revendeur précis, ou de tous à la fois.</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select className="dz-input" style={{ width: 220 }} value={revForExport} onChange={(e) => setRevForExport(e.target.value)}>
            <option value="tous">Tous les revendeurs</option>
            {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
          </select>
          <button className="dz-btn" onClick={() => exportTicketsCSV(revForExport)}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
            <Download size={14} /> Exporter en CSV
          </button>
        </div>
      </div>

      <div className="dz-card" style={{ padding: 18, background: dark ? "#0F172A" : "#F8FAFC" }}>
        <div style={{ fontSize: 12, color: theme.sub, lineHeight: 1.6 }}>
          💡 Pour partager un rapport hebdomadaire ou le classement sur WhatsApp, utilisez plutôt le bouton <b>Exporter / Partager</b> directement dans les pages <b>Rapport Hebdomadaire</b> et <b>Classements</b> — ils génèrent une image PNG prête à envoyer.
        </div>
      </div>
    </div>
  );
}

function ExportCard({ theme, dark, icon: Icon, color, title, desc, action, label }) {
  return (
    <div className="dz-card dz-card-hover" style={{ flex: "1 1 220px", padding: 20, display: "flex", flexDirection: "column" }}>
      <div className="dz-kpi-icon" style={{ background: color + "1c", boxShadow: `inset 0 0 0 1px ${color}30`, marginBottom: 14 }}>
        <Icon size={19} color={color} strokeWidth={2.2} />
      </div>
      <div style={{ fontWeight: 800, fontSize: 14.5, marginBottom: 6, letterSpacing: "-.01em" }}>{title}</div>
      <div style={{ fontSize: 12, color: theme.sub, marginBottom: 18, flex: 1, lineHeight: 1.5 }}>{desc}</div>
      <button className="dz-btn" onClick={action}
        style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}CC 100%)`, color: "#fff", padding: "10px 0", borderRadius: 11, fontWeight: 700, fontSize: 12.5, boxShadow: `0 6px 16px ${color}40` }}>
        {label}
      </button>
    </div>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function stamp() { return new Date().toISOString().slice(0, 10); }


/* ========================== RÉSEAU ==================================== */
const DEVICE_TYPES = ["Cambium ePMP", "Cambium PMP", "Grandstream GWN7664", "Grandstream GWN7630", "Autre AP", "Routeur", "Switch"];

function normalizeDeviceUrl(address) {
  if (!address) return "";
  return /^https?:\/\//i.test(address) ? address : `http://${address}`;
}

// Best-effort reachability check via an image request (works around CORS, since <img> doesn't
// need permissive headers the way fetch() does). Still approximate: a browser on HTTPS (GitHub
// Pages) usually can't reach a plain-HTTP local device at all — that's a browser security rule,
// not a real "down" device. Treated as "unknown" rather than falsely reporting DOWN in that case.
function Reseau({ theme, dark, equipements, setEquipements, showToast, addActivity, canManage, isRevendeurRole, revendeurs }) {
  const [editing, setEditing] = useState(null);

  function openNew() {
    setEditing({ id: null, nom: "", type: DEVICE_TYPES[0], adresse: "", notes: "", revendeurId: "", role: "Master" });
  }

  function save(d) {
    if (!d.nom.trim() || !d.adresse.trim()) { showToast("Nom et adresse IP requis", "error"); return; }
    if (d.id) {
      setEquipements((prev) => prev.map((x) => x.id === d.id ? { ...x, ...d } : x));
      addActivity("Équipement modifié", d.nom);
      showToast("Équipement mis à jour");
    } else {
      setEquipements((prev) => [...prev, { ...d, id: uid() }]);
      addActivity("Équipement ajouté", `${d.nom} (${d.type})`);
      showToast("Équipement ajouté");
    }
    setEditing(null);
  }

  function remove(id) {
    const d = equipements.find((x) => x.id === id);
    setEquipements((prev) => prev.filter((x) => x.id !== id));
    addActivity("Équipement supprimé", d?.nom);
    showToast("Équipement supprimé");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12.5, color: theme.sub }}>{fmtInt(equipements.length)} équipement(s)</div>
        </div>
        {canManage && (
          <button className="dz-btn" onClick={openNew}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Ajouter un équipement
          </button>
        )}
      </div>

      {equipements.length === 0 ? (
        <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
          Aucun équipement enregistré — ajoutez vos antennes Cambium ou points d'accès Grandstream avec leur adresse IP.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))", gap: 10 }}>
          {equipements.map((d) => (
              <div key={d.id} className="dz-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{d.nom}</div>
                    <div style={{ fontSize: 10.5, color: theme.sub, marginTop: 1 }}>{d.type}{d.role ? ` · ${d.role}` : ""}</div>
                    {d.revendeurId && <div style={{ fontSize: 10.5, color: COLORS.secondary, marginTop: 1, fontWeight: 600 }}>{(revendeurs || []).find((r) => r.id === d.revendeurId)?.nom || ""}</div>}
                  </div>
                  <Wifi size={15} color={COLORS.primary} style={{ flexShrink: 0 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, margin: "8px 0 0" }}>
                  <div style={{ fontSize: 11.5, color: theme.text, fontFamily: "monospace", background: dark ? "#0F172A" : "#F8FAFC", padding: "3px 7px", borderRadius: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.adresse}
                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    {!isRevendeurRole && d.role !== "Mesh" && (
                      <a href={normalizeDeviceUrl(d.adresse)} target="_blank" rel="noopener noreferrer" title="Ouvrir l'interface de l'AP"
                        className="dz-btn" style={{ background: GRAD.primary, color: "#fff", padding: "6px 8px", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                        <Share2 size={13} />
                      </a>
                    )}
                    {canManage && (
                      <>
                        <button className="dz-btn" title="Modifier" onClick={() => setEditing({ ...d })} style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.sub, padding: "6px 8px", borderRadius: 9 }}><Pencil size={13} /></button>
                        <button className="dz-btn" title="Supprimer" onClick={() => remove(d.id)} style={{ background: "transparent", border: `1px solid ${theme.border}`, color: COLORS.danger, padding: "6px 8px", borderRadius: 9 }}><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
          ))}
        </div>
      )}

      {equipements.length > 0 && (
        <div className="dz-card" style={{ padding: 18, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Équipements par revendeur</div>
            <button className="dz-btn" onClick={() => {
              const nomRev = (id) => (revendeurs || []).find((r) => r.id === id)?.nom || "Non assigné";
              const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
              const header = ["Revendeur", "Nom AP", "IP AP", "Catégorie", "Rôle"];
              const lines = [header.map(esc).join(",")].concat(
                equipements.slice().sort((a, b) => nomRev(a.revendeurId).localeCompare(nomRev(b.revendeurId)))
                  .map((d) => [nomRev(d.revendeurId), d.nom, d.adresse, d.type, d.role || ""].map(esc).join(","))
              );
              const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob); const a = document.createElement("a");
              a.href = url; a.download = `diafa-equipements-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
            }} style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.text, padding: "7px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
              <Download size={13} /> Exporter (CSV)
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr><th>Revendeur</th><th>Nom AP</th><th>IP AP</th><th>Catégorie</th><th>Rôle</th></tr></thead>
              <tbody>
                {equipements.slice().sort((a, b) => ((revendeurs || []).find((r) => r.id === a.revendeurId)?.nom || "zzz").localeCompare((revendeurs || []).find((r) => r.id === b.revendeurId)?.nom || "zzz")).map((d) => (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{(revendeurs || []).find((r) => r.id === d.revendeurId)?.nom || <span style={{ color: theme.sub }}>Non assigné</span>}</td>
                    <td>{d.nom}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{d.adresse}</td>
                    <td style={{ color: theme.sub }}>{d.type}</td>
                    <td><span style={{ fontSize: 11.5, fontWeight: 700, color: d.role === "Master" ? COLORS.primary : d.role === "Mesh" ? COLORS.secondary : d.role === "Transmission" ? COLORS.accent : theme.sub }}>{d.role || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {equipements.length > 0 && (() => {
        const nomRev = (id) => (revendeurs || []).find((r) => r.id === id)?.nom || "Non assigné";
        const agg = {};
        equipements.forEach((d) => {
          const k = d.revendeurId || "none";
          agg[k] = agg[k] || { nom: nomRev(k), total: 0, Master: 0, Mesh: 0, Transmission: 0 };
          agg[k].total += 1;
          const role = d.role === "Master" ? "Master" : d.role === "Mesh" ? "Mesh" : "Transmission";
          agg[k][role] += 1;
        });
        const rows = Object.values(agg).sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom));
        return (
          <div className="dz-card" style={{ padding: 18, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Classement par nombre d'AP</div>
              <button className="dz-btn" onClick={() => {
                exportReportImage(drawApRankingImage(rows), `diafa-classement-ap-${new Date().toISOString().slice(0, 10)}.png`, "Classement AP par revendeur — DIAFA WIFIZONE", "Classement du nombre d'AP par revendeur.", showToast);
              }} style={{ background: GRAD.primary, color: "#fff", padding: "7px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                <Download size={13} /> Exporter (image)
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
                <thead><tr><th style={{ width: 44 }}>#</th><th>Revendeur</th><th style={{ textAlign: "right" }}>Total AP</th><th style={{ textAlign: "right" }}>Master</th><th style={{ textAlign: "right" }}>Mesh</th><th style={{ textAlign: "right" }}>Transmission</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 800, color: i === 0 ? COLORS.accent : theme.sub }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{r.nom}</td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: COLORS.primary }}>{fmtInt(r.total)}</td>
                      <td style={{ textAlign: "right" }}>{fmtInt(r.Master)}</td>
                      <td style={{ textAlign: "right" }}>{fmtInt(r.Mesh)}</td>
                      <td style={{ textAlign: "right", color: theme.sub }}>{fmtInt(r.Transmission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {editing && (
        <Modal theme={theme} onClose={() => setEditing(null)} title={editing.id ? "Modifier l'équipement" : "Nouvel équipement"}>
          <Field label="Nom" theme={theme}><input className="dz-input" placeholder="Antenne Toit Nord" value={editing.nom} onChange={(e) => setEditing({ ...editing, nom: e.target.value })} /></Field>
          <Field label="Type / Catégorie" theme={theme}>
            <select className="dz-input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
              {DEVICE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Revendeur associé (optionnel)" theme={theme}>
                <select className="dz-input" value={editing.revendeurId || ""} onChange={(e) => setEditing({ ...editing, revendeurId: e.target.value })}>
                  <option value="">— Aucun —</option>
                  {(revendeurs || []).map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Rôle" theme={theme}>
                <select className="dz-input" value={editing.role || "Master"} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  <option value="Master">Master</option>
                  <option value="Mesh">Mesh</option>
                  <option value="Transmission">Transmission</option>
                </select>
              </Field>
            </div>
          </div>
          <Field label="Adresse IP (ou URL)" theme={theme}>
            <input className="dz-input" placeholder="192.168.1.20" value={editing.adresse} onChange={(e) => setEditing({ ...editing, adresse: e.target.value })} />
          </Field>
          <Field label="Notes (optionnel)" theme={theme}>
            <textarea className="dz-input" rows={2} style={{ resize: "vertical" }} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setEditing(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={() => save(editing)} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Enregistrer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}


/* ========================== LOGIN ==================================== */
const LOGIN_I18N = {
  fr: {
    tagline: "Connectez-vous à votre compte",
    identifiant: "Identifiant",
    motDePasse: "Mot de passe",
    connexion: "Connexion…",
    seConnecter: "Se connecter",
    contacterAdmin: "Contacter l'administrateur",
    oublie: "Compte oublié ou perdu ? Contactez un administrateur pour qu'il vous recrée un accès.",
    erreurIdentifiants: "Identifiant ou mot de passe incorrect.",
    erreurDesactive: "Ce compte a été désactivé — contactez un administrateur.",
  },
  en: {
    tagline: "Sign in to your account",
    identifiant: "Username",
    motDePasse: "Password",
    connexion: "Signing in…",
    seConnecter: "Sign in",
    contacterAdmin: "Contact the administrator",
    oublie: "Forgot or lost your account? Contact an administrator to have it recreated.",
    erreurIdentifiants: "Incorrect username or password.",
    erreurDesactive: "This account has been disabled — contact an administrator.",
  },
};

function Login({ theme, dark, users, onLoginSuccess, settings }) {
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState("fr");
  const t = LOGIN_I18N[lang];

  function submit(e) {
    e.preventDefault();
    if (!identifiant.trim() || !motDePasse) return;
    setBusy(true);
    setError("");
    // Small artificial delay so the button gives feedback even though this check is
    // actually instant (plain local comparison, no network round-trip involved).
    window.setTimeout(() => {
      const match = users.find((u) => (u.identifiant || "").toLowerCase() === identifiant.trim().toLowerCase());
      if (!match || deobfuscate(match.pwHash) !== motDePasse) {
        setError(t.erreurIdentifiants);
        setBusy(false);
        return;
      }
      if ((match.statut || "Actif") !== "Actif") {
        setError(t.erreurDesactive);
        setBusy(false);
        return;
      }
      onLoginSuccess(match);
    }, 250);
  }

  return (
    <div style={{
      minHeight: 640, height: "100%", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(120deg, #0B1220 0%, #1D4ED8 32%, #7C3AED 68%, #0B1220 100%)`,
      backgroundSize: "300% 300%", animation: "dzgradientmove 14s ease infinite",
      fontFamily: "'Inter', 'Manrope', 'Segoe UI', sans-serif", padding: 20,
    }}>
      <style>{`
        @keyframes dzOrb1 { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(30px,-24px) scale(1.08);} }
        @keyframes dzOrb2 { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(-24px,26px) scale(1.05);} }
      `}</style>
      <div style={{ position: "absolute", top: "-8%", left: "-6%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,.45) 0%, transparent 70%)", filter: "blur(10px)", animation: "dzOrb1 9s ease-in-out infinite" }} />
      <div style={{ position: "absolute", bottom: "-10%", right: "-8%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,.5) 0%, transparent 70%)", filter: "blur(10px)", animation: "dzOrb2 11s ease-in-out infinite" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px)", backgroundSize: "26px 26px", opacity: .5 }} />

      <div style={{ display: "flex", gap: 8, marginBottom: 20, position: "relative", zIndex: 1 }}>
        <button type="button" onClick={() => setLang("fr")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 99, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12.5, transition: "all .15s ease", background: lang === "fr" ? "#fff" : "rgba(255,255,255,.14)", color: lang === "fr" ? COLORS.primary : "#fff", backdropFilter: "blur(6px)" }}>
          🇫🇷 Français
        </button>
        <button type="button" onClick={() => setLang("en")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 99, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12.5, transition: "all .15s ease", background: lang === "en" ? "#fff" : "rgba(255,255,255,.14)", color: lang === "en" ? COLORS.primary : "#fff", backdropFilter: "blur(6px)" }}>
          🇬🇧 English
        </button>
      </div>

      <form onSubmit={submit} className="dz-scale-in" style={{
        background: "rgba(255,255,255,.90)", backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)",
        border: "1px solid rgba(255,255,255,.5)", borderRadius: 22, padding: 36, width: 380, maxWidth: "100%",
        boxShadow: "0 30px 80px rgba(0,0,0,.35)", position: "relative", zIndex: 1,
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: GRAD.primary, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, overflow: "hidden", boxShadow: "0 10px 28px rgba(37,99,235,.4)" }}>
            {settings?.logo ? <img src={settings.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Wifi size={28} color="#fff" strokeWidth={2.4} />}
          </div>
          <div style={{ fontWeight: 800, fontSize: 20, color: COLORS.textLight, letterSpacing: "-.01em" }}>{settings?.entreprise || "DIAFA WIFIZONE PRO"}</div>
          <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 4 }}>{t.tagline}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="dz-label">{t.identifiant}</label>
          <input className="dz-input" autoFocus value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} placeholder="admin" style={{ background: "#F8FAFC" }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <label className="dz-label">{t.motDePasse}</label>
          <div style={{ position: "relative" }}>
            <input className="dz-input" type={showPwd ? "text" : "password"} value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} placeholder="••••••••" style={{ paddingRight: 40, background: "#F8FAFC" }} />
            <button type="button" className="dz-btn" onClick={() => setShowPwd((s) => !s)}
              style={{ position: "absolute", right: 5, top: 5, background: "transparent", color: "#94A3B8", padding: 7, borderRadius: 10 }}>
              {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {error && (
          <div className="dz-slide-in" style={{ display: "flex", alignItems: "center", gap: 7, background: COLORS.danger + "12", color: COLORS.danger, padding: "10px 12px", borderRadius: 12, fontSize: 12, marginBottom: 14, marginTop: 10 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <button type="submit" disabled={busy} className="dz-btn dz-btn-primary" style={{ width: "100%", padding: "12px 0", fontSize: 13.5, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {busy && <RefreshCw size={14} className="dz-spin" />}
          {busy ? t.connexion : t.seConnecter}
        </button>

        <div style={{ marginTop: 18, fontSize: 11.5, color: "#94A3B8", textAlign: "center", lineHeight: 1.5 }}>
          {t.oublie}
        </div>
      </form>
      <div style={{ marginTop: 22, fontSize: 11, color: "rgba(255,255,255,.55)", position: "relative", zIndex: 1 }}>DIAFA WIFIZONE · v{APP_VERSION}</div>
    </div>
  );
}

/* ========================== SETUP ADMIN (premier lancement) =========== */
function SetupAdmin({ theme, dark, users, setUsers, addActivity, showToast, onLoginSuccess }) {
  const [nom, setNom] = useState("Administrateur");
  const [identifiant, setIdentifiant] = useState("admin");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!nom.trim() || !identifiant.trim()) { setError("Nom et identifiant requis."); return; }
    if (motDePasse.length < 6) { setError("Le mot de passe doit faire au moins 6 caractères."); return; }
    if (motDePasse !== confirm) { setError("Les deux mots de passe ne correspondent pas."); return; }
    setBusy(true);
    // Re-check the live database right before creating — a second device could have
    // bootstrapped the very first admin moments ago.
    const liveUsers = await loadKey("diafa:users", []);
    if (liveUsers.length > 0) {
      setError("Un compte existe déjà sur ce système — rechargez la page pour vous connecter.");
      setBusy(false);
      return;
    }
    const profile = { id: uid(), nom: nom.trim(), identifiant: identifiant.trim(), role: "admin", statut: "Actif", pwHash: obfuscate(motDePasse) };
    const ok = await saveKey("diafa:users", [profile]);
    setBusy(false);
    if (!ok) { setError("Erreur réseau — réessayez."); return; }
    setUsers([profile]);
    addActivity("Compte administrateur créé", nom.trim());
    showToast("Compte administrateur créé — bienvenue !");
    onLoginSuccess(profile);
  }

  return (
    <div style={{
      minHeight: 640, height: "100%", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(120deg, #0B1220 0%, #1D4ED8 32%, #7C3AED 68%, #0B1220 100%)`,
      backgroundSize: "300% 300%", animation: "dzgradientmove 14s ease infinite",
      fontFamily: "'Inter', 'Manrope', 'Segoe UI', sans-serif", padding: 20,
    }}>
      <div style={{ position: "absolute", top: "-8%", left: "-6%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,.45) 0%, transparent 70%)", filter: "blur(10px)" }} />
      <div style={{ position: "absolute", bottom: "-10%", right: "-8%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,.5) 0%, transparent 70%)", filter: "blur(10px)" }} />
      <form onSubmit={submit} className="dz-scale-in" style={{
        background: "rgba(255,255,255,.90)", backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)",
        border: "1px solid rgba(255,255,255,.5)", borderRadius: 22, padding: 36, width: 400, maxWidth: "100%",
        boxShadow: "0 30px 80px rgba(0,0,0,.35)", position: "relative", zIndex: 1,
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: GRAD.primary, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 13, boxShadow: "0 10px 28px rgba(37,99,235,.4)" }}>
            <Wifi size={26} color="#fff" strokeWidth={2.4} />
          </div>
          <div style={{ fontWeight: 800, fontSize: 19, color: COLORS.textLight, letterSpacing: "-.01em" }}>DIAFA WIFIZONE PRO</div>
          <div style={{ fontSize: 12.5, color: "#64748B", marginTop: 4, textAlign: "center" }}>Premier lancement — créez le compte administrateur</div>
        </div>

        <Field label="Nom complet" theme={{ sub: "#64748B" }}><input className="dz-input" value={nom} onChange={(e) => setNom(e.target.value)} style={{ background: "#F8FAFC" }} /></Field>
        <Field label="Identifiant" theme={{ sub: "#64748B" }}><input className="dz-input" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} style={{ background: "#F8FAFC" }} /></Field>
        <Field label="Mot de passe (6 caractères min.)" theme={{ sub: "#64748B" }}><input className="dz-input" type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} style={{ background: "#F8FAFC" }} /></Field>
        <Field label="Confirmer le mot de passe" theme={{ sub: "#64748B" }}><input className="dz-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ background: "#F8FAFC" }} /></Field>

        {error && (
          <div className="dz-slide-in" style={{ display: "flex", alignItems: "center", gap: 7, background: COLORS.danger + "12", color: COLORS.danger, padding: "10px 12px", borderRadius: 12, fontSize: 12, marginBottom: 14 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        <button type="submit" disabled={busy} className="dz-btn dz-btn-primary" style={{ width: "100%", padding: "12px 0", fontSize: 13.5, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {busy && <RefreshCw size={14} className="dz-spin" />}
          {busy ? "Création…" : "Créer le compte et démarrer"}
        </button>
      </form>
    </div>
  );
}

/* ========================== UTILISATEURS ==================================== */
function Utilisateurs({ theme, dark, users, setUsers, revendeurs, setRevendeurs, showToast, addActivity, currentUser, canManage, isCommercial, syncedUserIds }) {
  const [editing, setEditing] = useState(null);
  const [showPwd, setShowPwd] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const adminCount = users.filter((u) => u.role === "admin" && (u.statut || "Actif") === "Actif").length;
  const canCreate = canManage || isCommercial;
  const canTouchTarget = (u) => canManage || (isCommercial && u.role === "revendeur");

  function openNew() {
    setEditing({ id: null, nom: "", identifiant: "", motDePasse: "", role: isCommercial && !canManage ? "revendeur" : "revendeur", statut: "Actif", revendeurId: "" });
    setShowPwd(false); setNewPwd("");
  }
  function openEdit(u) {
    setEditing({ ...u });
    setShowPwd(false); setNewPwd("");
  }

  async function save(u) {
    if (!u.nom.trim() || !u.identifiant.trim()) { showToast("Nom et identifiant requis", "error"); return; }
    if (isCommercial && !canManage && u.role !== "revendeur") { showToast("Le rôle Commercial ne peut créer que des comptes Revendeur", "error"); return; }
    const dupId = users.find((x) => x.id !== u.id && x.identifiant.toLowerCase() === u.identifiant.trim().toLowerCase());
    if (dupId) { showToast("Cet identifiant est déjà utilisé", "error"); return; }

    setBusy(true);
    // Belt-and-suspenders: even though saveKey/loadKey already time out on their own,
    // never let this button visually hang forever no matter what goes wrong underneath.
    const watchdog = window.setTimeout(() => {
      setBusy(false);
      showToast("Délai dépassé — vérifiez la liste ci-dessous avant de réessayer.", "error");
    }, 30000);
    const liveUsers = await loadKey("diafa:users", users);

    if (u.id) {
      if (!canTouchTarget(u)) { window.clearTimeout(watchdog); showToast("Modification non autorisée pour ce compte", "error"); setBusy(false); return; }
      const updated = liveUsers.map((x) => x.id === u.id ? { ...x, nom: u.nom.trim(), identifiant: u.identifiant.trim(), role: canManage ? u.role : x.role, statut: u.statut, revendeurId: u.revendeurId || null } : x);
      setUsers(updated); // local immediately + retried by the write layer
      // Keep the LINKED reseller's name in sync so reports/soldes reflect the new name.
      if (u.revendeurId && setRevendeurs) {
        setRevendeurs((prev) => prev.map((r) => (r.id === u.revendeurId && r.nom !== u.nom.trim()) ? { ...r, nom: u.nom.trim() } : r));
      }
      const ok = await saveKey("diafa:users", updated); // confirm it reached the server now
      window.clearTimeout(watchdog);
      setBusy(false);
      addActivity("Utilisateur modifié", u.nom);
      showToast(ok
        ? "Utilisateur mis à jour et enregistré."
        : "Modifié localement mais PAS encore enregistré sur le serveur (bandeau rouge) — la synchro se refait automatiquement dès que la connexion revient.", ok ? "success" : "error");
      setEditing(null);
      return;
    }

    if (!u.motDePasse || u.motDePasse.length < 6) { window.clearTimeout(watchdog); showToast("Mot de passe requis (6 caractères minimum)", "error"); setBusy(false); return; }
    const profile = { id: uid(), nom: u.nom.trim(), identifiant: u.identifiant.trim(), role: u.role, statut: u.statut, revendeurId: u.revendeurId || null, pwHash: obfuscate(u.motDePasse) };
    const updated = [...liveUsers, profile];
    setUsers(updated); // appears immediately + retried by the write layer
    const ok = await saveKey("diafa:users", updated); // did it actually reach the server?
    window.clearTimeout(watchdog);
    setBusy(false);
    addActivity("Utilisateur ajouté", `${u.nom} (${u.role})`);
    showToast(ok
      ? `Compte « ${u.identifiant.trim()} » créé et enregistré — le revendeur peut se connecter.`
      : "Compte créé localement mais PAS ENCORE enregistré sur le serveur (voir le bandeau rouge). Le revendeur ne pourra se connecter qu'une fois la synchro réussie — elle se refait toute seule dès que la connexion/le quota reviennent.", ok ? "success" : "error");
    setEditing(null);
  }

  async function changePassword(u) {
    if (!newPwd || newPwd.length < 6) { showToast("Nouveau mot de passe : 6 caractères minimum", "error"); return; }
    if (!canTouchTarget(u)) { showToast("Non autorisé pour ce compte", "error"); return; }
    setBusy(true);
    const liveUsers = await loadKey("diafa:users", users);
    const updated = liveUsers.map((x) => x.id === u.id ? { ...x, pwHash: obfuscate(newPwd) } : x);
    setBusy(false);
    setUsers(updated); // persisted + retried by the write layer until it reaches the server & other devices
    addActivity("Mot de passe changé", u.nom);
    showToast(`Mot de passe de ${u.nom} mis à jour`);
    setNewPwd("");
    setEditing({ ...u, pwHash: obfuscate(newPwd) });
  }

  async function remove(u) {
    if (isCommercial && !canManage && u.role !== "revendeur") { showToast("Le rôle Commercial ne peut supprimer que des comptes Revendeur", "error"); return; }
    if (u.role === "admin" && adminCount <= 1) { showToast("Impossible de supprimer le dernier compte administrateur", "error"); return; }
    if (u.id === currentUser.id) { showToast("Vous ne pouvez pas supprimer votre propre compte connecté", "error"); return; }
    const liveUsers = await loadKey("diafa:users", users);
    const updated = liveUsers.filter((x) => x.id !== u.id);
    setUsers(updated); // persisted + retried by the write layer until it reaches the server & other devices
    addActivity("Utilisateur supprimé", u.nom);
    showToast("Utilisateur supprimé — son accès est révoqué immédiatement");
  }

  return (
    <div>
      <div className="dz-card" style={{ padding: "10px 16px", fontSize: 12, color: theme.sub, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldCheck size={14} color={COLORS.secondary} />
        <b>Administrateur</b> : accès total. <b>Superviseur</b> : comme admin, sauf réinitialisation complète. <b>Commercial</b> : voit tout, ne peut créer/supprimer que des comptes Revendeur. <b>Revendeur</b> : accès limité à ses propres données.
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: theme.sub, alignSelf: "center" }}>{fmtInt(users.length)} compte(s)</div>
        {canCreate && (
          <button className="dz-btn" onClick={openNew}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Nouvel utilisateur
          </button>
        )}
      </div>

      <div className="dz-card" style={{ overflow: "hidden" }}>
        <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.nom} {u.id === currentUser.id && <span style={{ color: theme.sub, fontWeight: 400 }}>(vous)</span>}</td>
                <td style={{ color: theme.sub, fontFamily: "monospace" }}>
                  <div>{u.identifiant}</div>
                  {(syncedUserIds || []).includes(u.id)
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.secondary, display: "inline-flex", alignItems: "center", gap: 3, marginTop: 3, fontFamily: "Inter, sans-serif" }}><CheckCircle2 size={11} /> Synchronisé</span>
                    : <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.accent, marginTop: 3, display: "inline-block", fontFamily: "Inter, sans-serif" }}>⏳ Synchro en cours…</span>}
                </td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: (u.role === "admin" ? COLORS.primary : u.role === "superviseur" ? "#0EA5E9" : u.role === "commercial" ? "#8B5CF6" : COLORS.secondary) + "18", color: u.role === "admin" ? COLORS.primary : u.role === "superviseur" ? "#0EA5E9" : u.role === "commercial" ? "#8B5CF6" : COLORS.secondary }}>
                    {u.role === "admin" ? "Administrateur" : u.role === "superviseur" ? "Superviseur" : u.role === "commercial" ? "Commercial" : "Revendeur"}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: (u.statut || "Actif") === "Actif" ? COLORS.secondary + "18" : theme.sub + "22", color: (u.statut || "Actif") === "Actif" ? COLORS.secondary : theme.sub }}>
                    {u.statut || "Actif"}
                  </span>
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {canTouchTarget(u) ? (
                    <>
                      <button className="dz-btn" onClick={() => openEdit(u)} style={{ background: "transparent", color: theme.sub, padding: 5 }}><Pencil size={14} /></button>
                      <button className="dz-btn" onClick={() => remove(u)} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><Trash2 size={14} /></button>
                    </>
                  ) : <span style={{ color: theme.sub, fontSize: 11 }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal theme={theme} onClose={() => setEditing(null)} title={editing.id ? "Modifier l'utilisateur" : "Nouvel utilisateur"}>
          <Field label="Nom complet" theme={theme}><input className="dz-input" value={editing.nom} onChange={(e) => setEditing({ ...editing, nom: e.target.value })} /></Field>
          <Field label="Identifiant" theme={theme}>
            <input className="dz-input" value={editing.identifiant} autoComplete="off" name="dz-nouvel-identifiant" spellCheck={false}
              placeholder="ex. Moussa1"
              onChange={(e) => setEditing({ ...editing, identifiant: e.target.value })} />
            {editing.id && <div style={{ fontSize: 11, color: theme.sub, marginTop: 4 }}>C'est l'identifiant de connexion. Le modifier change la façon dont ce compte se connecte.</div>}
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Rôle" theme={theme}>
                {isCommercial && !canManage ? (
                  <input className="dz-input" value="Revendeur" disabled style={{ opacity: .7 }} />
                ) : (
                  <select className="dz-input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                    <option value="admin">Administrateur</option>
                    <option value="superviseur">Superviseur</option>
                    <option value="commercial">Commercial</option>
                    <option value="revendeur">Revendeur</option>
                  </select>
                )}
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Statut" theme={theme}>
                <select className="dz-input" value={editing.statut} onChange={(e) => setEditing({ ...editing, statut: e.target.value })}>
                  <option value="Actif">Actif</option>
                  <option value="Inactif">Inactif</option>
                </select>
              </Field>
            </div>
          </div>
          {editing.role === "revendeur" && (
            <Field label="Lier à un revendeur (optionnel)" theme={theme}>
              <select className="dz-input" value={editing.revendeurId || ""} onChange={(e) => setEditing({ ...editing, revendeurId: e.target.value })}>
                <option value="">— Aucun —</option>
                {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
              </select>
            </Field>
          )}
          {!editing.id ? (
            <Field label="Mot de passe (6 caractères min.)" theme={theme}>
              <input className="dz-input" type="password" autoComplete="new-password" name="dz-nouveau-motdepasse" value={editing.motDePasse} onChange={(e) => setEditing({ ...editing, motDePasse: e.target.value })} />
            </Field>
          ) : (
            <div style={{ background: dark ? "#0F172A" : "#F8FAFC", padding: 12, borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: theme.sub, marginBottom: 8 }}>MOT DE PASSE</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div className="dz-input" style={{ flex: 1, fontFamily: "monospace", background: theme.card || "#fff" }}>
                  {showPwd ? deobfuscate(editing.pwHash) : "••••••••"}
                </div>
                <button type="button" className="dz-btn" onClick={() => setShowPwd((s) => !s)}
                  style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.sub, padding: "9px 10px", borderRadius: 11 }}>
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="dz-input" type="text" autoComplete="new-password" name="dz-changer-motdepasse" placeholder="Nouveau mot de passe" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
                <button type="button" className="dz-btn" disabled={busy} onClick={() => changePassword(editing)}
                  style={{ background: GRAD.primary, color: "#fff", padding: "9px 14px", borderRadius: 11, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", opacity: busy ? .6 : 1 }}>
                  {busy ? "…" : "Changer"}
                </button>
              </div>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setEditing(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={busy} onClick={() => save(editing)} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Enregistrer"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ========================== SOLDES REVENDEURS ============================ */
function periodBounds(period, refDate) {
  const now = refDate || new Date();
  if (period === "semaine") {
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(now.getDate() - now.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 7);
    return [start, end];
  }
  if (period === "mois") {
    return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)];
  }
  return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
}

function Soldes({ theme, dark, tickets, revendeurs, depenses, settings, currentUser, isRevendeurRole, openWeekTickets, lastClosedTicket }) {
  const [period, setPeriod] = useState("semaine");
  const commission = settings.commissionParTicket || 1000;

  const withDate = useMemo(
    () => tickets.map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) })),
    [tickets]
  );

  const scope = isRevendeurRole ? revendeurs.filter((r) => r.id === currentUser.revendeurId) : revendeurs;

  // "Cette semaine" must mean the same thing everywhere in the app: tickets imported since
  // the last clôturée week (by ticket number), not a calendar-date range — otherwise
  // importing an older Mikhmon file would show nothing here even though it shows up
  // correctly in Classements/Rapport Hebdomadaire.
  const periodTickets = useMemo(() => {
    if (period === "semaine") return openWeekTickets;
    const now = new Date();
    if (period === "mois") return withDate.filter((t) => t._d && t._d.getMonth() === now.getMonth() && t._d.getFullYear() === now.getFullYear());
    return withDate.filter((t) => t._d && t._d.getFullYear() === now.getFullYear()); // "annee"
  }, [period, openWeekTickets, withDate]);

  const [depStart, depEnd] = period === "semaine" ? [null, null] : periodBounds(period === "mois" ? "mois" : "annee");

  const rows = useMemo(() => {
    return scope.map((r) => {
      const myTickets = periodTickets.filter((t) => t.revendeurId === r.id);
      // Dépenses are tracked separately and taken in charge by the entreprise — they never
      // reduce what a revendeur is owed. Shown here purely for information.
      const depensesValidees = period === "semaine"
        ? 0 // "semaine en cours" has no fixed calendar bounds to match a date-based expense against
        : depenses
            .filter((d) => d.revendeurId === r.id && d.statut === "Validée" && d.date && new Date(d.date) >= depStart && new Date(d.date) < depEnd)
            .reduce((s, d) => s + (d.montant || 0), 0);
      return { revendeur: r, tickets: myTickets.length, solde: myTickets.length * commission, depensesValidees };
    }).sort((a, b) => b.solde - a.solde);
  }, [periodTickets, scope, depenses, period, commission, depStart, depEnd]);

  const totalSolde = rows.reduce((s, r) => s + r.solde, 0);
  const totalTickets = rows.reduce((s, r) => s + r.tickets, 0);

  // Company-level view: total revenue in, minus what's owed to revendeurs, minus expenses.
  const totalRentree = periodTickets.reduce((s, t) => s + t.price, 0);
  const totalDepensesEntreprise = period === "semaine" ? 0 : depenses
    .filter((d) => d.statut === "Validée" && d.date && new Date(d.date) >= depStart && new Date(d.date) < depEnd)
    .reduce((s, d) => s + (d.montant || 0), 0);
  const soldeEntreprise = totalRentree - totalSolde - totalDepensesEntreprise;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dz-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: COLORS.primary + "0c", border: `1px solid ${COLORS.primary}33` }}>
        <Wallet size={17} color={COLORS.primary} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: theme.text }}>
          Chaque ticket vendu rapporte <b>{GNF(commission)}</b> au revendeur. Les dépenses validées sont prises en charge par l'entreprise — elles n'affectent jamais ce solde.
        </div>
      </div>

      {scope.length === 0 && (
        <div className="dz-card" style={{ padding: 20, textAlign: "center", color: theme.sub, fontSize: 13 }}>
          {isRevendeurRole
            ? "Votre compte n'est pas encore lié à une fiche revendeur — demandez à un administrateur de faire ce lien dans Utilisateurs."
            : "Aucun revendeur enregistré pour l'instant — ajoutez-en dans la page Revendeurs pour voir leurs soldes ici."}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {[["semaine", "Cette semaine"], ["mois", "Ce mois"], ["annee", "Cette année"]].map(([k, label]) => (
          <button key={k} className="dz-btn" onClick={() => setPeriod(k)}
            style={{
              padding: "8px 16px", borderRadius: 11, fontSize: 12.5, fontWeight: 700,
              background: period === k ? COLORS.primary : (dark ? "#1E293B" : "#F1F5F9"),
              color: period === k ? "#fff" : theme.text,
            }}>
            {label}
          </button>
        ))}
      </div>

      {!isRevendeurRole && scope.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <KpiCard theme={theme} icon={TrendingUp} color={COLORS.primary} label="Total rentrée (CA)" value={GNF(totalRentree)} />
            <KpiCard theme={theme} icon={Wallet} color={COLORS.secondary} label="Commissions revendeurs" value={GNF(totalSolde)} />
            <KpiCard theme={theme} icon={Receipt} color={COLORS.accent} label="Dépenses (entreprise)" value={period === "semaine" ? "—" : GNF(totalDepensesEntreprise)} />
            <KpiCard theme={theme} icon={Wallet} color="#8B5CF6" label="Solde entreprise" value={period === "semaine" ? "—" : GNF(soldeEntreprise)} />
          </div>
          {period === "semaine" && (
            <div style={{ fontSize: 11.5, color: theme.sub }}>Le solde entreprise (avec dépenses) se calcule sur "Ce mois" et "Cette année" — la semaine en cours suit les numéros de tickets, pas de dates calendaires fixes pour le comparer aux dépenses.</div>
          )}
        </>
      )}

      {scope.length > 0 && (
        <div className="dz-card" style={{ overflow: "hidden" }}>
          <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th>Revendeur</th>
                <th style={{ textAlign: "right" }}>Tickets</th>
                <th style={{ textAlign: "right" }}>Solde (commission)</th>
                <th style={{ textAlign: "right" }}>Dépenses validées <span style={{ fontWeight: 400, color: theme.sub }}>(à charge entreprise)</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.revendeur.id}>
                  <td style={{ fontWeight: 600 }}>{r.revendeur.nom}</td>
                  <td style={{ textAlign: "right" }}>{fmtInt(r.tickets)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: COLORS.secondary }}>{GNF(r.solde)}</td>
                  <td style={{ textAlign: "right", color: theme.sub }}>{r.depensesValidees > 0 ? GNF(r.depensesValidees) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ========================== DÉPENSES ==================================== */
const DEPENSE_STATUTS = {
  "En attente": { color: "#F59E0B", icon: AlertTriangle },
  "Validée": { color: "#10B981", icon: CheckCircle2 },
  "Rejetée": { color: "#EF4444", icon: X },
};

function Depenses({ theme, dark, depenses, setDepenses, revendeurs, currentUser, canManage, isCommercial, isRevendeurRole, showToast, addActivity, notify }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ montant: "", motif: "", date: new Date().toISOString().slice(0, 10) });
  const [rejecting, setRejecting] = useState(null); // depense being rejected (needs a reason)
  const [rejetMotif, setRejetMotif] = useState("");
  const [filterStatut, setFilterStatut] = useState("tous");
  const [filterRevendeur, setFilterRevendeur] = useState("tous");
  const [busy, setBusy] = useState(false);

  const canValidate = canManage || isCommercial; // any of admin/superviseur/commercial can approve or reject
  const canTouchValidated = canManage; // only admin (full canManage tier restricted further below) may edit/delete once validated — actually admin only

  const isAdminOnly = (() => {
    // "canManage" covers admin+superviseur; validated expenses must be admin-only.
    return currentUser.role === "admin";
  })();

  const scoped = isRevendeurRole ? depenses.filter((d) => d.revendeurId === currentUser.revendeurId) : depenses;
  const visible = scoped
    .filter((d) => filterStatut === "tous" || d.statut === filterStatut)
    .filter((d) => isRevendeurRole || filterRevendeur === "tous" || d.revendeurId === filterRevendeur)
    .sort((a, b) => b.creeLe - a.creeLe);

  async function submitNew() {
    const montant = parseInt(form.montant, 10);
    if (!montant || montant <= 0) { showToast("Montant invalide", "error"); return; }
    if (!form.motif.trim()) { showToast("Indiquez un motif", "error"); return; }
    if (!currentUser.revendeurId) { showToast("Votre compte n'est pas lié à une fiche revendeur — contactez un administrateur.", "error"); return; }
    setBusy(true);
    const live = await loadKey("diafa:depenses", depenses);
    const entry = {
      id: uid(), revendeurId: currentUser.revendeurId, montant, motif: form.motif.trim(), date: form.date,
      statut: "En attente", creePar: currentUser.nom, creeParId: currentUser.id, creeLe: Date.now(), valideePar: null, dateValidation: null, motifRejet: null,
    };
    const updated = [...live, entry];
    const ok = await saveKey("diafa:depenses", updated);
    setBusy(false);
    if (!ok) { showToast("Échec de l'envoi — réessayez.", "error"); return; }
    setDepenses(updated);
    notify({ type: "depense", event: "nouvelle", audience: "validateurs", title: "Nouvelle dépense à valider", message: `${currentUser.nom} — ${GNF(montant)} · ${form.motif.trim()}` });
    addActivity("Dépense déclarée", `${GNF(montant)} — ${form.motif}`);
    showToast("Dépense envoyée pour validation");
    setForm({ montant: "", motif: "", date: new Date().toISOString().slice(0, 10) });
    setAdding(false);
  }

  async function removePending(d) {
    if (d.statut !== "En attente") { showToast("Seule une dépense en attente peut être supprimée", "error"); return; }
    if (isRevendeurRole && d.revendeurId !== currentUser.revendeurId) { showToast("Non autorisé", "error"); return; }
    const live = await loadKey("diafa:depenses", depenses);
    const updated = live.filter((x) => x.id !== d.id);
    const ok = await saveKey("diafa:depenses", updated);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDepenses(updated);
    addActivity("Dépense supprimée", `${GNF(d.montant)} — ${d.motif}`);
    showToast("Dépense supprimée");
  }

  async function validate(d) {
    if (!canValidate) return;
    const live = await loadKey("diafa:depenses", depenses);
    const updated = live.map((x) => x.id === d.id ? { ...x, statut: "Validée", valideePar: currentUser.nom, dateValidation: Date.now() } : x);
    const ok = await saveKey("diafa:depenses", updated);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDepenses(updated);
    notify({ type: "depense", event: "validee", audience: "user", forUserId: d.creeParId, title: "Dépense validée", message: `Votre dépense de ${GNF(d.montant)} (${d.motif}) a été validée.` });
    addActivity("Dépense validée", `${GNF(d.montant)} — ${d.motif}`);
    showToast("Dépense validée");
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(true);
    const live = await loadKey("diafa:depenses", depenses);
    const updated = live.map((x) => x.id === rejecting.id ? { ...x, statut: "Rejetée", valideePar: currentUser.nom, dateValidation: Date.now(), motifRejet: rejetMotif.trim() || null } : x);
    const ok = await saveKey("diafa:depenses", updated);
    setBusy(false);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDepenses(updated);
    notify({ type: "depense", event: "rejetee", audience: "user", forUserId: rejecting.creeParId, title: "Dépense rejetée", message: `Votre dépense de ${GNF(rejecting.montant)} (${rejecting.motif}) a été rejetée.${rejetMotif.trim() ? " Motif : " + rejetMotif.trim() : ""}` });
    addActivity("Dépense rejetée", `${GNF(rejecting.montant)} — ${rejecting.motif}`);
    showToast("Dépense rejetée");
    setRejecting(null);
    setRejetMotif("");
  }

  async function removeValidated(d) {
    if (!isAdminOnly) { showToast("Seul l'administrateur peut supprimer une dépense déjà validée/rejetée", "error"); return; }
    const live = await loadKey("diafa:depenses", depenses);
    const updated = live.filter((x) => x.id !== d.id);
    const ok = await saveKey("diafa:depenses", updated);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDepenses(updated);
    addActivity("Dépense supprimée (validée)", `${GNF(d.montant)} — ${d.motif}`);
    showToast("Dépense supprimée");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {isRevendeurRole && (
        <div className="dz-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: COLORS.primary + "0c", border: `1px solid ${COLORS.primary}33` }}>
          <Receipt size={17} color={COLORS.primary} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12.5, color: theme.text }}>
            Déclarez une dépense ici — elle doit être <b>validée par un administrateur, superviseur ou commercial</b> avant d'être prise en compte. Vous pouvez supprimer une dépense tant qu'elle est "En attente" ; une fois validée ou rejetée, seul l'administrateur peut encore la modifier.
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="dz-input" style={{ width: 160 }} value={filterStatut} onChange={(e) => setFilterStatut(e.target.value)}>
            <option value="tous">Tous les statuts</option>
            <option value="En attente">En attente</option>
            <option value="Validée">Validée</option>
            <option value="Rejetée">Rejetée</option>
          </select>
          {!isRevendeurRole && (
            <select className="dz-input" style={{ width: 200 }} value={filterRevendeur} onChange={(e) => setFilterRevendeur(e.target.value)}>
              <option value="tous">Tous les revendeurs</option>
              {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
            </select>
          )}
        </div>
        {isRevendeurRole && (
          <button className="dz-btn" onClick={() => setAdding(true)}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Déclarer une dépense
          </button>
        )}
      </div>

      <div className="dz-card" style={{ overflow: "hidden" }}>
        <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {!isRevendeurRole && <th>Revendeur</th>}
              <th>Date</th><th>Motif</th><th style={{ textAlign: "right" }}>Montant</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: theme.sub }}>Aucune dépense.</td></tr>
            ) : visible.map((d) => {
              const st = DEPENSE_STATUTS[d.statut] || DEPENSE_STATUTS["En attente"];
              const StIcon = st.icon;
              const rev = revendeurs.find((r) => r.id === d.revendeurId);
              return (
                <tr key={d.id}>
                  {!isRevendeurRole && <td style={{ fontWeight: 600 }}>{rev ? rev.nom : "—"}</td>}
                  <td style={{ color: theme.sub }}>{d.date}</td>
                  <td>{d.motif}{d.statut === "Rejetée" && d.motifRejet && <div style={{ fontSize: 11, color: COLORS.danger, marginTop: 2 }}>Motif du refus : {d.motifRejet}</div>}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{GNF(d.montant)}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: st.color + "18", color: st.color }}>
                      <StIcon size={11} /> {d.statut}
                    </span>
                    {d.statut !== "En attente" && d.valideePar && (
                      <div style={{ fontSize: 10.5, color: theme.sub, marginTop: 3 }}>par {d.valideePar}</div>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {d.statut === "En attente" && (
                      <>
                        {canValidate && (
                          <>
                            <button className="dz-btn" title="Valider" onClick={() => validate(d)} style={{ background: "transparent", color: COLORS.secondary, padding: 5 }}><CheckCircle2 size={14} /></button>
                            <button className="dz-btn" title="Rejeter" onClick={() => { setRejecting(d); setRejetMotif(""); }} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><X size={14} /></button>
                          </>
                        )}
                        {(isRevendeurRole ? d.revendeurId === currentUser.revendeurId : canManage) && (
                          <button className="dz-btn" title="Supprimer" onClick={() => removePending(d)} style={{ background: "transparent", color: theme.sub, padding: 5 }}><Trash2 size={14} /></button>
                        )}
                      </>
                    )}
                    {d.statut !== "En attente" && isAdminOnly && (
                      <button className="dz-btn" title="Supprimer (admin)" onClick={() => removeValidated(d)} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal theme={theme} onClose={() => setAdding(false)} title="Déclarer une dépense">
          <Field label="Montant (GNF)" theme={theme}>
            <input className="dz-input" type="number" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
          </Field>
          <Field label="Motif" theme={theme}>
            <input className="dz-input" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} placeholder="Ex. Achat carte de recharge" />
          </Field>
          <Field label="Date" theme={theme}>
            <input className="dz-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setAdding(false)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={busy} onClick={submitNew} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Envoyer pour validation"}</button>
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal theme={theme} onClose={() => setRejecting(null)} title="Rejeter la dépense">
          <div style={{ fontSize: 12.5, color: theme.sub, marginBottom: 12 }}>{rejecting.motif} — {GNF(rejecting.montant)}</div>
          <Field label="Motif du refus (optionnel, visible par le revendeur)" theme={theme}>
            <textarea className="dz-input" rows={3} style={{ resize: "vertical" }} value={rejetMotif} onChange={(e) => setRejetMotif(e.target.value)} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setRejecting(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={busy} onClick={reject} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Confirmer le rejet"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ========================== DASHBOARD REVENDEUR ============================ */
function DashboardRevendeur({ theme, dark, tickets, currentUser, catLabels, tarifs, settings, depenses, setPage, openWeekTickets }) {
  const L = { ...CAT_LABEL, ...(catLabels || {}) };
  const commission = settings.commissionParTicket || 1000;

  if (!currentUser.revendeurId) {
    return (
      <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
        Votre compte n'est pas encore lié à une fiche revendeur — demandez à un administrateur de faire ce lien dans <b>Utilisateurs</b> pour voir vos statistiques ici.
      </div>
    );
  }

  const myTickets = useMemo(
    () => tickets.filter((t) => t.revendeurId === currentUser.revendeurId).map((t) => ({ ...t, _d: parseMikhmonDate(t.date, t.time) })),
    [tickets, currentUser.revendeurId]
  );

  const now = new Date();
  const todayKey = dateKey(now);
  const [monthStart] = periodBounds("mois", now);
  const [yearStart] = periodBounds("annee", now);

  const countIn = (start) => myTickets.filter((t) => t._d && t._d >= start).length;
  const soldeToday = myTickets.filter((t) => t._d && dateKey(t._d) === todayKey).length * commission;
  // "Cette semaine" = tickets depuis la dernière clôture (comme Classements/Rapport
  // Hebdomadaire), pas une semaine calendaire — sinon un import de fichier plus ancien
  // afficherait 0 ici alors qu'il apparaît bien partout ailleurs.
  const soldeWeek = openWeekTickets.filter((t) => t.revendeurId === currentUser.revendeurId).length * commission;
  const soldeMonth = countIn(monthStart) * commission;
  const soldeYear = countIn(yearStart) * commission;

  const depensesEnAttente = depenses.filter((d) => d.revendeurId === currentUser.revendeurId && d.statut === "En attente").length;

  const last7 = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = dateKey(d);
      const count = myTickets.filter((t) => t._d && dateKey(t._d) === key).length;
      days.push({ label: d.toLocaleDateString("fr-FR", { weekday: "short" }), solde: count * commission });
    }
    return days;
  }, [myTickets, commission]);

  const byCat = useMemo(() => {
    const acc = {};
    myTickets.forEach((t) => { const c = catOfPrice(t.price); acc[c] = (acc[c] || 0) + 1; });
    return Object.entries(acc).map(([k, v]) => ({ name: L[k] || CAT_LABEL[k] || k, value: v }));
  }, [myTickets]);
  const PIE_COLORS = [COLORS.primary, COLORS.secondary, COLORS.accent, "#8B5CF6", COLORS.danger, "#64748B"];

  const recent = myTickets.slice().sort((a, b) => b.globalId - a.globalId).slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dz-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: COLORS.primary + "0c", border: `1px solid ${COLORS.primary}33` }}>
        <Award size={17} color={COLORS.primary} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: theme.text }}>
          Bienvenue {currentUser.nom} — {GNF(commission)} par ticket vendu. Pour voir votre position face aux autres, direction <b>Classements</b>.
        </div>
      </div>

      {depensesEnAttente > 0 && (
        <div className="dz-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: COLORS.accent + "12", border: `1px solid ${COLORS.accent}44`, cursor: "pointer" }}
          onClick={() => setPage("depenses")}>
          <Receipt size={17} color={COLORS.accent} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 12.5, color: theme.text }}>
            Vous avez <b>{depensesEnAttente}</b> dépense(s) en attente de validation. <span style={{ color: COLORS.primary, fontWeight: 700 }}>Voir →</span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard theme={theme} icon={Wallet} color={COLORS.primary} label="Mon solde aujourd'hui" value={GNF(soldeToday)} />
        <KpiCard theme={theme} icon={Wallet} color={COLORS.secondary} label="Mon solde (semaine)" value={GNF(soldeWeek)} />
        <KpiCard theme={theme} icon={CalendarRange} color={COLORS.accent} label="Mon solde (mois)" value={GNF(soldeMonth)} />
        <KpiCard theme={theme} icon={Wallet} color="#8B5CF6" label="Mon solde (année)" value={GNF(soldeYear)} />
        <KpiCard theme={theme} icon={Ticket} color={COLORS.primary} label="Mes tickets (total)" value={fmtInt(myTickets.length)} />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="dz-card" style={{ flex: "2 1 380px", padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Mon solde — 7 derniers jours</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={last7}>
              <defs>
                <linearGradient id="dzGradRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: theme.sub }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => (v >= 1000 ? v / 1000 + "k" : v)} />
              <Tooltip formatter={(v) => GNF(v)} contentStyle={{ borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 12 }} />
              <Area type="monotone" dataKey="solde" stroke={COLORS.primary} strokeWidth={2.5} fill="url(#dzGradRev)">
                <LabelList dataKey="solde" position="top" offset={9} style={{ fontSize: 9.5, fontWeight: 700, fill: theme.sub }} formatter={(v) => (v >= 1000 ? Math.round(v / 1000) + "k" : v || "")} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="dz-card" style={{ flex: "1 1 220px", padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Mes ventes par forfait</div>
          {byCat.length === 0 ? (
            <div style={{ color: theme.sub, fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>Aucune vente pour le moment</div>
          ) : (
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={40} outerRadius={65} paddingAngle={2}>
                  {byCat.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="dz-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em", marginBottom: 12 }}>Mes derniers tickets vendus</div>
        {recent.length === 0 ? (
          <div style={{ color: theme.sub, fontSize: 12.5 }}>Aucun ticket pour le moment.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th>#</th><th>Date</th><th>Heure</th><th>Username</th><th>Profil</th><th style={{ textAlign: "right" }}>Ma commission</th></tr></thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.globalId}>
                    <td style={{ fontWeight: 700 }}>№{t.num}</td>
                    <td>{t.date}</td>
                    <td style={{ color: theme.sub }}>{t.time}</td>
                    <td style={{ fontWeight: 600 }}>{t.username}</td>
                    <td>{L[catOfPrice(t.price)] || t.profile}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: COLORS.secondary }}>{GNF(commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================== STOCK TICKETS ============================ */
function StockTickets({ theme, dark, tickets, revendeurs, stockLots, setStockLots, currentUser, isRevendeurRole, canManage, isCommercial, catLabels, showToast, addActivity }) {
  const L = { ...CAT_LABEL, ...(catLabels || {}) };
  const CATS = ["heure", "jour", "semaine", "mois"];
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ revendeurId: "", categorie: "heure", quantite: "", note: "" });
  const canAllocate = canManage || isCommercial;

  const scope = isRevendeurRole ? revendeurs.filter((r) => r.id === currentUser.revendeurId) : revendeurs;

  const rows = useMemo(() => {
    return scope.map((r) => {
      const parCategorie = CATS.map((cat) => {
        const alloue = stockLots.filter((l) => l.revendeurId === r.id && l.categorie === cat).reduce((s, l) => s + l.quantite, 0);
        const vendu = tickets.filter((t) => t.revendeurId === r.id && catOfPrice(t.price) === cat).length;
        return { cat, alloue, vendu, restant: alloue - vendu };
      }).filter((c) => c.alloue > 0);
      return { revendeur: r, parCategorie, totalAlloue: parCategorie.reduce((s, c) => s + c.alloue, 0), totalRestant: parCategorie.reduce((s, c) => s + c.restant, 0) };
    }).filter((r) => r.parCategorie.length > 0 || !isRevendeurRole);
  }, [scope, stockLots, tickets]);

  async function submitLot() {
    if (!form.revendeurId) { showToast("Choisissez un revendeur", "error"); return; }
    const qty = parseInt(form.quantite, 10);
    if (!qty || qty <= 0) { showToast("Quantité invalide", "error"); return; }
    const live = await loadKey("diafa:stockLots", stockLots);
    const lot = { id: uid(), revendeurId: form.revendeurId, categorie: form.categorie, quantite: qty, note: form.note.trim(), dateAjout: Date.now() };
    const updated = [...live, lot];
    const ok = await saveKey("diafa:stockLots", updated);
    if (!ok) { showToast("Échec de l'enregistrement — réessayez.", "error"); return; }
    setStockLots(updated);
    const revNom = revendeurs.find((r) => r.id === form.revendeurId)?.nom || "";
    addActivity("Lot de tickets attribué", `${fmtInt(qty)} × ${L[form.categorie]} — ${revNom}`);
    showToast("Lot ajouté au stock");
    setForm({ revendeurId: "", categorie: "heure", quantite: "", note: "" });
    setAdding(false);
  }

  async function removeLot(lot) {
    if (!canManage) { showToast("Réservé aux administrateurs/superviseurs", "error"); return; }
    const live = await loadKey("diafa:stockLots", stockLots);
    const updated = live.filter((x) => x.id !== lot.id);
    const ok = await saveKey("diafa:stockLots", updated);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setStockLots(updated);
    addActivity("Lot de tickets supprimé", `${fmtInt(lot.quantite)} × ${L[lot.categorie]}`);
    showToast("Lot supprimé");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dz-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, background: COLORS.primary + "0c", border: `1px solid ${COLORS.primary}33` }}>
        <Archive size={17} color={COLORS.primary} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: 12.5, color: theme.text }}>
          Indiquez la quantité de tickets remise à chaque revendeur par forfait — le "restant" se met à jour automatiquement dès qu'un import CSV enregistre des ventes.
        </div>
      </div>

      {canAllocate && (
        <div>
          <button className="dz-btn" onClick={() => setAdding(true)}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Attribuer un lot de tickets
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="dz-card" style={{ padding: 30, textAlign: "center", color: theme.sub, fontSize: 13 }}>
          {isRevendeurRole ? "Aucun lot de tickets ne vous a encore été attribué." : "Aucun lot attribué pour l'instant."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map(({ revendeur, parCategorie, totalRestant }) => (
            <div key={revendeur.id} className="dz-card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{revendeur.nom}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: totalRestant <= 5 ? COLORS.danger : COLORS.secondary }}>
                  {fmtInt(totalRestant)} ticket(s) restant(s) au total
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {parCategorie.map((c) => (
                  <div key={c.cat} style={{ flex: "1 1 140px", padding: 10, borderRadius: 11, background: dark ? "#0F172A" : "#F8FAFC", border: `1px solid ${theme.border}` }}>
                    <div style={{ fontSize: 11, color: theme.sub, fontWeight: 600, marginBottom: 4 }}>{L[c.cat] || c.cat}</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: c.restant <= 5 ? COLORS.danger : theme.text }}>{fmtInt(c.restant)}</div>
                    <div style={{ fontSize: 10.5, color: theme.sub }}>{fmtInt(c.vendu)} vendus / {fmtInt(c.alloue)} reçus</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && stockLots.length > 0 && (
        <div className="dz-card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", fontWeight: 700, fontSize: 12.5, borderBottom: `1px solid ${theme.border}` }}>Historique des lots attribués</div>
          <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th>Date</th><th>Revendeur</th><th>Forfait</th><th style={{ textAlign: "right" }}>Quantité</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {stockLots.slice().sort((a, b) => b.dateAjout - a.dateAjout).map((lot) => (
                <tr key={lot.id}>
                  <td style={{ color: theme.sub }}>{new Date(lot.dateAjout).toLocaleDateString("fr-FR")}</td>
                  <td style={{ fontWeight: 600 }}>{revendeurs.find((r) => r.id === lot.revendeurId)?.nom || "—"}</td>
                  <td>{L[lot.categorie] || lot.categorie}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtInt(lot.quantite)}</td>
                  <td style={{ color: theme.sub }}>{lot.note || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="dz-btn" onClick={() => removeLot(lot)} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal theme={theme} onClose={() => setAdding(false)} title="Attribuer un lot de tickets">
          <Field label="Revendeur" theme={theme}>
            <select className="dz-input" value={form.revendeurId} onChange={(e) => setForm({ ...form, revendeurId: e.target.value })}>
              <option value="">— Choisir —</option>
              {revendeurs.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
            </select>
          </Field>
          <Field label="Forfait" theme={theme}>
            <select className="dz-input" value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c}>{L[c] || c}</option>)}
            </select>
          </Field>
          <Field label="Quantité reçue" theme={theme}>
            <input className="dz-input" type="number" value={form.quantite} onChange={(e) => setForm({ ...form, quantite: e.target.value })} placeholder="Ex. 150" />
          </Field>
          <Field label="Note (optionnel)" theme={theme}>
            <input className="dz-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ex. lot du 22/07" />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setAdding(false)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" onClick={submitLot} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Ajouter au stock</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ========================== DEMANDES DE TICKETS ============================ */
const DEMANDE_STATUTS = {
  "En attente": { color: "#F59E0B", icon: AlertTriangle },
  "Fournie": { color: "#10B981", icon: CheckCircle2 },
  "Rejetée": { color: "#EF4444", icon: X },
};

function DemandesTickets({ theme, dark, demandes, setDemandes, stockLots, setStockLots, revendeurs, setRevendeurs, currentUser, isRevendeurRole, canManage, isCommercial, catLabels, showToast, addActivity, notify }) {
  const L = { ...CAT_LABEL, ...(catLabels || {}) };
  const CATS = ["heure", "jour", "semaine", "mois"];
  const canValidate = canManage || isCommercial;

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ categorie: "heure", quantite: "", note: "", whatsapp: "" });
  const [fulfilling, setFulfilling] = useState(null); // demande being fulfilled
  const [fulfillQty, setFulfillQty] = useState("");
  const [fulfillWa, setFulfillWa] = useState("");
  const [fulfillPrefixes, setFulfillPrefixes] = useState("");
  const [rejecting, setRejecting] = useState(null);
  const [rejetMotif, setRejetMotif] = useState("");
  const [busy, setBusy] = useState(false);

  // Turn a typed number into a WhatsApp international number (Guinea +224 by default for local numbers).
  const waDigits = (raw) => { let n = (raw || "").replace(/\D/g, ""); if (n && n.length <= 9) n = "224" + n; return n; };

  const scoped = isRevendeurRole ? demandes.filter((d) => d.revendeurId === currentUser.revendeurId) : demandes;
  const visible = scoped.slice().sort((a, b) => b.creeLe - a.creeLe);

  async function submitDemande() {
    const qty = parseInt(form.quantite, 10);
    if (!qty || qty <= 0) { showToast("Quantité invalide", "error"); return; }
    if (!waDigits(form.whatsapp)) { showToast("Numéro WhatsApp requis (pour recevoir les tickets)", "error"); return; }
    if (!currentUser.revendeurId) { showToast("Votre compte n'est pas lié à une fiche revendeur — contactez un administrateur.", "error"); return; }
    setBusy(true);
    const live = await loadKey("diafa:demandesTickets", demandes);
    const entry = {
      id: uid(), revendeurId: currentUser.revendeurId, categorie: form.categorie, quantiteDemandee: qty, note: form.note.trim(), whatsapp: form.whatsapp.trim(),
      statut: "En attente", creePar: currentUser.nom, creeParId: currentUser.id, creeLe: Date.now(),
      quantiteFournie: null, fichierNom: null, fichierUrl: null, fournieePar: null, dateFourniture: null, motifRejet: null,
    };
    const updated = [...live, entry];
    const ok = await saveKey("diafa:demandesTickets", updated);
    setBusy(false);
    if (!ok) { showToast("Échec de l'envoi — réessayez.", "error"); return; }
    setDemandes(updated);
    notify({ type: "demande_ticket", event: "nouvelle", audience: "validateurs", title: "Nouvelle demande de tickets", message: `${currentUser.nom} — ${fmtInt(qty)} × ${L[form.categorie] || form.categorie}` });
    addActivity("Demande de tickets", `${fmtInt(qty)} × ${L[form.categorie]}`);
    showToast("Demande envoyée");
    setForm({ categorie: "heure", quantite: "", note: "", whatsapp: "" });
    setAdding(false);
  }

  async function cancelPending(d) {
    if (d.statut !== "En attente") { showToast("Seule une demande en attente peut être annulée", "error"); return; }
    if (isRevendeurRole && d.revendeurId !== currentUser.revendeurId) { showToast("Non autorisé", "error"); return; }
    const live = await loadKey("diafa:demandesTickets", demandes);
    const updated = live.filter((x) => x.id !== d.id);
    const ok = await saveKey("diafa:demandesTickets", updated);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDemandes(updated);
    addActivity("Demande de tickets annulée", `${fmtInt(d.quantiteDemandee)} × ${L[d.categorie]}`);
    showToast("Demande annulée");
  }

  function openFulfill(d) {
    setFulfilling(d);
    setFulfillQty(String(d.quantiteDemandee));
    setFulfillWa(d.whatsapp || "");
    setFulfillPrefixes("");
  }

  async function confirmFulfill() {
    const d = fulfilling;
    const qty = parseInt(fulfillQty, 10);
    if (!qty || qty <= 0) { showToast("Quantité fournie invalide", "error"); return; }
    const waNum = waDigits(fulfillWa);
    if (!waNum) { showToast("Numéro WhatsApp requis pour envoyer les tickets", "error"); return; }
    // Open WhatsApp right away (must stay inside the click gesture to avoid popup blocking).
    const revNom = revendeurs.find((r) => r.id === d.revendeurId)?.nom || "";
    const msg = `Bonjour${revNom ? " " + revNom : ""}, voici vos ${fmtInt(qty)} tickets ${L[d.categorie] || d.categorie} (demande du ${new Date(d.creeLe).toLocaleDateString("fr-FR")}). Le fichier des tickets est en pièce jointe.`;
    window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`, "_blank");
    setBusy(true);
    try {
      const liveDemandes = await loadKey("diafa:demandesTickets", demandes);
      const updatedDemandes = liveDemandes.map((x) => x.id === d.id ? {
        ...x, statut: "Fournie", quantiteFournie: qty, fichierUrl: null, whatsapp: fulfillWa.trim(),
        fournieePar: currentUser.nom, dateFourniture: Date.now(),
      } : x);
      const ok1 = await saveKey("diafa:demandesTickets", updatedDemandes);

      // Feed the stock ledger automatically — one less manual step for the admin.
      const liveLots = await loadKey("diafa:stockLots", stockLots);
      const revLotCount = liveLots.filter((l) => l.revendeurId === d.revendeurId).length;
      const now = new Date();
      const lotNom = `LOT${revLotCount + 1}-${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`;
      const lot = { id: uid(), revendeurId: d.revendeurId, categorie: d.categorie, quantite: qty, lotNom, note: lotNom, fichierUrl: null, dateAjout: Date.now() };
      const updatedLots = [...liveLots, lot];
      const ok2 = await saveKey("diafa:stockLots", updatedLots);

      setBusy(false);
      if (!ok1 || !ok2) { showToast("Écriture partielle — vérifiez la liste avant de réessayer.", "error"); return; }
      setDemandes(updatedDemandes);
      setStockLots(updatedLots);
      // Register the given ticket prefixes on the reseller so future imports auto-assign them.
      const rawPfx = (fulfillPrefixes || "").split(/[\s,;]+/).map((p) => p.trim().slice(0, 2)).filter((p) => p.length === 2);
      if (rawPfx.length && setRevendeurs) {
        setRevendeurs((prev) => prev.map((r) => {
          if (r.id !== d.revendeurId) return r;
          const existing = new Set((r.codes || []).map((c) => c.toLowerCase()));
          const added = rawPfx.filter((p) => !existing.has(p.toLowerCase()));
          return added.length ? { ...r, codes: [...(r.codes || []), ...added] } : r;
        }));
      }
      notify({ type: "demande_ticket", event: "validee", audience: "user", forUserId: d.creeParId, title: "Demande de tickets fournie", message: `Votre demande (${fmtInt(qty)} × ${L[d.categorie] || d.categorie}) a été validée. Vos tickets vous sont envoyés par WhatsApp.` });
      addActivity("Demande de tickets fournie", `${fmtInt(qty)} × ${L[d.categorie]} — ${revNom}`);
      showToast("Validé — WhatsApp ouvert : joignez le fichier des tickets et envoyez.");
      setFulfilling(null);
    } catch (err) {
      setBusy(false);
      showToast("Échec de l'enregistrement — réessayez.", "error");
    }
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(true);
    const live = await loadKey("diafa:demandesTickets", demandes);
    const updated = live.map((x) => x.id === rejecting.id ? { ...x, statut: "Rejetée", fournieePar: currentUser.nom, dateFourniture: Date.now(), motifRejet: rejetMotif.trim() || null } : x);
    const ok = await saveKey("diafa:demandesTickets", updated);
    setBusy(false);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDemandes(updated);
    notify({ type: "demande_ticket", event: "rejetee", audience: "user", forUserId: rejecting.creeParId, title: "Demande de tickets rejetée", message: `Votre demande (${fmtInt(rejecting.quantiteDemandee)} × ${L[rejecting.categorie] || rejecting.categorie}) a été rejetée.${rejetMotif.trim() ? " Motif : " + rejetMotif.trim() : ""}` });
    addActivity("Demande de tickets rejetée", `${fmtInt(rejecting.quantiteDemandee)} × ${L[rejecting.categorie]}`);
    showToast("Demande rejetée");
    setRejecting(null);
    setRejetMotif("");
  }

  async function removeWithFile(d) {
    if (!canManage && !isCommercial) { showToast("Réservé à Admin/Superviseur/Commercial", "error"); return; }
    const live = await loadKey("diafa:demandesTickets", demandes);
    const updated = live.filter((x) => x.id !== d.id);
    const ok = await saveKey("diafa:demandesTickets", updated);
    if (!ok) { showToast("Échec — réessayez.", "error"); return; }
    setDemandes(updated);
    addActivity("Demande de tickets supprimée", `${fmtInt(d.quantiteDemandee)} × ${L[d.categorie]}`);
    showToast("Demande supprimée — pensez aussi à supprimer le fichier là où vous l'aviez déposé (Drive, WhatsApp...)");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="dz-card" style={{ padding: "10px 16px", fontSize: 12, color: theme.sub, display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldCheck size={14} color={COLORS.secondary} />
        Le fichier de tickets ajouté par un lot fourni ne peut être supprimé que par Admin, Superviseur ou Commercial — jamais par le revendeur, même le sien.
      </div>

      {isRevendeurRole && (
        <div>
          <button className="dz-btn" onClick={() => setAdding(true)}
            style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={15} /> Nouvelle demande de tickets
          </button>
        </div>
      )}

      <div className="dz-card" style={{ overflow: "hidden" }}>
        <table className="dz-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {!isRevendeurRole && <th>Revendeur</th>}
              <th>Date</th><th>Forfait</th><th style={{ textAlign: "right" }}>Demandé</th><th style={{ textAlign: "right" }}>Fourni</th><th>Statut</th><th>WhatsApp</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 24, color: theme.sub }}>Aucune demande.</td></tr>
            ) : visible.map((d) => {
              const st = DEMANDE_STATUTS[d.statut] || DEMANDE_STATUTS["En attente"];
              const StIcon = st.icon;
              const rev = revendeurs.find((r) => r.id === d.revendeurId);
              return (
                <tr key={d.id}>
                  {!isRevendeurRole && <td style={{ fontWeight: 600 }}>{rev ? rev.nom : "—"}</td>}
                  <td style={{ color: theme.sub }}>{new Date(d.creeLe).toLocaleDateString("fr-FR")}</td>
                  <td>{L[d.categorie] || d.categorie}{d.note && <div style={{ fontSize: 11, color: theme.sub }}>{d.note}</div>}</td>
                  <td style={{ textAlign: "right" }}>{fmtInt(d.quantiteDemandee)}</td>
                  <td style={{ textAlign: "right", fontWeight: d.quantiteFournie ? 700 : 400 }}>{d.quantiteFournie != null ? fmtInt(d.quantiteFournie) : "—"}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: st.color + "18", color: st.color }}>
                      <StIcon size={11} /> {d.statut}
                    </span>
                    {d.statut === "Rejetée" && d.motifRejet && <div style={{ fontSize: 10.5, color: COLORS.danger, marginTop: 3 }}>{d.motifRejet}</div>}
                  </td>
                  <td>
                    {d.statut === "Fournie" && d.whatsapp && canValidate ? (
                      <button className="dz-btn" title="Renvoyer par WhatsApp"
                        onClick={() => { const revNom = revendeurs.find((r) => r.id === d.revendeurId)?.nom || ""; const msg = `Bonjour${revNom ? " " + revNom : ""}, voici vos ${fmtInt(d.quantiteFournie || d.quantiteDemandee)} tickets ${L[d.categorie] || d.categorie}. Le fichier des tickets est en pièce jointe.`; window.open(`https://wa.me/${waDigits(d.whatsapp)}?text=${encodeURIComponent(msg)}`, "_blank"); }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, color: COLORS.secondary, background: "transparent", fontSize: 12, fontWeight: 700, padding: 0 }}>
                        <Share2 size={12} /> WhatsApp
                      </button>
                    ) : <span style={{ color: theme.sub, fontSize: 11 }}>{d.whatsapp || "—"}</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {d.statut === "En attente" && (
                      <>
                        {canValidate && (
                          <>
                            <button className="dz-btn" title="Fournir les tickets" onClick={() => openFulfill(d)} style={{ background: "transparent", color: COLORS.secondary, padding: 5 }}><CheckCircle2 size={14} /></button>
                            <button className="dz-btn" title="Rejeter" onClick={() => { setRejecting(d); setRejetMotif(""); }} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><X size={14} /></button>
                          </>
                        )}
                        {(isRevendeurRole ? d.revendeurId === currentUser.revendeurId : canManage) && (
                          <button className="dz-btn" title="Annuler" onClick={() => cancelPending(d)} style={{ background: "transparent", color: theme.sub, padding: 5 }}><Trash2 size={14} /></button>
                        )}
                      </>
                    )}
                    {d.statut !== "En attente" && (canManage || isCommercial) && (
                      <button className="dz-btn" title="Supprimer" onClick={() => removeWithFile(d)} style={{ background: "transparent", color: COLORS.danger, padding: 5 }}><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal theme={theme} onClose={() => setAdding(false)} title="Nouvelle demande de tickets">
          <Field label="Forfait" theme={theme}>
            <select className="dz-input" value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}>
              {CATS.map((c) => <option key={c} value={c}>{L[c] || c}</option>)}
            </select>
          </Field>
          <Field label="Quantité souhaitée" theme={theme}>
            <input className="dz-input" type="number" value={form.quantite} onChange={(e) => setForm({ ...form, quantite: e.target.value })} placeholder="Ex. 100" />
          </Field>
          <Field label="Numéro WhatsApp (pour recevoir les tickets)" theme={theme}>
            <input className="dz-input" type="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="Ex. 620000000 ou +224620000000" />
          </Field>
          <Field label="Note (optionnel)" theme={theme}>
            <input className="dz-input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setAdding(false)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={busy} onClick={submitDemande} style={{ background: GRAD.primary, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Envoyer la demande"}</button>
          </div>
        </Modal>
      )}

      {fulfilling && (
        <Modal theme={theme} onClose={() => setFulfilling(null)} title="Fournir les tickets">
          <div style={{ fontSize: 12.5, color: theme.sub, marginBottom: 12 }}>
            {revendeurs.find((r) => r.id === fulfilling.revendeurId)?.nom} — demande de {fmtInt(fulfilling.quantiteDemandee)} × {L[fulfilling.categorie]}
          </div>
          <Field label="Quantité réellement fournie" theme={theme}>
            <input className="dz-input" type="number" value={fulfillQty} onChange={(e) => setFulfillQty(e.target.value)} />
          </Field>
          <Field label="Numéro WhatsApp du revendeur" theme={theme}>
            <input className="dz-input" type="tel" value={fulfillWa} onChange={(e) => setFulfillWa(e.target.value)} placeholder="Ex. 620000000 ou +224620000000" />
          </Field>
          <Field label="Préfixes des tickets donnés (optionnel)" theme={theme}>
            <input className="dz-input" value={fulfillPrefixes} onChange={(e) => setFulfillPrefixes(e.target.value)} placeholder="Ex. Mh, Bs, Dh" />
          </Field>
          <div style={{ fontSize: 11.5, color: theme.sub, marginTop: -8, marginBottom: 12, lineHeight: 1.4 }}>
            Saisis les 2 premières lettres des lots donnés à ce revendeur (séparées par des virgules). Elles seront <b>enregistrées sur sa fiche</b> pour que les prochains imports lui <b>attribuent automatiquement</b> ces tickets.
          </div>
          <div style={{ fontSize: 11.5, color: theme.sub, marginTop: -8, marginBottom: 12, lineHeight: 1.4 }}>
            En validant, <b>WhatsApp s'ouvrira</b> sur la conversation de ce numéro avec un message prêt. Il ne te reste qu'à <b>joindre le fichier des tickets</b> et à envoyer. (Le numéro est celui indiqué par le revendeur ; tu peux le corriger ici.)
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setFulfilling(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={busy} onClick={confirmFulfill} style={{ background: GRAD.success, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700, opacity: busy ? .6 : 1, display: "flex", alignItems: "center", gap: 6 }}>{busy ? "…" : "Valider et ouvrir WhatsApp"}</button>
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal theme={theme} onClose={() => setRejecting(null)} title="Rejeter la demande">
          <div style={{ fontSize: 12.5, color: theme.sub, marginBottom: 12 }}>{fmtInt(rejecting.quantiteDemandee)} × {L[rejecting.categorie]}</div>
          <Field label="Motif du refus (optionnel, visible par le revendeur)" theme={theme}>
            <textarea className="dz-input" rows={3} style={{ resize: "vertical" }} value={rejetMotif} onChange={(e) => setRejetMotif(e.target.value)} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button className="dz-btn" onClick={() => setRejecting(null)} style={{ background: dark ? "#334155" : "#F1F5F9", color: theme.text, padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 600 }}>Annuler</button>
            <button className="dz-btn" disabled={busy} onClick={reject} style={{ background: GRAD.danger, color: "#fff", padding: "9px 16px", borderRadius: 11, fontSize: 13, fontWeight: 700, opacity: busy ? .6 : 1 }}>{busy ? "…" : "Confirmer le rejet"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
