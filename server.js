const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// -----------------------------
// FIREBASE ADMIN CONFIG
// -----------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// -----------------------------
// HOME ROUTE
// -----------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Gateway Live 🔥");
});

// -----------------------------
// CREATE ORDER API
// -----------------------------
app.post("/create-order", async (req, res) => {
  try {
    const amount = req.body.amount || 10;
    const orderId = "ORD" + Date.now();

    // Call ZapUPI API
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: process.env.ZAPUPI_TOKEN,
        secret_key: process.env.ZAPUPI_SECRET,
        amount: amount,
        order_id: orderId,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const zapData = zap.data;

    // SAVE ORDER TO FIRESTORE
    await db.collection("orders").doc(orderId).set({
      order_id: orderId,
      amount: amount,
      payment_url: zapData.payment_url || null,
      payment_data: zapData.payment_data || null,
      auto_check: zapData.auto_check_every_2_sec || null,
      utr_check: zapData.utr_check || null,
      status: zapData.status === "success" ? "PENDING" : "FAILED",
      created_at: Date.now(),
    });

    res.json({
      success: true,
      orderId,
      zapData,
      payment_page: `https://oopppp.onrender.com/payment/${orderId}`,
    });
  } catch (err) {
    console.log("Error:", err.response?.data || err.message);
    res.json({ success: false, error: err.response?.data || err.message });
  }
});

// -----------------------------
// PAYMENT PAGE ROUTE
// -----------------------------
app.get("/payment/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const doc = await db.collection("orders").doc(orderId).get();

    if (!doc.exists) {
      return res.send("Invalid Order ID");
    }

    const data = doc.data();

    if (!data.payment_url) {
      return res.send("Payment URL not generated. Try again.");
    }

    res.redirect(data.payment_url);
  } catch (err) {
    res.send("Something went wrong");
  }
});

// -----------------------------
app.listen(3000, () => console.log("Server running on port 3000"));
