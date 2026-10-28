/** The model picker: the catalog, scoped by Pi's `enabledModels`, and the default for new sessions. */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { answer, readJson, record, type Route, string } from "../http.ts";
import { type Sessions, supportedLevel, THINKING_LEVELS } from "../sessions.ts";

async function enabledModels(): Promise<string[] | undefined> {
    try {
        const raw = await readFile(join(homedir(), ".pi/agent/settings.json"), "utf8");
        const parsed: unknown = JSON.parse(raw);
        const list =
            typeof parsed === "object" && parsed !== null && "enabledModels" in parsed
                ? parsed.enabledModels
                : undefined;

        return Array.isArray(list)
            ? list.filter((entry): entry is string => typeof entry === "string")
            : undefined;
    } catch {
        return undefined;
    }
}

async function addEnabledModel(key: string, fallback: string[]): Promise<void> {
    const file = join(homedir(), ".pi/agent/settings.json");
    let settings: Record<string, unknown> = {};

    try {
        settings = record(JSON.parse(await readFile(file, "utf8"))) ?? {};
    } catch {
        // No settings file yet: start one.
    }

    const current = Array.isArray(settings["enabledModels"])
        ? settings["enabledModels"].filter((entry): entry is string => typeof entry === "string")
        : fallback;

    if (!current.includes(key)) {
        settings["enabledModels"] = [...current, key];
        await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
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
                const enabled = await enabledModels();
                const scoped =
                    enabled === undefined
                        ? available
                        : available.filter((model) => {
                              const key = `${model.provider}/${model.id}`;

                              return enabled.some(
                                  (entry) =>
                                      entry === key ||
                                      entry.slice(0, entry.lastIndexOf(":")) === key,
                              );
                          });

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
