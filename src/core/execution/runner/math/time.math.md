# Executor time and numeric boundaries

These equations receive validated numeric timestamps in milliseconds. Parsing ISO
timestamps and deciding whether a job, snapshot or command is eligible remain in
TypeScript. One hour is 3,600,000 ms; one minute is 60,000 ms.

The source equations generate standalone JavaScript using the existing strict
scalar Cortex compiler. Run `npm run generate:execution-math` from the repository
root, or `npm run check:execution-math` to check the committed output.

Keep each operation boundary below: binary64 addition and multiplication cannot
be freely reassociated. In particular, divide work or data into hours before
converting to milliseconds, and form physical arrival before rounding to the grid.

## elapsedMilliseconds

Elapsed milliseconds, including a negative result when comparing reversed numeric bounds.

```json
{"inputs":{"start":"real","end":"real"},"result":"real"}
```

$$
\mathrm{end}-\mathrm{start}
$$

## timeAfter

Add an already calculated duration to its timestamp.

```json
{"inputs":{"start":"real","durationMs":"real"},"result":"real"}
```

$$
\mathrm{start}+\mathrm{durationMs}
$$

## readyTime

Initial admission and a move cannot precede either readiness or the job window.

```json
{"inputs":{"readyAt":"real","windowStart":"real"},"result":"real"}
```

$$
\max(\mathrm{readyAt},\mathrm{windowStart})
$$

## executionStart

Clip execution to the latest of the tick start, readiness and job-window start.

```json
{"inputs":{"tickStart":"real","readyAt":"real","windowStart":"real"},"result":"real"}
```

$$
\max(\mathrm{tickStart},\mathrm{readyAt},\mathrm{windowStart})
$$

## executionEnd

Clip the planned end to both the tick and the deadline.

```json
{"inputs":{"tickEnd":"real","deadline":"real"},"result":"real"}
```

$$
\min(\mathrm{tickEnd},\mathrm{deadline})
$$

## ageMinutes

Snapshot age in minutes. The caller separately rejects future observations.

```json
{"inputs":{"at":"real","observedAt":"real"},"result":"real"}
```

$$
\frac{\mathrm{at}-\mathrm{observedAt}}{60000}
$$

## millisecondsForHours

Convert a previously calculated hour quantity without changing its division order.

```json
{"inputs":{"durationHours":"real"},"result":"real"}
```

$$
\mathrm{durationHours}\,3600000
$$

## nearestWhole

Round a nonnegative duration to its nearest whole millisecond. The caller checks representability before using it.

```json
{"inputs":{"value":"real"},"result":"real"}
```

$$
\operatorname{round}(\mathrm{value})
$$

## withinRoundoff

The existing eight-epsilon relative tolerance, with a unit floor. The result is 1 or 0; the caller rejects nonfinite operands first. Since binary64 epsilon is $2^{-52}$, eight epsilon is exactly $2^{-49}$.

```json
{"inputs":{"left":"real","right":"real"},"result":"real"}
```

$$
\begin{cases}
1 & |\mathrm{left}-\mathrm{right}|\le 2^{-49}\max(1,|\mathrm{left}|,|\mathrm{right}|) \\
0 & \text{otherwise}
\end{cases}
$$
