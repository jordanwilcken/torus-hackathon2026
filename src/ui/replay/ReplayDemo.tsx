import { useEffect, useMemo, useState } from 'react';
import captured from '../../../examples/replay/job-stream.json';
import type { ReplayScenario } from '../../core/execution/replay/Replay.types';
import type { Job } from '../../core/jobs/Job.type';
import type { SlotReference } from '../../core/energy/SlotReference.type';
import { createJobReport } from '../../core/reporting/getJobReport';
import { hourStart } from '../../core/execution/simulation/workload';
import { EnergyMapView } from '../energy/EnergyMapView';
import { ChaosMonkeyControls } from '../core/controls/ChaosMonkeyControls';
import { replayFailures, useReplayPlayback, type ReplayProgress } from './useReplayPlayback';
import './ReplayDemo.css';

const exampleLocations = {
    A: { name: 'Site A · Salt Lake City reference', latitude: 40.7608, longitude: -111.8910 },
    B: { name: 'Site B · Cedar City reference', latitude: 37.6775, longitude: -113.0619 },
};
const number = (value: number | null | undefined, digits = 2) =>
    value === null || value === undefined || !Number.isFinite(value) ? 'Unavailable' : value.toFixed(digits);

function jobState(job: Job, progress: ReplayProgress): string {
    const latest = progress.selected.finalJobs.find(item => item.id === job.id) ?? job;
    if (latest.state === 'done') return 'Done';
    if (latest.state === 'missed') return 'Missed';
    if (progress.selected.run.ticks.some(tick => !tick.feasible)) return 'Stopped';
    if (!progress.selected.log.some(entry => entry.type === 'arrival' && entry.jobId === job.id)) return 'Upcoming';
    if (progress.phase === 'routed' && progress.selected.decisions.at(-1)?.results.some(result => result.jobId === job.id && result.accepted)) return 'Running';
    return 'Waiting';
}

/** Production replay composition: live engine publications, existing map and controls. */
export function ReplayDemo() {
    const playback = useReplayPlayback(captured as ReplayScenario);
    const { progress, completed, actions } = playback;
    const [activeJobId, setActiveJobId] = useState(progress.scenario.jobs[0].id);
    const [inspectedSlot, setInspectedSlot] = useState<SlotReference>();
    const [inspectedDecisionHour, setInspectedDecisionHour] = useState<number>();
    const originalJob = progress.scenario.jobs.find(job => job.id === activeJobId) ?? progress.scenario.jobs[0];
    const activeJob = progress.selected.finalJobs.find(job => job.id === originalJob.id) ?? originalJob;
    const history = progress.selected.decisions.flatMap(decision => decision.results
        .filter(result => result.jobId === activeJob.id).map(result => ({ hour: decision.hour, ...result })));
    const latest = history.at(-1);
    const report = createJobReport({ jobId: activeJob.id, submittedJob: originalJob, routingOutcome: latest?.selection },
        { fake: false, label: 'Live modeled home-site execution; fleet comparison reported separately.' });
    const activity = {
        meters: progress.selected.run.ticks.flatMap(tick => tick.meters),
        executions: progress.selected.run.ticks.flatMap(tick => tick.executions),
        transfers: [...progress.selected.run.transfers],
    };
    const receipts = activity.executions.filter(receipt => receipt.jobId === activeJob.id);
    const mapActivity = { ...activity, executions: activity.executions.filter(receipt => receipt.completedGpuH > 0) };
    const failures = replayFailures(progress);
    const stoppedEarly = progress.done && (progress.hour < progress.totalHours || failures.length > 0);
    const continuing = (['baseline', 'selected'] as const).filter(arm => !progress.armDone[arm])
        .map(arm => arm === 'baseline' ? 'Home FIFO' : 'Coordinated');
    const decisionMap = inspectedDecisionHour === undefined ? progress.map
        : playback.publications.get(inspectedDecisionHour) ?? progress.map;
    const displayMap = useMemo(() => ({ ...decisionMap, sites: new Map([...decisionMap.sites].map(([id, site]) =>
        [id, { ...site, ...exampleLocations[id as keyof typeof exampleLocations] }])) }), [decisionMap]);

    useEffect(() => {
        if (progress.phase === 'ready') {
            setActiveJobId(progress.scenario.jobs[0].id);
            setInspectedSlot(undefined);
            setInspectedDecisionHour(undefined);
        }
        if (progress.phase !== 'routed') return;
        const results = progress.selected.decisions.at(-1)?.results;
        const current = results?.findLast(result => result.accepted) ?? results?.at(-1);
        if (current) {
            setActiveJobId(current.jobId);
            setInspectedSlot(current.selection.selected ? current.selection.allocation.slot
                : progress.map.sites.get(progress.scenario.jobs.find(job => job.id === current.jobId)!.homeLocation)?.slots[0]?.reference);
            setInspectedDecisionHour(undefined);
        }
    }, [progress.phase, progress.hour, progress.selected.decisions]);

    function download(): void {
        if (!completed) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(completed, null, 2) + '\n'], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${completed.scenario.id}-evidence.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    const controls = <ChaosMonkeyControls actions={actions} state={{
        hour: progress.hour, totalHours: progress.totalHours,
        currentTime: hourStart(progress.scenario.startAt, progress.hour),
        mode: progress.done ? 'complete' : playback.playing ? 'playing' : 'paused',
        busy: playback.busy, speed: playback.speed, speedOptions: [1, 2, 4], response: playback.response,
        condition: failures.length
            ? { kind: 'infeasible', message: failures.map(failure => `${failure.label} stopped: ${failure.explanation}`).join(' ')
                + (progress.done ? ' Partial receipts retained.' : ` ${continuing.join(' and ')} continues.`) }
            : stoppedEarly ? { kind: 'degraded', message: 'Replay ended before the requested reporting horizon.' }
                : { kind: 'healthy', message: 'Captured synthetic inputs. Home-site time shifting; no automatic migration.' },
    }} scenario={{ selectedEventId: playback.eventId, events: [{
        id: 'solar-drop-A', label: 'Solar drop at Site A',
        description: 'Remove realized solar for the next hour in each active run; keep its forecast unchanged.',
        input: { atHour: progress.hour, kind: 'solar-drop', payload: { locationId: 'A' } },
    }] }} />;

    return <div className="replay-demo" role="region" aria-label="Paired replay">
        <section className="replay-intro">
            <div><p className="eyebrow">CAPTURED JOB STREAM</p><h2>Home-site time shifting</h2>
                <p>Real simulator execution from declared synthetic energy and jobs. All work and energy values are modeled.</p></div>
            <div className="replay-progress"><span>Replay progress</span><output aria-label="Replay hour">{progress.hour} / {progress.totalHours}</output>
                <small aria-label="Arm progress">Home FIFO {progress.armHours.baseline} / {progress.totalHours} · Coordinated {progress.armHours.selected} / {progress.totalHours}</small>
                <small>{progress.phase === 'routed' ? 'Allocations accepted; dispatch is running' : stoppedEarly ? 'Replay stopped; partial evidence retained' : progress.done ? 'Both runs complete' : failures.length ? `${continuing.join(' and ')} continues; partial evidence retained` : 'Ready for the next hour'}</small></div>
        </section>
        <section className="replay-job-stream" aria-label="Job stream">
            {progress.scenario.jobs.map(job => <button key={job.id} type="button" aria-label={`Inspect job ${job.id}`}
                aria-pressed={activeJobId === job.id} data-job-state={jobState(job, progress)} onClick={() => {
                    const decision = progress.selected.decisions.findLast(item => item.results.some(result => result.jobId === job.id));
                    const outcome = decision?.results.find(result => result.jobId === job.id)?.selection;
                    const publication = decision ? playback.publications.get(decision.hour) ?? progress.map : progress.map;
                    setActiveJobId(job.id);
                    setInspectedSlot(outcome?.selected ? outcome.allocation.slot : publication.sites.get(job.homeLocation)?.slots[0]?.reference);
                    setInspectedDecisionHour(decision?.hour);
                }}><strong>{job.id}</strong><span>{jobState(job, progress)}</span><small>Home {job.homeLocation} · arrives {job.readyAt.slice(11, 16)} UTC</small></button>)}
        </section>
        <p className="replay-geography">Map locations A/B are display-only city references, not observed Torus site locations.
            {' '}Decision offers published at {decisionMap.asOf}; these precede reservation and dispatch.
            {inspectedDecisionHour !== undefined && ` Inspecting retained hour ${inspectedDecisionHour} for ${activeJob.id}.`}</p>
        <EnergyMapView map={displayMap} jobFlow={{ job: activeJob, report, routeAttempt: history.length }}
            inspection={{ inspectedSlot, focusSlot: latest?.selection.selected ? latest.selection.allocation.slot : undefined,
                onInspect: setInspectedSlot }} activity={mapActivity} controls={controls} />
        <section className="replay-job-detail" role="region" aria-label="Job details" data-active-job-id={activeJob.id}>
            <div><p className="eyebrow">INSPECTED JOB</p><h2>{activeJob.id}</h2>
                <p>{jobState(originalJob, progress)} · {number(activeJob.remainingGpuH)} GPU-hours remaining · home {originalJob.homeLocation}</p></div>
            <div className="table-scroll"><table aria-label="Job decision history">
                <thead><tr><th>Hour</th><th>Decision</th><th>Accepted</th></tr></thead>
                <tbody>{history.map(item => <tr key={item.hour}><td>{item.hour}</td><td>{item.selection.explanation}</td><td>{item.accepted ? 'Yes' : 'No'}</td></tr>)}</tbody>
            </table></div>
            {history.length === 0 && <p>No routing decision yet.</p>}
            <h3>Modeled work receipts</h3>
            <p>These rows come from executor ticks, after allocation acceptance.</p>
            <div className="table-scroll"><table aria-label="Modeled work receipts">
                <thead><tr><th>Interval UTC</th><th>Site</th><th>Completed GPU-hours</th><th>Compute kWh</th><th>State</th></tr></thead>
                <tbody>{receipts.map(receipt => <tr key={receipt.window.startAt}>
                    <td>{receipt.window.startAt.slice(11, 16)}–{receipt.window.endAt.slice(11, 16)}</td><td>{receipt.locationId}</td>
                    <td data-value={receipt.completedGpuH}>{number(receipt.completedGpuH)}</td><td>{number(receipt.computeKWh)}</td><td>{receipt.state}</td>
                </tr>)}</tbody>
            </table></div>
            {receipts.length === 0 && <p>No modeled work has completed for this job.</p>}
        </section>
        <section className="replay-fleet" role="region" aria-label="Fleet comparison" data-comparison={completed?.comparison.comparison ?? 'pending'}>
            <div className="replay-fleet-heading"><div><p className="eyebrow">COUNTED ONCE ACROSS THE FLEET</p><h2>Paired comparison</h2></div>
                <button type="button" disabled={!completed} onClick={download}>Download evidence JSON</button></div>
            {!completed ? <p>Fleet comparison available after both runs finish.</p> : <>
                <p>{completed.comparison.comparison === 'comparable' ? 'Comparable modeled runs' : 'Comparison unavailable'} · same captured jobs, assets, hard limits and dispatch policy.</p>
                <div className="table-scroll"><table aria-label="Modeled fleet totals">
                    <thead><tr><th>Quantity</th><th>Home FIFO</th><th>Coordinated</th></tr></thead>
                    <tbody><tr><th>Carbon (kg)</th><td data-value={completed.baseline.impact.carbonKg}>{number(completed.baseline.impact.carbonKg)}</td><td data-value={completed.selected.impact.carbonKg}>{number(completed.selected.impact.carbonKg)}</td></tr>
                        <tr><th>Modeled cost (USD)</th><td data-value={completed.baseline.impact.modeledCostUsd}>{number(completed.baseline.impact.modeledCostUsd, 3)}</td><td data-value={completed.selected.impact.modeledCostUsd}>{number(completed.selected.impact.modeledCostUsd, 3)}</td></tr>
                        <tr><th>Electricity (USD)</th><td data-value={completed.baseline.impact.electricityUsd}>{number(completed.baseline.impact.electricityUsd, 3)}</td><td data-value={completed.selected.impact.electricityUsd}>{number(completed.selected.impact.electricityUsd, 3)}</td></tr></tbody>
                </table></div>
                <p>Carbon reduction: {number(completed.reductions.carbonKg)} kg · Modeled cost reduction: {completed.reductions.modeledCostUsd === null ? 'Unavailable' : '$' + number(completed.reductions.modeledCostUsd, 3)}</p>
                {completed.comparison.carbon.unavailableReason && <p>{completed.comparison.carbon.unavailableReason}</p>}
                {completed.comparison.cost.unavailableReason && completed.comparison.cost.unavailableReason !== completed.comparison.carbon.unavailableReason && <p>{completed.comparison.cost.unavailableReason}</p>}
                <p>Raw receipts include idle sites and storage inventory. Selection alone earns no savings.</p>
            </>}
        </section>
    </div>;
}
