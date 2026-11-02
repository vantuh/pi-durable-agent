import type { ExtensionNotice } from "../../../shared/protocol.ts";

/** How a notice is shown: as it comes, as one session's own toast, or not at all. */
export type NoticeTarget =
    | { kind: "plain"; level: ExtensionNotice["level"]; message: string }
    | {
          kind: "session";
          level: ExtensionNotice["level"];
          session: number;
          title: string;
          description?: string;
      }
    | { kind: "silent" };

/** A notice said as one session's toast: the title opens it, and `description` is the line under the title. */
export type SessionNotice = Extract<NoticeTarget, { kind: "session" }>;

/** The session on screen already shows what a notice about it would say, so that one stays silent. */
export function noticeTarget(notice: ExtensionNotice, current: number | null): NoticeTarget {
    if (notice.session === undefined) {
        return { kind: "plain", level: notice.level, message: notice.message };
    }

    if (notice.session === current) {
        return { kind: "silent" };
    }

    return {
        kind: "session",
        level: notice.level,
        session: notice.session,
        title: notice.message,
        ...(notice.description === undefined ? {} : { description: notice.description }),
    };
}
