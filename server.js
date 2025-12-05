const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");
const path = require("path");

const app = express();

// ---------- Middlewares ----------
app.use(cors()); // Netlify → Render CORS allow
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // ZapUPI webhook form-encoded হলে

// ---------- Firebase Init ----------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
});

const db = admin.database();

// ---------- Helper: Order ID ----------
function generateOrderID() {
  const r = Math.floor(Math.random() * 90000) + 10000;
  return "ORD" + Date.now() + r;
}

// ---------- Root ----------
app.get("/", (req, res) => {
  res.send("ZapUPI Deposit + Firebase Server Running ✔");
});

// ---------- CREATE ORDER (ZapUPI DEPOSIT) ----------
app.post("/create-order", async (req, res) => {
  let amount = parseInt(req.body.amount || 1);
  if (isNaN(amount) || amount <= 0) amount = 1;

  const orderId = generateOrderID();

  try {
    // ZapUPI Deposit API (URL তোমার account অনুযায়ী হতে পারে:
    // 'https://zapupi.com/api/deposit/create' বা 'https://api.zapupi.com/api/deposit/create')
    const zap = await axios.post(
      "https://zapupi.com/api/deposit/create",
      new URLSearchParams({
        token_key: process.env.ZAP_TOKEN_KEY,
        secret_key: process.env.ZAP_SECRET_KEY,
        amount: amount,
        order_id: orderId,
        remark: "Tournament Recharge",
        // প্রতিটি অর্ডারের জন্য webhook + success/fail সেট করে দিলাম
        webhook_url: `${process.env.BASE_URL}/zapupi-webhook`,
        success_url: `${process.env.BASE_URL}/success/${orderId}`,
        fail_url: `${process.env.BASE_URL}/fail/${orderId}`,
      }),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }
    );

    const data = zap.data;

    // আলাদা নামে ফেরত দিতে পারে: pay_url / payment_url ইত্যাদি
    const paymentUrl = data.payment_url || data.pay_url || data.url;

    if (!paymentUrl) {
      return res.json({
        success: false,
        error: "ZapUPI deposit API payment_url দেয়নি",
        raw: data,
      });
    }

    // Firebase-এ অর্ডার সেভ
    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
      status: "PENDING",
      payment_url: paymentUrl,
      gateway: "ZapUPI_DEPOSIT",
      createdAt: Date.now(),
    });

    // Netlify / অ্যাপকে response
    return res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`,
      payment_url: paymentUrl,
    });
  } catch (err) {
    console.error("ZapUPI create-order error:", err.response?.data || err.message);
    return res.json({
      success: false,
      error: err.message,
      raw: err.response?.data || null,
    });
  }
});

// ---------- PAYMENT PAGE ----------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ID ❌");

  const { amount, payment_url, status } = snap.val();

  const html = `
  <html>
  <body style="font-family: Arial; text-align: center; padding-top: 40px;">
    <h2>Add Money ₹${amount}</h2>
    <p>Order ID: ${id}</p>
    <p>Status: ${status}</p>

    <a href="${payment_url}">
      <button style="
        padding: 12px 25px;
        background: #22c55e;
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 18px;
      ">Pay Now</button>
    </a>

    <h3 id="msg">Waiting for payment (auto update)...</h3>

    <script>
      // Webhook এর মাধ্যমে status আপডেট হবে,
      // আমরা শুধু প্রতি 2 সেকেন্ড পর পর Firebase status check করব
      setInterval(async () => {
        const res = await fetch("/order-status/${id}");
        const d = await res.json();
        if (d.status === "PAID") {
          document.getElementById("msg").innerHTML = "Payment Success! Redirecting...";
          location.href = "/success/${id}";
        } else {
          document.getElementById("msg").innerHTML = "Current Status: " + d.status;
        }
      }, 2000);
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// ---------- SIMPLE STATUS (Firebase থেকে পড়া) ----------
app.get("/order-status/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");
  if (!snap.exists()) return res.json({ status: "INVALID" });

  const { status } = snap.val();
  res.json({ status: status || "PENDING" });
});

// ---------- ZAPUPI WEBHOOK (Auto Verify) ----------
app.post("/zapupi-webhook", async (req, res) => {
  // ZapUPI কী কী পাঠাচ্ছে সেটার ওপর ভিত্তি করে field ধরতে হবে।
  // সাধারনতঃ: order_id, status, txn_id, amount ইত্যাদি
  const body = req.body || {};
  console.log("ZapUPI Webhook:", body);

  const orderId = body.order_id || body.orderId;
  const status = (body.status || "").toUpperCase();

  if (!orderId) {
    console.log("Webhook এ order_id পাওয়া যায়নি");
    return res.status(400).send("No order_id");
  }

  try {
    if (status === "PAID" || status === "SUCCESS") {
      await db.ref("orders/" + orderId).update({
        status: "PAID",
        paidAt: Date.now(),
        txn_id: body.txn_id || body.txnId || null,
      });

      // এখানে তুমি user এর wallet এ coin add করার কাজ করবে
      // যেমন: db.ref("users/" + userId + "/balance").transaction(...)
      console.log("Order", orderId, "marked as PAID from webhook");
    } else if (status === "FAILED") {
      await db.ref("orders/" + orderId).update({
        status: "FAILED",
      });
      console.log("Order", orderId, "marked as FAILED from webhook");
    }

    res.send("OK");
  } catch (e) {
    console.error("Webhook update error:", e);
    res.status(500).send("ERROR");
  }
});

// ---------- SUCCESS / FAIL PAGE ----------
app.get("/success/:id", (req, res) => {
  res.send(`
    <h1 style="color: green;">Payment Successful 🎉</h1>
    <p>Your coins have been added (if configured).</p>
  `);
});

app.get("/fail/:id", (req, res) => {
  res.send(`
    <h1 style="color: red;">Payment Failed ❌</h1>
    <p>Your transaction was not completed.</p>
  `);
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
