const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// ---------------------------
// Firebase Realtime Database
// ---------------------------
const serviceAccount = {
  type: "service_account",
  project_id: "flash-nf",
  private_key_id: "ab193dd72988cc0293142541ae9ed6a76f120e7e",
  private_key: "-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDoXIczwHW7h/kk
UwbBKN4zytkl20KjL2HpnmiGJxuvhJaPl01cROoqUZoxDhyag81f3A6DjIua/ua5
KMR9vXG6mswKUKX2DSX92psbbvj7j4BNI0DX3WzmLEStv8pdlu+Hf6UFRlCLWbk2
Ggi+8lBFJjtfYxwgZpgGj9ZssYbnvaH59T1J7d4JRiZ3lIswmTeOogCZ5Glz7R/M
bbMB3x7HpYnLgLgIIyJbP2sm+f2mYybu/6s1v/N2vrWaGOYlBZSrz4+xiryTmAN0
QMwtZkDF+/b/8vAkyHlw3EIR3ni1kOoOWmwZTdBSH1PhbNkI362/OJBrEJaj2ppf
MTr3rqSRAgMBAAECggEAA8JmDXMeX/GtojO104QlgQvMqawrg168tDKqzZ2y3YHu
MT8LZMQYhxMb10jW6iIRRq0VmAfEMuQq82OZgD5Mlzd7byDcaD6Z24F305wxRmvN
MZJNMYV2/TCAqhlpmHCvLn0lBXVKPawTM6fGGoWhnJ+nVedIRsARCdHauV+vfkEa
rm7HuMzz0fBMwZAeIQKAh/v8LCp3qyp1Vwi+W1Ah1/3nNKIcHzYQMPlHFDesHMSe
wbOdpFPwiSR0c1oDCp4VIaMNBWICg0fht6L+IOe2CSa5AcxDOYYPP5TqnQf9I56F
ORzBUOj7rQ+O80hWUicBWncMNF4KjUkvCttEwAFD5QKBgQD4L/8fh7du44FaPTTM
mkQxqOOzx07XL3nusXX5RtFfGXkyKSlMoT72OTa3k8QpSiceNika7vV/RQKJU/XH
4vtjKLcbRuQZ8uCnWvKtPMRvXamZpb03QcgIfIgys/GfMd4KjHCeEXGtZltO/Iom
scrFcwTPsn71QHtbum177kvwHQKBgQDvrP+SkYM1JsqxGX3VpeqOmMOvmAuYlN6L
FdNa+HVzbPFtZdHuD+dX3flFdJc2aAsRe42BrLNKrF6jFw676RM68+Wnl1ovfvvX
hSIh9yEWHuflbC75SioRAEqYzvhji/j2TvMb2GoY7N1S+guWI0Q+qVEkJyFkBNYD
LiLAZLSEBQKBgHLKgE2tEAKR53o9ZPZdQ71USD0WqjiNFPB50/7/6kb6GTxCHX/7
9Isd21j9V3VhfsZSdqCmdZXv7URnOP7C1VL/ufE70LTPyWiegC/wM0rvH0qZhfLQ
0hxavQP2hoMDJZfrbQsvNkzlUsYtuBg9k3PPxyHphR8aO/QpPgpcJXNhAoGAIvgg
yefFNwoT5McNXxC4KloLoyESAA8ocS6cCdfaex7YEtgaSxuy61UNu56JOXzwsHpQ
aS0jc6+2lyEUG0KkdaOETHF+zRM/93ALTN1bzHhx6T1hlSnG/XgHakg4YX3Ys0dN
nTB0OnLE0Ah/jEZU/LeDiTzUWF2ERC6FD4Eh/WkCgYBXIT+C4QxLqCJPIvF4qCdv
SH8FGGo/D8tjd8FT13OWR1KU5oRnvH3F/0+P8R10jO3GETEquR7c+Vvp4UoDvV4X
CW+1D248bTnLDuy6TKKnRU501wug/JQDrOcg4Yd+9ODcfcxJTDtup+yjY80I0TJc
6h33OuyI9/uawgdGhONpKw==
-----END PRIVATE KEY-----"
  client_email: "firebase-adminsdk-fbsvc@flash-nf.iam.gserviceaccount.com",
  client_id: "113143569037330676591"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://flash-nf-default-rtdb.firebaseio.com"
});

const db = admin.database();

// ---------------------------
// Root
// ---------------------------
app.get("/", (req, res) => {
  res.send("ZapUPI Payment Gateway Live with Firebase 🔥");
});

// ---------------------------
// Create Order
// ---------------------------
app.post("/create-order", async (req, res) => {
  let amount = req.body.amount || 1;

  // prevent 1.04 / 1.07 problem
  amount = parseInt(amount);

  const orderId = "ORD" + Date.now();

  try {
    const zap = await axios.post(
      "https://api.zapupi.com/api/create-order",
      new URLSearchParams({
        token_key: "4637a43f8e8db38a97a5d68a110758d3",
        secret_key: "40961dcda5338e0cad148a6838fc3dbb",
        amount: amount,
        order_id: orderId
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const zapData = zap.data;

    // Save to Firebase
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
      payment_page: `https://oopppp.onrender.com/payment/${orderId}`,
      zapData
    });

  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// ---------------------------
// Payment Page
// ---------------------------
app.get("/payment/:id", async (req, res) => {
  const id = req.params.id;

  const snap = await db.ref("orders/" + id).once("value");
  if (!snap.exists()) return res.send("Invalid Order ID");

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

// ---------------------------
// Check Status
// ---------------------------
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

  } catch {
    res.json({ status: order.status });
  }
});

// ---------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server Running:", PORT));
