import React, { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  Phone,
  Users,
  UserPlus,
  Smartphone,
  Settings,
  LogOut,
  Search,
  MessageSquarePlus,
  Plus,
  ArrowLeft,
  Send,
  Archive,
  Pin,
  MoreHorizontal,
  X,
  Copy,
  Check,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  ShieldCheck,
  ChevronRight,
  Lock,
  RefreshCw,
  Trash2,
  WifiOff,
  Eye,
  EyeOff,
  Ban,
  Bell,
  Pencil,
  ShieldOff,
  UserRound,
} from "lucide-react";
import { VoiceClient } from "./voice-client.js";
import { watchSiteUpdate } from "./site-update.js";
import CallPanel from "./CallPanel.jsx";
import { deleteContacts } from "./contact-actions.js";
import { readTheme, watchTheme } from "./theme.js";

const empty = {
  conversations: [],
  messages: [],
  contacts: [],
  calls: [],
  device: null,
};
const time = (t) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const date = (t) =>
  new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const initials = (s) =>
  s
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
function IconButton({ icon: Icon, label, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={19} />
    </button>
  );
}
function PageAction({ icon: Icon, label, ...props }) {
  return (
    <button
      type="button"
      className="primary page-action"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
function SearchField({ label, value, onChange }) {
  return (
    <div className="search">
      <Search size={18} aria-hidden="true" />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function Filters({ options, value, onChange }) {
  return (
    <div className="filter-row" aria-label="Filter list">
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={value === option}
          className={value === option ? "selected" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
function Avatar({ name, small = false }) {
  return (
    <span className={"avatar " + (small ? "small" : "")}>
      {/^[+\d]/.test(name || "") ? (
        <UserRound size={19} />
      ) : (
        initials(name || "?")
      )}
    </span>
  );
}
function Sim({ value }) {
  return (
    <span className={"sim sim-" + value}>
      {value ? "SIM " + value : "SIM unknown"}
    </span>
  );
}
function Modal({ title, children, onClose }) {
  const ref = useRef();
  const titleId = React.useId();
  useEffect(() => {
    const old = document.activeElement;
    ref.current.showModal();
    return () => old?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton icon={X} label="Close dialog" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [theme, setTheme] = useState(readTheme);
  const themeWatcher = useRef(null);
  useEffect(() => {
    themeWatcher.current = watchTheme(setTheme);
    return () => themeWatcher.current.stop();
  }, []);
  const [session, setSession] = useState(null),
    [loading, setLoading] = useState(true),
    [demo, setDemo] = useState(false),
    [data, setData] = useState(empty);
  const [page, setPage] = useState(
      new URLSearchParams(location.search).get("view") === "calls"
        ? "Calls"
        : "Messages",
    ),
    [selected, setSelected] = useState(new URLSearchParams(location.search).get("conversation")),
    [filter, setFilter] = useState("All"),
    [search, setSearch] = useState("");
  const [modal, setModal] = useState(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState("");
  const [network, setNetwork] = useState(navigator.onLine),
    [syncError, setSyncError] = useState(false),
    [pairing, setPairing] = useState(null),
    [showPassword, setShowPassword] = useState(false);
  const pending = useRef(null),
    bottom = useRef(null),
    currentSession = useRef(null);
  const voiceClient = useRef(null);
  const [voice, setVoice] = useState({
    online: false,
    call: null,
    message: "",
    busy: false,
    mic: 0,
    caller: 0,
  });
  const [dialNumber, setDialNumber] = useState("");
  const [dialOpen, setDialOpen] = useState(false);
  const isBlocked = (number) =>
    (data.blocks || []).some((b) => b.number === number && b.blocked);
  function blockNumber(number) {
    act(async () => {
      const blocked = !isBlocked(number);
      await api("/blocks", { method: "POST", body: { number, blocked } });
      await refresh();
      if (modal?.type !== "blocks") setModal(null);
      setNotice(blocked ? "Number blocked" : "Number unblocked");
    });
  }
  function deleteHistory(path, label) {
    setModal({ type: "deleteHistory", path, label });
  }
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(
    () => (demo ? undefined : watchSiteUpdate(() => setUpdateAvailable(true))),
    [demo],
  );
  useEffect(() => {
    if (!session || demo) return;
    const client = new VoiceClient(session.csrf, setVoice);
    voiceClient.current = client;
    return () => {
      client.dispose();
      voiceClient.current = null;
    };
  }, [session?.csrf, demo]);
  function openCall(number = "") {
    if (demo) {
      setModal({ type: "call" });
      return;
    }
    if (voice.call && voice.call.state !== "ended") {
      setModal(null);
      navigate("Calls");
      return;
    }
    setError("");
    setModal({ type: "chooseSim", number: number.trim() });
  }
  currentSession.current = session?.csrf;
  async function api(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(session ? { "X-CSRF-Token": session.csrf } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = res.status === 204 ? {} : await res.json();
    if (!res.ok) {
      if (res.status === 401 && path != "/login" && path != "/password") {
        setSession(null);
        setData(empty);
        setPairing(null);
      }
      throw new Error(value.error?.message || "Request failed.");
    }
    return value;
  }
  async function refresh() {
    const key = session?.csrf;
    const d = await api("/state");
    if (currentSession.current === key) {
      setData(d);
      setSyncError(false);
    }
  }
  useEffect(() => {
    fetch("/api/session")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!session || demo) return;
    let alive = true;
    const sync = () => {
      if (!document.hidden)
        refresh().catch(() => {
          if (alive) setSyncError(true);
        });
    };
    sync();
    const id = setInterval(sync, 5000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [session, demo]);
  useEffect(() => {
    const online = () => setNetwork(navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [selected, data.messages.length]);
  async function act(fn) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const conversation = data.conversations.find((c) => c.id === selected);
  const thread = data.messages.filter((m) => m.conversationId === selected);
  const unread = data.messages.filter((m) => m.unread).length;
  const nameFor = (n) => data.contacts.find((c) => c.number === n)?.name || n;
  const contactFor = (number) => data.contacts.find((c) => c.number === number);
  function openContact(number) {
    setModal({ type: "contact", number, contact: contactFor(number) });
  }
  async function updateConversation(id, fields) {
    if (demo) {
      setData((d) => ({
        ...d,
        conversations: d.conversations.map((c) =>
          c.id === id ? { ...c, ...fields } : c,
        ),
        messages: fields.read
          ? d.messages.map((m) =>
              m.conversationId === id ? { ...m, unread: false } : m,
            )
          : d.messages,
      }));
      return;
    }
    await api("/conversations/" + id, { method: "PATCH", body: fields });
    await refresh();
  }
  function openConversation(c) {
    setSelected(c.id);
    setDraft("");
    setError("");
    setPage("Messages");
    act(() => updateConversation(c.id, { read: true }));
  }
  async function send(number, sim, text) {
    if (demo) {
      const c = data.conversations.find(
        (x) => x.number === number && x.sim === sim,
      ) || {
        id: crypto.randomUUID(),
        number,
        sim,
        name: nameFor(number),
        archived: false,
        pinned: false,
      };
      setData((d) => ({
        ...d,
        conversations: d.conversations.some((x) => x.id === c.id)
          ? d.conversations
          : [...d.conversations, c],
        messages: [
          ...d.messages,
          {
            id: crypto.randomUUID(),
            conversationId: c.id,
            direction: "outgoing",
            text,
            createdAt: Date.now(),
            sim,
            status: "sample",
            unread: false,
          },
        ],
      }));
      setSelected(c.id);
      setNotice("Sample message added. No SMS was sent.");
    } else {
      const signature = JSON.stringify({ number, sim, text });
      if (pending.current?.signature !== signature)
        pending.current = { signature, key: crypto.randomUUID() };
      await api("/messages", {
        method: "POST",
        body: { number, sim, text },
        headers: { "Idempotency-Key": pending.current.key },
      });
      pending.current = null;
      const d = await api("/state");
      setData(d);
      setSelected(
        d.conversations.find((c) => c.number === number && c.sim === sim)?.id,
      );
      setNotice("Queued for your phone.");
    }
    setPage("Messages");
    setFilter("All");
    setSearch("");
    setDraft("");
    setModal(null);
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied.");
    } catch {
      setError("Clipboard is unavailable. Select and copy the text manually.");
    }
  }
  const conversations = data.conversations
    .filter((c) => {
      if (filter === "Archived" ? !c.archived : c.archived) return false;
      if (
        filter === "Unread" &&
        !data.messages.some((m) => m.conversationId === c.id && m.unread)
      )
        return false;
      if (filter.startsWith("SIM") && c.sim !== Number(filter.slice(-1)))
        return false;
      return (
        !search ||
        [
          c.name,
          c.number,
          ...data.messages
            .filter((m) => m.conversationId === c.id)
            .map((m) => m.text),
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (data.messages.findLast((m) => m.conversationId === b.id)?.createdAt ||
          0) -
          (data.messages.findLast((m) => m.conversationId === a.id)
            ?.createdAt || 0),
    );
  function navigate(p) {
    setPage(p);
    setSearch("");
    setSelected(null);
    setFilter("All");
    setError("");
  }
  if (loading)
    return (
      <main className="loading">
        <img src="/icon-192.png" alt="" width="48" height="48" />
        <p>Relay</p>
      </main>
    );
  if (!session && !demo)
    return (
      <main className="login-page">
        <div className="login-brand">
          <img src="/icon-192.png" alt="" />
          Relay
        </div>
        <section className="login-form">
          <div className="lock-mark">
            <Lock />
          </div>
          <h1>
            Your lines.
            <br />
            One inbox.
          </h1>
          <p className="muted">Sign in to your private workspace.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(async () => {
                setSession(
                  await api("/login", {
                    method: "POST",
                    body: {
                      username: f.get("username"),
                      password: f.get("password"),
                    },
                  }),
                );
              });
            }}
          >
            <label>
              Username
              <input
                name="username"
                autoComplete="username"
                required
                autoCapitalize="none"
              />
            </label>
            <label>
              Password
              <div className="password-field">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />
                <IconButton
                  icon={showPassword ? EyeOff : Eye}
                  label="Show or hide password"
                  onClick={() => setShowPassword(!showPassword)}
                />
              </div>
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
              <ChevronRight size={18} />
            </button>
          </form>
        </section>
        <footer>
          <ShieldCheck size={16} /> Private access. No public registration.
        </footer>
      </main>
    );
  return (
    <div
      className={
        "app " + (selected && page === "Messages" ? "thread-open" : "")
      }
    >
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("Messages");
          }}
        >
          <img src="/icon-192.png" alt="" />
          Relay<span>PERSONAL</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {[
            [MessageSquare, "Messages"],
            [Phone, "Calls"],
            [Users, "Contacts"],
            [Smartphone, "Device"],
            [Settings, "Settings"],
          ].map(([Icon, p]) => (
            <button
              key={p}
              className={page === p ? "active" : ""}
              aria-current={page === p ? "page" : undefined}
              onClick={() => navigate(p)}
            >
              <Icon size={20} />
              <span>{p}</span>
              {p === "Messages" && unread > 0 && <b>{unread}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="device-summary" onClick={() => navigate("Device")}>
            <Smartphone size={23} />
            <span>
              {data.device?.name || "No phone paired"}
              <small>
                <i
                  className={
                    demo
                      ? "dot offline"
                      : data.device?.online
                        ? "dot"
                        : voice.online
                          ? "dot sync-delayed"
                          : "dot offline"
                  }
                />
                {demo
                  ? "Sample device"
                  : data.device?.online
                    ? "Phone online"
                    : voice.online
                      ? "Calls online; sync delayed"
                      : "Phone offline"}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
          <div className="profile">
            <Avatar
              small
              name={demo ? "Sample Workspace" : session.user.name}
            />
            <span>
              {demo ? "Sample workspace" : session.user.name}
              <small>{demo ? "Preview only" : "Private account"}</small>
            </span>
            <IconButton
              icon={LogOut}
              label={demo ? "Exit sample workspace" : "Sign out"}
              onClick={() =>
                act(async () => {
                  if (!demo) await api("/logout", { method: "POST" });
                  setSession(null);
                  setDemo(false);
                  setData(empty);
                  setSelected(null);
                  setPairing(null);
                })
              }
            />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            {demo ? (
              <span className="preview-badge">Sample workspace</span>
            ) : (
              <span
                className="connection-status"
                title={
                  !data.device?.online && voice.online
                    ? "Calls are connected, but SMS and history sync are delayed"
                    : undefined
                }
              >
                <i
                  className={
                    data.device?.online
                      ? "dot"
                      : voice.online
                        ? "dot sync-delayed"
                        : "dot offline"
                  }
                />
                {data.device?.online
                  ? "Connected"
                  : voice.online
                    ? "Calls only"
                    : "Offline"}
              </span>
            )}
            {page === "Messages" && (
              <PageAction
                icon={MessageSquarePlus}
                label="New message"
                onClick={() => {
                  setError("");
                  setModal({ type: "compose" });
                }}
              />
            )}
            {page === "Calls" && (
              <PageAction
                icon={Phone}
                label="New call"
                onClick={() =>
                  demo ? setModal({ type: "call" }) : setDialOpen(!dialOpen)
                }
                disabled={!!voice.call && voice.call.state !== "ended"}
              />
            )}
            {page === "Contacts" && (
              <PageAction
                icon={UserPlus}
                label="Add contact"
                onClick={() => setModal({ type: "contact" })}
              />
            )}
            {!demo && ["Messages", "Calls", "Contacts"].includes(page) && (
              <IconButton
                icon={MoreHorizontal}
                label={page + " options"}
                onClick={() => setModal({ type: "historyOptions", page })}
              />
            )}
          </div>
        </header>
        {(!network || syncError) && (
          <div className="connection-banner" role="status">
            <WifiOff size={16} />
            {!network
              ? "You are offline."
              : "Cannot refresh the phone workspace."}
            <button onClick={() => act(refresh)}>Retry</button>
          </div>
        )}
        {error && !modal && (
          <div className="error banner" role="alert">
            {error}
            <IconButton
              icon={X}
              label="Dismiss error"
              onClick={() => setError("")}
            />
          </div>
        )}
        {updateAvailable &&
          voice.online &&
          (!voice.call || voice.call.state === "ended") &&
          !voice.busy &&
          !busy &&
          !modal &&
          !draft &&
          !dialOpen && (
            <div className="connection-banner" role="status">
              An update is ready.
              <button
                onClick={() => {
                  const live = voiceClient.current?.state;
                  if (
                    live?.online &&
                    !live.busy &&
                    (!live.call || live.call.state === "ended")
                  )
                    location.reload();
                }}
              >
                Refresh Relay
              </button>
            </div>
          )}
        {!demo && page !== "Calls" && (
          <CallPanel
            voice={voice}
            client={voiceClient.current}
            showDial={false}
            nameFor={nameFor}
            onOpen={() => navigate("Calls")}
          />
        )}
        {!demo &&
          (data.historySync?.pending || 0) + (data.historySync?.failed || 0) >
            0 && (
            <div className="connection-banner" role="status">
              <RefreshCw size={15} />
              {data.historySync.failed
                ? "Some changes need attention. Check the phone’s permissions."
                : "Syncing changes when your phone is online…"}
            </div>
          )}
        {page === "Messages" ? (
          <div className="messages-layout">
            <section className="conversation-list" aria-label="Conversations">
              <div className="list-tools">
                <div className="section-heading">
                  <h2>Conversations</h2>
                  <span className="subtle-badge">{conversations.length}</span>
                </div>
                <SearchField
                  label="Search messages"
                  value={search}
                  onChange={setSearch}
                />
                <Filters
                  options={["All", "Unread", "SIM 1", "SIM 2", "Archived"]}
                  value={filter}
                  onChange={setFilter}
                />
              </div>
              <div className="list-scroll">
                <div className="rows conversation-rows">
                  {conversations.map((c) => {
                    const last = data.messages.findLast(
                        (m) => m.conversationId === c.id,
                      ),
                      count = data.messages.filter(
                        (m) => m.conversationId === c.id && m.unread,
                      ).length;
                    return (
                      <button
                        className={
                          "conversation person-row " +
                          (selected === c.id ? "selected" : "")
                        }
                        key={c.id}
                        aria-current={selected === c.id ? "true" : undefined}
                        onClick={() => openConversation(c)}
                      >
                        <Avatar name={c.name || c.number} />
                        <div className="conversation-info row-main">
                          <div className="conversation-title">
                            <strong>{c.name || c.number}</strong>
                            <time>{last ? date(last.createdAt) : ""}</time>
                          </div>
                          <p>
                            {last?.direction === "outgoing" ? "You: " : ""}
                            {last?.text || "No messages yet"}
                          </p>
                          <div className="conversation-meta">
                            <Sim value={c.sim} />
                            {c.pinned && <Pin size={12} />}
                            <span />
                            {count > 0 && (
                              <b className="unread-count">{count}</b>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {conversations.length === 0 && (
                    <div className="empty-list">
                      <MessageSquare size={28} />
                      <h3>No conversations</h3>
                      <p>
                        {search
                          ? "No matches found."
                          : filter === "All"
                            ? "Your inbox is empty."
                            : "Nothing here yet."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="list-footer">
                <ShieldCheck size={14} />
                {demo ? "Synthetic sample data" : "Private workspace"}
              </div>
            </section>
            <section className="thread" aria-label="Message thread">
              {conversation ? (
                <>
                  <div className="thread-header">
                    <span className="mobile-back">
                      <IconButton
                        icon={ArrowLeft}
                        label="Back to conversations"
                        onClick={() => setSelected(null)}
                      />
                    </span>
                    <Avatar name={conversation.name || conversation.number} />
                    <div className="thread-person">
                      <h2>{conversation.name || conversation.number}</h2>
                      <span>
                        {conversation.number}{" "}
                        <span className="separator">/</span>{" "}
                        <Sim value={conversation.sim} />
                      </span>
                    </div>
                    <div className="thread-actions">
                      <IconButton
                        icon={Phone}
                        label="Call contact"
                        onClick={() => openCall(conversation.number)}
                      />
                      <IconButton
                        icon={MoreHorizontal}
                        label="Conversation actions"
                        onClick={() => setModal({ type: "conversation" })}
                      />
                    </div>
                  </div>
                  <div className="message-scroll">
                    {thread.map((m, i) => (
                      <React.Fragment key={m.id}>
                        {(i === 0 ||
                          date(thread[i - 1].createdAt) !==
                            date(m.createdAt)) && (
                          <div className="date-divider">
                            <span>{date(m.createdAt)}</span>
                          </div>
                        )}
                        <div className={"message " + m.direction}>
                          <div className="bubble" dir="auto">
                            {m.text}
                          </div>
                          <div className="message-meta">
                            {!demo && (
                              <IconButton
                                icon={Trash2}
                                label="Delete message"
                                onClick={() =>
                                  deleteHistory(
                                    "/messages/" + m.id,
                                    "this message",
                                  )
                                }
                              />
                            )}
                            <time>{time(m.createdAt)}</time>
                            {m.direction === "outgoing" && (
                              <>
                                <span>
                                  {m.status === "sample" ? "Sample" : m.status}
                                </span>
                                {m.status === "delivered" && (
                                  <Check size={12} />
                                )}{" "}
                                {m.status === "queued" && (
                                  <button
                                    onClick={() =>
                                      act(async () => {
                                        await api(
                                          "/messages/" + m.id + "/cancel",
                                          { method: "POST" },
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    Cancel
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    ))}
                    <div ref={bottom} />
                  </div>
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.trim() && !conversation.sim)
                        setModal({
                          type: "compose",
                          number: conversation.number,
                          text: draft.trim(),
                        });
                      else if (draft.trim())
                        act(() =>
                          send(
                            conversation.number,
                            conversation.sim,
                            draft.trim(),
                          ),
                        );
                    }}
                  >
                    <div className="composer-line">
                      <textarea
                        aria-label="Message text"
                        placeholder={
                          demo
                            ? "Write a sample message..."
                            : "Write a message..."
                        }
                        rows="2"
                        maxLength="1600"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <button
                        className="send-button"
                        title={demo ? "Add sample message" : "Send message"}
                        aria-label={
                          demo ? "Add sample message" : "Send message"
                        }
                        disabled={
                          !draft.trim() ||
                          busy ||
                          (!demo && !data.device?.smsReady)
                        }
                      >
                        <Send size={19} />
                      </button>
                    </div>
                    <div className="composer-footer">
                      <span>
                        <span
                          className={"sim-dot sim-dot-" + conversation.sim}
                        />{" "}
                        {demo
                          ? "Sample SMS"
                          : data.device?.smsReady
                            ? "SMS"
                            : "Phone pairing required"}{" "}
                        <span className="separator">/</span> SIM{" "}
                        {conversation.sim ||
                          "unknown · choose a SIM when replying"}
                      </span>
                      <span>{draft.length} / 1600</span>
                    </div>
                  </form>
                </>
              ) : (
                <div className="thread-empty">
                  <div className="empty-icon">
                    <MessageSquare size={32} />
                  </div>
                  <h2>A little closer to home.</h2>
                  <p>
                    {data.conversations.length
                      ? "Choose a conversation to catch up."
                      : "Your messages will appear here after your phone is paired."}
                  </p>
                  <button
                    className="secondary"
                    onClick={() =>
                      demo ? setModal({ type: "compose" }) : navigate("Device")
                    }
                  >
                    {demo ? "New sample message" : "View phone connection"}
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="page-content">
            {page === "Calls" && (
              <>
                {!demo && (
                  <CallPanel
                    voice={voice}
                    client={voiceClient.current}
                    showDial
                    dialOpen={dialOpen}
                    setDialOpen={setDialOpen}
                    number={dialNumber}
                    setNumber={setDialNumber}
                    onDial={openCall}
                    nameFor={nameFor}
                  />
                )}
                <div className="section-heading">
                  <h2>Recent calls</h2>
                  <span className="subtle-badge">{data.calls.length}</span>
                </div>
                <SearchField
                  label="Search calls"
                  value={search}
                  onChange={setSearch}
                />
                <Filters
                  options={["All", "Missed", "Incoming", "Outgoing"]}
                  value={filter}
                  onChange={setFilter}
                />
                <div className="rows">
                  {data.calls
                    .filter(
                      (c) =>
                        (filter === "All" ||
                          c.direction === filter.toLowerCase()) &&
                        (nameFor(c.number) + c.number)
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .map((c) => {
                      const Icon =
                        c.direction === "missed"
                          ? PhoneMissed
                          : c.direction === "outgoing"
                            ? PhoneOutgoing
                            : PhoneIncoming;
                      return (
                        <div
                          className={
                            "data-row person-row " +
                            (page === "Calls" ? "call-row" : "contact-row")
                          }
                          key={c.id}
                        >
                          <Avatar name={nameFor(c.number)} />
                          <div className="row-main">
                            <strong>{nameFor(c.number)}</strong>
                            <small
                              className={
                                c.direction === "missed" ? "missed" : ""
                              }
                            >
                              <Icon size={14} />
                              {c.direction}{" "}
                              {c.duration > 0 &&
                                " · " +
                                  Math.floor(c.duration / 60) +
                                  "m " +
                                  (c.duration % 60) +
                                  "s"}
                            </small>
                            <Sim value={c.sim} />
                          </div>
                          <time>
                            {date(c.createdAt)}
                            <small>{time(c.createdAt)}</small>
                          </time>
                          <IconButton
                            icon={Phone}
                            label={"Call " + nameFor(c.number)}
                            onClick={() => openCall(c.number)}
                          />
                          {!demo && (
                            <IconButton
                              icon={MoreHorizontal}
                              label={"Options for " + nameFor(c.number)}
                              onClick={() =>
                                setModal({ type: "callActions", call: c })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  {data.calls.filter(
                    (c) =>
                      (filter === "All" ||
                        c.direction === filter.toLowerCase()) &&
                      (nameFor(c.number) + c.number)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  ).length === 0 && (
                    <Empty
                      icon={Phone}
                      title={
                        search || filter !== "All"
                          ? "No calls found"
                          : "No calls yet"
                      }
                    />
                  )}
                </div>
              </>
            )}
            {page === "Contacts" && (
              <>
                <div className="section-heading">
                  <h2>Your contacts</h2>
                  <span className="subtle-badge">{data.contacts.length}</span>
                </div>
                <SearchField
                  label="Search contacts"
                  value={search}
                  onChange={setSearch}
                />
                <div className="rows">
                  {data.contacts
                    .filter((c) =>
                      (c.name + c.number)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <div
                        className={
                          "data-row person-row " +
                          (page === "Calls" ? "call-row" : "contact-row")
                        }
                        key={c.id}
                      >
                        <Avatar name={c.name} />
                        <div className="row-main">
                          <strong>{c.name}</strong>
                          <small>{c.number}</small>
                          {isBlocked(c.number) && (
                            <small>
                              <Ban size={12} /> Blocked
                            </small>
                          )}
                          {!demo && !c.phoneSynced && (
                            <small className="sync-pending">
                              <RefreshCw size={12} />
                              Sync pending
                            </small>
                          )}
                        </div>
                        <IconButton
                          icon={Phone}
                          label={"Call " + c.name}
                          onClick={() => openCall(c.number)}
                        />
                        <IconButton
                          icon={MessageSquare}
                          label={"Message " + c.name}
                          onClick={() =>
                            setModal({ type: "compose", number: c.number })
                          }
                        />
                        <IconButton
                          icon={MoreHorizontal}
                          label={"Options for " + c.name}
                          onClick={() =>
                            setModal({ type: "contactActions", contact: c })
                          }
                        />
                      </div>
                    ))}
                  {!data.contacts.filter((c) =>
                    (c.name + c.number)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  ).length && (
                    <Empty
                      icon={Users}
                      title={search ? "No contacts found" : "No contacts yet"}
                    />
                  )}
                </div>
              </>
            )}
            {page === "Device" && (
              <>
                <div className="section-heading">
                  <h2>Phone connection</h2>
                  <span className="subtle-badge">1 phone · 2 SIMs</span>
                </div>
                <div className="phone-detail">
                  <div className="phone-illustration">
                    <Smartphone size={68} strokeWidth={1} />
                  </div>
                  <div>
                    <h2>{data.device?.name || "Pair your Xperia"}</h2>
                    <p className="muted">
                      {data.device?.model || "Sony Xperia XZ · F8332"}
                    </p>
                    <p>
                      {demo
                        ? "Sample device. Not connected."
                        : data.device?.online
                          ? "Online"
                          : voice.online
                            ? "Calls connected; SMS and history sync delayed"
                            : data.device
                              ? "Offline"
                              : "Not paired"}
                    </p>
                    {data.device?.lastSeen > 0 && (
                      <small className="muted">
                        Last sync {date(data.device.lastSeen)} at{" "}
                        {time(data.device.lastSeen)}
                      </small>
                    )}
                  </div>
                  {data.device?.battery != null && (
                    <strong className="battery">
                      {data.device.battery}%
                      <small>Battery{demo ? " (sample)" : ""}</small>
                    </strong>
                  )}
                </div>
                <div className="sim-lines">
                  {[1, 2].map((n) => {
                    const s = data.device?.sims.find((s) => s.slot === n);
                    return (
                      <div key={n} className="data-row">
                        <Sim value={n} />
                        <div className="row-main">
                          <strong>{s?.label || "SIM " + n}</strong>
                          <small>
                            {demo
                              ? "Sample line"
                              : s?.available
                                ? "Available"
                                : "Not connected"}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Text messages</h3>
                    <p>
                      {demo
                        ? "Sample inbox only"
                        : data.device?.smsReady
                          ? "Phone has enabled SMS access"
                          : "Waiting for the Android companion"}
                    </p>
                  </div>
                  <span className="subtle-badge">
                    {data.device?.smsReady && !demo ? "Ready" : "Not ready"}
                  </span>
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Live calls</h3>
                    <p>
                      {demo
                        ? "Calling is unavailable in the sample workspace"
                        : voice.online
                          ? "Ready to make and receive calls"
                          : "Waiting for the phone’s call connection"}
                    </p>
                  </div>
                  <span
                    className={
                      "subtle-badge " +
                      (!demo && voice.online ? "ready-badge" : "")
                    }
                  >
                    {!demo && voice.online ? "Ready" : "Offline"}
                  </span>
                </div>
                {!data.device && !pairing && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act(async () =>
                        setPairing(await api("/pairings", { method: "POST" })),
                      )
                    }
                  >
                    <Plus size={18} />
                    Create pairing code
                  </button>
                )}
                {pairing && (
                  <div className="pairing">
                    <h3>One-time pairing code</h3>
                    <p>
                      Expires at {time(pairing.expiresAt)}. Keep this code
                      private.
                    </p>
                    <code>{pairing.token}</code>
                    <button
                      className="secondary"
                      onClick={() => copy(pairing.token)}
                    >
                      <Copy size={16} />
                      Copy code
                    </button>
                    <p className="muted">
                      Open Relay Companion on the Xperia, enter this website’s
                      address and the pairing code, then enable Relay.
                    </p>
                  </div>
                )}
                {data.device && !demo && (
                  <button
                    className="danger-text"
                    onClick={() => setModal({ type: "unpair" })}
                  >
                    <Trash2 size={16} />
                    Remove phone
                  </button>
                )}
              </>
            )}
            {page === "Settings" && (
              <>
                <div className="section-heading">
                  <h2>Preferences</h2>
                  <ShieldCheck size={23} />
                </div>
                <div className="settings-row">
                  <div>
                    <h3>
                      <label className="appearance-label" htmlFor="appearance">
                        Appearance
                      </label>
                    </h3>
                    <p>Choose a theme for this browser.</p>
                  </div>
                  <select
                    id="appearance"
                    className="appearance-select"
                    value={theme}
                    onChange={(event) => {
                      setTheme(event.target.value);
                      themeWatcher.current.set(event.target.value);
                    }}
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Account</h3>
                    <p>{demo ? "Sample workspace" : session.user.username}</p>
                  </div>
                  <span>{demo ? "Preview" : session.user.name}</span>
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Password</h3>
                    <p>Changing it signs out all browser sessions.</p>
                  </div>
                  <button
                    className="secondary"
                    disabled={demo}
                    onClick={() => setModal({ type: "password" })}
                  >
                    <Lock size={18} />
                    Change password
                  </button>
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Call and SMS notifications</h3>
                    <p>
                      {voice.pushStatus ||
                        "Get alerts for incoming calls and SMS. On iPhone, add Relay to your Home Screen first."}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={demo}
                    onClick={() => voiceClient.current?.enableNotifications()}
                  >
                    <Bell size={17} />
                    Enable
                  </button>
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Home screen</h3>
                    <p>
                      {window.matchMedia("(display-mode: standalone)").matches
                        ? "Standalone app"
                        : "Browser session"}
                    </p>
                  </div>
                  <Smartphone size={22} />
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Blocked numbers</h3>
                    <p>
                      {(data.blocks || []).filter((b) => b.blocked).length}{" "}
                      blocked · applies to calls and messages
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={demo}
                    onClick={() => setModal({ type: "blocks" })}
                  >
                    <Ban size={17} />
                    Manage
                  </button>
                </div>
                <div className="settings-row">
                  <div>
                    <h3>Call connection</h3>
                    <p>
                      {voice.online
                        ? "Your Xperia is connected."
                        : "Your Xperia is offline."}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={demo || !voice.online}
                    onClick={() =>
                      act(async () => {
                        voiceClient.current?.send({ type: "check" });
                        setNotice("Checking call connection…");
                      })
                    }
                  >
                    <RefreshCw size={17} />
                    Check
                  </button>
                </div>
                <div className="privacy-note">
                  <Lock size={19} />
                  <p>
                    Messages are private to your account. The server can read
                    stored messages; this is not end-to-end encryption.
                  </p>
                </div>
              </>
            )}
            {page === "Settings" && (
              <button
                className="danger-text"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    if (!demo) await api("/logout", { method: "POST" });
                    setSession(null);
                    setDemo(false);
                    setData(empty);
                    setSelected(null);
                    setPairing(null);
                  })
                }
              >
                <LogOut size={17} />
                {demo ? "Exit sample workspace" : "Sign out"}
              </button>
            )}
          </div>
        )}
      </main>
      <nav className="mobile-nav">
        {[
          [MessageSquare, "Messages"],
          [Phone, "Calls"],
          [Users, "Contacts"],
          [Smartphone, "Device"],
          [Settings, "Settings"],
        ].map(([Icon, p]) => (
          <button
            className={page === p ? "active" : ""}
            aria-current={page === p ? "page" : undefined}
            key={p}
            onClick={() => navigate(p)}
          >
            <Icon size={21} />
            <span>{p}</span>
          </button>
        ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              compose: "New message",
              contact: modal.contact ? "Edit contact" : "Add contact",
              contactActions: modal.contact?.name || "Contact",
              call: "Live calls",
              chooseSim: "Call using",
              conversation: "Conversation",
              unpair: "Remove phone?",
              password: "Change password",
              deleteHistory: "Delete " + modal.label + "?",
              deleteContacts: "Delete all contacts?",
              callActions: modal.call ? nameFor(modal.call.number) : "Call",
              historyOptions:
                modal.page === "Calls" ? "Call history" : modal.page,
              blocks: "Blocked numbers",
            }[modal.type]
          }
          onClose={() => {
            setModal(null);
            setError("");
          }}
        >
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {modal.type === "deleteHistory" && (
            <>
              <p>This can’t be undone.</p>
              <div className="dialog-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      if (demo && modal.path.startsWith("/contacts/")) {
                        setData((d) => ({
                          ...d,
                          contacts: d.contacts.filter(
                            (c) =>
                              c.id !== modal.path.slice("/contacts/".length),
                          ),
                        }));
                      } else {
                        await api(modal.path, { method: "DELETE" });
                        await refresh();
                      }
                      setModal(null);
                      setNotice("Deleted");
                    })
                  }
                >
                  <Trash2 size={18} />
                  Delete
                </button>
              </div>
            </>
          )}
          {modal.type === "deleteContacts" && (
            <>
              <p>
                Delete all {data.contacts.length} contacts? This can’t be
                undone.
              </p>
              <div className="dialog-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy || !data.contacts.length}
                  onClick={() =>
                    act(async () => {
                      try {
                        await deleteContacts(
                          api,
                          data.contacts.map((contact) => contact.id),
                        );
                      } catch (error) {
                        await refresh().catch(() => {});
                        throw error;
                      }
                      await refresh();
                      setModal(null);
                      setNotice("Deleted");
                    })
                  }
                >
                  <Trash2 size={18} />
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </>
          )}
          {modal.type === "chooseSim" && (
            <>
              <div className="call-recipient">
                <Avatar name={nameFor(modal.number)} />
                <div>
                  <strong>{nameFor(modal.number)}</strong>
                  {nameFor(modal.number) !== modal.number && (
                    <p>{modal.number}</p>
                  )}
                </div>
              </div>
              <div className="sim-choices">
                {[1, 2].map((slot) => {
                  const phoneSim = data.device?.sims?.find(
                    (s) => Number(s.slot) === slot,
                  );
                  const available = phoneSim && phoneSim.available !== false;
                  return (
                    <button
                      key={slot}
                      className="sim-choice"
                      disabled={
                        !available ||
                        !voice.online ||
                        voice.busy ||
                        !voiceClient.current ||
                        (voice.call && voice.call.state !== "ended")
                      }
                      onClick={() => {
                        const client = voiceClient.current;
                        if (
                          !client ||
                          !voice.online ||
                          voice.busy ||
                          (voice.call && voice.call.state !== "ended")
                        )
                          return;
                        const number = modal.number;
                        setModal(null);
                        setDialOpen(false);
                        navigate("Calls");
                        client.dial(number, slot);
                      }}
                    >
                      <Phone size={20} />
                      <span>
                        <strong>SIM {slot}</strong>
                        <small>
                          {available
                            ? phoneSim.label || "Place call"
                            : "Unavailable"}
                        </small>
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  );
                })}
              </div>
              {!voice.online && (
                <p className="muted">
                  Your phone is offline. Reconnect it to make a call.
                </p>
              )}
              {voice.call && voice.call.state !== "ended" && (
                <p className="muted">
                  End the current call before starting another.
                </p>
              )}
            </>
          )}
          {modal.type === "contactActions" && (
            <>
              <p className="action-subtitle">{modal.contact.number}</p>
              <div className="action-list">
                <button
                  onClick={() =>
                    setModal({ type: "contact", contact: modal.contact })
                  }
                >
                  <Pencil size={18} /> Edit contact
                </button>
                <button
                  disabled={busy}
                  onClick={() => blockNumber(modal.contact.number)}
                >
                  {isBlocked(modal.contact.number) ? (
                    <ShieldOff size={18} />
                  ) : (
                    <Ban size={18} />
                  )}
                  {isBlocked(modal.contact.number) ? "Unblock" : "Block"}
                </button>
                <button
                  className="destructive"
                  onClick={() =>
                    deleteHistory(
                      "/contacts/" + modal.contact.id,
                      "this contact",
                    )
                  }
                >
                  <Trash2 size={18} /> Delete
                </button>
              </div>
            </>
          )}
          {modal.type === "callActions" && (
            <>
              <p className="action-subtitle">
                {modal.call.number} · {date(modal.call.createdAt)} at{" "}
                {time(modal.call.createdAt)}
              </p>
              <div className="action-list">
                <button onClick={() => openCall(modal.call.number)}>
                  <Phone size={18} />
                  Call
                </button>
                <button
                  onClick={() =>
                    setModal({ type: "compose", number: modal.call.number })
                  }
                >
                  <MessageSquare size={18} />
                  Message
                </button>
                <button onClick={() => openContact(modal.call.number)}>
                  <>
                    {contactFor(modal.call.number) ? (
                      <Pencil size={18} />
                    ) : (
                      <UserPlus size={18} />
                    )}
                  </>
                  {contactFor(modal.call.number)
                    ? "Edit contact"
                    : "Add to contacts"}
                </button>
                <button onClick={() => blockNumber(modal.call.number)}>
                  {isBlocked(modal.call.number) ? (
                    <ShieldOff size={18} />
                  ) : (
                    <Ban size={18} />
                  )}
                  {isBlocked(modal.call.number) ? "Unblock" : "Block"}
                </button>
                <button
                  className="destructive"
                  onClick={() =>
                    deleteHistory("/calls/" + modal.call.id, "this call")
                  }
                >
                  <Trash2 size={18} />
                  Delete
                </button>
              </div>
            </>
          )}
          {modal.type === "historyOptions" && (
            <div className="action-list">
              {modal.page === "Contacts" && (
                <button onClick={() => setModal({ type: "blocks" })}>
                  <Ban size={18} /> Blocked numbers
                </button>
              )}
              <button
                className="destructive"
                disabled={modal.page === "Contacts" && !data.contacts.length}
                onClick={() =>
                  modal.page === "Contacts"
                    ? setModal({ type: "deleteContacts" })
                    : deleteHistory(
                        modal.page === "Calls" ? "/calls" : "/messages",
                        modal.page === "Calls"
                          ? "all call history"
                          : "all messages",
                      )
                }
              >
                <Trash2 size={18} />
                {modal.page === "Contacts"
                  ? "Delete all contacts"
                  : modal.page === "Calls"
                    ? "Delete all calls"
                    : "Delete all messages"}
              </button>
            </div>
          )}
          {modal.type === "blocks" && (
            <>
              <p className="action-subtitle">
                Blocked numbers can’t call or message you.
              </p>
              <form
                className="block-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const n = new FormData(form).get("number").trim();
                  if (n)
                    act(async () => {
                      await api("/blocks", {
                        method: "POST",
                        body: { number: n, blocked: true },
                      });
                      await refresh();
                      form.reset();
                      setNotice("Number blocked");
                    });
                }}
              >
                <label htmlFor="block-number">Number or sender</label>
                <div>
                  <input
                    id="block-number"
                    name="number"
                    placeholder="+98…"
                    maxLength={80}
                    required
                  />
                  <button className="primary" disabled={busy}>
                    <Ban size={17} />
                    Block
                  </button>
                </div>
              </form>
              <div className="blocked-list">
                {(data.blocks || [])
                  .filter((b) => b.blocked || !b.phoneSynced)
                  .map((b) => (
                    <div className="blocked-row" key={b.id}>
                      <span className="blocked-symbol">
                        <Ban size={18} />
                      </span>
                      <div>
                        <strong>{nameFor(b.number)}</strong>
                        {nameFor(b.number) !== b.number && (
                          <small>{b.number}</small>
                        )}
                        {!b.phoneSynced && <small>Sync pending</small>}
                      </div>
                      {b.blocked && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => blockNumber(b.number)}
                        >
                          <ShieldOff size={18} /> Unblock
                        </button>
                      )}
                    </div>
                  ))}
                {!(data.blocks || []).some(
                  (b) => b.blocked || !b.phoneSynced,
                ) && (
                  <div className="quiet-empty">
                    <ShieldCheck size={24} />
                    <p>No blocked numbers</p>
                  </div>
                )}
              </div>
            </>
          )}
          {modal.type === "compose" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(() =>
                  send(
                    f.get("number"),
                    Number(f.get("sim")),
                    f.get("text").trim(),
                  ),
                );
              }}
            >
              <label>
                To
                <input
                  name="number"
                  type="tel"
                  list="contacts-list"
                  pattern="\+[1-9][0-9]{6,14}"
                  placeholder="+country code and number"
                  defaultValue={modal.number || ""}
                  required
                />
                <datalist id="contacts-list">
                  {data.contacts.map((c) => (
                    <option key={c.id} value={c.number}>
                      {c.name}
                    </option>
                  ))}
                </datalist>
              </label>
              <label>
                Send using
                <select name="sim">
                  <option value="1">SIM 1</option>
                  <option value="2">SIM 2</option>
                </select>
              </label>
              <label>
                Message
                <textarea
                  name="text"
                  rows="5"
                  maxLength="1600"
                  defaultValue={modal.text || ""}
                  required
                />
              </label>
              {!demo && !data.device?.smsReady && (
                <p className="muted">
                  Pair the Android phone before sending SMS.
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy || (!demo && !data.device?.smsReady)}
                >
                  <Send size={17} />
                  {demo ? "Add sample message" : "Send"}
                </button>
              </div>
            </form>
          )}
          {modal.type === "contact" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget),
                  c = { name: f.get("name"), number: f.get("number") };
                act(async () => {
                  if (demo)
                    setData((d) => ({
                      ...d,
                      contacts: [
                        ...d.contacts.filter((x) => x.number !== c.number),
                        { id: modal.contact?.id || crypto.randomUUID(), ...c },
                      ],
                      conversations: d.conversations.map((x) =>
                        x.number === c.number ? { ...x, name: c.name } : x,
                      ),
                    }));
                  else {
                    await api("/contacts", { method: "POST", body: c });
                    await refresh();
                  }
                  setModal(null);
                });
              }}
            >
              <label>
                Name
                <input
                  name="name"
                  defaultValue={modal.contact?.name || ""}
                  maxLength="80"
                  required
                />
              </label>
              <label>
                Phone number
                <input
                  name="number"
                  type="tel"
                  pattern="\+[1-9][0-9]{6,14}"
                  defaultValue={modal.contact?.number || modal.number || ""}
                  readOnly={!!modal.contact}
                  placeholder="+country code and number"
                  required
                />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  <Check size={17} />
                  Save
                </button>
              </div>
              {modal.contact && (
                <button
                  type="button"
                  className="danger-text"
                  onClick={() =>
                    deleteHistory(
                      "/contacts/" + modal.contact.id,
                      "this contact",
                    )
                  }
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              )}
            </form>
          )}
          {modal.type === "call" && (
            <>
              <div className="empty-icon">
                <Phone size={30} />
              </div>
              <p>Calling is unavailable in the sample workspace.</p>
              <button
                className="secondary wide"
                onClick={() => {
                  setModal(null);
                  navigate("Device");
                }}
              >
                View phone connection
                <ChevronRight size={16} />
              </button>
            </>
          )}
          {modal.type === "conversation" && conversation && (
            <div className="action-list">
              <button onClick={() => openContact(conversation.number)}>
                <>
                  {contactFor(conversation.number) ? (
                    <Pencil size={18} />
                  ) : (
                    <UserPlus size={18} />
                  )}
                </>
                {contactFor(conversation.number)
                  ? "Edit contact"
                  : "Add to contacts"}
              </button>
              <button
                onClick={() =>
                  act(async () => {
                    await updateConversation(selected, {
                      pinned: !conversation.pinned,
                    });
                    setModal(null);
                  })
                }
              >
                <Pin size={18} />
                {conversation.pinned ? "Unpin" : "Pin"} conversation
              </button>
              <button
                onClick={() =>
                  act(async () => {
                    await updateConversation(selected, {
                      archived: !conversation.archived,
                    });
                    setModal(null);
                    setSelected(null);
                  })
                }
              >
                <Archive size={18} />
                {conversation.archived ? "Unarchive" : "Archive"} conversation
              </button>
              <button onClick={() => copy(conversation.number)}>
                <Copy size={18} />
                Copy number
              </button>
              {!demo && (
                <>
                  <button onClick={() => blockNumber(conversation.number)}>
                    {isBlocked(conversation.number) ? (
                      <ShieldOff size={18} />
                    ) : (
                      <Ban size={18} />
                    )}
                    {isBlocked(conversation.number) ? "Unblock" : "Block"}
                  </button>
                  <button
                    className="destructive"
                    onClick={() =>
                      deleteHistory(
                        "/conversations/" + conversation.id,
                        "this conversation",
                      )
                    }
                  >
                    <Trash2 size={18} />
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
          {modal.type === "unpair" && (
            <>
              <p>
                This revokes the phone's access. Unclaimed messages are
                cancelled. A message already handed to the phone may still be
                sent. Your history stays here.
              </p>
              <div className="dialog-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api("/device", { method: "DELETE" });
                      setPairing(null);
                      await refresh();
                      setModal(null);
                    })
                  }
                >
                  <Trash2 size={17} />
                  Remove phone
                </button>
              </div>
            </>
          )}
          {modal.type === "password" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(async () => {
                  await api("/password", {
                    method: "POST",
                    body: {
                      currentPassword: f.get("current"),
                      newPassword: f.get("next"),
                    },
                  });
                  setModal(null);
                  setSession(null);
                  setData(empty);
                  setNotice("Password changed. Sign in again.");
                });
              }}
            >
              <label>
                Current password
                <input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                New password
                <input
                  name="next"
                  type="password"
                  autoComplete="new-password"
                  minLength="12"
                  required
                />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setModal(null);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  <Lock size={18} /> Change password
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function Empty({ icon: Icon, title }) {
  return (
    <div className="empty-list">
      <Icon size={28} />
      <h3>{title}</h3>
    </div>
  );
}
