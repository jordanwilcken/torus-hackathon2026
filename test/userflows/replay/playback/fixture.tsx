import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import captured from '../../../../examples/replay/job-stream.json';
import type { ReplayScenario } from '../../../../src/core/execution/replay/Replay.types';
import { useReplayPlayback, type ReplayPlaybackOptions } from '../../../../src/ui/replay/useReplayPlayback';

const query = new URLSearchParams(location.search);
const options: ReplayPlaybackOptions | undefined = query.get('profile') === 'defaults' ? undefined : {
    autoPlay: query.get('autoPlay') !== 'false',
    tickMs: Number(query.get('tickMs') ?? 4000),
    routedDwellMs: Number(query.get('routedDwellMs') ?? 1800),
    initialSpeed: Number(query.get('initialSpeed') ?? 1),
};

function Playback() {
    const playback = useReplayPlayback(captured as ReplayScenario, options);
    const { progress, actions } = playback;
    const [commandError, setCommandError] = useState<string>();
    const [acknowledgement, setAcknowledgement] = useState('none');
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
    </section>;
}

function Host() {
    const [mounted, setMounted] = useState(false);
    return <main>
        <h1>Real replay playback contract</h1>
        <p>The production hook runs the captured job stream through the real paired runtime.</p>
        <p>Mount is deferred only so the browser clock can be paused before hook timers are created.</p>
        <pre aria-label="Requested options">{JSON.stringify(options ?? 'existing defaults')}</pre>
        {mounted ? <Playback /> : <button type="button" onClick={() => setMounted(true)}>Mount playback</button>}
    </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Host /></StrictMode>);
