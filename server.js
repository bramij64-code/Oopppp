const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const app = express();

app.use(bodyParser.json());

// Load Firebase keys from environment
const serviceAccount = {
  "type": "service_account",
  "project_id": process.env.FIREBASE_PROJECT_ID,
  "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
  "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  "client_email": process.env.FIREBASE_CLIENT_EMAIL,
  "client_id": process.env.FIREBASE_CLIENT_ID,
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


// ----------------------------
// 🔥 MAIN WORKING ROUTE
// ----------------------------
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.json({ success: false, error: "Amount required" });
    }

    const txnId = "ZAPUPI" + Date.now();

    const paymentUrl = `upi://pay?pn=SkillClash&pa=${process.env.UPI_ID}&am=${amount}&tid=${txnId}`;

    // Save to firebase
    await db.collection("payments").doc(txnId).set({
        txnId,
        amount,
        paymentUrl,
        status: "PENDING",
        createdAt: Date.now()
    });

    return res.json({
      success: true,
      txnId,
      amount,
      paymentUrl
    });

  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: "Server Error" });
  }
});


// ----------------------------
app.get("/", (req, res) => {
  res.send("Server Running 🔥");
});


// ----------------------------
app.listen(3000, () => {
  console.log("Server running...");
});
