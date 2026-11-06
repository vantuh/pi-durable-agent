/** Lines added and removed: the added green, the removed red, a side with none left out. */
export function Counts({ added, removed }: { added: number; removed: number }) {
    return (
        <span className="inline-flex gap-1.5 tabular-nums">
            {added > 0 || removed === 0 ? <span className="text-ok">+{added}</span> : null}
            {removed > 0 ? <span className="text-danger">−{removed}</span> : null}
        </span>
    );
}
