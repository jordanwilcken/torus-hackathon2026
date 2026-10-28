# Allocation and completed-work math

Work uses GPU-hours; power uses kW; energy uses kWh; posted charges use USD.
`kWhPerGpuHour` is also the active kW per GPU. These functions calculate prepared
numeric values. Selection identity, publication evidence, admissibility,
reservations and job-state changes remain the runner's responsibility.

For the existing acceptance example, one GPU completes 0.25 GPU-hour in
900,000 ms, consumes 0.2125 kWh at 0.85 kWh/GPU-hour, and incurs a USD 0.25 posted
charge at USD 1/GPU-hour. Actual energy comes from the ledger's source usage;
the allocation's estimated energy does not replace it.

## unreservedGpus

Capacity remaining after existing reservations.

```json
{"inputs":{"capacity":"real","used":"real"},"result":"real"}
```

$$
\mathrm{capacity}-\mathrm{used}
$$

## computePower

Active power for the selected GPU count.

```json
{"inputs":{"gpus":"real","kWhPerGpuHour":"real"},"result":"real"}
```

$$
\mathrm{gpus}\,\mathrm{kWhPerGpuHour}
$$

## completedWork

Multiply GPUs by elapsed milliseconds before dividing into GPU-hours, then clamp to remaining work.

```json
{"inputs":{"remainingGpuH":"real","gpus":"real","durationMs":"real"},"result":"real"}
```

$$
\min\left(\mathrm{remainingGpuH},\frac{\mathrm{gpus}\,\mathrm{durationMs}}{3600000}\right)
$$

## workEnergy

Estimated energy for the planned amount of work.

```json
{"inputs":{"workGpuH":"real","kWhPerGpuHour":"real"},"result":"real"}
```

$$
\mathrm{workGpuH}\,\mathrm{kWhPerGpuHour}
$$

## requiredHours

Divide remaining work by GPUs before converting the result to milliseconds. A final fraction such as 1/7 GPU-hour remains subject to the existing whole-millisecond acceptance check.

```json
{"inputs":{"remainingGpuH":"real","gpus":"real"},"result":"real"}
```

$$
\frac{\mathrm{remainingGpuH}}{\mathrm{gpus}}
$$

## loadDuration

Actual load duration cannot exceed the planned interval or the validated rounded remaining duration.

```json
{"inputs":{"windowMs":"real","remainingMs":"real"},"result":"real"}
```

$$
\min(\mathrm{windowMs},\mathrm{remainingMs})
$$

## remainingWork

Subtract completed work. The runner transitions a remainder within the documented roundoff bound to exactly zero/done.

```json
{"inputs":{"remainingGpuH":"real","completedGpuH":"real"},"result":"real"}
```

$$
\mathrm{remainingGpuH}-\mathrm{completedGpuH}
$$

## directComputeEnergy

Sum actual direct source usage before adding battery usage, preserving the existing binary64 association.

```json
{"inputs":{"solarKWh":"real","gridKWh":"real"},"result":"real"}
```

$$
\mathrm{solarKWh}+\mathrm{gridKWh}
$$

## totalComputeEnergy

Add actual battery usage to the previously summed direct source usage.

```json
{"inputs":{"directKWh":"real","batteryKWh":"real"},"result":"real"}
```

$$
\mathrm{directKWh}+\mathrm{batteryKWh}
$$

## postedCharge

Charge for completed GPU-hours, including the final partial tick.

```json
{"inputs":{"completedGpuH":"real","postedUsdPerGpuHour":"real"},"result":"real"}
```

$$
\mathrm{completedGpuH}\,\mathrm{postedUsdPerGpuHour}
$$
