// server.js
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

// ---------- ENV check ----------
const requiredEnv = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY", // should contain \n sequences OR actual newlines
  "FIREBASE_PRIVATE_KEY_ID",
  "FIREBASE_CLIENT_ID",
  "FIREBASE_CLIENT_X509",
  // optional: UPI_ID
];
for (const k of requiredEnv) {
  if (!process.env[k]) {
    console.warn(`[WARN] env ${k} not set`);
  }
}

// Build service account object from env
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID || "",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "",
  client_id: process.env.FIREBASE_CLIENT_ID || "",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509 || ""
};

let db;
try {
  // If already initialized (hot reload), skip
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase initialized");
  } else {
    console.log("Firebase already initialized");
  }
  db = admin.firestore();
} catch (err) {
  console.error("Firebase init error:", err && err.stack ? err.stack : err);
  // continue – route handlers will handle missing db
}

// ---------- helper ----------
function devErrorResponse(res, err) {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) {
    return res.status(500).json({ success: false, error: "Server Error", detail: err && (err.stack || err.message || err) });
  } else {
    return res.status(500).json({ success: false, error: "Server Error" });
  }
}

// ---------- routes ----------
app.get("/", (req, res) => {
  res.json({ success: true, message: "Server running", env: process.env.NODE_ENV || "development" });
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ success: false, error: "Amount required" });

    // generate txn id
    const txnId = `ORD${Date.now()}`;

    // example payment URL (you can change to zapupi payment url logic)
    const upiId = process.env.UPI_ID || "your-upi@bank";
    const paymentUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&am=${encodeURIComponent(amount)}&tn=${encodeURIComponent(txnId)}`;

    // Save to firestore if db exists
    if (!db) {
      console.warn("Firestore not initialized, skipping save.");
    } else {
      await db.collection("payments").doc(txnId).set({
        txnId,
        amount,
        paymentUrl,
        status: "PENDING",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.json({ success: true, txnId, amount, paymentUrl });
  } catch (err) {
    console.error("Create-order error:", err && (err.stack || err));
    return devErrorResponse(res, err);
  }
});

// health check route to ensure POST works (GET to test)
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

// ---------- start ----------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
