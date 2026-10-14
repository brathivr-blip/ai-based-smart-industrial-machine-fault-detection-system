import "dotenv/config";
import { randomInt } from "node:crypto";
import { setDefaultResultOrder, setServers } from "node:dns";
import { createServer } from "node:http";
import mongoose from "mongoose";
import nodemailer from "nodemailer";

// Allow HTTPS fetch on networks with SSL inspection/proxy certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Ensure DNS lookups use reliable public DNS and prefer IPv4
setDefaultResultOrder("ipv4first");
try {
  setServers(["8.8.8.8", "8.8.4.4"]);
} catch {
  // Use system default if setServers is restricted
}

const PORT = Number(process.env.PORT || 5001);
const FRONTEND_ORIGINS = new Set(
  (process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const MAX_BODY_BYTES = 64 * 1024;
const OTP_SEND_COOLDOWN_MS = 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 10_000;
const rateLimits = new Map();

// ================= MONGODB SETUP =================
const MONGODB_URI = process.env.MONGODB_URI;
let isMongoConnected = false;

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
    .then(() => {
      isMongoConnected = true;
      console.log("MongoDB Atlas connected successfully.");
    })
    .catch((err) => {
      console.error("MongoDB Atlas connection error:", err.message);
    });
}

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, index: true },
  isVerified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  lastOtpSentAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.models.User || mongoose.model("User", UserSchema);

const TelemetrySchema = new mongoose.Schema({
  temperature: { type: Number, required: true },
  vibration: { type: Number, required: true },
  current: { type: Number, required: true },
  status: { type: String, default: "NORMAL" },
  ai_prediction: { type: String, default: "NORMAL" },
  timestamp: { type: Date, default: Date.now, index: true },
});
const Telemetry = mongoose.models.Telemetry || mongoose.model("Telemetry", TelemetrySchema);

// ================= EMAIL / NODEMAILER SETUP =================
const useAppsScript = Boolean(process.env.GOOGLE_APPS_SCRIPT_URL);
let mailer = null;

if (!useAppsScript) {
  const requiredEnvironment = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "OTP_FROM_EMAIL"];
  const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
  if (missingEnvironment.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvironment.join(", ")}. Copy .env.example to .env and configure it.`,
    );
  }

  const smtpPort = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be a valid port number.");
  }
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const otpRecords = new Map();

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(payload));
}

function corsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!FRONTEND_ORIGINS.has(origin)) return false;

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function getClientKey(request, suffix) {
  const address = request.socket.remoteAddress || "unknown";
  return `${address}:${suffix}`;
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (current && current.expiresAt > now) {
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [storedKey, entry] of rateLimits) {
      if (entry.expiresAt <= now) rateLimits.delete(storedKey);
      if (rateLimits.size < MAX_RATE_LIMIT_KEYS) break;
    }
    if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) return false;
  }

  rateLimits.set(key, { count: 1, expiresAt: now + windowMs });
  return true;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(Object.assign(new Error("Request is too large."), { status: 413 }));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function sendOtp(email) {
  // Record OTP request attempt in MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      await User.updateOne(
        { email },
        { $set: { email, lastOtpSentAt: new Date() } },
        { upsert: true },
      );
    }
  } catch (err) {
    console.warn("MongoDB User upsert warning:", err.message);
  }

  if (process.env.GOOGLE_APPS_SCRIPT_URL) {
    const res = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendOtp", email }),
    });
    const data = await res.json();
    if (!data.success) {
      throw Object.assign(new Error(data.message || "Could not send OTP via Google Apps Script."), { status: 400 });
    }
    return;
  }

  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await mailer.sendMail({
    from: process.env.OTP_FROM_EMAIL,
    to: email,
    subject: "Your PredictX verification code",
    text: `Your PredictX verification code is ${otp}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`,
  });
  otpRecords.set(email, { otp, attempts: 0, expiresAt: Date.now() + 5 * 60 * 1000 });
}

async function verifyOtp(email, otp) {
  if (!/^\d{6}$/.test(otp)) {
    throw Object.assign(new Error("Enter the six-digit verification code."), { status: 400 });
  }

  if (process.env.GOOGLE_APPS_SCRIPT_URL) {
    const res = await fetch(process.env.GOOGLE_APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verifyOtp", email, otp }),
    });
    const data = await res.json();
    if (!data.success) {
      throw Object.assign(new Error(data.message || "That verification code is incorrect or expired."), { status: 400 });
    }
  } else {
    const record = otpRecords.get(email);
    if (!record || record.expiresAt <= Date.now()) {
      otpRecords.delete(email);
      throw Object.assign(new Error("That code expired or was not found. Request a new code."), { status: 400 });
    }
    if (record.attempts >= 5) {
      otpRecords.delete(email);
      throw Object.assign(new Error("Too many incorrect codes. Request a new code."), { status: 400 });
    }
    if (record.otp !== otp) {
      record.attempts += 1;
      throw Object.assign(new Error("That verification code is incorrect."), { status: 400 });
    }
    otpRecords.delete(email);
  }

  // Save verified user account to MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      await User.updateOne(
        { email },
        { $set: { isVerified: true, verifiedAt: new Date() } },
        { upsert: true },
      );
      console.log(`Verified user ${email} saved to MongoDB.`);
    }
  } catch (err) {
    console.error("Failed to save verified user to MongoDB:", err.message);
  }
}

async function handleRequest(request, response) {
  if (!corsHeaders(request, response)) {
    sendJson(response, 403, { success: false, message: "This website is not allowed to call the authentication service." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || "/", "http://localhost");

  // Health check
  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      success: true,
      service: "predictx-auth",
      mongoConnected: mongoose.connection.readyState === 1,
    });
    return;
  }

  // Telemetry routes (store / retrieve all sensor data in MongoDB)
  if (requestUrl.pathname === "/api/telemetry") {
    if (request.method === "POST") {
      const body = await readJson(request);
      const record = new Telemetry({
        temperature: Number(body.temperature) || 0,
        vibration: Number(body.vibration) || 0,
        current: Number(body.current) || 0,
        status: String(body.status || "NORMAL"),
        ai_prediction: String(body.ai_prediction || "NORMAL"),
        timestamp: new Date(),
      });
      await record.save();
      sendJson(response, 201, { success: true, message: "Telemetry saved to MongoDB." });
      return;
    }

    if (request.method === "GET") {
      const records = await Telemetry.find().sort({ timestamp: -1 }).limit(50).lean();
      sendJson(response, 200, { success: true, count: records.length, data: records });
      return;
    }
  }

  // Get list of verified users from MongoDB
  if (request.method === "GET" && requestUrl.pathname === "/api/auth/users") {
    const users = await User.find({}, { _id: 0, __v: 0 }).sort({ createdAt: -1 }).lean();
    sendJson(response, 200, { success: true, users });
    return;
  }

  if (
    request.method !== "POST" ||
    !["/api/auth/send-otp", "/api/auth/verify-otp"].includes(requestUrl.pathname)
  ) {
    sendJson(response, 404, { success: false, message: "Route not found." });
    return;
  }

  const body = await readJson(request);
  const email = validateEmail(body.email);
  if (!email) {
    sendJson(response, 400, { success: false, message: "Enter a valid email address." });
    return;
  }

  if (requestUrl.pathname === "/api/auth/send-otp") {
    const cooldownKey = `send:${email}`;
    const sendIpKey = getClientKey(request, "send-otp");
    if (
      !rateLimit(sendIpKey, 12, 15 * 60 * 1000) ||
      !rateLimit(cooldownKey, 1, OTP_SEND_COOLDOWN_MS)
    ) {
      sendJson(response, 429, { success: false, message: "Please wait a minute before requesting another code." });
      return;
    }

    try {
      await sendOtp(email);
    } catch (error) {
      console.error("OTP email delivery failed:", error);
      if (error?.status) throw error;
      const message = error?.responseCode === 535
        ? "Gmail rejected the SMTP login. Use an App Password from the same Google account as SMTP_USER."
        : error?.code === "ETIMEDOUT"
          ? "Could not connect to Gmail SMTP. Check your network or firewall and try again."
          : error?.message || "Could not send the verification email. Check the SMTP settings and try again.";
      throw Object.assign(new Error(message), { status: 502 });
    }
    sendJson(response, 200, { success: true, message: "Verification code sent. Check your email." });
    return;
  }

  const clientKey = getClientKey(request, "verify-otp");
  if (!rateLimit(clientKey, 8, 15 * 60 * 1000)) {
    sendJson(response, 429, { success: false, message: "Too many verification attempts. Please try again later." });
    return;
  }

  const otp = typeof body.otp === "string" ? body.otp.trim() : "";
  if (!/^\d{6}$/.test(otp)) {
    sendJson(response, 400, { success: false, message: "Enter the six-digit verification code." });
    return;
  }

  await verifyOtp(email, otp);
  sendJson(response, 200, {
    success: true,
    message: "Email verified successfully. Account saved in MongoDB.",
  });
}

function start() {
  const server = createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent || response.destroyed) return;
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status === 500) console.error("Authentication service request failed:", error);
      sendJson(response, status, {
        success: false,
        message: status === 500 ? "The authentication service encountered an error." : error.message,
      });
    });
  });

  server.listen(PORT, () => {
    console.log(`PredictX auth service listening at http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start();
