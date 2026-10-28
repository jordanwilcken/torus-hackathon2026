import { useRef, useState } from "react";
import type { PlaybackControlsProps } from "./PlaybackControls.types.js";
import "./PlaybackControls.css";

/** A controlled view: commands request changes; only supplied state reports their outcome. */
export function PlaybackControls({ state, actions, scenario }: PlaybackControlsProps) {
    const [pending, setPending] = useState<string>();
    const [pendingEvent, setPendingEvent] = useState<string>();
    const [pausing, setPausing] = useState(false);
    const [failure, setFailure] = useState<string>();
    const commandInFlight = useRef(false);
    const eventInFlight = useRef(false);
    const pauseInFlight = useRef(false);
    const selectedEvent = scenario.events.find(event => event.id === scenario.selectedEventId);
    const locked = state.busy || pending !== undefined || pendingEvent !== undefined || pausing;
    const eventsLocked = pendingEvent !== undefined || pausing || (!state.allowEventSchedulingWhileBusy && locked);
    const complete = state.mode === "complete";
    // Pause remains available during a tick or a pending Play acknowledgement.
    const canPause = state.mode === "playing" || pending === "Play";

    async function request(label: string, operation: () => void | Promise<void>, kind: 'command' | 'pause' | 'event' = 'command'): Promise<void> {
        const pause = kind === 'pause', event = kind === 'event';
        if (pause) {
            if (pauseInFlight.current) return;
        } else if (event) {
            if (eventInFlight.current || pauseInFlight.current ||
                (!state.allowEventSchedulingWhileBusy && (commandInFlight.current || state.busy))) return;
        } else if (commandInFlight.current || eventInFlight.current || pauseInFlight.current || state.busy) return;
        if (pause) {
            pauseInFlight.current = true;
            setPausing(true);
        } else if (event) {
            eventInFlight.current = true;
            setPendingEvent(label);
        } else {
            commandInFlight.current = true;
            setPending(label);
        }
        setFailure(undefined);
        try {
            await operation();
        } catch (error) {
            setFailure(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (pause) {
                pauseInFlight.current = false;
                setPausing(false);
            } else if (event) {
                eventInFlight.current = false;
                setPendingEvent(undefined);
            } else {
                commandInFlight.current = false;
                setPending(undefined);
            }
        }
    }

    return <section className="playback-controls" aria-label="Simulation controls">
        <div className="playback-heading">
            <h2>Simulation controls</h2>
            <span className="playback-mode" aria-label="Playback status">{state.mode}</span>
        </div>
        <dl className="playback-clock">
            <div><dt>Simulation hour</dt><dd><output aria-label="Simulation hour">{state.hour} / {state.totalHours}</output></dd></div>
            <div><dt>Simulation time</dt><dd><time aria-label="Simulation time" dateTime={state.currentTime}>{state.currentTime}</time></dd></div>
        </dl>
        <div className="playback-buttons">
            {canPause
                ? <button type="button" className="playback-primary" disabled={pausing}
                    onClick={() => void request("Pause", () => actions.pause(), 'pause')}>Pause</button>
                : <button type="button" className="playback-primary" disabled={locked || complete}
                    onClick={() => void request("Play", () => actions.play())}>Play</button>}
            <button type="button" disabled={locked || complete || state.mode === "playing"}
                onClick={() => void request("Step", () => actions.step())}>Step</button>
            <button type="button" disabled={locked}
                onClick={() => void request("Reset", () => actions.reset())}>Reset</button>
            <label className="playback-speed">Playback speed
                <select value={state.speed} disabled={locked || state.speedOptions.length === 0}
                    onChange={event => {
                        const speed = Number(event.currentTarget.value);
                        void request("Change speed", () => actions.setSpeed(speed));
                    }}>
                    {state.speedOptions.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
                </select>
            </label>
        </div>
        <div className="playback-scenario">
            <h3>Scenario event</h3>
            <div className="playback-event-actions">
                <label>Scenario event
                    <select value={selectedEvent?.id ?? ""} disabled={eventsLocked || complete || scenario.events.length === 0}
                        onChange={event => {
                            const id = event.currentTarget.value;
                            void request("Choose event", () => actions.selectEvent(id), 'event');
                        }}>
                        <option value="" disabled>{scenario.events.length ? "Choose an event" : "No events available"}</option>
                        {scenario.events.map(event => <option key={event.id} value={event.id}>{event.label}</option>)}
                    </select>
                </label>
                <button type="button" disabled={eventsLocked || complete || !selectedEvent}
                    onClick={() => {
                        if (selectedEvent) void request("Apply event", () => actions.applyEvent(selectedEvent.input), 'event');
                    }}>Apply event</button>
            </div>
            {selectedEvent && <p className="playback-event-detail">
                {selectedEvent.description} <span>Event hour: {selectedEvent.input.atHour}.</span>
            </p>}
        </div>
        {(pending || pendingEvent || pausing || state.busy) && <p className="playback-pending" role="status">
            {pausing ? "Pause requested…" : pendingEvent ? `${pendingEvent} requested…` : pending ? `${pending} requested…` : "Simulation is processing…"}
        </p>}
        {state.condition && <p className="playback-condition" data-kind={state.condition.kind}>
            <strong>{state.condition.kind}: </strong>{state.condition.message}
        </p>}
        {state.response && <div className="playback-response" data-kind={state.response.kind}
            role={state.response.kind === "error" ? "alert" : "status"}>
            <span>Application response</span><p>{state.response.message}</p>
        </div>}
        {failure && <p className="playback-failure" role="alert">{failure}</p>}
    </section>;
}
