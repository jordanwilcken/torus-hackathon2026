import type { TimeWindow } from "../../TimeWindow.type.js";

export const hour = 3_600_000;
export function bounds(window: TimeWindow | undefined): readonly [number, number] | undefined {
    if (!window) return undefined;
    const start = Date.parse(window.startAt), end = Date.parse(window.endAt);
    return Number.isFinite(start) && Number.isFinite(end) && start < end ? [start, end] : undefined;
}
export function windowAt(start: number, end: number): TimeWindow {
    return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
}
export function sameWindow(a: TimeWindow | undefined, b: TimeWindow): boolean {
    const left = bounds(a), right = bounds(b);
    return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}
export function near(a: number, b: number): boolean {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}
