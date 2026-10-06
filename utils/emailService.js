const { google } = require("googleapis");

const APP_NAME = "MyStockHub";

const emailTemplates = {
  registration: {
    subject: `${APP_NAME} | Verify your email`,
    heading: "Verify your email address",
    description:
      "Welcome to MyStockHub. Enter this verification code to finish setting up your organization and admin account.",
    textDescription:
      "Welcome to MyStockHub. Enter this verification code to finish setting up your organization and admin account.",
    securityNotice:
      "If you did not request this, you can safely ignore this email. Your account will not be created without this code."
  },
  passwordReset: {
    subject: `${APP_NAME} | Password reset code`,
    heading: "Reset your password",
    description:
      "We received a request to reset the password for your MyStockHub account. Enter this code on the password reset page to continue.",
    textDescription:
      "We received a request to reset the password for your MyStockHub account. Enter this code on the password reset page to continue.",
    securityNotice:
      "If you did not request this, you can safely ignore this email. Your password will not be changed unless you complete the reset process."
  },
  twoFactor: {
    subject: `${APP_NAME} | Sign-in verification code`,
    heading: "Verify your sign-in",
    description:
      "Enter this one-time code to finish signing in to your MyStockHub account.",
    textDescription:
      "Enter this one-time code to finish signing in to your MyStockHub account.",
    securityNotice:
      "If you did not try to sign in, change your password and review your account security."
  },
  salesAction: {
    subject: `${APP_NAME} | Confirm sales action`,
    heading: "Confirm this sales action",
    description:
      "Enter this one-time code to verify the sales or payment action requested for your account.",
    textDescription:
      "Enter this one-time code to verify the sales or payment action requested for your account.",
    securityNotice:
      "If you did not request this action, you can safely ignore this message."
  }
};

const createEmailBrandLogo = () => `
  <span style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:32px;font-weight:800;letter-spacing:-0.5px;">
    <span style="color:#0F172A;">MY</span><span style="color:#16A34A;">Stock</span><span style="color:#0F172A;">HHub</span>
  </span>
`;

const createHtmlEmail = (
  { heading, description, securityNotice },
  otp
) => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${heading}</title>
  </head>

  <body style="margin:0;padding:0;background-color:#f3f6f4;font-family:Arial,Helvetica,sans-serif;color:#17201c;">

    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Your MyStockHub verification code is ${otp}. It expires in 10 minutes.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background-color:#f3f6f4;padding:32px 12px;">

      <tr>
        <td align="center">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
            style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8e4;border-radius:16px;overflow:hidden;">

            <tr>
              <td align="center" style="padding:28px 24px 20px;">
                ${createEmailBrandLogo()}
              </td>
            </tr>

            <tr>
              <td style="padding:8px 32px 32px;">

                <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;text-align:center;color:#17201c;">
                  ${heading}
                </h1>

                <p style="margin:0 0 24px;font-size:15px;line-height:24px;text-align:center;color:#59665e;">
                  ${description}
                </p>

                <div style="padding:20px 12px;border:1px solid #dce9df;border-radius:12px;background-color:#f4faf6;text-align:center;">

                  <p style="margin:0 0 8px;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#59665e;">
                    Your verification code
                  </p>

                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;color:#1e884d;">
                    ${otp}
                  </p>

                </div>

                <p style="margin:20px 0 0;font-size:14px;line-height:22px;color:#59665e;">
                  This code expires in
                  <strong style="color:#17201c;">10 minutes</strong>
                  and can only be used once.
                </p>

                <p style="margin:12px 0 0;font-size:14px;line-height:22px;color:#59665e;">
                  ${securityNotice}
                </p>

              </td>
            </tr>

            <tr>
              <td style="padding:18px 24px;border-top:1px solid #e8eeea;background-color:#fafcfb;text-align:center;">

                <p style="margin:0;font-size:12px;line-height:18px;color:#78847c;">
                  This is an automated security message from ${APP_NAME}.
                  Please do not reply to this email.
                </p>

              </td>
            </tr>

          </table>

        </td>
      </tr>

    </table>

  </body>
</html>
`;

const createRawEmail = ({ to, subject, text, html }) => {
  const boundary = "----=_MyStockHubBoundary";

  const message = [
    `From: ${process.env.GMAIL_USER}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`
  ].join("\r\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const sendOtpEmail = async (email, otp, purpose) => {
  const template = emailTemplates[purpose];

  if (!template) {
    throw new Error("Unsupported email verification purpose");
  }

  if (
    typeof email !== "string" ||
    typeof otp !== "string" ||
    !/^\d{6}$/.test(otp)
  ) {
    throw new Error(
      "A valid email address and 6-digit verification code are required"
    );
  }

  if (
    !process.env.GMAIL_CLIENT_ID ||
    !process.env.GMAIL_CLIENT_SECRET ||
    !process.env.GMAIL_REFRESH_TOKEN ||
    !process.env.GMAIL_USER
  ) {
    throw new Error("Gmail API is not configured");
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );

    auth.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN
    });

    const gmail = google.gmail({
      version: "v1",
      auth
    });

    const text = `${template.textDescription}

Your MyStockHub verification code: ${otp}

This code expires in 10 minutes and can only be used once.

${template.securityNotice}

This is an automated security message from MyStockHub. Please do not reply to this email.`;

    const html = createHtmlEmail(template, otp);

    const raw = createRawEmail({
      to: email,
      subject: template.subject,
      text,
      html
    });

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw
      }
    });

    console.info("[email] Gmail API email sent", {
      recipient: email,
      purpose,
      messageId: result.data.id
    });

    return result.data;
  } catch (error) {
    console.error(
      "[email] Gmail API delivery failed:",
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
};

module.exports = { sendOtpEmail };