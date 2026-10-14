function doPost(event) {
  try {
    var request = JSON.parse(event.postData.contents);
    var email = normalizeEmail(request.email);

    if (!isValidEmail(email)) {
      return jsonResponse({ success: false, message: "Enter a valid email address." });
    }

    if (request.action === "sendOtp") {
      return sendOtp(email);
    }

    if (request.action === "verifyOtp") {
      return verifyOtp(email, String(request.otp || ""));
    }

    return jsonResponse({ success: false, message: "Unknown action." });
  } catch (error) {
    console.error(error);
    return jsonResponse({ success: false, message: "The email verification service could not complete the request." });
  }
}

function sendOtp(email) {
  var cache = CacheService.getScriptCache();
  var key = cacheKey(email);

  if (cache.get(key + "_sent")) {
    return jsonResponse({ success: false, message: "Please wait a minute before requesting another code." });
  }

  var randomValue = parseInt(Utilities.getUuid().replace(/-/g, "").slice(0, 8), 16);
  var otp = ("000000" + (randomValue % 1000000)).slice(-6);
  cache.put(key, JSON.stringify({ otp: otp, attempts: 0 }), 300);
  cache.put(key + "_sent", "1", 60);

  try {
    MailApp.sendEmail({
      to: email,
      subject: "Your PredictX verification code",
      body: "Your PredictX verification code is " + otp + ". It expires in 5 minutes. If you did not request this code, you can ignore this email.",
      name: "PredictX",
    });
  } catch (error) {
    cache.remove(key);
    cache.remove(key + "_sent");
    throw error;
  }

  return jsonResponse({ success: true, message: "Verification code sent. Check your email." });
}

function verifyOtp(email, suppliedOtp) {
  if (!/^\d{6}$/.test(suppliedOtp)) {
    return jsonResponse({ success: false, message: "Enter the six-digit verification code." });
  }

  var cache = CacheService.getScriptCache();
  var key = cacheKey(email);
  var saved = cache.get(key);
  if (!saved) {
    return jsonResponse({ success: false, message: "That code expired or was not found. Request a new code." });
  }

  var record = JSON.parse(saved);
  if (record.attempts >= 5) {
    cache.remove(key);
    return jsonResponse({ success: false, message: "Too many incorrect codes. Request a new code." });
  }

  if (record.otp !== suppliedOtp) {
    record.attempts += 1;
    cache.put(key, JSON.stringify(record), 300);
    return jsonResponse({ success: false, message: "That verification code is incorrect." });
  }

  cache.remove(key);
  cache.remove(key + "_sent");
  return jsonResponse({ success: true, message: "Email verified successfully. No account was created or stored." });
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cacheKey(email) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    email,
    Utilities.Charset.UTF_8
  );
  return "predictx_otp_" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/, "");
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
