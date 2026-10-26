/**
 * What an extension's server half and browser half agree on. Browser-safe: no imports.
 *
 * The wire carries unchecked JSON, so a ref brings the check: `parse` returns the result or throws.
 * Only the browser uses it; the server never does.
 */

export type ActionRef<Args, Result> = {
    readonly extension: string;
    readonly name: string;
    /** Phantom: never set, only carries the type. */
    readonly args?: Args;
    readonly parse: (value: unknown) => Result;
};

export function actionRef<Args, Result>(
    extension: string,
    name: string,
    parse: (value: unknown) => Result,
): ActionRef<Args, Result> {
    return { extension, name, parse };
}
