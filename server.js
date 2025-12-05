const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();

// -----------------------------
// Essential middlewares
// -----------------------------
app.use(cors());               // Allow Netlify → Render API
app.use(express.json());        // Parse JSON body

// -----------------------------
// Firebase Admin Initialization
// -----------------------------
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
  }),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`
});

const db = admin.database();

// -----------------------------
// Auto Order ID Generator
// -----------------------------
function generateOrderID() {
  const r = Math.floor(Math.random() * 90000) + 10000;
  return "ORD" + Date.now() + r;
}

// -----------------------------
// Root Route
// -----------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI + Firebase Server Running Successfully ✔");
});

// -----------------------------
// CREATE ORDER
// -----------------------------
app.post("/create-order", async (req, res) => {
  let amount = parseInt(req.body.amount || 1);
  const orderId = generateOrderID();

  try {
    const zapRes = await axios.post(
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

    const data = zapRes.data;

    if (!data.payment_url) {
      return res.json({ success: false, message: "ZapUPI returned no payment_url" });
    }

    // Save order
    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
      payment_url: data.payment_url,
      utr_check: data.utr_check,
      status: "PENDING"
    });

    return res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`
    });

  } catch (error) {
    return res.json({
      success: false,
      error: error.message
    });
  }
});

// -----------------------------
// PAYMENT PAGE (Auto Polling)
// -----------------------------
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
      <button style="padding: 12px 25px; background: green; color: white; border-radius: 8px; font-size: 18px;">Pay Now</button>
    </a>

    <h3 id="msg">Waiting for payment...</h3>

    <script>
      setInterval(async () => {
        let res = await fetch("/check-status/${id}");
        let d = await res.json();

        if (d.status === "PAID") {
          document.getElementById("msg").innerHTML = "Payment Success! Redirecting...";
          location.href = "/success/${id}";
        }
      }, 2000);
    </script>

  </body>
  </html>
  `;

  res.send(html);
});

// -----------------------------
// CHECK STATUS (ZapUPI Polling)
// -----------------------------
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;

  const snap = await db.ref("orders/" + id).once("value");
  if (!snap.exists()) return res.json({ status: "INVALID" });

  try {
    const order = snap.val();
    const zap = await axios.get(order.utr_check);

    if (zap.data.status === "PAID") {
      await db.ref("orders/" + id).update({ status: "PAID" });
    }

    return res.json({ status: zap.data.status });

  } catch (err) {
    return res.json({ status: "PENDING" });
  }
});

// -----------------------------
// SUCCESS PAGE
// -----------------------------
app.get("/success/:id", (req, res) => {
  res.send(`<h1 style="color:green">Payment Successful ✔</h1>`);
});

// -----------------------------
// FAIL PAGE
// -----------------------------
app.get("/fail/:id", (req, res) => {
  res.send(`<h1 style="color:red">Payment Failed ❌</h1>`);
});

// -----------------------------
// START SERVER
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Running on Port ${PORT}`));
