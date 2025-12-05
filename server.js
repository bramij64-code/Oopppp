// ---------------------------------------------
// IMPORTS
// ---------------------------------------------
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();

// Enable CORS (Netlify → Render Fetch Fix)
app.use(cors());

// Parse JSON body
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
// GENERATE ORDER ID
// ---------------------------------------------
function generateOrderID() {
  return "ORD" + Date.now() + Math.floor(Math.random() * 1000);
}

// ---------------------------------------------
// ROOT ROUTE
// ---------------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI + Firebase + Webhook Server Running Successfully 🚀");
});

// ---------------------------------------------
// 💰 CREATE ORDER (WORKING & FIXED)
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

    // ✔ ZapUPI correct headers (403 FIXED)
    const zap = await axios.post(
      "https://zapupi.com/api/deposit/create",
      params,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${process.env.ZAP_TOKEN_KEY}`,
          "x-secret-key": process.env.ZAP_SECRET_KEY
        }
      }
    );

    console.log("ZapUPI Order Response:", zap.data);

    if (!zap.data.payment_url) {
      return res.json({
        success: false,
        error: "ZapUPI did not return payment_url"
      });
    }

    // SAVE ORDER IN FIREBASE
    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
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
    console.log("Order Error:", err.response?.data || err.message);
    res.json({ success: false, error: err.response?.data || err.message });
  }
});

// ---------------------------------------------
// PAYMENT PAGE (UI + Auto Status Checker)
// ---------------------------------------------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;

  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ❌");

  const { amount, payment_url } = snap.val();

  const html = `
  <html>
  <body style="font-family:Arial;text-align:center;padding-top:40px;">
  
  <h2>Add Money ₹${amount}</h2>
  <p>Order ID: ${id}</p>

  <a href="${payment_url}">
    <button style="padding:12px 22px;background:#00c853;color:white;border:none;border-radius:10px;font-size:18px;">
      Pay Now
    </button>
  </a>

  <h3 id="msg">Waiting for payment...</h3>

  <script>
    setInterval(async () => {
      let res = await fetch("/check-status/${id}");
      let data = await res.json();
      if (data.status === "PAID") {
        location.href = "/success/${id}";
      }
    }, 2000);
  </script>

  </body>
  </html>
  `;

  res.send(html);
});

// ---------------------------------------------
// SUCCESS PAGE
// ---------------------------------------------
app.get("/success/:id", (req, res) => {
  res.send(`
    <h1 style="color:green;">Payment Successful 🎉</h1>
    <p>Coins Added Successfully 🪙</p>
  `);
});

// ---------------------------------------------
// CHECK STATUS (Auto Verify via utr_check URL)
// ---------------------------------------------
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;

  const snap = await db.ref("orders/" + id).once("value");
  if (!snap.exists()) return res.json({ status: "INVALID" });

  const order = snap.val();

  try {
    const zap = await axios.get(order.utr_check);

    if (zap.data.status === "PAID") {
      await db.ref("orders/" + id).update({ status: "PAID" });
    }

    res.json({ status: zap.data.status });

  } catch (err) {
    res.json({ status: order.status });
  }
});

// ---------------------------------------------
// 🔔 WEBHOOK (Optional but Recommended)
// ---------------------------------------------
app.post("/zapupi-webhook", async (req, res) => {
  try {
    console.log("Webhook Received:", req.body);

    const { order_id, status } = req.body;

    if (status === "PAID") {
      await db.ref("orders/" + order_id).update({ status: "PAID" });
      console.log("Order Updated to PAID:", order_id);
    }

    res.send("OK");

  } catch (err) {
    console.log("Webhook ERROR:", err.message);
    res.status(500).send("ERR");
  }
});

// ---------------------------------------------
// START SERVER
// ---------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server Running on PORT", PORT);
});
