import { useCallback, useEffect, useRef, useState } from 'react';
import { createPairedReplaySession } from '../../core/execution/replay/createPairedReplaySession';
import type { PairedReplay, ReplayScenario } from '../../core/execution/replay/Replay.types';
import type { PlaybackActions, ControlsResponse } from '../core/controls/PlaybackControls.types';

export type ReplayProgress = ReturnType<ReturnType<typeof createPairedReplaySession>['read']>;

export function replayFailures(progress: ReplayProgress) {
    return (['baseline', 'selected'] as const).flatMap(arm => {
        const failure = progress[arm].run.ticks.find(tick => !tick.feasible);
        return failure ? [{ arm, label: arm === 'baseline' ? 'Home FIFO' : 'Coordinated',
            explanation: failure.explanation ?? 'Site dispatch is infeasible.' }] : [];
    });
}

/** Owns playback timing only. Every progress publication comes from the live paired session. */
export function useReplayPlayback(supplied: ReplayScenario) {
    const [original] = useState(() => structuredClone(supplied));
    const [initialSession] = useState(() => createPairedReplaySession(original));
    const session = useRef(initialSession);
    const [progress, setProgress] = useState<ReplayProgress>(() => initialSession.read());
    const [publications, setPublications] = useState(() => new Map<number, ReplayProgress['map']>());
    const [playing, setPlaying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [response, setResponse] = useState<ControlsResponse>();
    const [completed, setCompleted] = useState<PairedReplay>();
    const [eventId, setEventId] = useState('solar-drop-A');
    const busyNow = useRef(false);
    const playingNow = useRef(false);
    const speedNow = useRef(speed);
    const mounted = useRef(false);
    const generation = useRef(0);
    const scheduledTick = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const finishDwell = useRef<(() => void) | undefined>(undefined);

    const pause = useCallback(() => {
        playingNow.current = false;
        setPlaying(false);
        if (scheduledTick.current) clearTimeout(scheduledTick.current);
        scheduledTick.current = undefined;
        finishDwell.current?.();
    }, []);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            generation.current++;
            playingNow.current = false;
            if (scheduledTick.current) clearTimeout(scheduledTick.current);
            finishDwell.current?.();
        };
    }, []);

    const advance = useCallback(async (): Promise<void> => {
        if (busyNow.current || session.current.read().done) return;
        const token = generation.current;
        busyNow.current = true;
        setBusy(true);
        try {
            const settled = await session.current.step(async routed => {
                if (!mounted.current || generation.current !== token) return;
                setProgress(routed);
                const decisionHour = routed.selected.decisions.at(-1)?.hour;
                if (decisionHour !== undefined) setPublications(previous => new Map(previous).set(decisionHour, routed.map));
                // A short owned pause makes accepted placements visible before real dispatch settles.
                await new Promise<void>(resolve => {
                    const finish = () => {
                        clearTimeout(timer);
                        finishDwell.current = undefined;
                        resolve();
                    };
                    const timer = setTimeout(finish, 650 / speedNow.current);
                    finishDwell.current = finish;
                });
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
                setCompleted(session.current.result());
                pause();
            }
        } catch (error) {
            if (mounted.current && generation.current === token) {
                pause();
                setResponse({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
            }
        } finally {
            busyNow.current = false;
            if (mounted.current && generation.current === token) setBusy(false);
        }
    }, [pause]);

    useEffect(() => {
        if (playing && !busy && !progress.done) {
            scheduledTick.current = setTimeout(() => {
                scheduledTick.current = undefined;
                if (playingNow.current) void advance();
            }, 1000 / speed);
        }
        return () => {
            if (scheduledTick.current) clearTimeout(scheduledTick.current);
            scheduledTick.current = undefined;
        };
    }, [playing, busy, progress.done, speed, advance]);

    const actions: PlaybackActions = {
        play() {
            if (session.current.read().done) return;
            playingNow.current = true;
            setPlaying(true);
            setResponse({ kind: 'info', message: 'Playback started. Each step advances the active simulation arms.' });
        },
        pause,
        step: advance,
        reset() {
            if (busyNow.current) throw new Error('Pause and wait for the current hour to settle before resetting.');
            pause();
            generation.current++;
            session.current = createPairedReplaySession(original);
            setProgress(session.current.read());
            setPublications(new Map());
            setCompleted(undefined);
            setEventId('solar-drop-A');
            setResponse({ kind: 'info', message: 'Reset to the original captured inputs; progress and added events cleared.' });
        },
        setSpeed(value) { speedNow.current = value; setSpeed(value); },
        selectEvent: setEventId,
        applyEvent(input) {
            session.current.schedule(input);
            setProgress(session.current.read());
            setResponse({ kind: 'info', message: `Scheduled solar drop at Site A for hour ${input.atHour}; forecasts are unchanged.` });
        },
    };

    return { progress, publications, playing, busy, speed, response, completed, eventId, actions };
}
