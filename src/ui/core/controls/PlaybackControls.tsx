import { useRef, useState } from "react";
import type { PlaybackControlsProps } from "./PlaybackControls.types.js";
import "./PlaybackControls.css";

/** A controlled view: commands request changes; only supplied state reports their outcome. */
export function PlaybackControls({ state, actions, scenario }: PlaybackControlsProps) {
    const [pending, setPending] = useState<string>();
    const [pausing, setPausing] = useState(false);
    const [failure, setFailure] = useState<string>();
    const commandInFlight = useRef(false);
    const pauseInFlight = useRef(false);
    const selectedEvent = scenario.events.find(event => event.id === scenario.selectedEventId);
    const locked = state.busy || pending !== undefined || pausing;
    const complete = state.mode === "complete";
    // Pause remains available during a tick or a pending Play acknowledgement.
    const canPause = state.mode === "playing" || pending === "Play";

    async function request(label: string, operation: () => void | Promise<void>, pause = false): Promise<void> {
        if (pause ? pauseInFlight.current : commandInFlight.current || pauseInFlight.current || state.busy) return;
        if (pause) {
            pauseInFlight.current = true;
            setPausing(true);
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
                    onClick={() => void request("Pause", () => actions.pause(), true)}>Pause</button>
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
        {(pending || pausing || state.busy) && <p className="playback-pending" role="status">
            {pausing ? "Pause requested…" : pending ? `${pending} requested…` : "Simulation is processing…"}
        </p>}
        {state.condition && <p className="playback-condition" data-kind={state.condition.kind}>
            <strong>{state.condition.kind}: </strong>{state.condition.message}
        </p>}
        <div className="playback-scenario">
            <h3>Scenario event</h3>
            <div className="playback-event-actions">
                <label>Scenario event
                    <select value={selectedEvent?.id ?? ""} disabled={locked || complete || scenario.events.length === 0}
                        onChange={event => {
                            const id = event.currentTarget.value;
                            void request("Choose event", () => actions.selectEvent(id));
                        }}>
                        <option value="" disabled>{scenario.events.length ? "Choose an event" : "No events available"}</option>
                        {scenario.events.map(event => <option key={event.id} value={event.id}>{event.label}</option>)}
                    </select>
                </label>
                <button type="button" disabled={locked || complete || !selectedEvent}
                    onClick={() => {
                        if (selectedEvent) void request("Apply event", () => actions.applyEvent(selectedEvent.input));
                    }}>Apply event</button>
            </div>
            {selectedEvent && <p className="playback-event-detail">
                {selectedEvent.description} <span>Event hour: {selectedEvent.input.atHour}.</span>
            </p>}
        </div>
        {state.response && <div className="playback-response" data-kind={state.response.kind}
            role={state.response.kind === "error" ? "alert" : "status"}>
            <span>Application response</span><p>{state.response.message}</p>
        </div>}
        {failure && <p className="playback-failure" role="alert">{failure}</p>}
    </section>;
}
