# Site capacity and posted prices

Pricing consumes a supplied energy assessment. It does not choose dispatch or
reserve capacity. TypeScript checks numeric validity, freshness, version identity
and missing evidence before calling these formulas.

Power is kW, energy is kWh, work is GPU-hours, and duration is hours. Source prices
are USD/MWh, intensity is grams CO2/kWh, and the carbon price is USD/tonne CO2.
Supply energy includes the ledger's attributed storage/conversion losses.

Regenerate from the repository root:

```sh
node examples/math-formula-proof/generate.mjs src/core/scheduling/math/postSitePrice.math.md
```

## quantitiesMatch

The relative tolerance is eight IEEE-754 binary64 epsilons. The caller rejects
nonfinite values before comparing; an overflowed energy sum never matches.
Since $8\epsilon=2^{-49}$, use one scale factor to prevent reassociation into
`8 * magnitude * epsilon`, whose first product can overflow.

$$
|\mathrm{actual}-\mathrm{expected}|\le
2^{-49}\max(|\mathrm{actual}|,|\mathrm{expected}|)
$$

## wholeGpus

Round a ratio very close to a whole GPU; otherwise round down. Inputs are
nonnegative, so `Round` has JavaScript's halfway behavior for these quantities.

```json
{"result":"real"}
```

$$
\begin{cases}
\operatorname{Round}\left(\frac{\mathrm{availablePowerKW}}{\mathrm{activePowerKWPerGpu}}\right)
& \operatorname{quantitiesMatch}\left(
\frac{\mathrm{availablePowerKW}}{\mathrm{activePowerKWPerGpu}},
\operatorname{Round}\left(\frac{\mathrm{availablePowerKW}}{\mathrm{activePowerKWPerGpu}}\right)\right) \\
\left\lfloor\frac{\mathrm{availablePowerKW}}{\mathrm{activePowerKWPerGpu}}\right\rfloor
& \text{otherwise}
\end{cases}
$$

## slotDuration

Start/end inputs are parsed epoch milliseconds. TypeScript requires a positive
window before converting it.

```json
{"result":"real"}
```

$$
\frac{\mathrm{endMilliseconds}-\mathrm{startMilliseconds}}{3600000}
$$

## concurrentGpus

Count concurrent GPUs from the remaining cap and active power. Same-document
function arguments are alphabetical: active power per GPU, then available power.

```json
{"result":"real"}
```

$$
\min\left(\mathrm{capGpus}-\mathrm{usedGpus},
\operatorname{wholeGpus}(\mathrm{activePowerKWPerGpu},\mathrm{availablePowerKW})\right)
$$

## availableWork

Energy limits work, not the active power of a GPU. A one-hour slot with 1 kW and
0.25 kWh can supply 0.25 GPU-hours at full 1 kW.

```json
{"result":"real"}
```

$$
\min\left(\mathrm{remainingGpus}\,\mathrm{durationHours},
\frac{\mathrm{availableEnergyKWh}}{\mathrm{kWhPerGpuHour}}\right)
$$

## usage

Return required energy (kWh), then required active power (kW).

```json
{"result":"tuple<real, real>"}
```

$$
\left(\mathrm{remainingGpuHours}\,\mathrm{kWhPerGpuHour},
\mathrm{remainingGpus}\,\mathrm{activePowerKWPerGpu}\right)
$$

## gridLoad

Compute the demand ratio before multiplying a source's base price.

```json
{"result":"real"}
```

$$
\frac{\mathrm{demandMW}}{\mathrm{averageDemandMW}}
$$

## gridEnergyRate

This applies only to energy acquired at the slot's demand-scaled grid rate.
Stored energy retains its supplied acquisition rate. The helper boundary keeps
the ratio calculation before the multiplication, including for large inputs.

```json
{"result":"real"}
```

$$
\mathrm{usdPerMWh}\operatorname{gridLoad}(\mathrm{averageDemandMW},\mathrm{demandMW})
$$

## sourceCharges

Return electricity USD, then carbon kg. Convert each source before summing;
cost and carbon use upstream supply energy, not just delivered energy.

```json
{"result":"tuple<real, real>"}
```

$$
\left(\frac{\mathrm{supplyKWh}\,\mathrm{usdPerMWh}}{1000},
\frac{\mathrm{supplyKWh}\,\mathrm{gramsCO2PerKWh}}{1000}\right)
$$

## sourceTotal

Used independently for delivered kWh, source electricity USD and source carbon kg.
The list retains the supplied source order; empty lists sum to zero.

```json
{"inputs":{"values":"list<real>"},"result":"real"}
```

$$
\sum_{i=1}^{\operatorname{Length}(\mathrm{values})}\mathrm{values}_i
$$

## modeledCarbonCharge

```json
{"result":"real"}
```

$$
\frac{\mathrm{carbonKg}\,\mathrm{carbonPriceUsdPerTonne}}{1000}
$$

## postedUsdPerGpuHour

Spread the modeled electricity and carbon charges across all remaining work.
A single cheap solar GPU-hour cannot price a larger grid-powered quantity.

```json
{"result":"real"}
```

$$
\frac{\mathrm{electricityUsd}+\mathrm{carbonChargeUsd}}{\mathrm{remainingGpuHours}}
$$

## publishedLimits

Return total cap (including GPUs already used), remaining power and remaining
energy. Publishing changes no reservation.

```json
{"inputs":{"availablePowerKW":"real","requiredPowerKW":"real","availableEnergyKWh":"real","requiredKWh":"real"},"result":"tuple<real, real, real>"}
```

$$
\left(\mathrm{usedGpus}+\mathrm{remainingGpus},
\min(\mathrm{availablePowerKW},\mathrm{requiredPowerKW}),
\min(\mathrm{availableEnergyKWh},\mathrm{requiredKWh})\right)
$$
