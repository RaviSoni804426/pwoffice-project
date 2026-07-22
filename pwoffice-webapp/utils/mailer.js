const nodemailer = require('nodemailer');

/**
 * Creates and configures Nodemailer Transporter
 */
function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('[MAILER WARNING] SMTP_USER or SMTP_PASS not set in environment variables.');
  }

  return nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465, // true for 465, false for 587
    auth: (user && pass) ? {
      user: user,
      pass: pass
    } : undefined
  });
}

/**
 * Sends a PW Office Branded Password Reset Email
 * @param {string} toEmail - Recipient email address
 * @param {string} resetUrl - Complete password reset URL with token
 * @param {number} expiryMinutes - Token lifetime in minutes (default 60)
 */
async function sendPasswordResetEmail(toEmail, resetUrl, expiryMinutes = 60) {
  const transporter = createTransporter();
  const fromAddress = process.env.EMAIL_FROM || `"PW Office Security" <${process.env.SMTP_USER || 'no-reply@pwoffice.com'}>`;

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your PW Office Password</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: #0f172a;
          color: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .wrapper {
          width: 100%;
          background-color: #0f172a;
          padding: 40px 20px;
          box-sizing: border-box;
        }
        .card {
          max-width: 520px;
          margin: 0 auto;
          background-color: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 36px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
        }
        .header {
          text-align: center;
          margin-bottom: 28px;
        }
        .title {
          font-size: 24px;
          font-weight: 700;
          color: #38bdf8;
          margin: 12px 0 0 0;
        }
        .content {
          color: #cbd5e1;
          font-size: 15px;
          line-height: 1.6;
          margin-bottom: 28px;
        }
        .btn-container {
          text-align: center;
          margin: 32px 0;
        }
        .btn {
          display: inline-block;
          background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
          color: #ffffff !important;
          text-decoration: none;
          font-weight: 600;
          font-size: 16px;
          padding: 14px 32px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
        }
        .expiry-note {
          background-color: rgba(56, 189, 248, 0.1);
          border-left: 4px solid #38bdf8;
          padding: 12px 16px;
          border-radius: 4px;
          font-size: 14px;
          color: #94a3b8;
          margin-bottom: 24px;
        }
        .link-fallback {
          font-size: 13px;
          color: #64748b;
          word-break: break-all;
          margin-top: 24px;
          border-top: 1px solid #334155;
          padding-top: 20px;
        }
        .link-fallback a {
          color: #38bdf8;
        }
        .footer {
          text-align: center;
          margin-top: 32px;
          font-size: 12px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="card">
          <div class="header">
            <h1 class="title">PW Office</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to reset the password for your <strong>PW Office</strong> account associated with <code>${toEmail}</code>.</p>
            <p>Click the button below to choose a new password:</p>
            <div class="btn-container">
              <a href="${resetUrl}" class="btn" target="_blank">Reset Password</a>
            </div>
            <div class="expiry-note">
              <strong>Notice:</strong> This password reset link is valid for <strong>${expiryMinutes} minutes</strong> (1 hour). If you did not request a password reset, you can safely ignore this email.
            </div>
            <div class="link-fallback">
              If the button above does not work, copy and paste this URL into your web browser:<br>
              <a href="${resetUrl}" target="_blank">${resetUrl}</a>
            </div>
          </div>
          <div class="footer">
            &copy; 2026 PW Office Workspace & Document Editor. All rights reserved.
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
PW Office - Password Reset Request

Hello,

We received a request to reset your PW Office password for ${toEmail}.
Please use the following link to reset your password (valid for ${expiryMinutes} minutes):

${resetUrl}

If you did not request this, please ignore this email.

-- 
PW Office Team
  `;

  const mailOptions = {
    from: fromAddress,
    to: toEmail,
    subject: 'PW Office Password Reset Request',
    text: textContent,
    html: htmlContent
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[EMAIL SENT] Password reset email delivered to ${toEmail}. MessageID: ${info.messageId}`);
  return info;
}

module.exports = {
  sendPasswordResetEmail
};
