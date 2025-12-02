const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Firebase Credentials from Environment
const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIV_KEY.replace(/\\n/g, "\n")
};

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig)
});

const db = admin.firestore();

// CREATE ORDER
app.post("/create-order", async (req, res) => {
  try {
    const amount = req.body.amount;

    if (!amount) {
      return res.json({
        success: false,
        error: "Amount is missing"
      });
    }

    const zapRes = await axios.post(
      process.env.ZAPUPI_URL,
      { amount },
      {
        headers: {
          key: process.env.ZAPUPI_KEY,
          secret: process.env.ZAPUPI_SECRET,
          "Content-Type": "application/json"
        }
      }
    );

    const zap = zapRes.data;

    await db.collection("orders").doc(zap.order_id).set({
      amount,
      payment_url: zap.payment_url || "",
      utr_check: zap.utr_check || "",
      status: "pending",
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      orderId: zap.order_id,
      payment_page: `https://oopppp.onrender.com/payment/${zap.order_id}`,
      zapData: zap
    });

  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      error: err.message
    });
  }
});

// PAYMENT PAGE
app.get("/payment/:orderId", (req, res) => {
  const orderId = req.params.orderId;

  if (!orderId) {
    return res.send("Invalid Order ID");
  }

  res.send(`
    <html>
    <head><title>Payment</title></head>
    <body>
      <h2>Order ID: ${orderId}</h2>
      <a href="upi://pay?pa=9609693728@famupi&pn=ZapUPI&am=1">Pay Now</a>
    </body>
    </html>
  `);
});

app.listen(3000, () => console.log("Server running on port 3000"));
