export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  slackConnected: boolean;
  slackTeamName: string | null;
  slackChannelName: string | null;
};

export type EmailStatus = "SCHEDULED" | "RATE_LIMITED" | "SENDING" | "SENT" | "FAILED";

export type Attachment = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  cloudinaryUrl: string;
};

export type EmailRecord = {
  id: string;
  senderEmail: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledFor: string;
  status: EmailStatus;
  sentAt: string | null;
  lastError: string | null;
  etherealPreviewUrl: string | null;
  attachments: Attachment[];
  attachmentCount: number;
};
