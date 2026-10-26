import { useEffect, useRef, useState } from "react";

import { callAction } from "@/sdk/actions.ts";

import { account, type AccountResult } from "./account-refs.ts";

export function AccountDetails() {
    const [includeIdentity, setIncludeIdentity] = useState(false);
    const [result, setResult] = useState<AccountResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const generation = useRef(0);
    useEffect(
        () => () => {
            generation.current += 1;
        },
        [],
    );

    async function check(): Promise<void> {
        const mine = ++generation.current;
        setBusy(true);
        setError(false);
        setResult(null);
        try {
            const found = await callAction(account, { includeIdentity }, null);
            if (mine === generation.current) {
                setResult(found);
            }
        } catch {
            if (mine === generation.current) {
                setError(true);
            }
        } finally {
            if (mine === generation.current) {
                setBusy(false);
            }
        }
    }

    const profile = result?.kind === "profile" ? result.profile : null;
    return (
        <section
            className="border-edge-soft mt-1 flex flex-col gap-2 border-t pt-3"
            aria-label="Subscription account"
        >
            <div className="flex items-center justify-between gap-3">
                <span className="text-ink">Subscription account</span>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                        void check();
                    }}
                    className="rounded-control border-edge-soft text-ink hover:bg-raised focus-visible:ring-accent border px-2 py-1 outline-none focus-visible:ring-2 disabled:opacity-50"
                >
                    {busy ? "Checking…" : "Check subscription"}
                </button>
            </div>
            <label className="text-muted flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={includeIdentity}
                    disabled={busy}
                    onChange={(event) => {
                        setIncludeIdentity(event.target.checked);
                        setResult(null);
                    }}
                    className="accent-accent"
                />
                Include email and organization
            </label>
            {error ? (
                <p role="alert" className="text-danger">
                    Could not check the account. Please try again.
                </p>
            ) : null}
            {result?.kind === "not-oauth" ? (
                <p className="text-muted">No Anthropic OAuth authorization configured.</p>
            ) : null}
            {result?.kind === "unavailable" ? (
                <p role="alert" className="text-warn">
                    Account unavailable: {result.reason}
                </p>
            ) : null}
            {profile === null ? null : (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                    <dt className="text-faint">Subscription type</dt>
                    <dd className="text-muted text-right break-all">
                        {profile.organizationType ?? "Unknown"}
                    </dd>
                    <dt className="text-faint">Subscription status</dt>
                    <dd className="text-muted text-right break-all">
                        {profile.subscriptionStatus ?? "Unknown"}
                    </dd>
                    <dt className="text-faint">Extra usage</dt>
                    <dd className="text-muted text-right">
                        {profile.extraUsageEnabled === null
                            ? "Unknown"
                            : profile.extraUsageEnabled
                              ? "Enabled"
                              : "Disabled"}
                    </dd>
                    <dt className="text-faint">Rate limit tier</dt>
                    <dd className="text-muted text-right break-all">
                        {profile.rateLimitTier ?? "Unknown"}
                    </dd>
                    <dt className="text-faint">Seat tier</dt>
                    <dd className="text-muted text-right break-all">
                        {profile.seatTier ?? "Unknown"}
                    </dd>
                    {includeIdentity ? (
                        <>
                            <dt className="text-faint">Email</dt>
                            <dd className="text-muted text-right break-all">
                                {profile.email ?? "Unknown"}
                            </dd>
                            <dt className="text-faint">Organization</dt>
                            <dd className="text-muted text-right break-all">
                                {profile.organizationName ?? "Unknown"}
                            </dd>
                        </>
                    ) : null}
                    <dt className="text-faint">Checked</dt>
                    <dd className="text-muted text-right">
                        {result?.kind === "profile"
                            ? new Date(result.checkedAt).toLocaleString()
                            : ""}
                    </dd>
                </dl>
            )}
            <p className="text-faint">
                Queried only on click via an undocumented Anthropic endpoint. Account status does
                not confirm how a model request was billed.
            </p>
        </section>
    );
}
