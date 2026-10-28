import type { InputEvent } from "../../../core/execution/simulation/clock.js";

export type ControlsResponse = {
    kind: "success" | "error" | "info";
    message: string;
};

export type PlaybackCondition = {
    kind: "healthy" | "stale" | "degraded" | "infeasible";
    message: string;
};

/** Authoritative application state. This view does not advance the simulation. */
export type PlaybackState = {
    hour: number;
    totalHours: number;
    currentTime: string;
    mode: "paused" | "playing" | "complete";
    speed: number;
    speedOptions: ReadonlyArray<number>;
    busy: boolean;
    condition?: PlaybackCondition;
    response?: ControlsResponse;
};

export type ScenarioEventOption = {
    id: string;
    label: string;
    description: string;
    input: InputEvent;
};

export type ScenarioMenu = {
    /** Refresh event hours/payloads as application state changes; the view forwards them unchanged. */
    events: ReadonlyArray<ScenarioEventOption>;
    selectedEventId: string;
};

/** Commands retain application policy. A promise acknowledges a command, rather than the entire playback session. */
export type PlaybackActions = {
    play(): void | Promise<void>;
    pause(): void | Promise<void>;
    step(): void | Promise<void>;
    reset(): void | Promise<void>;
    setSpeed(speed: number): void | Promise<void>;
    selectEvent(id: string): void | Promise<void>;
    applyEvent(input: InputEvent): void | Promise<void>;
};

export type PlaybackControlsProps = {
    state: PlaybackState;
    actions: PlaybackActions;
    scenario: ScenarioMenu;
};
