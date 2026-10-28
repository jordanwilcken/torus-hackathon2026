# Site pricing

Pricing receives assessed GPU-hours, required energy, and the corresponding energy
mix as numbers. The caller selects current evidence, prepares the quantities and
retains slot/version/source/forecast metadata. Pricing calculates the rate only.

Energy is kWh, work is GPU-hours, source prices are USD/MWh, intensity is grams
CO2/kWh, and the carbon price is USD/tonne CO2. Supply energy includes attributed
storage/conversion losses. Inputs are finite and nonnegative; average demand is
positive. Unknown acquisition cost or carbon remains explicitly unavailable.

Regenerate from the repository root:

```sh
node examples/math-formula-proof/generate.mjs src/core/scheduling/math/postSitePrice.math.md
```

## quantitiesMatch

The full mix must supply the required energy. Eight binary64 epsilons equal
$2^{-49}$; one scale factor prevents reassociation into an overflowing
`8 * magnitude * epsilon`. The caller rejects nonfinite totals before comparison.

$$
|\mathrm{actual}-\mathrm{expected}|\le
2^{-49}\max(|\mathrm{actual}|,|\mathrm{expected}|)
$$

## gridLoad

```json
{"result":"real"}
```

$$
\frac{\mathrm{demandMW}}{\mathrm{averageDemandMW}}
$$

## gridEnergyRate

Apply only to energy acquired at this slot's demand-scaled grid rate. Stored
energy retains its supplied acquisition rate. Compute the ratio first.

```json
{"result":"real"}
```

$$
\mathrm{usdPerMWh}\operatorname{gridLoad}(\mathrm{averageDemandMW},\mathrm{demandMW})
$$

## sourceCharges

Return electricity USD, then carbon kg. Convert each source before summing, using
upstream supply energy including losses.

```json
{"result":"tuple<real, real>"}
```

$$
\left(\frac{\mathrm{supplyKWh}\,\mathrm{usdPerMWh}}{1000},
\frac{\mathrm{supplyKWh}\,\mathrm{gramsCO2PerKWh}}{1000}\right)
$$

## sourceTotal

Sum delivered kWh, source electricity USD and source carbon kg independently,
retaining the supplied source order.

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

Spread the electricity and modeled carbon charges over all assessed work. One
cheap solar GPU-hour must not price a larger grid-powered quantity.

```json
{"result":"real"}
```

$$
\frac{\mathrm{electricityUsd}+\mathrm{carbonChargeUsd}}{\mathrm{remainingGpuHours}}
$$

## gpuHoursForEnergy

The ledger assesses the whole remaining energy quantity using the site's compute
profile. Its quoted work uses that same kWh/GPU-hour profile, including a partial
final interval; active power and physical availability remain with the ledger.

```json
{"result":"real"}
```

$$
\frac{\mathrm{availableEnergyKWh}}{\mathrm{kWhPerGpuHour}}
$$
