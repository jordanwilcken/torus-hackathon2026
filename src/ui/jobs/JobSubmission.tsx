import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react';
import type { Job } from '../../core/jobs/Job.type';
import './JobSubmission.css';

export type JobLocation = { id: string; name: string; detail?: string };
export type JobSubmissionProps = {
  initialJob: Job;
  locations: readonly JobLocation[];
  onSubmit: (job: Job) => void | Promise<unknown>;
  className?: string;
};
export type JobDetailEvidence = {
  slackHours?: number;
  projectedFinishAt?: string;
  carbonKg?: number;
  decisions?: readonly { at: string; reason: string }[];
};

type JobLauncherProps = {
  onClick: () => void;
  expanded: boolean;
  controls: string;
  ref?: Ref<HTMLButtonElement>;
};

export function JobLauncher({ onClick, expanded, controls, ref }: JobLauncherProps) {
  return <button ref={ref} type="button" className="job-launcher" aria-label="Build job"
    aria-haspopup="dialog" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" strokeLinejoin="round" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5" />
      <path d="M19 2v6M16 5h6" strokeWidth="2" strokeLinecap="round" />
    </svg>
    <span className="job-launcher-tooltip">Build job</span>
  </button>;
}

/** The caller supplies a fresh job ID and the simulation's profile, origin and clock. */
export function JobSubmission({ initialJob, locations, onSubmit, className = '' }: JobSubmissionProps) {
  const id = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const workload = useRef<HTMLInputElement>(null);
  const sending = useRef(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const origin = locations.find(location => location.id === initialJob.currentLocation);

  useEffect(() => { if (open) workload.current?.focus({ preventScroll: true }); }, [open]);

  function close() {
    if (sending.current) return;
    setOpen(false);
    launcher.current?.focus({ preventScroll: true });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const form = event.currentTarget;
    setError('');
    if (!form.checkValidity()) {
      setError('Check the highlighted fields.');
      const invalid = form.querySelector<HTMLInputElement>('input:invalid');
      const section = invalid?.closest('details');
      if (section) section.open = true;
      invalid?.focus();
      return;
    }
    const values = new FormData(form);
    const workloadRef = String(values.get('workload')).trim();
    const workGpuH = Number(values.get('work'));
    const maxGpus = Number(values.get('gpus'));
    const dataGB = Number(values.get('data'));
    const allowedLocations = values.getAll('locations').map(String);
    const deadline = Date.parse(String(values.get('deadline')) + 'Z');
    const readyAt = Math.max(Date.parse(initialJob.readyAt), Date.parse(initialJob.window.startAt));
    if (!workloadRef || workGpuH <= 0) {
      setError('Enter a workload and more than zero GPU-hours of work.');
      return;
    }
    if (!(deadline > readyAt)) {
      setError('Choose a deadline after this job is ready to start.');
      return;
    }
    if (!allowedLocations.length) {
      setError('Choose at least one site where this job may run.');
      return;
    }
    const job: Job = {
      ...initialJob, workloadRef, workGpuH, remainingGpuH: workGpuH, maxGpus, dataGB,
      allowedLocations, window: { ...initialJob.window, endAt: new Date(deadline).toISOString() },
      state: 'queued', transferToLocation: undefined,
    };
    sending.current = true;
    setPending(true);
    try {
      await onSubmit(job);
      setNotice('Job submitted.');
      setOpen(false);
      launcher.current?.focus({ preventScroll: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not submit this job. Try again.');
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  return <div className={'job-submission ' + className}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && open) close(); }}>
    <JobLauncher ref={launcher} expanded={open} controls={id} onClick={() => {
      if (open) close();
      else { setError(''); setNotice(''); setOpen(true); }
    }} />
    {open && <section id={id} className="job-editor" role="dialog" aria-labelledby={id + '-title'} aria-busy={pending}>
      <header className="job-editor-heading">
        <div><p className="job-kicker">COMPUTE / NEW WORKLOAD</p><h2 id={id + '-title'}>Build job<span aria-hidden="true">.</span></h2></div>
        <button type="button" className="job-close" aria-label="Close job editor" onClick={close} disabled={pending}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </header>
      <div className="job-origin"><span className="job-origin-marker" /><span>From <strong>{origin?.name ?? initialJob.currentLocation}</strong></span>
        <span className="job-origin-time">{new Date(initialJob.readyAt).toISOString().slice(11, 16)} UTC</span></div>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={pending} className="job-fields">
          <label className="job-field">Workload<input ref={workload} name="workload" required maxLength={120}
            autoComplete="off" defaultValue={initialJob.workloadRef} placeholder="Training batch" /></label>
          <div className="job-quantity-fields">
            <label className="job-field">Work (GPU-hours)<input name="work" type="number" min="0" step="any" required defaultValue={initialJob.workGpuH} /></label>
            <label className="job-field">GPU limit<input name="gpus" type="number" min="1" step="1" required defaultValue={initialJob.maxGpus} /></label>
          </div>
          <label className="job-field">Deadline (UTC)<input name="deadline" type="datetime-local" required step="60"
            defaultValue={new Date(initialJob.window.endAt).toISOString().slice(0, 16)} /></label>
          <fieldset className="job-locations"><legend>Where it may run</legend>
            <div className="job-location-grid">{locations.map(location => <label className="job-location" key={location.id}>
              <input name="locations" type="checkbox" value={location.id} defaultChecked={initialJob.allowedLocations.includes(location.id)} />
              <span className="job-location-check" aria-hidden="true"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m2.5 6 2.2 2.2L9.5 3.5" /></svg></span>
              <span><strong>{location.name}</strong>{location.detail && <small>{location.detail}</small>}</span>
            </label>)}</div>
          </fieldset>
          <details className="job-data"><summary>Data & context<span>{initialJob.dataGB} GB</span></summary>
            <label className="job-field">Data (GB)<input name="data" type="number" min="0" step="any" required defaultValue={initialJob.dataGB} /></label>
            <p>{initialJob.computeProfile} · {initialJob.id}</p>
          </details>
        </fieldset>
        {error && <p className="job-error" role="alert">{error}</p>}
        <footer className="job-editor-footer">
          <button className="job-send" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send to scheduler'}
            <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 9h11M10 4l5 5-5 5" /></svg>
          </button>
        </footer>
      </form>
    </section>}
    <span className="job-announcement" role="status">{notice}</span>
  </div>;
}

type JobDetailsProps = { job: Job; details?: JobDetailEvidence };
const formatTime = (value: string) => new Intl.DateTimeFormat('en', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
}).format(new Date(value)) + ' UTC';

export function JobDetails({ job, details }: JobDetailsProps) {
  const completed = Math.max(0, job.workGpuH - job.remainingGpuH);
  return <article className="job-detail" aria-label="Job details">
    <header><div><p className="job-kicker">WORKLOAD</p><h3>{job.workloadRef}</h3><small>{job.id}</small></div>
      <span className="job-state" data-state={job.state}>{job.state}</span></header>
    <div className="job-work"><span>{completed.toLocaleString()} <small>/ {job.workGpuH.toLocaleString()} GPU-hours</small></span>
      <progress aria-label="Completed work" value={completed} max={job.workGpuH} /></div>
    {job.state === 'moving' && job.transferToLocation && <p className="job-destination">Moving to {job.transferToLocation}</p>}
    <dl className="job-detail-metrics">
      <div><dt>Deadline</dt><dd>{formatTime(job.window.endAt)}</dd></div>
      <div><dt>Projected finish</dt><dd>{details?.projectedFinishAt ? formatTime(details.projectedFinishAt) : 'Unavailable'}</dd></div>
      <div><dt>Slack</dt><dd>{details?.slackHours === undefined ? 'Unavailable' : details.slackHours.toLocaleString() + ' h'}</dd></div>
      <div><dt>Carbon used</dt><dd>{details?.carbonKg === undefined ? 'Unavailable' : details.carbonKg.toLocaleString() + ' kg'}</dd></div>
    </dl>
    <details className="job-history"><summary>Decision history<span>{details?.decisions?.length ?? 0}</span></summary>
      {details?.decisions?.length ? <ol>{details.decisions.map((decision, index) => <li key={index}>
        <time dateTime={decision.at}>{formatTime(decision.at)}</time><span>{decision.reason}</span>
      </li>)}</ol> : <p>No decisions supplied yet.</p>}
    </details>
  </article>;
}
