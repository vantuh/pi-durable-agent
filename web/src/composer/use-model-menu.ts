import { useCallback, useState } from "react";

import type { ModelChoice } from "../../../shared/protocol.ts";
import {
    addScopedModel,
    listModels,
    type Models,
    removeScopedModel,
    setAgent,
    setDefaultModel,
} from "../lib/api.ts";

/** The model menu above the composer: whether it is open, and what it shows and does. */
export function useModelMenu(session: number | null, reload: () => Promise<void>) {
    const [menu, setMenu] = useState(false);
    const [models, setModels] = useState<Models>({ scoped: [], all: [], default: null });
    const toggleMenu = useCallback((): void => {
        void (async () => {
            if (!menu) {
                setModels(await listModels());
            }

            setMenu((open) => !open);
        })();
    }, [menu]);

    return {
        menu,
        toggleMenu,
        menuProps: {
            scoped: models.scoped,
            all: models.all,
            defaultModel: models.default,
            onClose: () => {
                setMenu(false);
            },
            onAddScoped: (choice: ModelChoice) => {
                void (async () => {
                    await addScopedModel(choice);
                    setModels(await listModels());
                })();
            },
            onRemoveScoped: (choice: ModelChoice) => {
                void (async () => {
                    await removeScopedModel(choice);
                    setModels(await listModels());
                })();
            },
            onMakeDefault: (choice: ModelChoice, level: string) => {
                void (async () => {
                    await setDefaultModel({
                        provider: choice.provider,
                        modelId: choice.id,
                        thinkingLevel: level,
                    });
                    setModels(await listModels());
                })();
            },
            onPick: (choice: ModelChoice, level: string) => {
                void (async () => {
                    if (session !== null) {
                        await setAgent(session, {
                            model: {
                                provider: choice.provider,
                                modelId: choice.id,
                            },
                            thinkingLevel: level,
                        });
                    }

                    await reload();
                })();
            },
        },
    };
}
