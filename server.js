import express from "express";
import axios from "axios";
import admin from "firebase-admin";
import cors from "cors";

// ---------------------------
//  FIREBASE ADMIN CONFIG
// ---------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJ,
    client_email: process.env.FIREBASE_CLIE,
    private_key: process.env.FIREBASE_PRIV, // NO replace() needed
  }),
});

const db = admin.firestore();

// ---------------------------
//  EXPRESS SETUP
// ---------------------------

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("🔥 ZapUPI Payment Server Live!");
});

// ---------------------------
//  CREATE ORDER API
// ---------------------------

app.post("/create-order", async (req, res) => {
  try {
    const amount = req.body.amount;
    if (!amount) {
      return res.json({
        success: false,
        message: "Amount missing",
      });
    }

    // CLIENT SIDE ORDER ID
    const orderId = "ORD" + Date.now();

    // CALL ZapUPI API
    const zapRes = await axios.post(
      "https://api.zapupi.com/api/create-order",
      {
        token_key: process.env.ZAP_TOKEN,
        secret_key: process.env.ZAP_SECRET,
        amount: amount,
        order_id: orderId,
      }
    );

    const zapData = zapRes.data;

    // SAVE ORDER IN FIRESTORE
    await db.collection("orders").doc(orderId).set({
      orderId: orderId,
      amount: amount,
      zapData: zapData,
      status: "PENDING",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      orderId: orderId,
      zapData: zapData,
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.message,
    });
  }
});

// ---------------------------
//  PAYMENT PAGE
// ---------------------------

app.get("/payment/:orderId", async (req, res) => {
  const orderId = req.params.orderId;

  const snap = await db.collection("orders").doc(orderId).get();

  if (!snap.exists) {
    return res.send("Invalid Order ID");
  }

  const data = snap.data();
  const payUrl = data?.zapData?.payment_url;

  if (!payUrl) {
    return res.send("Payment link not found!");
  }

  res.redirect(payUrl);
});

// ---------------------------
//  START SERVER
// ---------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on PORT " + PORT);
});
