// ----------------------------------------------------------
// IMPORTS
// ----------------------------------------------------------
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------------------------------------------
// FIREBASE INITIALIZATION
// ----------------------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
});
const db = admin.database();

// ----------------------------------------------------------
// ORDER ID GENERATOR
// ----------------------------------------------------------
function generateOrderID() {
  return "ORD" + Date.now() + Math.floor(Math.random() * 10000);
}

// ----------------------------------------------------------
// ROOT
// ----------------------------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Server Running ✔");
});

// ----------------------------------------------------------
// CREATE ORDER (Correct According to ZapUPI Documentation)
// ----------------------------------------------------------
app.post("/create-order", async (req, res) => {
  try {
    const amount = parseInt(req.body.amount || 1);
    const userId = req.body.userId || "unknown";
    const orderId = generateOrderID();

    // REQUIRED PARAMETERS (Documentation অনুযায়ী)
    const params = new URLSearchParams({
      token_key: process.env.ZAP_TOKEN_KEY,
      secret_key: process.env.ZAP_SECRET_KEY,
      amount: amount,
      order_id: orderId,
      remark: "Recharge",
      redirect_url: `${process.env.BASE_URL}/status/${orderId}` // REQUIRED ✔
    });

    // CORRECT ENDPOINT ✔
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (!zap.data.payment_url) {
      return res.json({ success: false, error: "ZapUPI did not return payment_url" });
    }

    // SAVE ORDER IN FIREBASE ✔
    await db.ref("orders/" + orderId).set({
      orderId,
      userId,
      amount,
      payment_url: zap.data.payment_url,
      status: "PENDING"
    });

    res.json({
      success: true,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`
    });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------------
// PAYMENT PAGE
// ----------------------------------------------------------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ❌");

  const { amount, payment_url } = snap.val();

  res.send(`
    <h2>Add Money ₹${amount}</h2>
    <a href="${payment_url}">
      <button style="padding:12px 22px;background:green;color:white;border-radius:10px">Pay Now</button>
    </a>
  `);
});

// ----------------------------------------------------------
// REDIRECT STATUS PAGE (ZapUPI redirect_url)
// ----------------------------------------------------------
app.get("/status/:id", (req, res) => {
  res.send(`
    <h2>Checking Payment Status...</h2>
    <script>
      setInterval(async () => {
        let res = await fetch("/check-status/${req.params.id}");
        let data = await res.json();
        if (data.status === "PAID") window.location.href = "/success/${req.params.id}";
        if (data.status === "FAILED") window.location.href = "/fail/${req.params.id}";
      }, 2000);
    </script>
  `);
});

// ----------------------------------------------------------
// ORDER STATUS CHECK (Correct as per ZapUPI Support)
// ----------------------------------------------------------
app.get("/check-status/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const snap = await db.ref("orders/" + orderId).once("value");
    if (!snap.exists()) return res.json({ status: "INVALID" });

    // OFFICIAL STATUS API (Correct) ✔
    const api = `https://api.zapupi.com/api/order-status?order_id=${orderId}`;

    const zap = await axios.get(api);

    const status = zap.data.status;

    // UPDATE FIREBASE ✔
    if (status === "PAID") {
      await db.ref("orders/" + orderId).update({ status });

      // AUTO COIN ADD (optional)
      const order = snap.val();
      await db.ref("users/" + order.userId + "/coins")
        .transaction(c => (c || 0) + order.amount);
    }

    res.json({ status });

  } catch (err) {
    res.json({ status: "ERROR" });
  }
});

// ----------------------------------------------------------
// SUCCESS PAGE
// ----------------------------------------------------------
app.get("/success/:id", (req, res) => {
  res.send(`<h1 style="color:green;">Payment Successful 🎉</h1>`);
});

// ----------------------------------------------------------
// FAIL PAGE
// ----------------------------------------------------------
app.get("/fail/:id", (req, res) => {
  res.send(`<h1 style="color:red;">Payment Failed ❌</h1>`);
});

// ----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on PORT", PORT));
