const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// ---------------- FIREBASE ADMIN ----------------
const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIV_KEY
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});

const db = admin.firestore();

// ---------------- CREATE ORDER ----------------
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.json({ success: false, error: "Amount missing" });
    }

    // create a unique order id  
    const orderId = "ORD" + Date.now();

    // ZapUPI Request
    const zapResponse = await axios.post(process.env.ZAPUPI_URL, {
      amount: amount,
      orderId: orderId,
      redirectUrl: `https://oopppp.onrender.com/payment/${orderId}`
    }, {
      headers: {
        "X-API-KEY": process.env.ZAPUPI_KEY,
        "X-SECRET-KEY": process.env.ZAPUPI_SECRET,
        "Content-Type": "application/json"
      }
    });

    const payUrl = zapResponse.data.payment_url;

    // Save order to Firestore
    await db.collection("orders").doc(orderId).set({
      amount: amount,
      orderId: orderId,
      payment_url: payUrl,
      status: "PENDING",
      createdAt: Date.now()
    });

    return res.json({
      success: true,
      orderId: orderId,
      payment_url: payUrl
    });

  } catch (err) {
    console.log(err);
    return res.json({
      success: false,
      error: err.message
    });
  }
});

// ---------------- PAYMENT STATUS PAGE ----------------
app.get("/payment/:orderId", async (req, res) => {
  const orderId = req.params.orderId;

  const orderSnap = await db.collection("orders").doc(orderId).get();

  if (!orderSnap.exists) {
    return res.send("Invalid Order ID");
  }

  const order = orderSnap.data();

  return res.send(`
    <h2>Order ID: ${orderId}</h2>
    <p>Status: ${order.status}</p>
    <a href="${order.payment_url}">Pay Now</a>
  `);
});

// ---------------- ROOT ----------------
app.get("/", (req, res) => {
  res.send("Server is running...");
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
