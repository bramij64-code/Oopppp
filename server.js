// -------------------------------------------------------
// IMPORTS
// -------------------------------------------------------
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());


// -------------------------------------------------------
// FIREBASE INITIALIZATION
// -------------------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
});

const db = admin.database();


// -------------------------------------------------------
// GENERATE ORDER ID
// -------------------------------------------------------
function generateOrderID() {
  return "ORD" + Date.now() + Math.floor(Math.random() * 1000);
}


// -------------------------------------------------------
// ROOT CHECK
// -------------------------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Server Working ✔");
});


// -------------------------------------------------------
// CREATE ORDER  (Correct as per ZapUPI Support)
// -------------------------------------------------------
app.post("/create-order", async (req, res) => {
  try {
    const amount = parseInt(req.body.amount || 1);
    const orderId = generateOrderID();

    const params = new URLSearchParams({
      token_key: process.env.ZAP_TOKEN_KEY,
      secret_key: process.env.ZAP_SECRET_KEY,
      amount: amount,
      order_id: orderId,
      success_url: `${process.env.BASE_URL}/success/${orderId}`,
      fail_url: `${process.env.BASE_URL}/fail/${orderId}`
    });

    // ✔ OFFICIAL CREATE ORDER API
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      params,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (!zap.data.payment_url) {
      return res.json({ success: false, error: "ZapUPI did not return payment_url" });
    }

    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
      payment_url: zap.data.payment_url,
      status: "PENDING"
    });

    res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`
    });

  } catch (err) {
    console.log("Order Error:", err.message);
    res.json({ success: false, error: err.message });
  }
});


// -------------------------------------------------------
// PAYMENT PAGE
// -------------------------------------------------------
app.get("/payment/:id", async (req, res) => {
  const snap = await db.ref("orders/" + req.params.id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ❌");

  const order = snap.val();

  res.send(`
    <h2>Add Money ₹${order.amount}</h2>
    <a href="${order.payment_url}">
      <button style="padding:10px 20px;background:green;color:white;font-size:18px;border:none;border-radius:10px;">
        Pay Now
      </button>
    </a>
  `);
});


// -------------------------------------------------------
// SUCCESS PAGE
// -------------------------------------------------------
app.get("/success/:id", (req, res) => {
  res.send("<h1 style='color:green;'>Payment Successful 🎉</h1>");
});


// -------------------------------------------------------
// FAIL PAGE
// -------------------------------------------------------
app.get("/fail/:id", (req, res) => {
  res.send("<h1 style='color:red;'>Payment Failed ❌</h1>");
});


// -------------------------------------------------------
// ORDER STATUS CHECK (Correct as per ZapUPI Support)
// -------------------------------------------------------
app.get("/check-status/:id", async (req, res) => {
  try {
    const order = await db.ref("orders/" + req.params.id).once("value");
    if (!order.exists()) return res.json({ status: "INVALID" });

    const orderId = req.params.id;

    // ✔ OFFICIAL STATUS API
    const api = `https://api.zapupi.com/api/order-status?order_id=${orderId}`;

    const zap = await axios.get(api);

    if (zap.data.status === "PAID") {
      await db.ref("orders/" + orderId).update({ status: "PAID" });
    }

    res.json({ status: zap.data.status });

  } catch (err) {
    res.json({ status: "ERROR" });
  }
});


// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running on", PORT));
