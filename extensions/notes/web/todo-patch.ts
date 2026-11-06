import type { Todo } from "../refs.ts";

export type Patch = Partial<Omit<Todo, "id">>;
