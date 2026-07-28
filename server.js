// Server qendror i licencave — përdoret nga të gjitha programet (ArkaPro etj.)
// për të konfirmuar licencën dhe për t'u shfaqur "online" te dashboard-i.
//
// Nisje lokale: npm install && npm start
// Në Railway (ose çdo host tjetër Node), vendos ADMIN_KEY si environment variable.

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4500;
const ADMIN_KEY = process.env.ADMIN_KEY || "ndrysho-kete-fjalekalim";
const DB_PATH = path.join(__dirname, "data.json");

// Një licencë konsiderohet "online" nëse ka dërguar heartbeat brenda kësaj kohe
const ONLINE_WINDOW_MS = 3 * 60 * 1000; // 3 minuta

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { licenses: [] };
  }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function genKey() {
  // p.sh. ARKA-9F2K-7QLM-3X8B
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `LIC-${part()}-${part()}-${part()}`;
}

function withComputed(lic) {
  const now = Date.now();
  const expiresAt = lic.activatedAt + lic.durationDays * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
  const online = !!lic.lastSeen && now - lic.lastSeen < ONLINE_WINDOW_MS;
  return {
    ...lic,
    expiresAt,
    daysLeft,
    online,
    expired: lic.revoked ? true : daysLeft <= 0,
  };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* ---------------------------------------------------------
   API PUBLIKE — thirren nga vetë programet (ArkaPro etj.)
--------------------------------------------------------- */

// Aplikacioni dërgon heartbeat çdo pak minuta me çelësin e tij.
// Përgjigjja i thotë nëse është ende valide dhe sa ditë i mbeten.
app.post("/api/heartbeat", (req, res) => {
  const { licenseKey, product, deviceId } = req.body || {};
  if (!licenseKey || !product) {
    return res.status(400).json({ valid: false, error: "licenseKey dhe product kërkohen" });
  }
  const db = readDB();
  const lic = db.licenses.find((l) => l.licenseKey === licenseKey && l.product === product);
  if (!lic) return res.status(404).json({ valid: false, error: "Licencë e panjohur" });

  lic.lastSeen = Date.now();
  if (deviceId && !lic.deviceIds.includes(deviceId)) lic.deviceIds.push(deviceId);
  writeDB(db);

  const c = withComputed(lic);
  res.json({
    valid: !c.expired,
    expired: c.expired,
    revoked: !!lic.revoked,
    daysLeft: c.daysLeft,
    expiresAt: c.expiresAt,
    clientName: lic.clientName,
  });
});

/* ---------------------------------------------------------
   API ADMIN — kërkojnë header x-admin-key, përdoren nga dashboard-i
--------------------------------------------------------- */
function requireAdmin(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({ error: "Fjalëkalimi admin i pasaktë" });
  }
  next();
}

app.get("/api/admin/licenses", requireAdmin, (req, res) => {
  const db = readDB();
  res.json(db.licenses.map(withComputed).sort((a, b) => b.activatedAt - a.activatedAt));
});

app.post("/api/admin/licenses", requireAdmin, (req, res) => {
  const { clientName, product, durationDays } = req.body || {};
  if (!clientName || !product) {
    return res.status(400).json({ error: "clientName dhe product kërkohen" });
  }
  const db = readDB();
  const lic = {
    id: crypto.randomUUID(),
    licenseKey: genKey(),
    clientName,
    product,
    durationDays: Number(durationDays) > 0 ? Number(durationDays) : 365,
    activatedAt: Date.now(),
    lastSeen: null,
    deviceIds: [],
    revoked: false,
  };
  db.licenses.push(lic);
  writeDB(db);
  res.json(withComputed(lic));
});

app.post("/api/admin/licenses/:id/extend", requireAdmin, (req, res) => {
  const { days } = req.body || {};
  const db = readDB();
  const lic = db.licenses.find((l) => l.id === req.params.id);
  if (!lic) return res.status(404).json({ error: "S'u gjet" });
  lic.durationDays += Number(days) || 365;
  writeDB(db);
  res.json(withComputed(lic));
});

app.post("/api/admin/licenses/:id/revoke", requireAdmin, (req, res) => {
  const db = readDB();
  const lic = db.licenses.find((l) => l.id === req.params.id);
  if (!lic) return res.status(404).json({ error: "S'u gjet" });
  lic.revoked = !lic.revoked;
  writeDB(db);
  res.json(withComputed(lic));
});

app.delete("/api/admin/licenses/:id", requireAdmin, (req, res) => {
  const db = readDB();
  db.licenses = db.licenses.filter((l) => l.id !== req.params.id);
  writeDB(db);
  res.json({ deleted: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`License server po dëgjon në portin ${PORT}`);
});
