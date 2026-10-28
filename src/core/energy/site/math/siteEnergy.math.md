# Energy at one site

This model answers one question: **can the site supply these active loads, and
what energy remains afterward?** Planning, reservations and dispatch use the
same calculation. Planning changes a copy; only successful dispatch commits it.

The Markdown equations below generate `siteEnergy.generated.js`. The adjacent
`generate.mjs` uses Cortex Compute Engine 0.171.0 in strict mode. Each displayed
equation is an executable expression; its heading names the generated function.
JSON annotations declare real numeric inputs. Descriptive symbols include their
units so a call can be read without translating a private alphabet.

## Assumptions and measurement boundary

Supply is constant within a canonical reading interval. Split that interval at
every job start and finish, then calculate each resulting period in time order.
This preserves active power: a 2 kW job lasting 15 minutes consumes 0.5 kWh but
still needs 2 kW while running. Fixed site load continues during idle periods.

Solar supplies demand first, usable battery energy second, and grid imports
third. Surplus solar charges the battery before any remainder is curtailed.
There is no grid charging, export or simultaneous charging and discharging.
These are explicit simulation assumptions, not a model of hardware controls.

| Quantity | Meaning | Unit |
|---|---|---|
| `durationHours` | Duration of one period with unchanged active jobs | h |
| `powerKW` | Constant power during that period | kW |
| `storedKWh` | Energy inside the battery before the period | kWh |
| `protectedKWh` | Stored energy that must remain available | kWh |
| `capacityKWh` | Maximum energy stored inside the battery | kWh |
| `chargeEfficiency`, `dischargeEfficiency` | Fraction retained or delivered, in (0, 1] | dimensionless |
| `chargeLimitKWh`, `dischargeLimitKWh`, `gridLimitKWh` | Corresponding kW limit multiplied by this period's hours | kWh |
| `batteryKWh` | Energy delivered from battery to site, after discharge loss | kWh |
| `chargeKWh` | Solar energy sent into charging, before charge loss | kWh |

All public inputs must be finite and nonnegative. GPU counts are integral,
power per GPU is positive, and the input boundary checks timestamps and
efficiencies. Missing or stale supply is infeasible. A protected reserve above
current stored energy is also infeasible; future solar cannot retroactively
make that initial state valid.

## energyForPeriod

Power is a rate. Multiplying by the time it acts gives energy. For compute,
first multiply the active GPU count by kW per GPU, then use this equation.

```json
{"inputs":{"powerKW":"real","durationHours":"real"},"result":"real"}
```
$$
\mathrm{powerKW}\,\mathrm{durationHours}
$$

## totalDemand

Add fixed and compute energy **once**. Reuse this same total for the deficit,
solar attribution and surplus. Repeatedly subtracting individual jobs can
manufacture a tiny surplus through floating-point rounding.

```json
{"inputs":{"fixedKWh":"real","computeKWh":"real"},"result":"real"}
```
$$
\mathrm{fixedKWh}+\mathrm{computeKWh}
$$

## unmetDemand

Only the portion of demand not met by solar needs battery or grid energy.

```json
{"inputs":{"demandKWh":"real","solarKWh":"real"},"result":"real"}
```
$$
\max(0,\mathrm{demandKWh}-\mathrm{solarKWh})
$$

## usableStorage

The protected reserve is measured inside the battery. The remainder can be
withdrawn; multiplying it by discharge efficiency gives deliverable energy.

```json
{"inputs":{"storedKWh":"real","protectedKWh":"real"},"result":"real"}
```
$$
\max(0,\mathrm{storedKWh}-\mathrm{protectedKWh})
$$

## batteryDelivery

Battery delivery is bounded by three independent facts: remaining demand,
the discharge power limit over this period, and usable stored energy after loss.

```json
{"inputs":{"unmetKWh":"real","dischargeLimitKWh":"real","usableKWh":"real","dischargeEfficiency":"real"},"result":"real"}
```
$$
\min(\mathrm{unmetKWh},\mathrm{dischargeLimitKWh},\mathrm{usableKWh}\,\mathrm{dischargeEfficiency})
$$

## requiredGridImport

The grid must supply the remaining demand. If this exceeds the period's import
limit, the entire interval fails without changing inventory or publishing
partial meters. Accepted imports are capped at the actual limit.

```json
{"inputs":{"unmetKWh":"real","batteryKWh":"real"},"result":"real"}
```
$$
\max(0,\mathrm{unmetKWh}-\mathrm{batteryKWh})
$$

## storageWithdrawal

Delivering energy removes more from storage when discharge efficiency is below
one. Capping the withdrawal at usable energy preserves the reserve at rounding
boundaries.

```json
{"inputs":{"usableKWh":"real","batteryKWh":"real","dischargeEfficiency":"real"},"result":"real"}
```
$$
\min(\mathrm{usableKWh},\frac{\mathrm{batteryKWh}}{\mathrm{dischargeEfficiency}})
$$

## storageAfterDischarge

```json
{"inputs":{"storedKWh":"real","withdrawnKWh":"real","protectedKWh":"real"},"result":"real"}
```
$$
\max(\mathrm{protectedKWh},\mathrm{storedKWh}-\mathrm{withdrawnKWh})
$$

## surplusSolar

Use the same total demand as above. Solar cannot both serve demand and charge
storage.

```json
{"inputs":{"solarKWh":"real","demandKWh":"real"},"result":"real"}
```
$$
\max(0,\mathrm{solarKWh}-\mathrm{demandKWh})
$$

## solarCharging

Charge input is limited by available surplus, charging power and storage room.
Dividing storage room by charge efficiency converts inside-battery capacity to
the amount of solar energy that may enter the charger.

```json
{"inputs":{"surplusKWh":"real","chargeLimitKWh":"real","capacityKWh":"real","remainingKWh":"real","chargeEfficiency":"real"},"result":"real"}
```
$$
\max(0,\min(\mathrm{surplusKWh},\mathrm{chargeLimitKWh},\frac{\mathrm{capacityKWh}-\mathrm{remainingKWh}}{\mathrm{chargeEfficiency}}))
$$

## storageAfterCharge

```json
{"inputs":{"capacityKWh":"real","remainingKWh":"real","chargeKWh":"real","chargeEfficiency":"real"},"result":"real"}
```
$$
\min(\mathrm{capacityKWh},\mathrm{remainingKWh}+\mathrm{chargeKWh}\,\mathrm{chargeEfficiency})
$$

## curtailedSolar

```json
{"inputs":{"surplusKWh":"real","chargeKWh":"real"},"result":"real"}
```
$$
\max(0,\mathrm{surplusKWh}-\mathrm{chargeKWh})
$$

## Conservation and worked examples

At the site's electricity boundary,
$\text{solar}+\text{grid}+\text{battery delivered}=\text{fixed}+\text{compute}+\text{charge input}+\text{curtailed}$.
Inside storage,
$\text{ending storage}=\text{starting storage}-\text{withdrawal}+\eta_c\text{charge input}$.
Charge and discharge losses belong between these two boundaries.

For one hour with 1 kW solar, 0.5 kW fixed load and 3 kW compute, demand is
3.5 kWh. Starting with 3 kWh stored, no reserve and 75% discharge efficiency,
the battery delivers 2.25 kWh, the grid supplies 0.25 kWh, and storage ends at
zero. At the site boundary, $1+2.25+0.25=0.5+3$.

For 10 kWh surplus solar, a battery starting at 4 kWh with capacity 5 kWh and
80% charge efficiency accepts 1.25 kWh into its charger. It retains 1 kWh and
curtails 8.75 kWh, provided the charging power limit allows that input.

## Where carbon and electricity expenditure belong

Physical flow and source accounting are separate responsibilities. Fixed load
receives the first available solar/battery/grid energy; accepted reservations
follow in acceptance order, then proposed jobs. Each allocation is bounded by
the remaining physical source pool, so rounding cannot invent a grid purchase.

The battery carries its acquisition carbon (kg) and electricity expenditure
(USD). A withdrawal transfers the fraction
$f=\text{withdrawn kWh}/\text{starting stored kWh}$ of each carried amount to
consumption. Empty storage uses fraction zero. The remaining inventory retains
the rest. Charging adds the carbon and cost of the full charge input to storage,
including energy lost during charging; it does not book consumption immediately.
Subsequent discharge therefore includes both losses once.

For example, charging 4 kWh at 50 g/kWh and USD 40/MWh retains 3.2 kWh at 80%
efficiency, carrying 0.2 kg and USD 0.16. At 75% discharge efficiency it eventually
delivers 2.4 kWh and transfers that same 0.2 kg and USD 0.16 to consumption.

Rates are converted first: g/kWh to kg/kWh, and USD/MWh to USD/kWh, by dividing
by 1000. Multiplication by energy follows. Unknown carbon and unknown cost
remain independent. A zero quantity contributes known zero even if its rate is
unknown; a positive quantity with an unknown rate remains unknown.

## Numerical boundaries and regeneration

The implementation uses binary64 arithmetic. A grid-bound comparison allows
only a rounding margin of $8\epsilon\max(1,|x|,|L|)$, then caps the accepted
import at $L$. Other guards keep storage within its physical bounds. Nonfinite
calculated totals fail; they never become successful meters. The generated
functions receive prepared numeric scalars. Arithmetic overflow propagates to
the enclosing calculation's rejection checks; input validation and evidence
checks remain at the implemented input and ledger boundaries.

Equation boundaries also preserve evaluation order. GPU count times power is
formed before multiplying by hours; fixed plus compute is formed once; source
rates are divided by 1000 before multiplying by energy. The unchanged ledger
examples cover `3 × 0.1`, `10 × 0.1` and `0.1 + 0.2` rounding cases.

From this folder, run `npm ci`, then `npm run generate`. Run `npm run check` to
verify that the committed JavaScript matches this source and the pinned compiler.
The application imports ordinary generated JavaScript and needs no math runtime.
