/*
===============================
 FULL SKILL CLASH STYLE BACKEND
===============================
*/

const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -----------------------------
// 🔥 Firebase Setup
// -----------------------------
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


// -----------------------------
// 🔥 SkillClash Style Payment
// -----------------------------
app.post("/create-payment", async (req, res) => {
  try {
    const { amount, userId } = req.body;

    if (!amount || !userId) {
      return res.json({ success: false, error: "Missing fields" });
    }

    // ✔ Create Payment in ZapUPI
    const response = await axios.post("https://api.zapupi.com/payment", {
      amount: amount,
      upi_id: process.env.ZAPUPI_UPI,
      note: "Game Coins"
    }, {
      headers: {
        "x-api-key": process.env.ZAPUPI_KEY
      }
    });

    const data = response.data;

    if (!data.success) {
      return res.json({ success: false, error: "ZapUPI error" });
    }

    // ✔ Store initial payment data to Firestore
    await db.collection("payments").doc(data.txnId).set({
      amount: amount,
      userId: userId,
      status: "pending",
      createdAt: Date.now()
    });

    // ✔ Redirect to UI (Skill Clash style)
    return res.json({
      success: true,
      redirect: `/pay.html?amt=${amount}&qr=${data.qrLink}&txn=${data.txnId}`
    });

  } catch (err) {
    console.log(err);
    return res.json({ success: false, error: "Server Error" });
  }
});


// -----------------------------
// 🔥 Status Check (Auto Coin Add)
// -----------------------------
app.post("/verify", async (req, res) => {
  try {
    const { txnId } = req.body;

    if (!txnId) return res.json({ success: false, error: "txnId missing" });

    // ✔ Call ZapUPI Verify
    const verify = await axios.post("https://api.zapupi.com/verify", {
      txnId
    }, {
      headers: {
        "x-api-key": process.env.ZAPUPI_KEY
      }
    });

    if (!verify.data.success) {
      return res.json({ success: false, error: "Not paid yet" });
    }

    // ✔ Check Firestore record
    const paymentRef = db.collection("payments").doc(txnId);
    const payment = await paymentRef.get();

    if (!payment.exists) {
      return res.json({ success: false, error: "Payment not found" });
    }

    if (payment.data().status === "completed") {
      return res.json({ success: true, message: "Already added" });
    }

    const userId = payment.data().userId;
    const amount = payment.data().amount;

    // ✔ Add coins to user Firestore
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      coins: admin.firestore.FieldValue.increment(amount)
    });

    // ✔ Update payment status
    await paymentRef.update({
      status: "completed",
      paidAt: Date.now()
    });

    return res.json({ success: true, message: "Coins Added" });

  } catch (err) {
    console.log(err);
    return res.json({ success: false, error: "Server Verify Error" });
  }
});


// -----------------------------
// 🔥 Serve Frontend Files
// -----------------------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.send("Server Running Successfully!");
});

// -----------------------------
// 🔥 Port Listener
// -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🔥 SERVER RUNNING ON PORT", PORT);
});
