# Execution slot math

Quantities use GPU-hours, hours, kW, kWh and USD. `kWhPerGpuHour` is also the
active kW per GPU. Routing supplies valid numeric quantities and clipped slot
durations; freshness, state, location and waiting decisions stay in TypeScript.

## roundoff

The helper keeps multiplication by IEEE-754 epsilon before multiplication by
four. This function boundary prevents an overflowing reassociation at large values.

```json
{"result":"real"}
```

$$
\mathrm{value}\,2^{-52}
$$

## floorWholeUnits

```json
{"result":"real"}
```

$$
\left\lfloor\mathrm{value}+4\operatorname{roundoff}(|\mathrm{value}|)\right\rfloor
$$

## exceeds

Mathematical calls use alphabetical parameters: `exceeds(limit, value)`.
TypeScript calls use named inputs.

$$
\mathrm{value}-\mathrm{limit}>
4\operatorname{roundoff}\left(\max(|\mathrm{value}|,|\mathrm{limit}|)\right)
$$

## minimumRunHours

```json
{"result":"real"}
```

$$
\frac{\mathrm{remainingGpuH}}{\mathrm{maxGpus}}
$$

## powerLimitedGpus

```json
{"inputs":{"maxGpus":"real"},"result":"real"}
```

$$
\min\left(
\mathrm{maxGpus},
\mathrm{capGpus}-\mathrm{usedGpus},
\operatorname{floorWholeUnits}\left(\frac{\mathrm{availablePowerKW}}{\mathrm{kWhPerGpuHour}}\right),
\left\lceil\frac{\mathrm{remainingGpuH}}{\mathrm{durationHours}}\right\rceil
\right)
$$

## energyLimitedGpus

Reduce GPUs only when the actual work in this slot exceeds its energy budget.
The final fraction of a GPU-hour can consume less energy than a full slot.

```json
{"inputs":{"remainingGpuH":"real"},"result":"real"}
```

$$
\begin{cases}
\min\left(\mathrm{initialGpus},
\operatorname{floorWholeUnits}\left(\frac{\mathrm{availableEnergyKWh}}{\mathrm{durationHours}\,\mathrm{kWhPerGpuHour}}\right)\right)
& \operatorname{exceeds}\left(\mathrm{availableEnergyKWh},
\min(\mathrm{remainingGpuH},\mathrm{initialGpus}\,\mathrm{durationHours})\,\mathrm{kWhPerGpuHour}\right) \\
\mathrm{initialGpus} & \text{otherwise}
\end{cases}
$$

## slotUsage

Returns work (GPU-hours), active power (kW), and consumed energy (kWh), in that order.

```json
{"inputs":{"remainingGpuH":"real"},"result":"tuple<real, real, real>"}
```

$$
\left(
\min(\mathrm{remainingGpuH},\mathrm{allocatedGpus}\,\mathrm{durationHours}),
\mathrm{allocatedGpus}\,\mathrm{kWhPerGpuHour},
\min(\mathrm{remainingGpuH},\mathrm{allocatedGpus}\,\mathrm{durationHours})\,\mathrm{kWhPerGpuHour}
\right)
$$

## priceWithTransfer

Amortize the one-time transfer cost over all remaining work, not just this slot.

```json
{"result":"real"}
```

$$
\mathrm{postedUsdPerGpuHour}+\frac{\mathrm{transferCostUsd}}{\mathrm{remainingGpuH}}
$$
