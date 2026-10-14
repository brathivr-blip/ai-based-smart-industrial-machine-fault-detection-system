import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Login() {
  const [mode, setMode] = useState("password"); // "password" or "otp"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const navigate = useNavigate();

  // Validate email format
  const isValidEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());

  // Password / Direct login with any valid email
  const handlePasswordLogin = (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      setError("Please enter a valid email address (e.g., yourname@gmail.com).");
      return;
    }

    if (!password || password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    // Save user session and navigate
    localStorage.setItem("predictxLogin", "true");
    localStorage.setItem("predictxUserEmail", cleanEmail);
    navigate("/dashboard");
  };

  // Send real OTP code to user's Gmail using auth-service on port 5001
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      setError("Please enter a valid Gmail or email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("http://localhost:5001/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setOtpSent(true);
        setSuccess(`A 6-digit verification code has been sent to ${cleanEmail}.`);
      } else {
        setError(data.message || "Could not send OTP. Make sure the auth service is running.");
      }
    } catch {
      setError("Cannot reach auth service on port 5001. You can switch to Password Login to proceed.");
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP code entered by user
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    if (!/^\d{6}$/.test(cleanOtp)) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("http://localhost:5001/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, otp: cleanOtp }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem("predictxLogin", "true");
        localStorage.setItem("predictxUserEmail", cleanEmail);
        navigate("/dashboard");
      } else {
        setError(data.message || "Invalid or expired verification code.");
      }
    } catch {
      setError("Authentication error. Please check your verification code.");
    } finally {
      setLoading(false);
    }
  };

  // Quick 1-click access
  const handleQuickAccess = () => {
    localStorage.setItem("predictxLogin", "true");
    localStorage.setItem("predictxUserEmail", "operator@predictx.local");
    navigate("/dashboard");
  };

  return (
    <div className="loginPage">
      <div className="loginCard">
        <div className="loginLogo">⚙️</div>

        <h1>PredictX</h1>
        <p className="loginSubtitle">AI Predictive Maintenance Platform</p>

        {/* MODE SWITCHER */}
        <div className="authTabSwitch">
          <button
            type="button"
            className={`authTab ${mode === "password" ? "authTabActive" : ""}`}
            onClick={() => {
              setMode("password");
              setError("");
              setSuccess("");
            }}
          >
            Email &amp; Password
          </button>
          <button
            type="button"
            className={`authTab ${mode === "otp" ? "authTabActive" : ""}`}
            onClick={() => {
              setMode("otp");
              setError("");
              setSuccess("");
            }}
          >
            Gmail OTP Code
          </button>
        </div>

        {/* PASSWORD LOGIN FORM */}
        {mode === "password" && (
          <form onSubmit={handlePasswordLogin}>
            <label>Your Email / Gmail</label>
            <input
              type="email"
              placeholder="Enter your email (e.g. name@gmail.com)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && <div className="loginError">{error}</div>}

            <button type="submit">Sign In &rarr;</button>
          </form>
        )}

        {/* GMAIL OTP VERIFICATION FORM */}
        {mode === "otp" && (
          <div>
            {!otpSent ? (
              <form onSubmit={handleSendOtp}>
                <label>Your Gmail Address</label>
                <input
                  type="email"
                  placeholder="Enter your Gmail to receive code"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />

                {error && <div className="loginError">{error}</div>}
                {success && <div className="loginSuccess">{success}</div>}

                <button type="submit" disabled={loading}>
                  {loading ? "Sending Code..." : "Send Verification Code ✉️"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp}>
                <label>Enter 6-Digit Code for {email}</label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="e.g. 123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  style={{ letterSpacing: "4px", fontSize: "18px", textAlign: "center" }}
                  required
                  autoFocus
                />

                {error && <div className="loginError">{error}</div>}
                {success && <div className="loginSuccess">{success}</div>}

                <button type="submit" disabled={loading}>
                  {loading ? "Verifying..." : "Verify &amp; Enter Dashboard →"}
                </button>

                <button
                  type="button"
                  className="resendBtn"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError("");
                    setSuccess("");
                  }}
                >
                  Change Email / Resend
                </button>
              </form>
            )}
          </div>
        )}

        {/* QUICK ACCESS BUTTON (Replaces static demo box) */}
        <div className="quickAccessRow">
          <button type="button" className="quickAccessBtn" onClick={handleQuickAccess}>
            ⚡ One-Click Instant Guest Access
          </button>
        </div>
      </div>
    </div>
  );
}

export default Login;