const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// -------------------------------------
// Firebase Admin Initialization
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
// ORDER ID GENERATOR
// -------------------------------------
function generateOrderID() {
  return "ORD" + Date.now() + Math.floor(Math.random() * 10000);
}

// -------------------------------------
// ROOT
// -------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Server Live ✔");
});

// -------------------------------------
// CREATE ORDER
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

    const zapData = zap.data;

    if (!zapData.payment_url) {
      return res.json({
        success: false,
        error: "ZapUPI didn't return payment_url"
      });
    }

    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
      status: "PENDING",
      payment_url: zapData.payment_url,
      utr_check: zapData.utr_check
    });

    res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`
    });

  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// -------------------------------------
// PAYMENT PAGE (SkillClash Style)
// -------------------------------------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ❌");

  const { amount, payment_url } = snap.val();

  const html = `
  <html>
  <body style="font-family: Arial; text-align: center; padding-top: 40px;">

      <h2>Add Money ₹${amount}</h2>
      <p>Order ID: ${id}</p>

      <a href="${payment_url}">
        <button style="padding: 12px 22px; background: #00c853; color: white; border: none; border-radius: 10px; font-size: 18px;">
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
  </html>`;

  res.send(html);
});

// -------------------------------------
// SUCCESS PAGE
// -------------------------------------
app.get("/success/:id", (req, res) => {
  res.send(`
    <h1 style="color: green;">Payment Successful 🎉</h1>
    <p>Your money has been added successfully.</p>
  `);
});

// -------------------------------------
// FAIL PAGE
// -------------------------------------
app.get("/fail/:id", (req, res) => {
  res.send(`
    <h1 style="color: red;">Payment Failed ❌</h1>
    <p>Please try again.</p>
  `);
});

// -------------------------------------
// CHECK STATUS (UTR CHECK API)
// -------------------------------------
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.json({ status: "INVALID" });

  const order = snap.val();

  try {
    const zapStatus = await axios.get(order.utr_check);

    if (zapStatus.data.status === "PAID") {
      await db.ref("orders/" + id).update({ status: "PAID" });
    }

    res.json({ status: zapStatus.data.status });

  } catch (e) {
    res.json({ status: order.status });
  }
});

// -------------------------------------
// ZAPUPI WEBHOOK (AUTO VERIFY)
// -------------------------------------
app.post("/zapupi-webhook", async (req, res) => {
  const { order_id, status, utr } = req.body;

  console.log("Webhook Received:", req.body);

  if (!order_id) return res.send("Invalid Webhook");

  if (status === "PAID" || status === "SUCCESS") {
    await db.ref("orders/" + order_id).update({
      status: "PAID",
      utr: utr || null
    });

    // Auto Coin Add (optional)
    await db.ref("users/" + order_id + "/coins")
      .transaction((c) => (c || 0) + 10);
  }

  res.send("Webhook OK");
});

// -------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Running on ${PORT}`));
