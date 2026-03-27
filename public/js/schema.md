## Realtime Database schema (high-level)

All data lives under `/rooms/{pin}` where `{pin}` is a 6-digit string.

### `/rooms/{pin}/meta`
- `createdAt`: server timestamp
- `hostUid`: string
- `status`: `"lobby" | "running" | "reveal" | "ended"`
- `questionIndex`: number
- `questionTotal`: number
- `questionDurationMs`: number
- `questionStartAt`: server timestamp (ms)
- `questionEndAt`: server timestamp (ms)

### `/rooms/{pin}/players/{uid}`
- `name`: string
- `score`: number
- `joinedAt`: server timestamp
- `connected`: boolean

### `/rooms/{pin}/names/{normalizedName}`
- `uid`: string

### `/rooms/{pin}/answers/{questionIndex}/{uid}`
- `choice`: 0..3
- `answeredAt`: server timestamp (ms)

### `/rooms/{pin}/agg/{questionIndex}`
- `a`: number
- `b`: number
- `c`: number
- `d`: number
- `submitted`: number

### `/rooms/{pin}/top5`
- computed-ish list of 5 entries (denormalized for host)

