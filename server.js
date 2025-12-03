const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// -------------------------------------
// Firebase Admin SDK (Render-friendly)
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
// Root
// -------------------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Gateway with Firebase ✔ Running Successfully 🔥");
});

// -------------------------------------
// Create Order (ZapUPI)
// -------------------------------------
app.post("/create-order", async (req, res) => {
  let amount = req.body.amount || 1;

  // 1.04, 1.07 issue fix
  amount = parseInt(amount);

  const orderId = "ORD" + Date.now();

  try {
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: process.env.ZAP_TOKEN_KEY,
        secret_key: process.env.ZAP_SECRET_KEY,
        amount: amount,
        order_id: orderId
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const zapData = zap.data;

    // Extract Correct Fields
    const payment_url = zapData.payment_url;
    const utr_check = zapData.utr_check;

    // Validate response
    if (!payment_url || !utr_check) {
      return res.json({
        success: false,
        error: "ZapUPI error: payment_url or utr_check missing"
      });
    }

    // Save to Firebase
    await db.ref("orders/" + orderId).set({
      orderId,
      amount,
      status: "PENDING",
      payment_url,
      utr_check
    });

    res.json({
      success: true,
      orderId,
      payment_page: `${process.env.BASE_URL}/payment/${orderId}`,
      payment_url,
      utr_check
    });

  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// -------------------------------------
// Payment Page (SkillClash UI)
// -------------------------------------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.send("Invalid Order ID ❌");

  const { amount, payment_url } = snap.val();

  const html = `
  <html>
  <body style="font-family: Arial; text-align: center; padding-top: 40px;">

      <h2>Add Money ₹${amount}</h2>
      <p>Order ID: ${id}</p>

      <br>

      <a href="${payment_url}">
        <button style="
          padding: 12px 22px;
          background: #00c853;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 18px;
        ">Pay Using QR</button>
      </a>

      <br><br>

      <h3 id="msg">Waiting for payment...</h3>

      <script>
        setInterval(async () => {
          let res = await fetch("/check-status/${id}");
          let data = await res.json();

          if (data.status === "PAID") {
            document.getElementById("msg").innerHTML =
             "Payment Success! ₹${amount} Added 🎉";
          }
        }, 2000);
      </script>

  </body>
  </html>
  `;

  res.send(html);
});

// -------------------------------------
// Auto Check Payment Status
// -------------------------------------
app.get("/check-status/:id", async (req, res) => {
  const id = req.params.id;
  const snap = await db.ref("orders/" + id).once("value");

  if (!snap.exists()) return res.json({ error: "Invalid order" });

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
// Start Server
// -------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Running at Port ${PORT} ✔`));
