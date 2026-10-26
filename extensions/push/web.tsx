import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner.tsx";
import { callAction } from "@/sdk/actions.ts";
import type { SettingsProps, WebExtension } from "@/sdk/types.ts";

import { enable, OLD_WORKER, readyWorker, workerProblem } from "./device.ts";
import { normalizeContact, prepare, state, subscribe, unsubscribe } from "./refs.ts";

type Phase =
    | { kind: "checking" }
    | { kind: "blocked"; why: string }
    | { kind: "off"; contact: string }
    | { kind: "on"; contact: string };

function blockedReason(): string | undefined {
    if (!window.isSecureContext) {
        return "Notifications need a secure address: localhost, or a trusted HTTPS address.";
    }

    if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
    ) {
        return "This browser cannot receive push notifications. On iPhone, add the app to the Home Screen first.";
    }

    if (import.meta.env.DEV) {
        return "The development server has no service worker. Use a production build (pnpm build && pnpm preview).";
    }

    if (Notification.permission === "denied") {
        return "Notifications are blocked for this site. Allow them in the browser's site settings.";
    }

    return undefined;
}

/** Contact to show first: the saved one, else this address when it is a public HTTPS name. */
function firstContact(saved: string | null): string {
    if (saved !== null) {
        return saved;
    }

    try {
        return normalizeContact(window.location.origin);
    } catch {
        return "";
    }
}

async function currentSubscription(): Promise<PushSubscription | null> {
    const registration = await navigator.serviceWorker.getRegistration();

    return registration === undefined ? null : await registration.pushManager.getSubscription();
}

async function disable(): Promise<void> {
    const device = await currentSubscription();

    if (device === null) {
        return;
    }

    await callAction(unsubscribe, { endpoint: device.endpoint }, null);
    await device.unsubscribe();
}

function Notifications(_props: SettingsProps) {
    const [phase, setPhase] = useState<Phase>({ kind: "checking" });
    const [contact, setContact] = useState("");
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | undefined>();
    // Held so Enable can inspect it before its first await, which keeps the user gesture (Safari).
    const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);

    const refresh = useCallback(async () => {
        const why = blockedReason();

        if (why !== undefined) {
            setPhase({ kind: "blocked", why });

            return;
        }

        try {
            registration.current = await navigator.serviceWorker.getRegistration();

            const device = await registration.current?.pushManager.getSubscription();
            const known = await callAction(state, { endpoint: device?.endpoint ?? null }, null);
            const shown = firstContact(known.contact);
            const problem = workerProblem(registration.current);

            if (problem === OLD_WORKER) {
                // Never show "on" while the active worker is old: it may not show the push.
                setPhase({ kind: "blocked", why: problem });

                return;
            }

            setContact((current) => (current === "" ? shown : current));
            setPhase({ kind: known.subscribed ? "on" : "off", contact: shown });
        } catch (failure) {
            setPhase({ kind: "off", contact: "" });
            setError(failure instanceof Error ? failure.message : "Cannot read the state.");
        }
    }, []);

    useEffect(() => {
        // oxlint-disable-next-line react/set-state-in-effect -- reads the browser's subscription and the server's state, which only exist after mount
        void refresh();
    }, [refresh]);

    const run = async (work: () => Promise<void>) => {
        setWorking(true);
        setError(undefined);

        try {
            await work();
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Something went wrong.");
        } finally {
            setWorking(false);
            await refresh();
        }
    };

    if (phase.kind === "checking") {
        return <Spinner className="text-faint" />;
    }

    if (phase.kind === "blocked") {
        return <p className="text-meta text-muted">{phase.why}</p>;
    }

    const on = phase.kind === "on";

    return (
        <div className="flex flex-col gap-2">
            <p className="text-meta text-muted">
                {on
                    ? "This device gets a notification when Pi finishes an answer."
                    : "Get a notification on this device when Pi finishes an answer."}
            </p>
            {on ? null : (
                <label className="flex flex-col gap-1">
                    <span className="text-meta text-faint">
                        Contact for the push service (email or https address)
                    </span>
                    <input
                        type="text"
                        value={contact}
                        onChange={(event) => {
                            setContact(event.target.value);
                        }}
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="rounded-control border-edge bg-sunken text-ink text-interface focus-visible:ring-accent border px-2 py-1.5 outline-none focus-visible:ring-2"
                    />
                </label>
            )}
            <button
                type="button"
                disabled={working || (!on && contact.trim() === "")}
                onClick={() => {
                    void run(async () => {
                        if (on) {
                            await disable();
                        } else {
                            await enable(contact, {
                                notification: Notification,
                                registration: registration.current,
                                ready: readyWorker,
                                prepare: async (saved) =>
                                    (await callAction(prepare, { contact: saved }, null)).publicKey,
                                save: async (subscription) => {
                                    await callAction(subscribe, { subscription }, null);
                                },
                            });
                        }
                    });
                }}
                className="rounded-control bg-raised text-ink text-interface hover:bg-edge-soft focus-visible:ring-accent flex items-center justify-center gap-2 px-3 py-1.5 outline-none focus-visible:ring-2 disabled:opacity-50"
            >
                {working ? <Spinner /> : null}
                {on ? "Disable on this device" : "Enable on this device"}
            </button>
            {error === undefined ? null : <p className="text-meta text-danger">{error}</p>}
        </div>
    );
}

export default {
    settings: [{ id: "notifications", title: "Notifications", component: Notifications }],
} satisfies WebExtension;
