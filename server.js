// server.js
"use strict";
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

// Import rrdom packages (for potential server‑side DOM processing)
const rrdom = require("rrdom");
const rrdomNodejs = require("rrdom-nodejs");

const app = express();

// ----- Security Middleware -----
app.use(helmet());
app.use(express.json({ limit: "1mb" })); // Limit payload size

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // Limit each IP to 60 requests per minute
});
app.use(limiter);

// ----- Configuration Endpoint -----
// Clients can query this endpoint to know if console plugins should be enabled.
app.get("/config", (req, res) => {
  res.json({
    enableConsolePlugin: process.env.ENABLE_CONSOLE_PLUGIN === "true"
  });
});

// ----- Allowed Domains Configuration -----
// ALLOWED_DOMAINS is a JSON string from the .env file mapping allowed domains
// to their respective S3 buckets and pre‑shared tokens.
let allowedDomains = {};
try {
  allowedDomains = JSON.parse(process.env.ALLOWED_DOMAINS);
} catch (err) {
  console.error("Error parsing ALLOWED_DOMAINS environment variable:", err);
  process.exit(1);
}

// ----- AWS Configuration -----
AWS.config.update({
  region: process.env.AWS_REGION // e.g. "us-east-1"
  // AWS credentials are picked up from environment variables or IAM roles.
});
const s3 = new AWS.S3();

// ----- Endpoint: /upload-session -----
// Receives session data from the recorder and uploads it to S3.
app.post("/upload-session", (req, res) => {
  try {
    const { sessionId, events, pageUrl, host, timestamp, domainToken } = req.body;
    if (!sessionId || !Array.isArray(events) || events.length === 0 || !pageUrl || !host || !domainToken) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    // ----- Domain Verification (Backend) -----
    if (!(allowedDomains[host] && allowedDomains[host].token === domainToken)) {
      return res.status(403).json({ error: "Domain not allowed or token invalid" });
    }
    const verifiedDomain = host; // Verified

    // Determine the correct S3 bucket for this domain.
    const bucketName = allowedDomains[verifiedDomain].bucket;
    if (!bucketName) {
      return res.status(500).json({ error: "S3 bucket not configured for domain" });
    }

    // ----- Upload Session Data to S3 -----
    const fileName = `sessions/${sessionId}_${Date.now()}_${uuidv4()}.json`;
    const sessionData = JSON.stringify({ sessionId, events, pageUrl, host: verifiedDomain, timestamp });
    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: sessionData,
      ContentType: "application/json"
    };

    s3.upload(params, (err, data) => {
      if (err) {
        console.error("Error uploading to S3:", err);
        return res.status(500).json({ error: "Error uploading session" });
      }
      // Generate a signed URL (expires in 1 hour) for secure playback.
      const signedUrl = s3.getSignedUrl("getObject", {
        Bucket: bucketName,
        Key: fileName,
        Expires: 3600
      });
      res.json({ url: signedUrl });
    });
  } catch (err) {
    console.error("Error in /upload-session:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Serve Static Files (e.g. Recorder & Playback Pages) -----
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
