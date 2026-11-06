import { type KeyboardEvent, type RefObject, useEffect, useMemo, useState } from "react";

import { listProjectFiles, listSkills, type SkillInfo } from "@/lib/api.ts";
import { setComposerDraft } from "@/sdk/composer.ts";

import { type Candidate, matchingFiles, slashCandidates } from "./candidate.ts";

export function useCompletion({
    sessionId,
    text,
    field,
    instantOk,
    onNewSession,
    onToggleMenu,
}: {
    sessionId: string;
    text: string;
    field: RefObject<HTMLTextAreaElement | null>;
    /** Nothing is attached or quoted, so a command with no arguments may run at once. */
    instantOk: boolean;
    onNewSession: () => void;
    onToggleMenu: () => void;
}) {
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [projectFiles, setProjectFiles] = useState<string[]>([]);
    const [caret, setCaret] = useState(0);
    const [marked, setMarked] = useState(0);
    // The list closes on Escape and opens again when the text changes.
    const [dismissed, setDismissed] = useState<string | null>(null);

    useEffect(() => {
        void listSkills(Number(sessionId)).then(setSkills);
        void listProjectFiles(Number(sessionId)).then(setProjectFiles);
    }, [sessionId]);

    // "/" or "/ne" (no space yet) asks for a command or a skill, the closest name first. A picked command is
    // inserted without a trailing space, so the pick closes the list itself.
    const typed = /^\/(?:skill:)?([\w-]*)$/.exec(text)?.[1]?.toLowerCase();
    // "@" at the start of a word, wherever the caret is in the text, asks for a file of the folder.
    const mention = typed === undefined ? /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret)) : null;
    const mentioned = mention?.[2];
    const fileMatches = useMemo(
        (): string[] => matchingFiles(projectFiles, mentioned),
        [projectFiles, mentioned],
    );
    const mentionAt = caret - (mentioned?.length ?? 0) - 1;
    const fileCandidates: Candidate[] =
        mentioned === undefined || dismissed === text
            ? []
            : fileMatches.map((path): Candidate => {
                  const slash = path.lastIndexOf("/");

                  return {
                      label: path.slice(slash + 1),
                      description: slash < 0 ? "" : path.slice(0, slash),
                      insert: `@${path} `,
                      replace: [mentionAt, caret],
                  };
              });
    const matches: Candidate[] =
        typed === undefined || dismissed === text ? fileCandidates : slashCandidates(typed, skills);
    const pick = (candidate: Candidate): void => {
        if (candidate.replace !== undefined) {
            const [from, to] = candidate.replace;
            const next = text.slice(0, from) + candidate.insert + text.slice(to);
            const end = from + candidate.insert.length;

            setComposerDraft(sessionId, next);
            setCaret(end);
            requestAnimationFrame(() => {
                field.current?.setSelectionRange(end, end);
            });

            return;
        }

        if (candidate.instant !== undefined && instantOk) {
            setComposerDraft(sessionId, "");

            if (candidate.instant === "new") {
                onNewSession();
            } else {
                onToggleMenu();
            }

            return;
        }

        setComposerDraft(sessionId, candidate.insert);
        setDismissed(candidate.insert);
    };

    /** Answers whether the key was the list's. */
    const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
        const chosen = matches[Math.min(marked, matches.length - 1)];

        if (chosen !== undefined && !event.nativeEvent.isComposing) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMarked(
                    (marked + (event.key === "ArrowDown" ? 1 : -1) + matches.length) %
                        matches.length,
                );

                return true;
            }

            if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                event.preventDefault();
                pick(chosen);

                return true;
            }

            if (event.key === "Escape") {
                setDismissed(text);

                return true;
            }
        }

        return false;
    };

    return { matches, marked, setMarked, setCaret, pick, handleKey };
}
