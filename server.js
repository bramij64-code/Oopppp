require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

app.get("/", (req, res) => {
  res.send("Running OK 👍");
});

app.post("/create-order", async (req, res) => {
  try {
    const { amount, userId } = req.body;

    const zapRes = await axios.post(process.env.ZAPUPI_URL, {
      amount: amount,
     upi_id: "test@upi",
    }, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ZAPUPI_KEY,
      }
    });

    const paymentUrl = zapRes.data?.payment_url;

    await db.collection("payments").add({
      userId,
      amount,
      paymentUrl,
      time: Date.now(),
      status: "pending",
    });

    res.json({
      success: true,
      paymentUrl,
    });

  } catch (err) {
    console.log(err);
    res.json({ success: false, error: err.message });
  }
});

app.listen(10000, () => {
  console.log("Server running on port 10000");
});
