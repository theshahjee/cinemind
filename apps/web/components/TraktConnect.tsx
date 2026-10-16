"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { disconnectTrakt, pollTrakt, startTrakt, syncTraktNow, type TraktDevice } from "@/app/actions";

interface Props {
  configured: boolean;
  connected: boolean;
  lastSyncAt?: string;
}

const MESSAGES: Record<string, string> = {
  expired: "The code expired. Start again.",
  denied: "Access was declined on Trakt.",
  invalid: "Trakt didn't recognise that code. Start again.",
  used: "That code was already used. Start again.",
};

export function TraktConnect({ configured, connected, lastSyncAt }: Props) {
  const [device, setDevice] = useState<TraktDevice>();
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!device) return;
    let interval = device.interval * 1000;
    const deadline = Date.now() + device.expires_in * 1000;
    const tick = async () => {
      if (Date.now() > deadline) {
        setDevice(undefined);
        setMessage(MESSAGES.expired);
        return;
      }
      const res = await pollTrakt(device.device_code);
      if (res.status === "connected") {
        setDevice(undefined);
        setMessage("Connected. Your Trakt ratings and watchlist are imported.");
        return;
      }
      if (res.status === "slow_down") interval += 1000;
      if (res.status === "pending" || res.status === "slow_down") {
        timer.current = setTimeout(tick, interval);
        return;
      }
      setDevice(undefined);
      setMessage(res.error ?? MESSAGES[res.status] ?? `Trakt said: ${res.status}`);
    };
    timer.current = setTimeout(tick, interval);
    return () => clearTimeout(timer.current);
  }, [device]);

  if (!configured) {
    return (
      <p className="text-sm text-muted">
        Trakt isn&apos;t set up on this server. Create an app at trakt.tv/oauth/applications, then set <code>TRAKT_CLIENT_ID</code> in{" "}
        <code>.env</code> and restart.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {device ? (
        <div className="rounded-md border border-amber/40 bg-amber/10 p-4 text-sm">
          <p>
            Go to{" "}
            <a href={device.verification_url} target="_blank" rel="noreferrer" className="text-amber underline">
              {device.verification_url}
            </a>{" "}
            and enter this code:
          </p>
          <p className="my-2 font-mono text-3xl tracking-[0.3em]">{device.user_code}</p>
          <p className="text-muted">Waiting for you to approve…</p>
        </div>
      ) : connected ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded bg-amber/15 px-2 py-1 text-amber">Connected</span>
          {lastSyncAt && <span className="text-muted">Last synced {new Date(lastSyncAt).toLocaleString()}</span>}
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setMessage(await syncTraktNow()))}
            className="rounded border border-line px-3 py-1.5 hover:border-amber-dim disabled:opacity-50"
          >
            {pending ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await disconnectTrakt(); setMessage("Disconnected. Imported ratings stay in your library."); })}
            className="rounded px-3 py-1.5 text-muted hover:text-rose disabled:opacity-50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMessage(undefined);
              const res = await startTrakt();
              if (res.ok) setDevice(res.device);
              else setMessage(res.error);
            })
          }
          className="h-9 rounded bg-amber px-4 text-sm font-medium text-ink hover:bg-amber/90 disabled:opacity-60"
        >
          Connect Trakt
        </button>
      )}
      {message && (
        <p role="status" className="text-sm text-paper/80">
          {message}
        </p>
      )}
    </div>
  );
}
