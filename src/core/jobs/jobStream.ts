import type { Job } from './Job.type';
import type { JobOutcome } from '../scheduling/JobOutcome.type';
import type { JobObservations } from '../reporting/JobObservations.type';
import type { ReportableJob } from '../reporting/ReportableJob.interface';
import type { ImpactObservation } from '../reporting/ImpactObservation.interface';
import { reportableJob, withReporting } from '../reporting/impact/reportableJob';

type JobListener = (jobs: JobObservations[]) => void;

export class JobStream {
  private readonly observers = new Map<string, ReportableJob>();
  private readonly listeners = new Set<JobListener>();

  constructor(private readonly routeJob: (job: Job) => Promise<JobOutcome>) {}

  async submit(job: Job): Promise<JobOutcome> {
    if (this.observers.has(job.id)) throw new Error('Job already submitted: ' + job.id);
    const observer = reportableJob(job.id);
    this.observers.set(job.id, observer);
    const pending = withReporting(this.routeJob, observer)(structuredClone(job));
    this.publish();
    try {
      return await pending;
    } finally {
      this.publish();
    }
  }

  read(): JobObservations[] {
    return [...this.observers.values()].map(observer => observer.readObservations());
  }

  observe(evidence: ImpactObservation): boolean {
    const observer = this.observers.get(evidence.jobId);
    if (!observer) return false;
    observer.observe(evidence);
    this.publish();
    return true;
  }

  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener);
    this.notify(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    for (const listener of this.listeners) this.notify(listener);
  }

  private notify(listener: JobListener): void {
    try {
      listener(this.read());
    } catch (error) {
      console.error('Job stream subscriber failed', error);
    }
  }
}
