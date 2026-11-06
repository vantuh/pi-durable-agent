/** The model picker: the catalog, scoped by Pi's `enabledModels`, and the default for new sessions. */

import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { type ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Hono } from "hono";
import { z } from "zod";

import type { ApiEnv } from "../http.ts";
import { type Sessions, supportedLevel } from "../sessions.ts";
import { jsonBody, ThinkingLevel } from "../validate.ts";

const ModelBody = z.object({ provider: z.string(), modelId: z.string() });
const DefaultBody = z.object({ model: ModelBody, thinkingLevel: ThinkingLevel });

/** Read through the manager that saves it, so a model added here is in the next read. */
export function enabledModels(): string[] | undefined {
    return SettingsManager.create(process.cwd()).getEnabledModels();
}

/**
 * A settings entry names a model, and may carry a suffix after a colon: Pi's thinking level for it,
 * or a provider's own word. Only a colon can start one, so an entry without one names itself alone.
 */
function namesModel(entry: string, key: string): boolean {
    const colon = entry.lastIndexOf(":");

    return entry === key || (colon !== -1 && entry.slice(0, colon) === key);
}

/**
 * `enabledModels` scopes the catalog, not what has credentials: a model just added from the picker
 * is in `scoped` at once, instead of vanishing until its provider is configured.
 */
export function scopedModels<T extends { provider: string; id: string }>(
    enabled: string[] | undefined,
    catalog: readonly T[],
    available: readonly T[],
): readonly T[] {
    if (enabled === undefined) {
        return available;
    }

    return catalog.filter((model) =>
        enabled.some((entry) => namesModel(entry, `${model.provider}/${model.id}`)),
    );
}

/** The entries left once every entry naming `key` is gone, with its `:level` entries too. */
export function withoutModel(enabled: readonly string[], key: string): string[] {
    return enabled.filter((entry) => !namesModel(entry, key));
}

async function addEnabledModel(key: string, fallback: string[]): Promise<void> {
    const settings = SettingsManager.create(process.cwd());
    const current = settings.getEnabledModels() ?? fallback;

    if (!current.includes(key)) {
        settings.setEnabledModels([...current, key]);
        await settings.flush();
    }
}

/** Nothing scoped writes an empty list: the picker then offers the catalog, as when none is set. */
async function removeEnabledModel(key: string): Promise<void> {
    const settings = SettingsManager.create(process.cwd());
    const current = settings.getEnabledModels();

    if (current === undefined) {
        return;
    }

    settings.setEnabledModels(withoutModel(current, key));
    await settings.flush();
}

function modelInfo(model: Model<Api>) {
    return {
        provider: model.provider,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        levels: getSupportedThinkingLevels(model),
    };
}

export function modelRoutes(deps: {
    models: ModelRuntime;
    sessions: Sessions;
    /** The `MODEL` setting: what a new session starts with until a default is chosen. */
    fallback: { provider: string; modelId: string };
}) {
    const { models, sessions, fallback } = deps;

    return new Hono<ApiEnv>()
        .get("/api/models", async (c) => {
            const available = await models.getAvailable();
            const list = models.getModels();
            const enabled = enabledModels();
            const scoped = scopedModels(enabled, list, available);

            const stored = await sessions.defaults();

            return c.json({
                scoped: scoped.map(modelInfo),
                all: list.map(modelInfo),
                default:
                    stored === undefined
                        ? {
                              ...fallback,
                              thinkingLevel: supportedLevel(models, fallback, "off"),
                          }
                        : { ...stored.model, thinkingLevel: stored.thinkingLevel },
            });
        })
        .post(
            "/api/scoped",
            jsonBody(ModelBody, "provider and modelId are required"),
            async (c) => {
                const { provider, modelId } = c.req.valid("json");
                const available = await models.getAvailable();

                await addEnabledModel(
                    `${provider}/${modelId}`,
                    available.map((model) => `${model.provider}/${model.id}`),
                );

                return c.json({ provider, modelId }, 200);
            },
        )
        .delete(
            "/api/scoped",
            jsonBody(ModelBody, "provider and modelId are required"),
            async (c) => {
                const { provider, modelId } = c.req.valid("json");

                await removeEnabledModel(`${provider}/${modelId}`);

                return c.json({ provider, modelId }, 200);
            },
        )
        .post(
            "/api/default",
            jsonBody(DefaultBody, "model and thinkingLevel are required"),
            async (c) => {
                const { model, thinkingLevel } = c.req.valid("json");

                await sessions.setDefaults(model, thinkingLevel);

                return c.json({ ...model, thinkingLevel }, 200);
            },
        );
}
