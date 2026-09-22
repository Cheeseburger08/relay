import React, { useState, useEffect } from "react";
import {
  Phone,
  PhoneIncoming,
  PhoneOff,
  Mic,
  MicOff,
  Volume2,
  Grid3X3,
  X,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react";
export default function CallPanel({
  voice,
  client,
  showDial,
  dialOpen,
  setDialOpen,
  number,
  setNumber,
  onDial,
  nameFor,
  onOpen,
}) {
  const call = voice.call,
    ongoing = call && call.state !== "ended";
  const [keypad, setKeypad] = useState(false);
  const [volume, setVolume] = useState(() => client?.volume ?? 0.7);
  useEffect(() => setKeypad(false), [call?.id]);
  if (!ongoing && !voice.message && (!showDial || !dialOpen)) return null;
  const party = ongoing ? nameFor(call.number) || "Unknown caller" : "";
  const state =
    call?.state === "active"
      ? "Connected"
      : call?.state === "dialing"
        ? "Calling…"
        : call?.state === "ringing"
          ? "Incoming call"
          : call?.state === "held"
            ? "On hold"
            : "";
  const compact = ongoing && !showDial;
  const canMoveAudio =
    call?.state === "active" &&
    !voice.audioConnected &&
    (voice.audioElsewhere || voice.audioTaken || voice.canStartAudio);
  return (
    <section
      className={
        "call-panel " +
        (ongoing ? "has-call " : "") +
        (compact ? "compact-call " : "") +
        (call?.state === "ringing" ? "ringing" : "")
      }
      aria-label="Phone calls"
    >
      {ongoing && (
        <>
          <div className="call-identity">
            <span className="call-avatar">
              <Phone size={compact ? 20 : 26} />
            </span>
            <div>
              <p className="call-state">
                {state}
                <span> · {call.sim ? "SIM " + call.sim : "Unknown SIM"}</span>
              </p>
              <strong className="call-party">{party}</strong>
              {!compact && party !== call.number && (
                <p className="call-number">{call.number}</p>
              )}
            </div>
            {compact && (
              <button
                className="icon-button"
                aria-label="Open call"
                title="Open call"
                onClick={onOpen}
              >
                <ArrowUpRight size={20} />
              </button>
            )}
          </div>
          {canMoveAudio && (
            <button
              className="primary audio-permission"
              disabled={voice.busy || !voice.online}
              onClick={() => client?.takeAudio()}
            >
              <Mic size={17} />
              {voice.busy ? "Moving audio…" : "Use audio here"}
            </button>
          )}
          {call.state === "active" &&
            voice.needsAudioGesture &&
            !canMoveAudio && (
              <button
                className="primary audio-permission"
                onClick={() => client?.attach()}
              >
                <Mic size={17} />
                Enable microphone
              </button>
            )}
          <div className="call-actions">
            {call.state === "ringing" && (
              <button
                className="call-control answer-call"
                disabled={voice.busy}
                onClick={() => client?.answer()}
              >
                <PhoneIncoming />
                <span>Answer</span>
              </button>
            )}
            {call.state === "active" && (
              <button
                className={"call-control " + (voice.muted ? "is-on" : "")}
                aria-pressed={!!voice.muted}
                disabled={!voice.audioConnected}
                onClick={() => client?.mute()}
              >
                {voice.muted ? <MicOff /> : <Mic />}
                <span>{voice.muted ? "Unmute" : "Mute"}</span>
              </button>
            )}
            {call.state === "active" && !compact && (
              <button
                className={"call-control " + (voice.outputOpen ? "is-on" : "")}
                disabled={!voice.audioConnected}
                aria-expanded={!!voice.outputOpen}
                onClick={() => client?.openOutput()}
              >
                <Volume2 />
                <span>Speaker</span>
              </button>
            )}
            {call.state === "active" && !compact && (
              <button
                className={"call-control " + (keypad ? "is-on" : "")}
                aria-expanded={keypad}
                onClick={() => setKeypad(!keypad)}
              >
                <Grid3X3 />
                <span>Keypad</span>
              </button>
            )}
            <button
              className="call-control end-call"
              onClick={() => client?.end()}
            >
              <PhoneOff />
              <span>{call.state === "ringing" ? "Decline" : "End"}</span>
            </button>
          </div>
          {call.state === "active" &&
            !voice.audioConnected &&
            !voice.needsAudioGesture && (
              <p className="call-feedback" role="status">
                {voice.audioElsewhere
                  ? "Audio is on another browser."
                  : voice.canStartAudio
                    ? "Use audio here to join the call."
                    : voice.claimed
                      ? "Reconnecting audio…"
                      : "Connecting audio…"}
              </p>
            )}
          {!compact && keypad && call.state === "active" && (
            <div className="call-keypad" aria-label="In-call keypad">
              {"123456789*0#".split("").map((digit) => (
                <button
                  key={digit}
                  aria-label={`Send tone ${digit}`}
                  disabled={!voice.audioConnected || !voice.online}
                  onClick={() => client?.dtmf(digit)}
                >
                  {digit}
                </button>
              ))}
            </div>
          )}
          {!compact && voice.audioConnected && voice.outputOpen && (
            <div className="call-output" aria-label="Call audio output">
              {voice.outputSupported ? (
                <>
                  <label>
                    Audio output
                    <select
                      value={voice.outputId || ""}
                      disabled={voice.outputBusy}
                      onChange={(e) =>
                        client?.selectOutput(
                          e.target.value,
                          e.target.selectedOptions[0].text,
                        )
                      }
                    >
                      <option value="">Device default</option>
                      {(voice.outputDevices || []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="call-output-actions">
                    {typeof navigator.mediaDevices?.selectAudioOutput ===
                      "function" && (
                      <button
                        className="secondary"
                        disabled={voice.outputBusy}
                        onClick={() => client?.pickOutput()}
                      >
                        <Volume2 size={18} />
                        Choose a speaker
                      </button>
                    )}
                    <button
                      className="secondary"
                      disabled={voice.outputBusy}
                      onClick={() => client?.refreshOutputs()}
                    >
                      <RefreshCw size={18} />
                      Refresh outputs
                    </button>
                  </div>
                  <p role="status">
                    {voice.outputBusy
                      ? "Switching…"
                      : "Selected: " + (voice.outputLabel || "Device default")}
                  </p>
                  <p>
                    {voice.outputDevices?.length
                      ? "Check which speaker you hear after switching."
                      : "The browser hasn’t listed separate outputs. Try refreshing or choosing a speaker."}
                  </p>
                </>
              ) : (
                <p>
                  This browser doesn’t provide output selection here. Use your
                  device’s audio controls or headphones.
                </p>
              )}
              <label>
                Call volume
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setVolume(next);
                    client?.setVolume(next);
                  }}
                />
              </label>
              {voice.outputError && <p role="status">{voice.outputError}</p>}
            </div>
          )}
        </>
      )}
      {voice.message && (
        <div className="call-feedback" role="status">
          <span>{voice.message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss call status"
            title="Dismiss call status"
            onClick={() => client?.update({ message: "" })}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {voice.reconnectSeconds > 0 && (
        <p className="call-feedback" role="status">
          Reconnecting · {voice.reconnectSeconds}s remaining
        </p>
      )}
      {showDial && dialOpen && !ongoing && (
        <>
          <div className="call-panel-heading">
            <h2>New call</h2>
            <button
              className="icon-button"
              aria-label="Close dialer"
              title="Close dialer"
              onClick={() => setDialOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form
            id="call-dial-form"
            className="call-dial"
            onSubmit={(e) => {
              e.preventDefault();
              onDial?.(number.trim());
            }}
          >
            <label>
              Phone number
              <input
                type="tel"
                autoFocus
                autoComplete="tel"
                placeholder="+98…"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={!voice.online || voice.busy}>
              <Phone size={17} />
              Call
            </button>
            {!voice.online && (
              <small>
                Your phone is offline. Calls will be available when it
                reconnects.
              </small>
            )}
          </form>
        </>
      )}
    </section>
  );
}
