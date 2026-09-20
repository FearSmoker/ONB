import type { Attachment, EmailRecord, User } from "../types";

const rawBase = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").trim();
export const API_BASE = rawBase ? rawBase.replace(/\/+$/, "") : "";

function buildUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${cleanPath}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function loginWithGoogle() {
  window.location.href = buildUrl("/api/auth/google");
}

export function connectSlack() {
  window.location.href = buildUrl("/api/slack/connect");
}

export async function uploadAttachment(file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(buildUrl("/api/attachments/upload"), {
    method: "POST",
    credentials: "include",
    body: formData
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Upload failed with ${response.status}`);
  }

  return response.json() as Promise<Attachment>;
}

export const api = {
  me: async () => {
    try {
      return await request<{ user: User | null }>("/api/me");
    } catch {
      return { user: null };
    }
  },
  loginWithEmail: (email: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  disconnectSlack: () => request<{ ok: true }>("/api/slack/disconnect", { method: "POST" }),
  uploadAvatar: async (file: File) => {
    const formData = new FormData();
    formData.append("avatar", file);
    const response = await fetch(buildUrl("/api/me/avatar"), {
      method: "POST",
      credentials: "include",
      body: formData
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Avatar upload failed" }));
      throw new Error(err.error || "Avatar upload failed");
    }
    return response.json() as Promise<{ user: User }>;
  },
  listEmails: (status: "all" | "scheduled" | "sent" | "failed", q = "") => {
    const params = new URLSearchParams({ status });
    if (q.trim()) params.set("q", q.trim());
    return request<{ emails: EmailRecord[] }>(`/api/emails?${params.toString()}`);
  },
  scheduleEmails: (payload: {
    senderEmail: string;
    senderEmails?: string[];
    recipients: string[];
    subject: string;
    body: string;
    startTime: string;
    delayBetweenEmailsMs: number;
    hourlyLimit: number;
    attachmentIds?: string[];
  }) =>
    request<{ campaignId: string; scheduledCount: number; emails: EmailRecord[] }>("/api/emails/schedule", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteEmail: (id: string) =>
    request<{ ok: true; id: string }>(`/api/emails/${id}`, {
      method: "DELETE"
    }),
  deleteAttachment: (id: string) =>
    request<{ ok: true; id: string }>(`/api/attachments/${id}`, {
      method: "DELETE"
    })
};
