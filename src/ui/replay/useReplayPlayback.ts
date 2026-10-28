import { useCallback, useEffect, useRef, useState } from 'react';
import { createPairedReplaySession } from '../../core/execution/replay/createPairedReplaySession';
import type { PairedReplay, ReplayScenario } from '../../core/execution/replay/Replay.types';
import type { PlaybackActions, ControlsResponse } from '../core/controls/PlaybackControls.types';
import { restoreReplayProgress, type ReplaySession } from './restoreFrozenFleet';

export type { ReplaySession } from './restoreFrozenFleet';

export type ReplayProgress = ReturnType<ReturnType<typeof createPairedReplaySession>['read']>;

/** Initial presentation settings. Model hours and execution results do not depend on these values. */
export type ReplayPlaybackOptions = {
    autoPlay?: boolean;
    tickMs?: number;
    routedDwellMs?: number;
    initialSpeed?: number;
    /** A restored session becomes this controller's owned starting point, including Reset. */
    session?: ReplaySession;
};

type ActiveStep = {
    completion: Promise<void>;
    presentationCancelled: boolean;
    finishPresentation?: () => void;
    abortRestore?: () => void;
};

function cancelPresentation(step: ActiveStep | undefined): void {
    if (!step) return;
    step.presentationCancelled = true;
    step.finishPresentation?.();
}

function holdPresentation(step: ActiveStep, milliseconds: number): Promise<void> {
    if (step.presentationCancelled) return Promise.resolve();
    return new Promise(resolve => {
        const finish = () => {
            clearTimeout(timer);
            step.finishPresentation = undefined;
            resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        step.finishPresentation = finish;
    });
}

function latestPublication(progress: ReplayProgress): Map<number, ReplayProgress['map']> {
    const hour = progress.selected.decisions.at(-1)?.hour;
    return hour === undefined ? new Map() : new Map([[hour, structuredClone(progress.map)]]);
}

export function replayFailures(progress: ReplayProgress) {
    return (['baseline', 'selected'] as const).flatMap(arm => {
        const failure = progress[arm].run.ticks.find(tick => !tick.feasible);
        return failure ? [{ arm, label: arm === 'baseline' ? 'Home FIFO' : 'Coordinated',
            explanation: failure.explanation ?? 'Site dispatch is infeasible.' }] : [];
    });
}

/** Owns playback timing only. Every progress publication comes from the live paired session. */
export function useReplayPlayback(supplied: ReplayScenario, options: ReplayPlaybackOptions = {}) {
    const [settings] = useState(() => {
        const configured = { autoPlay: options.autoPlay ?? false, tickMs: options.tickMs ?? 1000,
            routedDwellMs: options.routedDwellMs ?? 650, initialSpeed: options.initialSpeed ?? 1 };
        if (![configured.tickMs, configured.routedDwellMs].every(value => Number.isFinite(value) && value >= 0)
            || !Number.isFinite(configured.initialSpeed) || configured.initialSpeed <= 0)
            throw new RangeError('Playback needs finite nonnegative delays and a positive initial speed.');
        return configured;
    });
    const [initialSession] = useState(() => options.session ?? createPairedReplaySession(supplied));
    const [initialProgress] = useState(() => initialSession.read());
    const original = initialProgress.scenario;
    const session = useRef(initialSession);
    const [progress, setProgress] = useState<ReplayProgress>(() => structuredClone(initialProgress));
    const [publications, setPublications] = useState(() => latestPublication(initialProgress));
    const [playing, setPlaying] = useState(settings.autoPlay && !initialProgress.done);
    const [busy, setBusy] = useState(false);
    const [speed, setSpeed] = useState(settings.initialSpeed);
    const [response, setResponse] = useState<ControlsResponse>();
    const [completed, setCompleted] = useState<PairedReplay | undefined>(() => initialProgress.done ? initialSession.result() : undefined);
    const [eventId, setEventId] = useState('solar-drop-A');
    const busyNow = useRef(false);
    const playingNow = useRef(settings.autoPlay && !initialProgress.done);
    const speedNow = useRef(speed);
    const mounted = useRef(false);
    const generation = useRef(0);
    const scheduledTick = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const activeStep = useRef<ActiveStep | undefined>(undefined);

    const clearScheduledTick = useCallback(() => {
        if (scheduledTick.current) clearTimeout(scheduledTick.current);
        scheduledTick.current = undefined;
    }, []);

    const stopScheduling = useCallback(() => {
        playingNow.current = false;
        clearScheduledTick();
    }, [clearScheduledTick]);

    const pause = useCallback(async () => {
        stopScheduling();
        const token = generation.current;
        const current = activeStep.current;
        cancelPresentation(current);
        // An accepted canonical step settles once before Pause is acknowledged.
        await current?.completion;
        if (mounted.current && generation.current === token && !playingNow.current) setPlaying(false);
    }, [stopScheduling]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            generation.current++;
            clearScheduledTick();
            cancelPresentation(activeStep.current);
            activeStep.current?.abortRestore?.();
        };
    }, [clearScheduledTick]);

    const advance = useCallback((): Promise<void> => {
        if (!mounted.current || busyNow.current || session.current.read().done) return Promise.resolve();
        const token = generation.current;
        const currentSession = session.current;
        const current: ActiveStep = { completion: Promise.resolve(), presentationCancelled: false };
        activeStep.current = current;
        busyNow.current = true;
        setBusy(true);
        current.completion = (async () => {
            try {
                const settled = await currentSession.step(async routed => {
                    if (!mounted.current || generation.current !== token) return;
                    setProgress(routed);
                    const decisionHour = routed.selected.decisions.at(-1)?.hour;
                    if (decisionHour !== undefined) setPublications(previous => new Map(previous).set(decisionHour, routed.map));
                    await holdPresentation(current, settings.routedDwellMs / speedNow.current);
                });
                if (!mounted.current || generation.current !== token) return;
                setProgress(settled);
                const failures = replayFailures(settled);
                const continuing = (['baseline', 'selected'] as const).filter(arm => !settled.armDone[arm])
                    .map(arm => arm === 'baseline' ? 'Home FIFO' : 'Coordinated');
                setResponse(failures.length
                    ? { kind: 'error', message: failures.map(failure => `${failure.label} stopped: ${failure.explanation}`).join(' ')
                        + (settled.done ? ' Replay stopped; partial evidence retained.' : ` ${continuing.join(' and ')} continues; partial receipts retained.`) }
                    : { kind: 'success', message: `Replay settled hour ${settled.hour} of ${settled.totalHours}.` });
                if (settled.done) {
                    setCompleted(currentSession.result());
                    stopScheduling();
                    setPlaying(false);
                }
            } catch (error) {
                if (mounted.current && generation.current === token) {
                    stopScheduling();
                    setPlaying(false);
                    setResponse({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
                }
            } finally {
                if (mounted.current && generation.current === token) {
                    busyNow.current = false;
                    activeStep.current = undefined;
                    setBusy(false);
                }
            }
        })();
        return current.completion;
    }, [settings.routedDwellMs, stopScheduling]);

    useEffect(() => {
        if (playing && playingNow.current && !busy && !progress.done) {
            scheduledTick.current = setTimeout(() => {
                scheduledTick.current = undefined;
                if (playingNow.current) void advance();
            }, settings.tickMs / speed);
        }
        return clearScheduledTick;
    }, [playing, busy, progress.done, speed, advance, settings.tickMs, clearScheduledTick]);

    const read = useCallback((): ReplayProgress => session.current.read(), []);

    function publishReset(restored: ReplaySession): void {
        session.current = restored;
        const starting = restored.read();
        setProgress(starting);
        setPublications(latestPublication(starting));
        setCompleted(starting.done ? restored.result() : undefined);
        setEventId('solar-drop-A');
        setResponse({ kind: 'info', message: initialProgress.hour === 0
            ? 'Reset to the original captured inputs; progress and added events cleared.'
            : `Reset to captured hour ${initialProgress.hour}; subsequent progress and added events cleared.` });
    }

    function reset(): void | Promise<void> {
        stopScheduling();
        const token = ++generation.current;
        cancelPresentation(activeStep.current);
        activeStep.current?.abortRestore?.();
        activeStep.current = undefined;
        setPlaying(false);
        if (initialProgress.hour === 0 && initialProgress.phase === 'ready') {
            busyNow.current = false;
            setBusy(false);
            publishReset(createPairedReplaySession(original));
            return;
        }

        const abort = new AbortController();
        const current: ActiveStep = { completion: Promise.resolve(), presentationCancelled: true,
            abortRestore: () => abort.abort() };
        activeStep.current = current;
        busyNow.current = true;
        setBusy(true);
        current.completion = (async () => {
            try {
                const { map: _, ...captured } = initialProgress;
                const restored = await restoreReplayProgress(captured, abort.signal);
                if (mounted.current && generation.current === token) publishReset(restored);
            } catch (error) {
                if (mounted.current && generation.current === token) {
                    setResponse({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
                    throw error;
                }
            } finally {
                if (mounted.current && generation.current === token) {
                    busyNow.current = false;
                    activeStep.current = undefined;
                    setBusy(false);
                }
            }
        })();
        return current.completion;
    }

    const actions: PlaybackActions = {
        play() {
            if (activeStep.current?.abortRestore || session.current.read().done) return;
            playingNow.current = true;
            setPlaying(true);
            setResponse({ kind: 'info', message: 'Playback started. Each step advances the active simulation arms.' });
        },
        pause,
        step: advance,
        reset,
        setSpeed(value) {
            if (!Number.isFinite(value) || value <= 0) throw new RangeError('Playback speed must be finite and positive.');
            speedNow.current = value;
            setSpeed(value);
        },
        selectEvent: setEventId,
        applyEvent(input) {
            if (activeStep.current?.abortRestore) throw new Error('Wait for the captured moment to finish restoring before adding an event.');
            session.current.schedule(input);
            setProgress(session.current.read());
            setResponse({ kind: 'info', message: `Scheduled solar drop at Site A for hour ${input.atHour}; forecasts are unchanged.` });
        },
    };

    return { progress, publications, playing, busy, speed, response, completed, eventId, actions, read };
}
