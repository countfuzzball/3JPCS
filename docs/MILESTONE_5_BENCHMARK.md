# Milestone 5 production benchmark

This is the measured Milestone 5 acceptance run, not a synthetic-count shortcut. The
production Vite bundle contains and validates exactly:

- 309 varied road polylines;
- 279 prefabs;
- 4,870 native tree records;
- 27,628 native shrub records; and
- 32,498 individually addressable native vegetation UUIDs in total.

Run `npm run benchmark` to rebuild and repeat it. The command launches the production
bundle at 1920×1080, warms up camera motion, takes 60 pan/zoom frame samples, exercises
dense and sparse selection, performs within- and cross-chunk moves, commits a terrain-
pad change, serializes project v4, and writes the complete machine-readable result to
`benchmark-results/milestone-5-latest.json`.

## Recorded environment and results

Recorded 2026-08-27 on Windows 10 through Headless Chrome 151 at 1920×1080, DPR 1.
WebGL reported `ANGLE … SwiftShader Device (Subzero) … SwiftShader driver`, so this
run used Chromium's CPU software renderer rather than the machine's hardware GPU.

| Measurement | Result | Target / interpretation |
|---|---:|---|
| Model construction + strict validation | 737.1 ms | Full exact-count project |
| Time until interactive | 2,446.7 ms | Includes model, projection, and first software render |
| Pan/zoom frame median | 1,916.6 ms | Misses the ~16.7 ms target |
| Pan/zoom frame p95 | 2,299.9 ms | Misses the 33 ms target |
| Draw calls | 2,735 | 411 are native-vegetation chunk/asset/type batches |
| Scene Object3Ds | 3,862 | Does not contain 32,498 vegetation Object3Ds |
| Native vegetation batches | 411 | 512 m spatial chunks, split by type/asset |
| Dense / sparse selection | 210.8 / 205.3 ms | Includes visible overlay submission; misses 50 ms on SwiftShader |
| Move within one chunk | 206.7 ms | Exactly 1 slot write, 0 batch/world rebuilds |
| Move across a chunk | 142.8 ms | Exactly 2 slot writes, 1 re-batch, 0 world rebuilds |
| Terrain-pad change + Y refresh | 1,012.8 ms | Exactly 32,498 derived-Y updates, as allowed for a committed terrain edit |
| Project-v4 serialization | 470.2 ms / 10,946,283 bytes | Complete, unsampled native collection |
| JavaScript heap after run | 47.4 MB used / 68 MB allocated | Chromium-reported approximation |
| Three.js resources after initial render | 2,147 geometries / 1 texture | GPU memory bytes unavailable |

## Acceptance interpretation

The vegetation architecture passes its structural gates: every UUID resolves to a
batch/slot, no placement becomes a Mesh/Object3D, picking visits only nearby 512 m
chunks, swap-remove keeps slot maps compact, a same-chunk edit writes one slot, a
cross-chunk edit writes two slots, and neither edit rebuilds the world. A committed
terrain change deliberately resamples all native Y values once. The automated suite
asserts those exact work counts over all 32,498 records.

This run does **not** claim the frame-time or visible-edit latency target succeeded.
The recorded bottleneck is full-scene submission through SwiftShader: the older road
and prefab projections plus the 411 vegetation chunks produce 2,735 draw calls and
2,147 geometries. The next performance pass should batch unchanged roads and prefab
proxy primitives and repeat the same benchmark on hardware-accelerated Chromium. That
work can reduce draw calls without changing native vegetation identity or persistence.
The JSON report deliberately preserves the miss rather than hiding it by lowering
counts, disabling layers, sampling vegetation, or timing only initial load.
