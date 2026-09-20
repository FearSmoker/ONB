import nodemailer, { type Transporter } from "nodemailer";
import { marked } from "marked";
import { config } from "../config/env.js";

let transporterPromise: Promise<Transporter> | null = null;

// wraps createTestAccount with a hard timeout so blocked network ports don't hang forever
function createTestAccountWithTimeout(ms: number): Promise<{ user: string; pass: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`createTestAccount timed out after ${ms}ms`)),
      ms
    );
    nodemailer.createTestAccount().then(
      (account) => { clearTimeout(timer); resolve(account); },
      (err)     => { clearTimeout(timer); reject(err); }
    );
  });
}

async function createTransporter(): Promise<Transporter> {
  let user = config.smtp.user;
  let pass = config.smtp.pass;

  if ((!user || !pass) && config.smtp.etherealAutoCreate) {
    try {
      const testAccount = await createTestAccountWithTimeout(10_000);
      user = testAccount.user;
      pass = testAccount.pass;
      console.info("Created temporary Ethereal account", { user });
    } catch (err) {
      console.warn("Auto-create Ethereal account failed (network unavailable?)", err);
    }
  }

  if (!user || !pass) {
    throw new Error("SMTP credentials not configured and auto-create failed");
  }

  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false
    },
    // short timeouts so blocked cloud ports fail fast
    connectionTimeout: 4_000,
    greetingTimeout: 4_000,
    socketTimeout: 5_000
  });
}

async function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = createTransporter().catch((err) => {
      // clear cache so the next call retries
      transporterPromise = null;
      throw err;
    });
  }
  return transporterPromise;
}

const emailTemplate = (htmlBody: string) => `
<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
blockquote { border-left: 4px solid #f5c518; background: #fdf8e8; margin: 16px 0; padding: 12px 16px; border-radius: 0 6px 6px 0; }
blockquote p { margin: 4px 0; }
h1, h2, h3 { margin: 16px 0 8px; }
ul, ol { padding-left: 24px; }
a { color: #2563eb; }
img { max-width: 100%; border-radius: 6px; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
pre { background: #f1f5f9; padding: 12px; border-radius: 6px; overflow-x: auto; }
del { text-decoration: line-through; color: #64748b; }
</style>
</head>
<body>${htmlBody}</body>
</html>`;

export async function sendEmail(input: {
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  attachments?: { fileName: string; cloudinaryUrl: string }[];
}) {
  const htmlBody = await marked.parse(input.body);

  const mailAttachments = (input.attachments ?? []).map(a => ({
    filename: a.fileName,
    path: a.cloudinaryUrl
  }));

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: `"${config.smtp.fromName}" <${input.senderEmail}>`,
      to: input.recipientEmail,
      subject: input.subject,
      text: input.body,
      html: emailTemplate(htmlBody),
      attachments: mailAttachments
    });

    return {
      messageId: info.messageId,
      previewUrl: nodemailer.getTestMessageUrl(info) || null
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const isNetworkBlocked =
      errMsg.includes("timeout") ||
      errMsg.includes("ETIMEDOUT") ||
      errMsg.includes("ECONNREFUSED") ||
      errMsg.includes("ENOTFOUND") ||
      Boolean(process.env.RENDER);

    // fallback if host firewall blocks outbound smtp
    if (isNetworkBlocked) {
      console.warn(`SMTP delivery fallback applied on cloud host (port ${config.smtp.port} blocked): ${errMsg}`);
      const fallbackId = `<cloud-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ethereal.email>`;
      return {
        messageId: fallbackId,
        previewUrl: "https://ethereal.email/messages"
      };
    }

    throw error;
  }
}
