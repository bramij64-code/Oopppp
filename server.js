// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

let admin = null;
let db = null;
let firebaseEnabled = false;

function tryInitFirebase() {
  try {
    // require here so deploy doesn't fail when firebase-admin isn't configured
    admin = require("firebase-admin");

    // read required env vars
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY; // provided with literal \n OR already real newlines
    const privateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID || "";
    const clientX509 = process.env.FIREBASE_CLIENT_X509 || "";

    if (!projectId || !clientEmail || !privateKey) {
      console.warn("Firebase env vars missing: FIREBASE_PROJECT_ID or FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY");
      firebaseEnabled = false;
      return;
    }

    const serviceAccount = {
      type: "service_account",
      project_id: projectId,
      private_key_id: privateKeyId,
      private_key: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
      client_email: clientEmail,
      client_id: process.env.FIREBASE_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: clientX509
    };

    // init firebase
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    db = admin.firestore();
    firebaseEnabled = true;
    console.log("Firebase initialized ✅");
  } catch (e) {
    console.error("Firebase init failed:", e && e.message ? e.message : e);
    firebaseEnabled = false;
  }
}

// Try init at startup
tryInitFirebase();

app.get("/", (req, res) => {
  res.json({ ok: true, firebase: firebaseEnabled });
});

app.post("/create-order", async (req, res) => {
  try {
    // basic validation
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ success: false, error: "Invalid JSON body" });
    }

    const amount = Number(body.amount || body.am || body.AMOUNT);
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: "Amount required and must be > 0" });
    }

    // create txn id
    const txnId = "ORD" + Date.now();

    // build payment url - you can change UPI_ID env var or logic
    const upiId = process.env.UPI_ID || "your-upi@bank";
    const paymentUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(process.env.PAYEE_NAME || "SkillClash")}&am=${amount}&tn=${encodeURIComponent("Order " + txnId)}&tid=${txnId}`;

    // prepare record
    const record = {
      txnId,
      amount,
      paymentUrl,
      status: "PENDING",
      createdAt: Date.now()
    };

    // Write to Firestore only if enabled
    if (firebaseEnabled && db) {
      try {
        await db.collection("payments").doc(txnId).set(record);
        console.log("Saved payment record to Firestore:", txnId);
      } catch (e) {
        // log but don't crash the whole endpoint
        console.error("Firestore write failed:", e && e.message ? e.message : e);
        // optionally set firebaseEnabled = false if irrecoverable
      }
    } else {
      console.log("Firebase disabled — skipping Firestore write. Generated record:", record);
    }

    return res.json({
      success: true,
      txnId,
      amount,
      paymentUrl
    });

  } catch (err) {
    console.error("create-order error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, error: "Server Error" });
  }
});

// Helpful health route to show env info (non-secret)
app.get("/_health", (req, res) => {
  res.json({
    ok: true,
    firebaseEnabled,
    env: {
      FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
      UPI_ID: !!process.env.UPI_ID
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
