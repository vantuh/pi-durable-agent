/** The model picker: the catalog, scoped by Pi's `enabledModels`, and the default for new sessions. */

import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { type ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";

import { answer, readJson, record, type Route, string } from "../http.ts";
import { type Sessions, supportedLevel, THINKING_LEVELS } from "../sessions.ts";

/** Read through the manager that saves it, so a model added here is in the next read. */
export function enabledModels(): string[] | undefined {
    return SettingsManager.create(process.cwd()).getEnabledModels();
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

    return catalog.filter((model) => {
        const key = `${model.provider}/${model.id}`;

        // A trailing `:level` in a settings entry is Pi's thinking level for that model.
        return enabled.some(
            (entry) => entry === key || entry.slice(0, entry.lastIndexOf(":")) === key,
        );
    });
}

async function addEnabledModel(key: string, fallback: string[]): Promise<void> {
    const settings = SettingsManager.create(process.cwd());
    const current = settings.getEnabledModels() ?? fallback;

    if (!current.includes(key)) {
        settings.setEnabledModels([...current, key]);
        await settings.flush();
    }
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
}): Route[] {
    const { models, sessions, fallback } = deps;

    return [
        {
            method: "GET",
            path: /^\/api\/models$/,
            handle: async (_request, response) => {
                const available = await models.getAvailable();
                const list = models.getModels();
                const enabled = enabledModels();
                const scoped = scopedModels(enabled, list, available);

                const stored = await sessions.defaults();

                answer(response, 200, {
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
            },
        },
        {
            method: "POST",
            path: /^\/api\/scoped$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const provider = string(payload?.["provider"]);
                const modelId = string(payload?.["modelId"]);

                if (provider === undefined || modelId === undefined) {
                    answer(response, 400, { error: "provider and modelId are required" });

                    return;
                }

                const available = await models.getAvailable();

                await addEnabledModel(
                    `${provider}/${modelId}`,
                    available.map((model) => `${model.provider}/${model.id}`),
                );
                answer(response, 200, { provider, modelId });
            },
        },
        {
            method: "POST",
            path: /^\/api\/default$/,
            handle: async (request, response) => {
                const payload = record(await readJson(request));
                const model = record(payload?.["model"]);
                const provider = string(model?.["provider"]);
                const modelId = string(model?.["modelId"]);
                const thinkingLevel = THINKING_LEVELS.find(
                    (known) => known === payload?.["thinkingLevel"],
                );

                if (
                    provider === undefined ||
                    modelId === undefined ||
                    thinkingLevel === undefined
                ) {
                    answer(response, 400, { error: "model and thinkingLevel are required" });

                    return;
                }

                await sessions.setDefaults({ provider, modelId }, thinkingLevel);
                answer(response, 200, { provider, modelId, thinkingLevel });
            },
        },
    ];
}
