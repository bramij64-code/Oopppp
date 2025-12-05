// ---------------------------------------------
// IMPORTS
// ---------------------------------------------
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();

app.use(cors()); // Allow Netlify → Render
app.use(express.json());

// ---------------------------------------------
// FIREBASE INITIALIZATION
// ---------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
});

const db = admin.database();

// ---------------------------------------------
// ORDER ID GENERATOR
// ---------------------------------------------
function generateOrderID() {
  return "ORD" + Date.now() + Math.floor(Math.random() * 1000);
}

// ---------------------------------------------
// ROOT
// ---------------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Server Live ✔");
});

// ---------------------------------------------
// CREATE ORDER  (FINAL WORKING VERSION)
// ---------------------------------------------
app.post("/create-order", async (req, res) => {
  try {
    const amount = parseInt(req.body.amount || 1);
    const orderId = generateOrderID();

    const params = new URLSearchParams({
      amount: amount,
      order_id: orderId,
      remark: "Recharge"
    });

    // ✔ CORRECT ZapUPI API URL (NO ERROR)
    const zap = await axios.post(
      "https://api.zapupi.com/deposit/create",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${process.env.ZAP_TOKEN_KEY}`,
          "x-secret-key": process.env.ZAP_SECRET_KEY
        }
      }
    );

    if (!zap.data.payment_url) {
      return res.json({ success: false, error: "ZapUPI error" });
    }

    // Save in Firebase
    await db.ref("orders/" + orderId).set({
      amount,
      orderId,
      status: "PENDING",
      payment_url: zap.data.payment_url,
      utr_check: zap.data.utr_check
    });

    res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`,
      payment_url: zap.data.payment_url
    });

  } catch (err) {
    console.log("Create Error:", err.response?.data || err.message);
    res.json({ success: false, error: err.response?.data || err.message });
  }
});

// ---------------------------------------------
// PAYMENT PAGE
// ---------------------------------------------
app.get("/payment/:id", async (req, res) => {
  const snap = await db.ref("orders/" + req.params.id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ❌");

  const { amount, payment_url } = snap.val();

  res.send(`
    <h2>Add Money ₹${amount}</h2>
    <p>Order ID: ${req.params.id}</p>
    <a href="${payment_url}">
      <button style="padding:10px 20px;background:green;color:white;border:none;border-radius:8px;">
        Pay Now
      </button>
    </a>

    <h3>Waiting for payment...</h3>

    <script>
      setInterval(async () => {
        const res = await fetch("/check-status/${req.params.id}");
        const data = await res.json();
        if (data.status === "PAID") {
          window.location.href = "/success/${req.params.id}";
        }
      }, 2000);
    </script>
  `);
});

// ---------------------------------------------
// SUCCESS PAGE
// ---------------------------------------------
app.get("/success/:id", (req, res) => {
  res.send("<h1 style='color:green;'>Payment Successful 🎉</h1>");
});

// ---------------------------------------------
// CHECK STATUS (UTR Verify)
// ---------------------------------------------
app.get("/check-status/:id", async (req, res) => {
  const snap = await db.ref("orders/" + req.params.id).once("value");
  if (!snap.exists()) return res.json({ status: "INVALID" });

  const order = snap.val();

  try {
    const zap = await axios.get(order.utr_check);

    if (zap.data.status === "PAID") {
      await db.ref("orders/" + req.params.id).update({ status: "PAID" });
    }

    res.json({ status: zap.data.status });

  } catch {
    res.json({ status: order.status });
  }
});

// ---------------------------------------------
// START SERVER
// ---------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on PORT", PORT));
