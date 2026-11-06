/**
 * The ponytail chip's unicorn. Lucide has no horse, so the body is Tabler Icons' `horse` — same
 * 24-grid, 2px stroke and round caps, drawn by Paweł Kuna under the MIT license (Copyright (c)
 * 2020-2026 Paweł Kuna, https://github.com/tabler/tabler-icons) — with the horn and its notch added
 * here.
 */
import { createLucideIcon } from "lucide-react";

export const Unicorn = createLucideIcon("unicorn", [
    [
        "path",
        {
            d: "M7 10l-.85 8.507a1.357 1.357 0 0 0 1.35 1.493h.146a2 2 0 0 0 1.857 -1.257l.994 -2.486a2 2 0 0 1 1.857 -1.257h1.292a2 2 0 0 1 1.857 1.257l.994 2.486a2 2 0 0 0 1.857 1.257h.146a1.37 1.37 0 0 0 1.364 -1.494l-.864 -9.506h-8c0 -3 -3 -5 -6 -5l-3 6l2 2l3 -2",
            key: "body",
        },
    ],
    ["path", { d: "M22 14v-2a3 3 0 0 0 -3 -3", key: "ear" }],
    ["path", { d: "M8.7 6.7 8.2 1.9", key: "horn" }],
    ["path", { d: "M7.7 5.1 8.9 5.6", key: "notch" }],
]);
