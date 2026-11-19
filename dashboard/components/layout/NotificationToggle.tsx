"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/LangProvider";
import { fetchPushPublicKey, subscribeToPush, unsubscribeFromPush } from "@/actions/pushActions";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/app";

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "not-configured" | "needs-install" | "off" | "on" | "blocked";

/**
 * Turns this browser into somewhere an escalation can reach a human.
 *
 * Escalations previously notified nobody - the hand-off message went to the customer, and the
 * only staff-facing signal was a badge that a polled, open dashboard tab updated. On a phone
 * that meant no signal at all.
 *
 * iOS is the awkward one: Safari only allows web push for a site added to the Home Screen, so
 * "needs-install" is a real state rather than a failure, and the copy has to say what to do.
 */
export function NotificationToggle() {
  const t = useT();
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        // On iOS this is what a normal Safari tab looks like - the APIs only appear once the
        // site has been installed to the Home Screen, so say that rather than "unsupported".
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const standalone = window.matchMedia("(display-mode: standalone)").matches;
        if (active) setState(isIos && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setState("blocked");
        return;
      }

      const reg = await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`);
      const existing = await reg?.pushManager.getSubscription();
      if (active) setState(existing ? "on" : "off");
    })().catch(() => active && setState("unsupported"));

    return () => {
      active = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const publicKey = await fetchPushPublicKey();
      if (!publicKey) {
        // The API has no VAPID keypair configured - nothing the person clicking can fix, but it
        // has to SAY so. This used to fall through to "unsupported", which hides the control
        // entirely: you pressed a button and it vanished, which reads as a broken page rather
        // than a server that is one env var short.
        setState("not-configured");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` });
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const ok =
        json.endpoint && json.keys?.p256dh && json.keys.auth
          ? await subscribeToPush({
              endpoint: json.endpoint,
              keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            })
          : false;

      // A subscription the server never stored would look enabled here and deliver nothing -
      // the exact silent failure this feature exists to remove. Roll it back instead.
      if (!ok) {
        await sub.unsubscribe().catch(() => { });
        setState("off");
        return;
      }
      setState("on");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribeFromPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      /* leave the state alone - a failed unsubscribe is better shown as still-on */
    } finally {
      setBusy(false);
    }
  }

  // "unsupported" is the only state worth hiding for: the browser genuinely cannot do this and
  // there is no action to offer. Every other state has something to tell the person.
  if (state === "loading" || state === "unsupported") return null;

  const label: Record<Exclude<State, "loading" | "unsupported">, string> = {
    "not-configured": t("common.notif.notConfigured"),
    "needs-install": t("common.notif.needsInstall"),
    blocked: t("common.notif.blocked"),
    off: t("common.notif.off"),
    on: t("common.notif.on"),
  };

  const inert = state === "needs-install" || state === "blocked" || state === "not-configured";

  return (
    <button
      type="button"
      onClick={inert ? undefined : state === "on" ? disable : enable}
      disabled={busy || inert}
      className="w-full text-left text-xs px-3 py-2 rounded"
      style={{
        color: state === "on" ? "#166534" : "#475569",
        background: state === "on" ? "#DCFCE7" : "#F1F5F9",
        border: "1px solid #E2E8F0",
        cursor: inert ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? t("common.processing") : label[state]}
    </button>
  );
}
