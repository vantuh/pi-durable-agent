// The parameter schema each tool of an extension installs, by tool name, through `JSON.stringify` so
// builder-only symbols and `undefined` keys are gone. Not the provider payload: pi-ai converts it per
// provider (Anthropic rebuilds the root, Gemini turns `const` into `enum`, strict mode closes objects).
export function schemasSent(extension: {
    readonly tools?: readonly { readonly name: string; readonly parameters: unknown }[];
}): Record<string, unknown> {
    return Object.fromEntries(
        (extension.tools ?? []).map((tool) => {
            const sent: unknown = JSON.parse(JSON.stringify(tool.parameters));

            return [tool.name, sent];
        }),
    );
}
