import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, SVGProps } from "react";
import { marked } from "marked";
import { api, connectSlack, loginWithGoogle, uploadAttachment } from "../lib/api";
import { extractEmails, localDatetimeToIso, toLocalDatetimeValue } from "../lib/emailParser";
import type { Attachment, EmailRecord, User } from "../types";

type Screen = "all" | "scheduled" | "sent" | "reader" | "compose";
type ListTab = "all" | "scheduled" | "sent";
type IconProps = SVGProps<SVGSVGElement> & { size?: number; sw?: number };

const S = ({ size = 14, sw = 1.8, children, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

const Icon = {
  chevron: (p: IconProps) => <S sw={2.4} {...p}><path d="m6 9 6 6 6-6" /></S>,
  clock: (p: IconProps) => <S sw={2} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>,
  plane: (p: IconProps) => <S sw={2} {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></S>,
  search: (p: IconProps) => <S sw={2.2} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></S>,
  filter: (p: IconProps) => (
    <S sw={1.8} {...p}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </S>
  ),
  inbox: (p: IconProps) => <S sw={2} {...p}><path d="M3 12h3l2-7 4 14 4-10 2 3h3" /><rect x="3" y="3" width="18" height="18" rx="2" /></S>,
  arrowLeft: (p: IconProps) => <S sw={2} {...p}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></S>,
  refresh: (p: IconProps) => <S sw={2} {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></S>,
  star: (p: IconProps) => <S {...p}><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9Z" /></S>,
  back: (p: IconProps) => <S sw={2} {...p}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></S>,
  archive: (p: IconProps) => <S {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8" /><path d="M10 12h4" /></S>,
  trash: (p: IconProps) => (
    <S sw={1.8} {...p}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </S>
  ),
  clip: (p: IconProps) => <S {...p}><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></S>,
  upload: (p: IconProps) => <S sw={2} {...p}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></S>,
  undo: (p: IconProps) => <S sw={2} {...p}><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></S>,
  redo: (p: IconProps) => <S sw={2} {...p}><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></S>,
  bold: (p: IconProps) => <S sw={2.2} {...p}><path d="M6 4h7a4 4 0 0 1 0 8H6z" /><path d="M6 12h8a4 4 0 0 1 0 8H6z" /></S>,
  italic: (p: IconProps) => <S sw={2} {...p}><path d="M19 4h-9M14 20H5M15 4 9 20" /></S>,
  underline: (p: IconProps) => <S sw={2} {...p}><path d="M6 4v6a6 6 0 0 0 12 0V4" /><path d="M4 21h16" /></S>,
  alignLeft: (p: IconProps) => <S sw={2} {...p}><path d="M4 6h16M4 12h10M4 18h14" /></S>,
  alignCenter: (p: IconProps) => <S sw={2} {...p}><path d="M4 6h16M7 12h10M5 18h14" /></S>,
  ulist: (p: IconProps) => <S sw={2} {...p}><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none" /></S>,
  olist: (p: IconProps) => <S sw={2} {...p}><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 7V4l-1 .5" strokeWidth="1.5" /><path d="M3 13h2l-2 2h2" strokeWidth="1.5" /><path d="M3 17h1.5a.5.5 0 0 1 0 1H3.5a.5.5 0 0 0 0 1H5" strokeWidth="1.5" /></S>,
  indent: (p: IconProps) => <S sw={2} {...p}><path d="M12 6h9M12 12h9M12 18h9M3 6h1M4 6l3 3-3 3" /></S>,
  outdent: (p: IconProps) => <S sw={2} {...p}><path d="M12 6h9M12 12h9M12 18h9M7 6H6M7 6 4 9l3 3" /></S>,
  link: (p: IconProps) => <S sw={2} {...p}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></S>,
  quote: (p: IconProps) => <S sw={2} {...p}><path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" /></S>,
  strike: (p: IconProps) => <S sw={2} {...p}><path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><line x1="4" x2="20" y1="12" y2="12" /></S>,
  file: (p: IconProps) => <S sw={2} {...p}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a1 1 0 0 0 1 1h3" /></S>,
  x: (p: IconProps) => <S sw={2} {...p}><path d="M18 6 6 18M6 6l12 12" /></S>,
  plus: (p: IconProps) => <S sw={2} {...p}><path d="M12 5v14M5 12h14" /></S>
};

const PIXEL_GLYPHS: Record<string, string[]> = {
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  N: ["10001", "11001", "10101", "10101", "10101", "10011", "10001"],
  B: ["01110", "10001", "10001", "10110", "10001", "10001", "01110"]
};

function PixelWordmark({ word = "ONB", gap = 1, color = "currentColor" }) {
  const rects: JSX.Element[] = [];
  let xOff = 0;

  for (const ch of word) {
    const glyph = PIXEL_GLYPHS[ch];
    if (!glyph) {
      xOff += 6;
      continue;
    }
    glyph.forEach((row, y) => {
      let x = 0;
      while (x < 5) {
        if (row[x] === "1") {
          const start = x;
          while (x < 5 && row[x] === "1") x++;
          rects.push(<rect key={`${xOff}-${y}-${start}`} x={xOff + start} y={y} width={x - start} height={1} />);
        } else {
          x++;
        }
      }
    });
    xOff += 5 + gap;
  }

  return (
    <svg viewBox={`0 0 ${xOff - gap} 7`} shapeRendering="crispEdges" role="img" aria-label={word}>
      <g fill={color}>{rects}</g>
    </svg>
  );
}

const GoogleG = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
    <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
  </svg>
);

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U";
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFullDateTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function parseMarkdown(text: string): string {
  return marked.parse(text, { async: false, breaks: true }) as string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageType(fileType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp)$/i.test(fileType);
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 15 * 1024 * 1024;
const MAX_SENDERS = 5;

const AVATAR_COLORS = [
  "#1ea750", "#2d8cf0", "#e05c5c", "#9b59b6", "#e67e22",
  "#16a085", "#2980b9", "#8e44ad", "#d35400", "#27ae60"
];

function letterAvatar(email: string): { letter: string; color: string } {
  const char = (email[0] ?? "?").toUpperCase();
  const hash = email.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return { letter: char, color: color ?? "#1ea750" };
}

function formatSenderName(email: string): string {
  const local = email.split("@")[0] || "Sender";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function Avatar({ user }: { user: User }) {
  return (
    <span className="avatar">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
    </span>
  );
}

function Login({
  error,
  onLoginSuccess
}: {
  error: string | null;
  onLoginSuccess: (user: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  function handleGoogleLogin() {
    if (googleLoading || loading) return;
    setGoogleLoading(true);
    loginWithGoogle();
  }

  async function handleLogin(e?: FormEvent) {
    if (e) e.preventDefault();
    if (loading || googleLoading) return;
    if (!email.trim() && !password.trim()) {
      setFormError("Email and password are required");
      return;
    }
    if (!email.trim()) {
      setFormError("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("Please enter a valid email address");
      return;
    }
    if (!password.trim()) {
      setFormError("Password is required");
      return;
    }
    if (password.trim().length < 4) {
      setFormError("Password must be at least 4 characters");
      return;
    }

    setFormError(null);
    setLoading(true);
    try {
      const res = await api.loginWithEmail(email.trim(), password.trim());
      onLoginSuccess(res.user);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  const displayError = formError || error;

  return (
    <div className="login-stage">
      <div className="login-card">
        <h1>Login</h1>
        <button
          className="btn-google"
          type="button"
          disabled={googleLoading || loading}
          onClick={handleGoogleLogin}
        >
          {googleLoading ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <Icon.refresh size={14} className="spinning" />
              Redirecting...
            </span>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
              </svg>
              Login with Google
            </>
          )}
        </button>
        <div className="divider">
          <span>or sign up through email</span>
        </div>
        <form onSubmit={handleLogin}>
          <input
            className="field"
            type="email"
            placeholder="Email ID"
            value={email}
            disabled={loading || googleLoading}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
          />
          <input
            className="field"
            type="password"
            placeholder="Password"
            value={password}
            disabled={loading || googleLoading}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button className="btn-primary" type="submit" disabled={loading || googleLoading}>
            {loading ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <Icon.refresh size={13} className="spinning" />
                Logging in...
              </span>
            ) : (
              "Login"
            )}
          </button>
          {displayError && <div className="login-error">{displayError}</div>}
        </form>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  active,
  counts,
  slackLoading,
  onNavigate,
  onCompose,
  onSlackClick,
  onLogout,
  onAvatarUpdate,
  onNotice
}: {
  user: User;
  active: ListTab;
  counts: { all: number; scheduled: number; sent: number };
  slackLoading: boolean;
  onNavigate: (screen: ListTab) => void;
  onCompose: () => void;
  onSlackClick: () => void;
  onLogout: () => void;
  onAvatarUpdate?: (user: User) => void;
  onNotice?: (notice: { type: "success" | "error" | "info"; text: string }) => void;
}) {
  const [logoArrow, setLogoArrow] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [profileOpen]);

  function handleLogoClick() {
    setLogoArrow(true);
    setTimeout(() => {
      onNavigate("all");
      setTimeout(() => setLogoArrow(false), 400);
    }, 280);
  }

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const res = await api.uploadAvatar(file);
      onAvatarUpdate?.(res.user);
      onNotice?.({ type: "success", text: "Profile photo updated via Cloudinary!" });
      setProfileOpen(false);
    } catch (err) {
      onNotice?.({ type: "error", text: err instanceof Error ? err.message : "Failed to upload photo" });
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  }

  return (
    <aside className="sidebar">
      <button
        className="logo logo-btn"
        type="button"
        title="Go to All Inbox"
        onClick={handleLogoClick}
        aria-label="Go to All Inbox"
      >
        <span className={`logo-inner${logoArrow ? " logo-arrow" : ""}`}>
          {logoArrow
            ? <Icon.arrowLeft size={22} sw={2.5} style={{ color: "var(--green)" }} />
            : <PixelWordmark word="ONB" />
          }
        </span>
      </button>

      <div ref={profileRef} style={{ position: "relative" }}>
        <input
          ref={avatarFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleAvatarFile}
        />
        <button
          className="profile"
          type="button"
          title={`Logged in as ${user.name} (${user.email})`}
          onClick={() => setProfileOpen((v) => !v)}
          aria-expanded={profileOpen}
        >
          <Avatar user={user} />
          <span className="profile-meta">
            <b>{user.name}</b>
            <span>{user.email}</span>
          </span>
          <span className={`chevron-icon${profileOpen ? " open" : ""}`}>
            <Icon.chevron size={12} />
          </span>
        </button>
        {profileOpen && (
          <div className="profile-dropdown">
            <button
              className="profile-item"
              type="button"
              disabled={uploadingAvatar}
              onClick={() => avatarFileRef.current?.click()}
            >
              {uploadingAvatar ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon.refresh size={12} className="spinning" /> Uploading to Cloudinary...
                </span>
              ) : (
                "📷 Change profile photo"
              )}
            </button>
            <button
              className="profile-item"
              type="button"
              onClick={() => { setProfileOpen(false); onCompose(); }}
            >
              ✏️ Compose email
            </button>
            <button
              className={`profile-item${user.slackConnected ? " danger" : ""}`}
              type="button"
              disabled={slackLoading}
              onClick={() => { setProfileOpen(false); onSlackClick(); }}
            >
              {slackLoading
                ? (user.slackConnected ? "Disconnecting..." : "Connecting...")
                : (user.slackConnected ? `Disconnect ${user.slackChannelName ?? "Slack"}` : "Connect Slack")}
            </button>
            <div className="profile-divider" />
            <button
              className="profile-item danger"
              type="button"
              onClick={() => { setProfileOpen(false); onLogout(); }}
            >
              🚪 Sign out
            </button>
          </div>
        )}
      </div>

      <button className="btn-slack btn-compose" type="button" title="Compose new email campaign" onClick={onCompose}>
        Compose
      </button>

      <div>
        <div className="nav-label">CORE</div>
        <div className="nav">
          <button
            className="nav-item"
            type="button"
            title="View all emails"
            aria-current={active === "all"}
            onClick={() => onNavigate("all")}
          >
            <Icon.inbox size={13} />
            All Inbox <span className="count">{counts.all}</span>
          </button>
          <button
            className="nav-item"
            type="button"
            title="View scheduled emails"
            aria-current={active === "scheduled"}
            onClick={() => onNavigate("scheduled")}
          >
            <Icon.clock size={13} />
            Scheduled <span className="count">{counts.scheduled}</span>
          </button>
          <button
            className="nav-item"
            type="button"
            title="View sent emails"
            aria-current={active === "sent"}
            onClick={() => onNavigate("sent")}
          >
            <Icon.plane size={13} />
            Sent <span className="count">{counts.sent}</span>
          </button>
        </div>
      </div>

      <div className="sidebar-bottom">
        <button
          className={`btn-slack${user.slackConnected ? " connected" : ""}`}
          type="button"
          disabled={slackLoading}
          title={user.slackConnected ? `Connected to ${user.slackChannelName ?? "Slack"} (click to disconnect)` : "Connect Slack for rate limit notifications"}
          onClick={onSlackClick}
        >
          {slackLoading ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
              <Icon.refresh size={12} className="spinning" />
              {user.slackConnected ? "Disconnecting..." : "Connecting..."}
            </span>
          ) : (
            user.slackConnected ? `Disconnect ${user.slackChannelName ?? "Slack"}` : "Connect Slack"
          )}
        </button>
      </div>
    </aside>
  );
}


type FilterStatus = "all" | "SCHEDULED" | "RATE_LIMITED" | "SENT" | "FAILED";

function Topbar({
  user,
  query,
  statusFilter,
  onQuery,
  onRefresh,
  onLogout,
  onFilterChange
}: {
  user: User;
  query: string;
  statusFilter: FilterStatus;
  onQuery: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onLogout: () => Promise<void> | void;
  onFilterChange: (status: FilterStatus) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilter(false);
      }
    }
    if (showFilter) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showFilter]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await onLogout();
    } catch {
      setLoggingOut(false);
    }
  }

  function handleFilter(status: FilterStatus) {
    onFilterChange(status);
    setShowFilter(false);
  }

  const filterLabels: { value: FilterStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "SCHEDULED", label: "Scheduled" },
    { value: "RATE_LIMITED", label: "Rate Limited" },
    { value: "SENT", label: "Sent" },
    { value: "FAILED", label: "Failed" }
  ];

  return (
    <div className="topbar">
      <div className="search">
        <Icon.search size={12} />
        <input
          placeholder="Search emails..."
          aria-label="Search mail"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void handleRefresh()}
        />
        {query && (
          <button
            className="search-clear"
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => onQuery("")}
          >
            <Icon.x size={11} />
          </button>
        )}
      </div>
      <div style={{ position: "relative" }} ref={filterRef}>
        <button
          className={`icon-btn filter-btn${statusFilter !== "all" ? " active" : ""}`}
          type="button"
          aria-label="Filter"
          title={statusFilter === "all" ? "Filter by status" : `Filter: ${statusFilter}`}
          onClick={() => setShowFilter((v) => !v)}
        >
          <Icon.filter size={14} />
          {statusFilter !== "all" && <span className="filter-badge-dot" />}
        </button>
        {showFilter && (
          <div className="filter-dropdown">
            {filterLabels.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`filter-option${statusFilter === value ? " selected" : ""}`}
                onClick={() => handleFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className={`icon-btn${refreshing ? " spinning" : ""}`}
        type="button"
        aria-label="Refresh"
        title={refreshing ? "Refreshing..." : "Refresh emails"}
        disabled={refreshing}
        onClick={() => void handleRefresh()}
      >
        <Icon.refresh />
      </button>
      <div className="user-chip">
        <Avatar user={user} />
        <span className="profile-meta">
          <b>{user.name}</b>
          <span>{user.email}</span>
        </span>
        <button
          className="logout-btn"
          type="button"
          title="Sign out of ONB Mail"
          disabled={loggingOut}
          onClick={() => void handleLogout()}
        >
          {loggingOut ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
              <Icon.refresh size={11} className="spinning" />
              Logging out...
            </span>
          ) : (
            "Logout"
          )}
        </button>
      </div>
    </div>
  );
}

function MailList({
  items,
  loading,
  type,
  query,
  statusFilter,
  starredIds,
  onOpen,
  onToggleStar,
  onClearFilters,
  onCompose
}: {
  items: EmailRecord[];
  loading: boolean;
  type: ListTab;
  query: string;
  statusFilter: FilterStatus;
  starredIds: Set<string>;
  onOpen: (email: EmailRecord) => void;
  onToggleStar: (id: string) => void;
  onClearFilters: () => void;
  onCompose: () => void;
}) {
  const [clockNow, setClockNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading && items.length === 0) {
    return (
      <div className="loading">
        <div className="loading-spinner">
          <Icon.refresh size={22} className="spinning" />
        </div>
        <span>Loading {type === "all" ? "inbox" : type} emails...</span>
      </div>
    );
  }

  if (items.length === 0) {
    const isFiltered = query.trim().length > 0 || statusFilter !== "all";
    if (isFiltered) {
      return (
        <div className="empty">
          <Icon.search size={24} sw={1.5} />
          <h3>No matching emails found</h3>
          <p>{query.trim() ? `No emails matching "${query}"` : "No emails match the selected filter."}</p>
          <button className="btn-empty-action" type="button" onClick={onClearFilters}>
            Clear search & filters
          </button>
        </div>
      );
    }

    if (type === "all") {
      return (
        <div className="empty">
          <Icon.inbox size={28} sw={1.5} />
          <h3>No emails in All Inbox</h3>
          <p>Your inbox is empty. Create a campaign to start sending emails.</p>
          <button className="btn-empty-action" type="button" onClick={onCompose}>
            Compose Email
          </button>
        </div>
      );
    }

    if (type === "sent") {
      return (
        <div className="empty">
          <Icon.plane size={28} sw={1.5} />
          <h3>No sent emails yet</h3>
          <p>Emails that have been successfully delivered will appear here.</p>
        </div>
      );
    }

    return (
      <div className="empty">
        <Icon.clock size={28} sw={1.5} />
        <h3>No scheduled emails</h3>
        <p>You have no emails in queue. Create a campaign to start sending.</p>
        <button className="btn-empty-action" type="button" onClick={onCompose}>
          Compose Email
        </button>
      </div>
    );
  }

  return (
    <div className={`list${loading ? " list-refreshing" : ""}`}>
      {loading && (
        <>
          <div className="youtube-loading-bar" />
          <div className="gmail-refresh-dialog" role="status" aria-live="polite">
            <div className="stripes-bg" />
            <div className="dialog-content">
              <Icon.refresh size={13} className="spinning" />
              <span>Refreshing...</span>
            </div>
          </div>
        </>
      )}
      {items.map((mail, index) => {
        const isStarred = starredIds.has(mail.id);
        const isOverdue =
          mail.status === "SCHEDULED" &&
          mail.scheduledFor !== null &&
          new Date(mail.scheduledFor).getTime() <= clockNow;

        return (
          <button
            className="row"
            type="button"
            key={mail.id}
            onClick={() => onOpen(mail)}
            title={`Open: ${mail.subject}`}
            style={{ animationDelay: `${Math.min(index * 0.025, 0.2)}s` }}
          >
            <span className="to" title={`To: ${mail.recipientEmail}`}>To: {mail.recipientEmail}</span>
            {mail.status === "SENT" ? (
              <span className="tag tag-sent">Sent</span>
            ) : mail.status === "FAILED" ? (
              <span className="tag tag-failed">Failed</span>
            ) : mail.status === "SENDING" || isOverdue ? (
              <span className="tag tag-sending">
                <Icon.refresh size={9} className="spinning" /> Sending
              </span>
            ) : (
              <span className="tag tag-time">
                <Icon.clock size={9} sw={2.4} />
                {mail.status === "RATE_LIMITED" ? "Rate limited" : formatDate(mail.scheduledFor)}
              </span>
            )}
            <span className="snippet">
              <b>{mail.subject}</b> - {mail.body.slice(0, 120)}
            </span>
            {(mail.attachments?.length ?? 0) > 0 && (
              <span className="row-attach-indicator" title={`${mail.attachments!.length} attachment${mail.attachments!.length > 1 ? "s" : ""}`}>
                <Icon.clip size={11} />
              </span>
            )}
            <span
              className={`star${isStarred ? " starred" : ""}`}
              title={isStarred ? "Unstar email" : "Star email"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(mail.id);
              }}
            >
              <Icon.star
                size={13}
                fill={isStarred ? "#f0b429" : "none"}
                stroke={isStarred ? "#f0b429" : "currentColor"}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Reader({
  email,
  user,
  isStarred,
  onBack,
  onDelete,
  onToggleStar,
  onNotice
}: {
  email: EmailRecord;
  user: User;
  isStarred: boolean;
  onBack: () => void;
  onDelete: (id: string) => Promise<void>;
  onToggleStar: (id: string) => void;
  onNotice: (notice: { type: "success" | "error" | "info"; text: string }) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const senderAvatar = letterAvatar(email.senderEmail);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        setDetailsOpen(false);
      }
    }
    if (detailsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [detailsOpen]);

  async function handleDelete() {
    if (deleting) return;
    if (!window.confirm("Are you sure you want to delete this email?")) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(email.id);
    } catch (err) {
      setDeleting(false);
      onNotice({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to delete email"
      });
    }
  }

  return (
    <>
      <div className="reader-head">
        <button className="back" type="button" onClick={onBack} aria-label="Back" title="Back to list">
          <Icon.back size={15} sw={2} />
        </button>
        <h2 title={email.subject}>{email.subject}</h2>
        <div className="reader-actions">
          <button
            className={`icon-btn${isStarred ? " active-star" : ""}`}
            type="button"
            aria-label={isStarred ? "Unstar" : "Star"}
            title={isStarred ? "Unstar email" : "Star email"}
            onClick={() => onToggleStar(email.id)}
          >
            <Icon.star
              fill={isStarred ? "#f0b429" : "none"}
              stroke={isStarred ? "#f0b429" : "currentColor"}
            />
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Archive"
            title="Archive"
            onClick={() => onNotice({ type: "info", text: "Email archived." })}
          >
            <Icon.archive size={14} />
          </button>
          <button
            className="icon-btn danger-hover"
            type="button"
            aria-label="Delete email"
            title="Delete email"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? <Icon.refresh className="spinning" /> : <Icon.trash size={14} />}
          </button>
          <div className="reader-user-avatar" title={`Logged in as ${user.name}`}>
            <Avatar user={user} />
          </div>
        </div>
      </div>

      <div className="reader-body">
        <div className="sender">
          <span
            className="avatar avatar-sender"
            style={{ backgroundColor: senderAvatar.color, color: "#fff", fontWeight: 700 }}
          >
            {senderAvatar.letter}
          </span>
          <span className="sender-meta">
            <span className="sender-line">
              <b>{formatSenderName(email.senderEmail)}</b>
              <span className="sender-email">&lt;{email.senderEmail}&gt;</span>
            </span>
            <div className="sender-sub-wrap" ref={detailsRef}>
              <button
                type="button"
                className="sender-sub-btn"
                onClick={() => setDetailsOpen((prev) => !prev)}
                title="Show details"
              >
                to me <Icon.chevron size={9} sw={2.5} className={detailsOpen ? "open" : ""} />
              </button>
              {detailsOpen && (
                <div className="gmail-details-popover">
                  <table className="gmail-details-table">
                    <tbody>
                      <tr>
                        <td className="gd-lbl">from:</td>
                        <td className="gd-val"><b>{formatSenderName(email.senderEmail)}</b> &lt;{email.senderEmail}&gt;</td>
                      </tr>
                      <tr>
                        <td className="gd-lbl">reply-to:</td>
                        <td className="gd-val">{email.senderEmail}</td>
                      </tr>
                      <tr>
                        <td className="gd-lbl">to:</td>
                        <td className="gd-val">{email.recipientEmail}</td>
                      </tr>
                      <tr>
                        <td className="gd-lbl">date:</td>
                        <td className="gd-val">{formatFullDateTime(email.sentAt ?? email.scheduledFor)}</td>
                      </tr>
                      <tr>
                        <td className="gd-lbl">subject:</td>
                        <td className="gd-val">{email.subject}</td>
                      </tr>
                      <tr>
                        <td className="gd-lbl">mailed-by:</td>
                        <td className="gd-val">{email.senderEmail.split("@")[1] || "reachinbox.com"}</td>
                      </tr>
                      <tr>
                        <td className="gd-lbl">signed-by:</td>
                        <td className="gd-val">{email.senderEmail.split("@")[1] || "reachinbox.com"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </span>
          <span className="date">{formatDate(email.sentAt ?? email.scheduledFor)}</span>
        </div>

        <div
          className="message-body md-body"
          dangerouslySetInnerHTML={{ __html: parseMarkdown(email.body) }}
        />
        {email.lastError && <p className="message-body">Last event: {email.lastError}</p>}
        {email.etherealPreviewUrl && (
          <a
            className="preview-link"
            href={email.etherealPreviewUrl}
            target="_blank"
            rel="noreferrer"
            title="Open preview on Ethereal Email"
          >
            Open Ethereal preview ↗
          </a>
        )}

        {(email.attachments?.length ?? 0) > 0 && (
          <div className="reader-attachments">
            <div className="reader-attach-label">
              <Icon.clip size={12} />
              {email.attachments!.length} Attachment{email.attachments!.length > 1 ? "s" : ""}
            </div>
            <div className="attach-grid">
              {email.attachments!.map((a) => (
                <a
                  key={a.id}
                  className="attach-card reader-attach-card"
                  href={a.cloudinaryUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Download ${a.fileName}`}
                >
                  {isImageType(a.fileType) ? (
                    <img className="attach-thumb" src={a.cloudinaryUrl} alt={a.fileName} />
                  ) : (
                    <div className="attach-icon"><Icon.file size={32} /></div>
                  )}
                  <div className="attach-card-meta">
                    <span className="attach-name">{a.fileName}</span>
                    <span className="attach-size">{formatFileSize(a.fileSize)}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;
  const before = text.substring(0, index);
  const match = text.substring(index, index + query.length);
  const after = text.substring(index + query.length);
  return (
    <>
      {before}
      <b>{match}</b>
      {after}
    </>
  );
}

function Toolbar({
  onFormat,
  activeFormats
}: {
  onFormat: (action: string, param?: string) => void;
  activeFormats: Set<string>;
}) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const headingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (headingRef.current && !headingRef.current.contains(event.target as Node)) {
        setHeadingOpen(false);
      }
    }
    if (headingOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [headingOpen]);

  const isHeadingActive = activeFormats.has("h1") || activeFormats.has("h2") || activeFormats.has("h3");

  const buttons: Array<"sep" | "size" | [string, string, (p: IconProps) => JSX.Element]> = [
    ["undo", "Undo", Icon.undo],
    ["redo", "Redo", Icon.redo],
    "sep",
    "size",
    "sep",
    ["bold", "Bold", Icon.bold],
    ["italic", "Italic", Icon.italic],
    ["underline", "Underline", Icon.underline],
    "sep",
    ["alignLeft", "Align left", Icon.alignLeft],
    ["alignCenter", "Align center", Icon.alignCenter],
    "sep",
    ["olist", "Numbered list", Icon.olist],
    ["ulist", "Bulleted list", Icon.ulist],
    ["indent", "Indent", Icon.indent],
    ["outdent", "Outdent", Icon.outdent],
    "sep",
    ["quote", "Quote", Icon.quote],
    ["link", "Insert link", Icon.link],
    ["strike", "Strikethrough", Icon.strike]
  ];

  return (
    <div className="toolbar">
      {buttons.map((button, index) => {
        if (button === "sep") return <span className="tb-sep" key={`sep-${index}`} />;
        if (button === "size") {
          return (
            <div className="tb-dropdown-wrap" ref={headingRef} key="size">
              <button
                className={`tb wide${isHeadingActive ? " active" : ""}`}
                type="button"
                aria-label="Text size / Heading"
                title="Heading style"
                onClick={() => setHeadingOpen((prev) => !prev)}
              >
                Tt <Icon.chevron size={9} sw={3} className={headingOpen ? "open" : ""} />
              </button>
              {headingOpen && (
                <div className="heading-dropdown">
                  <button
                    type="button"
                    className={`heading-option h1${activeFormats.has("h1") ? " active" : ""}`}
                    onClick={() => {
                      onFormat("heading", "h1");
                      setHeadingOpen(false);
                    }}
                  >
                    <span>Heading 1</span>
                    <span className="heading-shortcut">#</span>
                  </button>
                  <button
                    type="button"
                    className={`heading-option h2${activeFormats.has("h2") ? " active" : ""}`}
                    onClick={() => {
                      onFormat("heading", "h2");
                      setHeadingOpen(false);
                    }}
                  >
                    <span>Heading 2</span>
                    <span className="heading-shortcut">##</span>
                  </button>
                  <button
                    type="button"
                    className={`heading-option h3${activeFormats.has("h3") ? " active" : ""}`}
                    onClick={() => {
                      onFormat("heading", "h3");
                      setHeadingOpen(false);
                    }}
                  >
                    <span>Heading 3</span>
                    <span className="heading-shortcut">###</span>
                  </button>
                  <button
                    type="button"
                    className={`heading-option normal${!isHeadingActive ? " active" : ""}`}
                    onClick={() => {
                      onFormat("heading", "normal");
                      setHeadingOpen(false);
                    }}
                  >
                    <span>Normal text</span>
                  </button>
                </div>
              )}
            </div>
          );
        }
        const [action, label, Component] = button;
        const isActive = activeFormats.has(action);
        return (
          <button
            className={`tb${isActive ? " active" : ""}`}
            type="button"
            key={action}
            aria-label={label}
            title={label}
            onClick={() => onFormat(action)}
          >
            <Component size={13} />
          </button>
        );
      })}
    </div>
  );
}

function Compose({
  user,
  allEmails,
  submitting,
  onBack,
  onNotice,
  onSchedule
}: {
  user: User;
  allEmails: EmailRecord[];
  submitting: boolean;
  onBack: () => void;
  onNotice: (notice: { type: "success" | "error" | "info"; text: string }) => void;
  onSchedule: (payload: {
    senderEmail: string;
    recipients: string[];
    subject: string;
    body: string;
    startTime: string;
    delayBetweenEmailsMs: number;
    hourlyLimit: number;
    attachmentIds?: string[];
  }) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const toInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<HTMLDivElement | null>(null);

  const [recipientList, setRecipientList] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [fileRecipients, setFileRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [scheduledTime, setScheduledTime] = useState<string | null>(null);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [pickDateTime, setPickDateTime] = useState(() => toLocalDatetimeValue(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [hourlyLimit, setHourlyLimit] = useState(0);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(() => new Set());

  // Contact memory: preseed with demo contact + localStorage + past emails
  const knownContacts = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    map.set("deepaksaxena474@gmail.com", {
      name: "Deepak Saxena",
      email: "DeepakSaxena474@gmail.com"
    });
    try {
      const saved = localStorage.getItem("onb_known_contacts");
      if (saved) {
        const list = JSON.parse(saved);
        if (Array.isArray(list)) {
          list.forEach((c) => {
            if (c && c.email) map.set(c.email.toLowerCase(), c);
          });
        }
      }
    } catch {}
    allEmails.forEach((mail) => {
      if (mail.recipientEmail) {
        const key = mail.recipientEmail.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            name: formatSenderName(mail.recipientEmail),
            email: mail.recipientEmail
          });
        }
      }
    });
    return Array.from(map.values());
  }, [allEmails]);

  const matchingContacts = useMemo(() => {
    const q = recipientInput.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set([...recipientList, ...fileRecipients].map((e) => e.toLowerCase()));
    return knownContacts.filter((c) => {
      if (chosen.has(c.email.toLowerCase())) return false;
      return c.email.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
    });
  }, [recipientInput, recipientList, fileRecipients, knownContacts]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowAutocomplete(false);
      }
    }
    if (showAutocomplete) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showAutocomplete]);

  const recipients = useMemo(
    () => Array.from(new Set([...recipientList, ...fileRecipients])),
    [recipientList, fileRecipients]
  );

  const previewHtml = useMemo(() => (body.trim() ? parseMarkdown(body) : ""), [body]);
  const totalAttachmentSize = useMemo(() => attachments.reduce((s, a) => s + a.fileSize, 0), [attachments]);

  function addRecipient(emailStr: string, name?: string) {
    const extracted = extractEmails(emailStr);
    if (extracted.length === 0) return;
    setRecipientList((prev) => {
      const set = new Set(prev);
      extracted.forEach((e) => set.add(e));
      return Array.from(set);
    });
    setRecipientInput("");
    setShowAutocomplete(false);

    // Save contact to localStorage memory
    try {
      const existing = localStorage.getItem("onb_known_contacts");
      const list: Array<{ name: string; email: string }> = existing ? JSON.parse(existing) : [];
      const map = new Map<string, { name: string; email: string }>();
      list.forEach((c) => map.set(c.email.toLowerCase(), c));
      extracted.forEach((e) => {
        if (!map.has(e.toLowerCase())) {
          map.set(e.toLowerCase(), { name: name || formatSenderName(e), email: e });
        }
      });
      localStorage.setItem("onb_known_contacts", JSON.stringify(Array.from(map.values())));
    } catch {}
  }

  function removeRecipient(email: string) {
    setRecipientList((prev) => prev.filter((e) => e !== email));
  }

  function handleToKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (matchingContacts.length > 0 && showAutocomplete) {
        e.preventDefault();
        addRecipient(matchingContacts[0].email, matchingContacts[0].name);
        return;
      }
      if (recipientInput.trim()) {
        e.preventDefault();
        addRecipient(recipientInput.trim());
      }
    } else if (e.key === "Backspace" && !recipientInput && recipientList.length > 0) {
      removeRecipient(recipientList[recipientList.length - 1]);
    } else if (e.key === "Escape") {
      setShowAutocomplete(false);
    }
  }

  async function handleAttachmentUpload(file: File) {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      onNotice({ type: "error", text: `File "${file.name}" exceeds 5MB limit.` });
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      onNotice({ type: "error", text: `Maximum ${MAX_ATTACHMENTS} attachments allowed.` });
      return;
    }
    if (totalAttachmentSize + file.size > MAX_TOTAL_SIZE) {
      onNotice({ type: "error", text: "Total attachment size exceeds 15MB limit." });
      return;
    }
    setUploading(true);
    try {
      const result = await uploadAttachment(file);
      setAttachments((prev) => [...prev, result]);
      onNotice({ type: "success", text: `Attached "${result.fileName}" (${formatFileSize(result.fileSize)}).` });
    } catch (err) {
      onNotice({ type: "error", text: err instanceof Error ? err.message : "Failed to upload attachment." });
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    api.deleteAttachment(id).catch(() => {});
  }

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const extracted = extractEmails(text);
      if (extracted.length === 0) {
        onNotice({ type: "error", text: `No valid email addresses found in "${file.name}".` });
        return;
      }
      setRecipientList((prev) => Array.from(new Set([...prev, ...extracted])));
      onNotice({
        type: "success",
        text: `Loaded ${extracted.length} recipient${extracted.length > 1 ? "s" : ""} from "${file.name}".`
      });
    } catch {
      onNotice({ type: "error", text: "Failed to read recipient file." });
    }
  }

  function updateActiveFormats(text = body, sStart?: number, sEnd?: number) {
    const el = textareaRef.current;
    const start = sStart !== undefined ? sStart : (el ? el.selectionStart : 0);
    const end = sEnd !== undefined ? sEnd : (el ? el.selectionEnd : 0);
    const selected = text.substring(start, end);

    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = text.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = text.length;
    const currentLine = text.substring(lineStart, lineEnd);

    const active = new Set<string>();

    if (/^#\s/.test(currentLine)) active.add("h1");
    else if (/^##\s/.test(currentLine)) active.add("h2");
    else if (/^###\s/.test(currentLine)) active.add("h3");

    if (
      (selected.startsWith("**") && selected.endsWith("**") && selected.length >= 4) ||
      (start >= 2 && text.substring(start - 2, start) === "**" && text.substring(end, end + 2) === "**")
    ) {
      active.add("bold");
    }

    if (
      (selected.startsWith("*") && selected.endsWith("*") && selected.length >= 2 && !selected.startsWith("**")) ||
      (start >= 1 && text.charAt(start - 1) === "*" && text.charAt(end) === "*")
    ) {
      active.add("italic");
    }

    if (
      (selected.startsWith("<u>") && selected.endsWith("</u>")) ||
      (start >= 3 && text.substring(start - 3, start) === "<u>" && text.substring(end, end + 4) === "</u>")
    ) {
      active.add("underline");
    }

    if (
      (selected.startsWith("~~") && selected.endsWith("~~")) ||
      (start >= 2 && text.substring(start - 2, start) === "~~" && text.substring(end, end + 2) === "~~")
    ) {
      active.add("strike");
    }

    if (/^>\s/.test(currentLine)) active.add("quote");
    if (/^[-*]\s/.test(currentLine)) active.add("ulist");
    if (/^\d+\.\s/.test(currentLine)) active.add("olist");
    if (selected.startsWith("<center>") && selected.endsWith("</center>")) active.add("alignCenter");

    setActiveFormats(active);
  }

  function handleFormat(action: string, param?: string) {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.substring(start, end);

    const lineStart = body.lastIndexOf("\n", start - 1) + 1;
    let lineEnd = body.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = body.length;
    const currentLine = body.substring(lineStart, lineEnd);

    if (action === "heading") {
      const cleanLine = currentLine.replace(/^#{1,6}\s*/, "");
      let newLine = cleanLine;
      if (param === "h1") newLine = `# ${cleanLine}`;
      else if (param === "h2") newLine = `## ${cleanLine}`;
      else if (param === "h3") newLine = `### ${cleanLine}`;

      const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        const diff = newLine.length - currentLine.length;
        el.setSelectionRange(Math.max(lineStart, start + diff), Math.max(lineStart, end + diff));
        updateActiveFormats(nextBody, Math.max(lineStart, start + diff), Math.max(lineStart, end + diff));
      }, 0);
      return;
    }

    if (action === "bold") {
      if (selected.startsWith("**") && selected.endsWith("**") && selected.length >= 4) {
        const unwrapped = selected.slice(2, -2);
        const nextBody = body.substring(0, start) + unwrapped + body.substring(end);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start, start + unwrapped.length);
          updateActiveFormats(nextBody, start, start + unwrapped.length);
        }, 0);
        return;
      }
      const insert = selected ? `**${selected}**` : `**bold text**`;
      const nextBody = body.substring(0, start) + insert + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + 2, start + insert.length - 2);
        updateActiveFormats(nextBody, start + 2, start + insert.length - 2);
      }, 0);
      return;
    }

    if (action === "italic") {
      if (selected.startsWith("*") && selected.endsWith("*") && selected.length >= 2 && !selected.startsWith("**")) {
        const unwrapped = selected.slice(1, -1);
        const nextBody = body.substring(0, start) + unwrapped + body.substring(end);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start, start + unwrapped.length);
          updateActiveFormats(nextBody, start, start + unwrapped.length);
        }, 0);
        return;
      }
      const insert = selected ? `*${selected}*` : `*italic text*`;
      const nextBody = body.substring(0, start) + insert + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + 1, start + insert.length - 1);
        updateActiveFormats(nextBody, start + 1, start + insert.length - 1);
      }, 0);
      return;
    }

    if (action === "underline") {
      if (selected.startsWith("<u>") && selected.endsWith("</u>")) {
        const unwrapped = selected.slice(3, -4);
        const nextBody = body.substring(0, start) + unwrapped + body.substring(end);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start, start + unwrapped.length);
          updateActiveFormats(nextBody, start, start + unwrapped.length);
        }, 0);
        return;
      }
      const insert = selected ? `<u>${selected}</u>` : `<u>underlined text</u>`;
      const nextBody = body.substring(0, start) + insert + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + 3, start + insert.length - 4);
        updateActiveFormats(nextBody, start + 3, start + insert.length - 4);
      }, 0);
      return;
    }

    if (action === "strike") {
      if (selected.startsWith("~~") && selected.endsWith("~~")) {
        const unwrapped = selected.slice(2, -2);
        const nextBody = body.substring(0, start) + unwrapped + body.substring(end);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start, start + unwrapped.length);
          updateActiveFormats(nextBody, start, start + unwrapped.length);
        }, 0);
        return;
      }
      const insert = selected ? `~~${selected}~~` : `~~strikethrough text~~`;
      const nextBody = body.substring(0, start) + insert + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + 2, start + insert.length - 2);
        updateActiveFormats(nextBody, start + 2, start + insert.length - 2);
      }, 0);
      return;
    }

    if (action === "quote") {
      if (currentLine.startsWith("> ")) {
        const newLine = currentLine.replace(/^>\s*/, "");
        const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(lineStart, lineStart + newLine.length);
          updateActiveFormats(nextBody, lineStart, lineStart + newLine.length);
        }, 0);
        return;
      }
      const newLine = `> ${currentLine}`;
      const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(lineStart, lineStart + newLine.length);
        updateActiveFormats(nextBody, lineStart, lineStart + newLine.length);
      }, 0);
      return;
    }

    if (action === "ulist") {
      if (/^[-*]\s/.test(currentLine)) {
        const newLine = currentLine.replace(/^[-*]\s*/, "");
        const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(lineStart, lineStart + newLine.length);
          updateActiveFormats(nextBody, lineStart, lineStart + newLine.length);
        }, 0);
        return;
      }
      const newLine = `- ${currentLine}`;
      const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(lineStart, lineStart + newLine.length);
        updateActiveFormats(nextBody, lineStart, lineStart + newLine.length);
      }, 0);
      return;
    }

    if (action === "olist") {
      if (/^\d+\.\s/.test(currentLine)) {
        const newLine = currentLine.replace(/^\d+\.\s*/, "");
        const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(lineStart, lineStart + newLine.length);
          updateActiveFormats(nextBody, lineStart, lineStart + newLine.length);
        }, 0);
        return;
      }
      const newLine = `1. ${currentLine}`;
      const nextBody = body.substring(0, lineStart) + newLine + body.substring(lineEnd);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(lineStart, lineStart + newLine.length);
        updateActiveFormats(nextBody, lineStart, lineStart + newLine.length);
      }, 0);
      return;
    }

    if (action === "link") {
      const text = selected || "link text";
      const insert = `[${text}](https://example.com)`;
      const nextBody = body.substring(0, start) + insert + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + text.length + 3, start + insert.length - 1);
        updateActiveFormats(nextBody, start, start + insert.length);
      }, 0);
      return;
    }

    if (action === "alignCenter") {
      if (selected.startsWith("<center>") && selected.endsWith("</center>")) {
        const unwrapped = selected.slice(8, -9);
        const nextBody = body.substring(0, start) + unwrapped + body.substring(end);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start, start + unwrapped.length);
          updateActiveFormats(nextBody, start, start + unwrapped.length);
        }, 0);
        return;
      }
      const insert = `<center>${selected || "centered text"}</center>`;
      const nextBody = body.substring(0, start) + insert + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + 8, start + insert.length - 9);
        updateActiveFormats(nextBody, start + 8, start + insert.length - 9);
      }, 0);
      return;
    }

    if (action === "alignLeft") {
      if (selected) {
        const trimmed = selected.split("\n").map((l) => l.trimStart()).join("\n");
        const nextBody = body.substring(0, start) + trimmed + body.substring(end);
        setBody(nextBody);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start, start + trimmed.length);
          updateActiveFormats(nextBody, start, start + trimmed.length);
        }, 0);
        return;
      }
      return;
    }

    if (action === "indent") {
      const indented = (selected || "text").split("\n").map((l) => `    ${l}`).join("\n");
      const nextBody = body.substring(0, start) + indented + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + indented.length);
      }, 0);
      return;
    }

    if (action === "outdent") {
      const outdented = (selected || "text").split("\n").map((l) => l.replace(/^ {1,4}/, "")).join("\n");
      const nextBody = body.substring(0, start) + outdented + body.substring(end);
      setBody(nextBody);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + outdented.length);
      }, 0);
      return;
    }

    if (action === "undo") {
      document.execCommand("undo");
      return;
    }

    if (action === "redo") {
      document.execCommand("redo");
      return;
    }
  }

  function getQuickTimes() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const t10 = new Date(tomorrow);
    t10.setHours(10, 0, 0, 0);
    const t11 = new Date(tomorrow);
    t11.setHours(11, 0, 0, 0);
    const t15 = new Date(tomorrow);
    t15.setHours(15, 0, 0, 0);

    return [
      { label: "Tomorrow, 9:00 AM", value: toLocalDatetimeValue(tomorrow) },
      { label: "Tomorrow, 10:00 AM", value: toLocalDatetimeValue(t10) },
      { label: "Tomorrow, 11:00 AM", value: toLocalDatetimeValue(t11) },
      { label: "Tomorrow, 3:00 PM", value: toLocalDatetimeValue(t15) }
    ];
  }

  function handleSendLaterDone() {
    setScheduledTime(pickDateTime);
    setSendLaterOpen(false);
  }

  const isSendLater = scheduledTime !== null;

  async function submit() {
    if (submitting) return;
    const startTime = isSendLater ? localDatetimeToIso(scheduledTime) : new Date().toISOString();
    await onSchedule({
      senderEmail: user.email,
      recipients,
      subject,
      body,
      startTime,
      delayBetweenEmailsMs: Math.max(0, delaySeconds * 1000),
      hourlyLimit: hourlyLimit || 200,
      attachmentIds: attachments.map((a) => a.id)
    });
  }

  return (
    <>
      <div className="compose-head">
        <button className="back" type="button" disabled={submitting} onClick={onBack} aria-label="Back" title="Back to list">
          <Icon.back size={15} sw={2} />
        </button>
        <h2>Compose New Email</h2>
        <button
          className="icon-btn"
          type="button"
          disabled={submitting || uploading}
          aria-label="Attach file"
          title={`Attach file (${attachments.length}/${MAX_ATTACHMENTS})`}
          onClick={() => attachRef.current?.click()}
          style={{ position: "relative" }}
        >
          {uploading ? <Icon.refresh size={14} className="spinning" /> : <Icon.clip />}
          {attachments.length > 0 && (
            <span className="attach-badge">{attachments.length}</span>
          )}
        </button>
        <input
          ref={attachRef}
          type="file"
          accept="*/*"
          hidden
          disabled={submitting || uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleAttachmentUpload(file);
            e.target.value = "";
          }}
        />
        <button
          className={`icon-btn${isSendLater ? " active" : ""}`}
          type="button"
          disabled={submitting}
          aria-label="Send Later"
          title={isSendLater ? `Scheduled for: ${formatDate(scheduledTime)}` : "Schedule send time"}
          onClick={() => setSendLaterOpen(!sendLaterOpen)}
        >
          <Icon.clock />
        </button>
        <button
          className="btn-send ghost"
          type="button"
          disabled={submitting || recipients.length === 0 || !subject.trim() || !body.trim()}
          title={isSendLater ? "Schedule emails for later" : "Send emails now"}
          onClick={submit}
        >
          {submitting ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
              <Icon.refresh size={12} className="spinning" />
              {isSendLater ? "Scheduling..." : "Sending..."}
            </span>
          ) : (
            isSendLater ? "Send Later" : "Send"
          )}
        </button>
      </div>

      <div className="compose-body">
        {sendLaterOpen && (
          <div className="send-later-popup">
            <h4>Send Later</h4>
            <div className="sl-pick">
              <label>Pick date & time</label>
              <input
                type="datetime-local"
                disabled={submitting}
                value={pickDateTime}
                onChange={(event) => setPickDateTime(event.target.value)}
              />
            </div>
            <div className="sl-options">
              {getQuickTimes().map((opt) => (
                <button
                  className="sl-option"
                  type="button"
                  disabled={submitting}
                  key={opt.label}
                  onClick={() => setPickDateTime(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="sl-actions">
              {isSendLater && (
                <button
                  type="button"
                  className="sl-clear-btn"
                  disabled={submitting}
                  onClick={() => {
                    setScheduledTime(null);
                    setSendLaterOpen(false);
                  }}
                >
                  Send now
                </button>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={() => setSendLaterOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-send ghost"
                type="button"
                disabled={submitting}
                onClick={handleSendLaterDone}
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="crow crow-from">
          <label htmlFor="cFrom">From</label>
          <div className="from-static-chip" id="cFrom">
            <span className="pill-avatar" style={{ backgroundColor: letterAvatar(user.email).color }}>
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : letterAvatar(user.email).letter}
            </span>
            <span className="from-user-name">{user.name}</span>
            <span className="from-email-pill">&lt;{user.email}&gt;</span>
          </div>
        </div>

        <div className="crow crow-to">
          <label htmlFor="cTo">To</label>
          <div className="to-field-box">
            <div className="to-pills-wrap">
              {recipientList.map((email) => {
                const avatar = letterAvatar(email);
                return (
                  <span className="recipient-pill" key={email}>
                    <span className="pill-avatar" style={{ backgroundColor: avatar.color }}>
                      {avatar.letter}
                    </span>
                    <span className="pill-name">{email}</span>
                    <button
                      type="button"
                      className="pill-remove"
                      disabled={submitting}
                      aria-label={`Remove ${email}`}
                      onClick={() => removeRecipient(email)}
                    >
                      <Icon.x size={10} sw={2.5} />
                    </button>
                  </span>
                );
              })}
              <div className="to-input-wrapper" ref={autocompleteRef}>
                <input
                  ref={toInputRef}
                  id="cTo"
                  className="to-input"
                  placeholder={recipientList.length === 0 ? "recipient@example.com" : ""}
                  disabled={submitting}
                  value={recipientInput}
                  onChange={(e) => {
                    setRecipientInput(e.target.value);
                    setShowAutocomplete(true);
                  }}
                  onFocus={() => {
                    if (recipientInput.trim()) setShowAutocomplete(true);
                  }}
                  onKeyDown={handleToKeyDown}
                />
                {showAutocomplete && matchingContacts.length > 0 && (
                  <div className="autocomplete-dropdown">
                    {matchingContacts.slice(0, 6).map((c) => (
                      <button
                        key={c.email}
                        type="button"
                        className="autocomplete-item"
                        onClick={() => addRecipient(c.email, c.name)}
                      >
                        <div className="ac-avatar" style={{ backgroundColor: letterAvatar(c.email).color }}>
                          {letterAvatar(c.email).letter}
                        </div>
                        <div className="ac-info">
                          <div className="ac-name">{highlightMatch(c.name || formatSenderName(c.email), recipientInput)}</div>
                          <div className="ac-email">{highlightMatch(c.email, recipientInput)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              hidden
              disabled={submitting}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = "";
              }}
            />
            <button
              className="link-upload"
              type="button"
              disabled={submitting}
              title="Upload CSV or TXT file with recipient emails"
              onClick={() => fileRef.current?.click()}
            >
              <Icon.upload size={11} />
              Upload List
            </button>
          </div>
        </div>

        <div className="crow">
          <label htmlFor="cSubject">Subject</label>
          <input
            className="plain"
            id="cSubject"
            placeholder="Subject"
            disabled={submitting}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>

        <div className="limits">
          <div className="limit" title="Minimum delay between successive emails in seconds">
            <label htmlFor="cDelay">Delay between 2 emails (s)</label>
            <input
              id="cDelay"
              type="number"
              min="0"
              disabled={submitting}
              value={delaySeconds}
              onChange={(event) => setDelaySeconds(Math.max(0, Number(event.target.value)))}
            />
          </div>
          <div className="limit" title="Maximum emails sent per hour for this campaign">
            <label htmlFor="cLimit">Hourly Limit</label>
            <input
              id="cLimit"
              type="number"
              min="0"
              disabled={submitting}
              value={hourlyLimit}
              onChange={(event) => setHourlyLimit(Math.max(0, Number(event.target.value)))}
            />
          </div>
        </div>

        <div className={`editor-wrapper${showPreview ? " preview-open" : ""}`}>
          <div className="editor">
            <div className="editor-top-bar">
              <span className="editor-top">Type Your Reply...</span>
              <button
                type="button"
                className={`preview-toggle${showPreview ? " active" : ""}`}
                onClick={() => setShowPreview((v) => !v)}
                title={showPreview ? "Hide preview" : "Show markdown preview"}
              >
                {showPreview ? "Hide Preview" : "Preview"}
              </button>
            </div>
            <Toolbar onFormat={handleFormat} activeFormats={activeFormats} />
            <textarea
              ref={textareaRef}
              className="editor-area"
              aria-label="Message body"
              placeholder="Write your email content here… (supports **bold**, *italic*, > blockquote, [links](url))"
              value={body}
              disabled={submitting}
              onChange={(event) => {
                setBody(event.target.value);
                updateActiveFormats(event.target.value);
              }}
              onKeyUp={() => updateActiveFormats()}
              onClick={() => updateActiveFormats()}
              onSelect={() => updateActiveFormats()}
            />
          </div>
          {showPreview && (
            <div className="editor-preview">
              <div className="preview-label">Preview</div>
              {previewHtml ? (
                <div
                  className="preview-body md-body"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              ) : (
                <div className="preview-empty">Nothing to preview yet...</div>
              )}
            </div>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="attach-strip">
            {attachments.map((a) => (
              <div className="attach-card" key={a.id}>
                {isImageType(a.fileType) ? (
                  <img className="attach-thumb" src={a.cloudinaryUrl} alt={a.fileName} />
                ) : (
                  <div className="attach-icon"><Icon.file size={24} /></div>
                )}
                <span className="attach-name">{a.fileName}</span>
                <span className="attach-size">{formatFileSize(a.fileSize)}</span>
                <button
                  type="button"
                  className="attach-remove"
                  disabled={submitting}
                  aria-label={`Remove ${a.fileName}`}
                  onClick={() => removeAttachment(a.id)}
                >
                  <Icon.x size={10} sw={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="compose-meta">
          <span><strong>{recipients.length}</strong> recipient{recipients.length !== 1 ? "s" : ""}</span>
          {fileRecipients.length > 0 && (
            <button
              className="link-upload"
              type="button"
              disabled={submitting}
              onClick={() => setFileRecipients([])}
            >
              Clear uploaded list
            </button>
          )}
          {totalAttachmentSize > 0 && (
            <span className="attach-total">{formatFileSize(totalAttachmentSize)} attached</span>
          )}
        </div>
      </div>
    </>
  );
}

export default function OnbMail() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("all");
  const [lastList, setLastList] = useState<ListTab>("all");
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [emails, setEmails] = useState<{ all: EmailRecord[]; scheduled: EmailRecord[]; sent: EmailRecord[] }>({
    all: [],
    scheduled: [],
    sent: []
  });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [listLoading, setListLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [slackLoading, setSlackLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("onb_starred_ids");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleStar = useCallback((id: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      const wasStarred = next.has(id);
      if (wasStarred) {
        next.delete(id);
        setNotice({ type: "info", text: "Email unstarred." });
      } else {
        next.add(id);
        setNotice({ type: "success", text: "Email starred." });
      }
      try {
        localStorage.setItem("onb_starred_ids", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      setAuthError(decodeURIComponent(err));
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const response = await api.me();
      setUser(response.user);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const loadEmails = useCallback(
    async (list: ListTab = "all", search = query, silent = false) => {
      if (!silent) setListLoading(true);
      try {
        const response = await api.listEmails(list, search);
        setEmails((current) => ({ ...current, [list]: response.emails }));

        // background sync other tabs to keep badge counts updated
        if (list === "all") {
          void Promise.allSettled([
            api.listEmails("scheduled", search),
            api.listEmails("sent", search)
          ]).then(([schedRes, sentRes]) => {
            setEmails((curr) => ({
              ...curr,
              scheduled: schedRes.status === "fulfilled" ? schedRes.value.emails : curr.scheduled,
              sent: sentRes.status === "fulfilled" ? sentRes.value.emails : curr.sent
            }));
          });
        } else {
          void api.listEmails("all", search).then((allRes) => {
            setEmails((curr) => ({ ...curr, all: allRes.emails }));
          }).catch(() => {});
        }
      } catch (error) {
        if (!silent) {
          setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not load emails" });
        }
      } finally {
        if (!silent) setListLoading(false);
      }
    },
    [query]
  );

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (user && (screen === "all" || screen === "scheduled" || screen === "sent")) {
      void loadEmails(screen);
      setLastList(screen);
    }
  }, [loadEmails, screen, user]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      // background poll for updates
      void loadEmails(lastList, query, true);
    }, 3000);
    return () => clearInterval(interval);
  }, [user, lastList, query, loadEmails]);

  async function logout() {
    try {
      await api.logout().catch(() => undefined);
    } finally {
      setUser(null);
    }
  }

  async function handleSlackClick() {
    if (slackLoading) return;
    setSlackLoading(true);
    try {
      if (!user?.slackConnected) {
        connectSlack();
        return;
      }

      await api.disconnectSlack();
      await refreshMe();
      setNotice({ type: "success", text: "Slack disconnected." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not disconnect Slack" });
    } finally {
      setSlackLoading(false);
    }
  }

  async function schedule(payload: Parameters<typeof api.scheduleEmails>[0]) {
    if (submitting) return;
    if (payload.recipients.length === 0) {
      setNotice({ type: "error", text: "Upload or enter at least one recipient email." });
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.scheduleEmails(payload);
      setNotice({ type: "success", text: `Scheduled ${response.scheduledCount} emails.` });
      setScreen("all");
      setLastList("all");
      await loadEmails("all", "");
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Scheduling failed" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteEmail(id: string) {
    await api.deleteEmail(id);
    setNotice({ type: "success", text: "Email deleted successfully." });
    setSelectedEmail(null);
    setScreen(lastList);
    await loadEmails(lastList, query);
  }

  function handleClearFilters() {
    setQuery("");
    setStatusFilter("all");
  }

  if (authLoading) {
    return (
      <div className="login-stage">
        <div className="loading">
          <div className="loading-spinner">
            <Icon.refresh size={28} className="spinning" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-2)" }}>Checking session...</span>
        </div>
      </div>
    );
  }
  if (!user) return <Login error={authError} onLoginSuccess={(u) => setUser(u)} />;

  // resolve items from active category or full pool
  const activePool =
    statusFilter !== "all" && emails.all.length > 0
      ? emails.all
      : screen === "sent"
      ? emails.sent
      : screen === "scheduled"
      ? emails.scheduled
      : emails.all;

  const activeItems = activePool.filter(
    (email) => statusFilter === "all" || email.status === statusFilter
  );

  return (
    <div className="app">
      <Sidebar
        user={user}
        active={lastList}
        counts={{
          all: emails.all.length,
          scheduled: emails.scheduled.length,
          sent: emails.sent.length
        }}
        slackLoading={slackLoading}
        onNavigate={(next) => {
          setScreen(next);
          setLastList(next);
        }}
        onCompose={() => setScreen("compose")}
        onSlackClick={() => void handleSlackClick()}
        onLogout={() => void logout()}
        onAvatarUpdate={(u) => setUser(u)}
        onNotice={setNotice}
      />
      <div className="main">
        {(screen === "all" || screen === "scheduled" || screen === "sent") && (
          <>
            <Topbar
              user={user}
              query={query}
              statusFilter={statusFilter}
              onQuery={setQuery}
              onRefresh={() => loadEmails(screen, query)}
              onLogout={() => void logout()}
              onFilterChange={(status) => setStatusFilter(status)}
            />
            {notice && (
              <div className={`notice ${notice.type}`} role="status">
                <span>{notice.text}</span>
                <button
                  className="notice-close"
                  type="button"
                  aria-label="Dismiss notice"
                  title="Dismiss"
                  onClick={() => setNotice(null)}
                >
                  <Icon.x size={12} />
                </button>
              </div>
            )}
            <MailList
              items={activeItems}
              loading={listLoading}
              type={screen}
              query={query}
              statusFilter={statusFilter}
              starredIds={starredIds}
              onOpen={(email) => {
                setSelectedEmail(email);
                setScreen("reader");
              }}
              onToggleStar={toggleStar}
              onClearFilters={handleClearFilters}
              onCompose={() => setScreen("compose")}
            />
          </>
        )}
        {screen === "reader" && selectedEmail && (
          <>
            {notice && (
              <div className={`notice ${notice.type}`} role="status">
                <span>{notice.text}</span>
                <button
                  className="notice-close"
                  type="button"
                  aria-label="Dismiss notice"
                  title="Dismiss"
                  onClick={() => setNotice(null)}
                >
                  <Icon.x size={12} />
                </button>
              </div>
            )}
            <Reader
              email={selectedEmail}
              user={user}
              isStarred={starredIds.has(selectedEmail.id)}
              onBack={() => setScreen(lastList)}
              onDelete={handleDeleteEmail}
              onToggleStar={toggleStar}
              onNotice={setNotice}
            />
          </>
        )}
        {screen === "compose" && (
          <>
            {notice && (
              <div className={`notice ${notice.type}`} role="status">
                <span>{notice.text}</span>
                <button
                  className="notice-close"
                  type="button"
                  aria-label="Dismiss notice"
                  title="Dismiss"
                  onClick={() => setNotice(null)}
                >
                  <Icon.x size={12} />
                </button>
              </div>
            )}
            <Compose
              user={user}
              allEmails={emails.all}
              submitting={submitting}
              onBack={() => setScreen(lastList)}
              onNotice={setNotice}
              onSchedule={schedule}
            />
          </>
        )}
      </div>
    </div>
  );
}
