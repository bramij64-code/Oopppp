import express from "express";
import axios from "axios";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ---------------- FIREBASE SETUP ----------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJ,
    client_email: process.env.FIREBASE_CLIE,
    private_key: process.env.FIREBASE_PRIV.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// ---------------- CREATE ORDER ----------------
app.post("/create-order", async (req, res) => {
  try {
    const amount = req.body.amount;
    if (!amount) return res.json({ success: false, error: "Amount missing" });

    const orderId = "ORD" + Date.now();

    // Call ZapUPI
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: process.env.ZAP_TOKEN,
        secret_key: process.env.ZAP_SECRET,
        amount: amount,
        order_id: orderId,
      })
    );

    const zapData = zap.data;

    if (zapData.status !== "success") {
      return res.json({ success: false, error: zapData.message });
    }

    // Save to Firestore
    await db.collection("payments").doc(orderId).set({
      orderId,
      amount,
      status: "PENDING",
      payment_url: zapData.payment_url || null,
      createdAt: Date.now(),
    });

    res.json({
      success: true,
      orderId,
      payment_page: `https://oopppp.onrender.com/payment/${orderId}`,
      zapData,
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ---------------- PAYMENT PAGE ----------------
app.get("/payment/:id", async (req, res) => {
  const orderId = req.params.id;

  const doc = await db.collection("payments").doc(orderId).get();
  if (!doc.exists) return res.send("Invalid Order ID");

  const data = doc.data();

  res.send(`
    <h2>Payment Page</h2>
    <p>Order: ${data.orderId}</p>
    <p>Amount: ₹${data.amount}</p>
    <a href="${data.payment_url}">
      <button style="padding:10px;font-size:20px;">Pay Now</button>
    </a>
  `);
});

// ---------------- DEFAULT ROUTE ----------------
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Gateway Live 🔥");
});

app.listen(3000, () => console.log("Server Running on 3000"));
