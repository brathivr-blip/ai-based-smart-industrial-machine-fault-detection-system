# PredictX email OTP verification

This additive email-verification service does not use MongoDB or create user
accounts. It does not modify the existing React login, dashboard, or firmware.
The verification page is available at `http://localhost:5173/register.html`
when the Vite website is running.

## Configuration

1. Copy `.env.example` to `.env` in this directory.
2. Configure SMTP. For Gmail, use `smtp.gmail.com`, port `587`, your Gmail
   address for `SMTP_USER` and `OTP_FROM_EMAIL`, and a Google App Password for
   `SMTP_PASS` (not your normal account password). Keep credentials private and
   never commit `.env`.
3. Install and start the service from this directory:

   ```powershell
   npm install
   npm start
   ```

   Node.js 20 or newer is required. The service listens on port 5001. Nodemailer
   sends email directly through SMTP; OTPs live in service memory for five
   minutes.
4. Start the existing website separately with `npm run dev` from the `website`
   directory, then open `http://localhost:5173/register.html`.

The backend handles OTP generation and verification itself. The existing Google
Apps Script files are no longer part of the active email flow. Codes expire
after five minutes, resend requests are throttled, and up to five verification
attempts are allowed.

The verification page confirms the email only. It does not create an account,
save the email, or integrate with the existing demo login.
