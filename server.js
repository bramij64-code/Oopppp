const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");

const app = express();
app.use(express.json());

// -------------------------------------
// Firebase Initialization
// -------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
});
const db = admin.database();

// -------------------------------------
// Unique Order ID Generator
// -------------------------------------
function generateOrderID() {
  return (
    "ORD" +
    Date.now().toString() +
    Math.floor(Math.random() * 10000).toString()
  );
}

// -------------------------------------
// Static Payment UI
// -------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------
// CREATE ORDER API
// -------------------------------------
app.post("/create-order", async (req, res) => {
  let amount = parseInt(req.body.amount || 1);
  const orderId = generateOrderID();

  try {
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: process.env.ZAP_TOKEN_KEY,
        secret_key: process.env.ZAP_SECRET_KEY,
        amount: amount,
        order_id: orderId,
        success_url: `${process.env.BASE_URL}/success/${orderId}`,
        fail_url: `${process.env.BASE_URL}/fail/${orderId}`
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = zap.data;
    if (!data.payment_url) {
      return res.json({ success: false, error: "ZapUPI returned no payment_url" });
    }

    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
      status: "PENDING",
      payment_url: data.payment_url,
      utr_check: data.utr_check
    });

    res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`
    });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// -------------------------------------
// PAYMENT PAGE
// -------------------------------------
app.get("/payment/:id", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const id = req.params.id;

  const snap = await db.ref("orders/" + id).once("value");
  if (!snap.exists()) return res.send("Invalid Order ID ❌");

  const { amount, payment_url } = snap.val();

  const html = `
  <html>
  <body style="text-align:center;font-family:Arial;padding-top:40px">
    <h2>Add Money ₹${amount}</h2>
    <p>Order ID: ${id}</p>
    <a href="${payment_url}">
      <button style="padding:12px 22px;background:#22c55e;color:#fff;font-size:18px;border:none;border-radius:8px">
        Pay Now
      </button>
    </a>
    <h3 id="msg">Waiting for payment...</h3>
    
    <script>
      setInterval(async () => {
        const res = await fetch("/check-status/${id}");
        const data = await res.json();
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

// -------------------------------------
// CHECK PAYMENT STATUS
// -------------------------------------
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
    return res.json({ status: zap.data.status });
  } catch (err) {
    return res.json({ status: order.status });
  }
});

// -------------------------------------
// SUCCESS PAGE
// -------------------------------------
app.get("/success/:id", (req, res) => {
  res.send(`
    <h1 style="color:green">Payment Successful 🎉</h1>
    <p>Coins added successfully!</p>
  `);
});

// -------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
