import { Component, type ReactNode } from "react";

/** One contribution that throws while rendering hides only itself, and logs once. */
export class ItemBoundary extends Component<
    { name: string; children: ReactNode; fallback?: ReactNode },
    { failed: boolean }
> {
    override state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    override componentDidCatch(error: unknown): void {
        console.error(`extension ${this.props.name}: failed while rendering:`, error);
    }

    override render(): ReactNode {
        return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
    }
}
