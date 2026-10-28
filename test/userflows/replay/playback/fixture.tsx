import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import captured from '../../../../examples/replay/job-stream.json';
import { createPairedReplaySession } from '../../../../src/core/execution/replay/createPairedReplaySession';
import type { ReplayScenario } from '../../../../src/core/execution/replay/Replay.types';
import type { FrozenFleetSnapshot } from '../../../../src/data/FrozenFleet.type';
import { useReplayPlayback, type ReplayPlaybackOptions, type ReplayProgress } from '../../../../src/ui/replay/useReplayPlayback';
import { restoreFrozenFleet, type ReplaySession } from '../../../../src/ui/replay/restoreFrozenFleet';

const query = new URLSearchParams(location.search);
const options: ReplayPlaybackOptions | undefined = query.get('profile') === 'defaults' ? undefined : {
    autoPlay: query.get('autoPlay') !== 'false',
    tickMs: Number(query.get('tickMs') ?? 4000),
    routedDwellMs: Number(query.get('routedDwellMs') ?? 1800),
    initialSpeed: Number(query.get('initialSpeed') ?? 1),
};

const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => item instanceof Map ? [...item.entries()] : item);

function Playback({ initialSession }: { initialSession?: ReplaySession }) {
    const configured = initialSession ? { ...options, session: initialSession, autoPlay: false } : options;
    const playback = useReplayPlayback(captured as ReplayScenario, configured);
    const { progress, actions } = playback;
    const [commandError, setCommandError] = useState<string>();
    const [acknowledgement, setAcknowledgement] = useState('none');
    const [savedRead, setSavedRead] = useState<ReplayProgress | null>(null);
    const [currentRead, setCurrentRead] = useState<ReplayProgress | null>(null);
    const completedWork = progress.selected.run.ticks.flatMap(tick => tick.executions)
        .reduce((total, receipt) => total + receipt.completedGpuH, 0);

    async function command(label: string, action: () => void | Promise<void>): Promise<void> {
        setCommandError(undefined);
        try {
            await action();
            setAcknowledgement(`${label} acknowledged`);
        } catch (error) {
            setCommandError(error instanceof Error ? error.message : String(error));
        }
    }

    return <section aria-label="Playback observation">
        <dl>
            <dt>Phase</dt><dd><output aria-label="Observed phase">{progress.phase}</output></dd>
            <dt>Hour</dt><dd><output aria-label="Observed hour">{progress.hour}</output></dd>
            <dt>Playing</dt><dd><output aria-label="Observed playing">{String(playback.playing)}</output></dd>
            <dt>Busy</dt><dd><output aria-label="Observed busy">{String(playback.busy)}</output></dd>
            <dt>Completed</dt><dd><output aria-label="Observed completed">{String(playback.completed !== undefined)}</output></dd>
            <dt>Speed</dt><dd><output aria-label="Observed speed">{playback.speed}</output></dd>
            <dt>Publication hours</dt><dd><output aria-label="Observed publications">{[...playback.publications.keys()].join(',') || 'none'}</output></dd>
            <dt>Selected work</dt><dd><output aria-label="Observed selected work">{completedWork}</output></dd>
            <dt>Response kind</dt><dd><output aria-label="Observed response kind">{playback.response?.kind ?? 'none'}</output></dd>
        </dl>
        <div className="commands">
            <button type="button" onClick={() => void command('Play', () => actions.play())}>Play</button>
            <button type="button" onClick={() => void command('Pause', () => actions.pause())}>Pause</button>
            <button type="button" onClick={() => void command('Pause and capture', async () => {
                await actions.pause();
                // This continuation retains its original React closure; the hook must read its live session.
                setSavedRead(playback.read());
            })}>Pause and capture</button>
            <button type="button" onClick={() => void command('Read current', () => setCurrentRead(playback.read()))}>Read current moment</button>
            <button type="button" onClick={() => void command('Inject fresh event', () => actions.applyEvent({
                kind: 'solar-drop', atHour: progress.hour, payload: { locationId: 'A' },
            }))}>Inject fresh solar drop</button>
            <button type="button" onClick={() => void command('Step', () => actions.step())}>Step</button>
            <button type="button" onClick={() => void command('Step and pause', async () => {
                const next = actions.step();
                const stopped = actions.pause();
                await stopped;
                await next;
            })}>Step and immediately pause</button>
            <button type="button" onClick={() => void command('Reset', () => actions.reset())}>Reset</button>
            <button type="button" onClick={() => void command('Reset and step', async () => {
                const reset = actions.reset();
                const next = actions.step();
                await reset;
                await next;
            })}>Reset and start fresh step</button>
            <label>Speed <select aria-label="Playback speed" value={playback.speed}
                onChange={event => actions.setSpeed(Number(event.currentTarget.value))}>
                <option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
            </select></label>
        </div>
        <p aria-label="Command acknowledgement">{acknowledgement}</p>
        <p aria-label="Command error">{commandError ?? 'none'}</p>
        <pre aria-label="Completed evidence">{JSON.stringify(playback.completed ?? null)}</pre>
        <pre aria-label="Saved read">{serialize(savedRead)}</pre>
        <pre aria-label="Current read">{serialize(currentRead)}</pre>
    </section>;
}

function Host() {
    const [mounted, setMounted] = useState(false);
    const [initialSession, setInitialSession] = useState<ReplaySession>();
    async function mount(): Promise<void> {
        if (query.get('capture') === 'hour-2') {
            const scenario = structuredClone(captured) as ReplayScenario;
            scenario.events = [{ kind: 'solar-drop', atHour: 1, payload: { locationId: 'A' } }];
            const prepared = createPairedReplaySession(scenario);
            await prepared.step();
            await prepared.step();
            const { map: _, ...progress } = prepared.read();
            const sourceContext = { capturedAt: scenario.startAt, weather: null, caiso: null, eia: null };
            const snapshot: FrozenFleetSnapshot = JSON.parse(JSON.stringify({ schemaVersion: 1,
                capturedAt: '2026-10-28T20:00:00Z', runInputs: sourceContext, latestContext: sourceContext, progress }));
            setInitialSession(await restoreFrozenFleet(snapshot));
        }
        setMounted(true);
    }
    return <main>
        <h1>Real replay playback contract</h1>
        <p>The production hook runs the captured job stream through the real paired runtime.</p>
        <p>Mount is deferred only so the browser clock can be paused before hook timers are created.</p>
        <pre aria-label="Requested options">{JSON.stringify(options ?? 'existing defaults')}</pre>
        {mounted ? <Playback initialSession={initialSession} /> : <button type="button" onClick={() => void mount()}>Mount playback</button>}
    </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
