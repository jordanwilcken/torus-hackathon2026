# Checkpoint transfer and destination-capacity math

Transfers preserve remaining GPU-hours and perform no work in transit. Bandwidth
uses GB/hour, transfer energy uses kWh/GB, and job transfer charges use USD/GB.
Unknown accounting rates remain unknown in the caller; zero transfer energy
contributes known zero even without a rate. The finite-result and deadline checks
remain at the transfer boundary.

A 10 GB transfer at 20 GB/hour takes half an hour and rounds upward to the next
canonical tick. At 0.02 kWh/GB it consumes 0.2 kWh. With 400 g/kWh and USD 50/MWh,
that is 0.08 kg and USD 0.01; a USD 0.03/GB job charge is USD 0.30. A zero-data
transfer can arrive immediately. Destination capacity is a necessary forecast
check, never a future reservation or permission to resume without a fresh quote.

## transferHours

Divide data by bandwidth before converting the result to milliseconds.

```json
{"inputs":{"dataGB":"real","bandwidthGBPerHour":"real"},"result":"real"}
```

$$
\frac{\mathrm{dataGB}}{\mathrm{bandwidthGBPerHour}}
$$

## gridReadyTime

Round physical arrival upward to the shared tick grid. Compute arrival as start plus transfer duration before calling this equation.

```json
{"inputs":{"origin":"real","arrival":"real","tickMs":"real"},"result":"real"}
```

$$
\mathrm{origin}+\left\lceil\frac{\mathrm{arrival}-\mathrm{origin}}{\mathrm{tickMs}}\right\rceil\,\mathrm{tickMs}
$$

## transferEnergy

Energy spent once for the transfer.

```json
{"inputs":{"dataGB":"real","kWhPerGB":"real"},"result":"real"}
```

$$
\mathrm{dataGB}\,\mathrm{kWhPerGB}
$$

## transferCharge

The job transfer charge, recorded once in the stable receipt.

```json
{"inputs":{"dataGB":"real","usdPerGB":"real"},"result":"real"}
```

$$
\mathrm{dataGB}\,\mathrm{usdPerGB}
$$

## carbonKilograms

Multiply energy by the supplied carbon rate, then convert grams to kilograms, preserving the existing order and overflow behavior.

```json
{"inputs":{"energyKWh":"real","gramsPerKWh":"real"},"result":"real"}
```

$$
\frac{\mathrm{energyKWh}\,\mathrm{gramsPerKWh}}{1000}
$$

## electricityDollars

Multiply energy by the supplied electricity rate before dividing by 1000, preserving existing evaluation order.

```json
{"inputs":{"energyKWh":"real","usdPerMWh":"real"},"result":"real"}
```

$$
\frac{\mathrm{energyKWh}\,\mathrm{usdPerMWh}}{1000}
$$

## activeHours

Overlap between destination availability, arrival and deadline, in hours.

```json
{"inputs":{"deadline":"real","slotEnd":"real","readyAt":"real","slotStart":"real"},"result":"real"}
```

$$
\frac{\max(0,\min(\mathrm{deadline},\mathrm{slotEnd})-\max(\mathrm{readyAt},\mathrm{slotStart}))}{3600000}
$$

## powerSupportedGpus

Unrounded GPU count supported by the destination power.

```json
{"inputs":{"availablePowerKW":"real","kWhPerGpuHour":"real"},"result":"real"}
```

$$
\frac{\mathrm{availablePowerKW}}{\mathrm{kWhPerGpuHour}}
$$

## wholePowerGpus

Snap a nonnegative power-derived GPU count to its nearest integer only within the same eight-epsilon bound documented in time.math.md, then floor. This retains all three GPUs when 3 × 0.7 kW rounds slightly below the exact boundary.

```json
{"inputs":{"powerGpus":"real"},"result":"real"}
```

$$
\left\lfloor\begin{cases}
\operatorname{round}(\mathrm{powerGpus}) & |\mathrm{powerGpus}-\operatorname{round}(\mathrm{powerGpus})|\le 2^{-49}\max(1,|\mathrm{powerGpus}|,|\operatorname{round}(\mathrm{powerGpus})|) \\
\mathrm{powerGpus} & \text{otherwise}
\end{cases}\right\rfloor
$$

## destinationGpus

Bound whole GPUs by the job limit, unreserved capacity and power.

```json
{"inputs":{"maxGpus":"real","unreservedGpus":"real","powerGpus":"real"},"result":"real"}
```

$$
\min(\mathrm{maxGpus},\mathrm{unreservedGpus},\mathrm{powerGpus})
$$

## slotWork

Remaining destination work capacity, also bounded by available energy.

```json
{"inputs":{"gpus":"real","activeHours":"real","availableEnergyKWh":"real","kWhPerGpuHour":"real"},"result":"real"}
```

$$
\min\left(\mathrm{gpus}\,\mathrm{activeHours},\frac{\mathrm{availableEnergyKWh}}{\mathrm{kWhPerGpuHour}}\right)
$$

## accumulatedWork

Accumulate candidate slots in their existing iteration order.

```json
{"inputs":{"previousGpuH":"real","slotGpuH":"real"},"result":"real"}
```

$$
\mathrm{previousGpuH}+\mathrm{slotGpuH}
$$
