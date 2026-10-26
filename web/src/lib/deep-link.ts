/** The session a `?session=<id>` link names, or undefined when the value is not a positive integer. */
export function sessionFromSearch(search: string): number | undefined {
    const value = new URLSearchParams(search).get("session");

    if (value === null || !/^[1-9]\d*$/.test(value)) {
        return undefined;
    }

    const id = Number(value);

    return Number.isSafeInteger(id) ? id : undefined;
}
