# Energy impact

Preview in VS Code with **Ctrl+K, then V**. Each index is one energy source.
Inputs are numeric arrays in the same source order. Supply includes losses;
prices are USD/MWh, carbon intensity is g CO2/kWh, and `m` is a supplied multiplier.

## deliveredKWh

```json
{"inputs":{"d":"list<real>"}}
```

$$
\sum_{i=1}^{\operatorname{Length}(d)} d_i
$$

## electricityUsd

```json
{"inputs":{"s":"list<real>","p":"list<real>","m":"list<real>"}}
```

$$
\frac{\sum_{i=1}^{\operatorname{Length}(s)} s_i p_i m_i}{1000}
$$

## carbonKg

```json
{"inputs":{"s":"list<real>","c":"list<real>"}}
```

$$
\frac{\sum_{i=1}^{\operatorname{Length}(s)} s_i c_i}{1000}
$$
