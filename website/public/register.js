const apiBase =
  window.location.port === "5173"
    ? `${window.location.protocol}//${window.location.hostname}:5001`
    : window.location.origin;

const form = document.querySelector("#register-form");
const emailInput = document.querySelector("#email");
const otpInput = document.querySelector("#otp");
const otpSection = document.querySelector("#otp-section");
const sendOtpButton = document.querySelector("#send-otp");
const submitButton = document.querySelector("#register-submit");
const formMessage = document.querySelector("#form-message");
let otpSentFor = "";
let isSubmitting = false;
let emailVerified = false;

function showMessage(message, kind = "") {
  formMessage.textContent = message;
  formMessage.classList.toggle("is-error", kind === "error");
  formMessage.classList.toggle("is-success", kind === "success");
}

async function postJson(path, data) {
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    throw new Error("Cannot reach the registration service. Make sure it is running.");
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The registration service returned an invalid response.");
  }

  if (!response.ok || result.success !== true) {
    throw new Error(result.message || "The request could not be completed.");
  }
  return result;
}

sendOtpButton.addEventListener("click", async () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }

  sendOtpButton.disabled = true;
  showMessage("Sending your verification code…");
  try {
    const result = await postJson("/api/auth/send-otp", { email });
    otpSentFor = email;
    otpSection.hidden = false;
    otpInput.required = true;
    submitButton.disabled = false;
    otpInput.focus();
    showMessage(result.message || "Code sent. Check your inbox.", "success");
    sendOtpButton.textContent = "Resend OTP";
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    window.setTimeout(() => {
      sendOtpButton.disabled = false;
    }, 900);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSubmitting) return;

  const email = emailInput.value.trim().toLowerCase();
  const otp = otpInput.value.trim();

  if (!form.reportValidity()) return;
  if (!otpSentFor || email !== otpSentFor || emailVerified) {
    showMessage("Send a new code to the email address you entered.", "error");
    return;
  }

  isSubmitting = true;
  submitButton.disabled = true;
  showMessage("Verifying your email…");
  try {
    const result = await postJson("/api/auth/verify-otp", { email, otp });
    emailVerified = true;
    otpInput.disabled = true;
    sendOtpButton.disabled = true;
    localStorage.setItem("predictxLogin", "true");
    localStorage.setItem("userEmail", email);
    submitButton.textContent = "Redirecting to Dashboard…";
    showMessage("Email verified successfully! Redirecting to Dashboard…", "success");
    window.setTimeout(() => {
      window.location.href = "/dashboard";
    }, 1200);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    isSubmitting = false;
    submitButton.disabled = emailVerified || otpSection.hidden;
  }
});

emailInput.addEventListener("input", () => {
  if (emailInput.value.trim().toLowerCase() !== otpSentFor) {
    otpSentFor = "";
    emailVerified = false;
    otpSection.hidden = true;
    otpInput.required = false;
    otpInput.disabled = false;
    submitButton.disabled = true;
    submitButton.textContent = "Verify email";
    sendOtpButton.disabled = false;
  }
});
