// ------------------------------
//       Oopppp PAYMENT SERVER
// ------------------------------

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 তোমার REAL UPI ID
const MERCHANT_UPI = "9609693728@fam";

// ------------------------------
//  Firebase Admin Initialization
// ------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT,
  }),
});

// ------------------------------
// Create Order API (Main)
// ------------------------------
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 1) {
      return res.json({ success: false, error: "Invalid Amount" });
    }

    const txnId = "ORD" + Date.now();

    // 🔥 Generate Payment Link (UPI URL)
    const paymentUrl =
      `upi://pay?pa=${MERCHANT_UPI}&pn=Merchant&am=${amount}&tn=Payment%20to%20Oopppp&cu=INR`;

    // 🔥 Generate QR Image from Google API
    const qrImage = `https://chart.googleapis.com/chart?cht=qr&chs=300x300&chl=${encodeURIComponent(
      paymentUrl
    )}`;

    return res.json({
      success: true,
      txnId,
      amount,
      upiId: MERCHANT_UPI,
      paymentUrl,
      qrImage,
      message: "Scan the QR or open payment link",
    });

  } catch (err) {
    console.error("Order Error:", err.message);
    res.json({ success: false, error: "Server Error" });
  }
});

// ------------------------------
// Default Route
// ------------------------------
app.get("/", (req, res) => {
  res.send("🔥 Oopppp Payment Server is Running Successfully!");
});

// ------------------------------
// Server Listen
// ------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("SERVER RUNNING ON PORT", PORT);
});
