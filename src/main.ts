import "./styles.css";
import { EditorApp } from "./app/EditorApp";

const host = document.querySelector<HTMLElement>("#app");
if (!host) {
  throw new Error("Application host #app was not found");
}

const app = new EditorApp(host);
if (new URLSearchParams(window.location.search).has("benchmark")) {
  const benchmarkStart = performance.now();
  void import("./benchmark/syntheticScene").then(({ benchmarkCounts, buildSyntheticBenchmarkScene }) => {
    const scene = buildSyntheticBenchmarkScene();
    const initialSnapshot = app.loadBenchmarkScene(scene);
    const interactiveMs = performance.now() - benchmarkStart;
    window.__POLYGON_BENCHMARK__ = {
      ready: true,
      run: async (options) => {
        const denseSelection = app.benchmarkSelectVegetation(scene.densePick);
        const sparseSelection = app.benchmarkSelectVegetation(scene.sparsePick);
        const withinChunkMove = app.benchmarkMoveVegetation(scene.moveId, 1);
        const acrossChunkMove = app.benchmarkMoveVegetation(scene.moveId, 600);
        const terrainPadRefresh = app.benchmarkTerrainPadRefresh(scene.padPrefabId);
        const serialization = app.benchmarkSerialization();
        const frameTimes = options?.quick
          ? await app.benchmarkPanZoomFrames(6, 2)
          : await app.benchmarkPanZoomFrames();
        const memory = (performance as Performance & {
          readonly memory?: {
            readonly usedJSHeapSize: number;
            readonly totalJSHeapSize: number;
            readonly jsHeapSizeLimit: number;
          };
        }).memory;
        return {
          seed: "0x5eedc0de",
          userAgent: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
          counts: benchmarkCounts(scene.model),
          constructionAndValidationMs: scene.constructionAndValidationMs,
          interactiveMs,
          initialSnapshot,
          frameTimes,
          denseSelection,
          sparseSelection,
          withinChunkMove,
          acrossChunkMove,
          terrainPadRefresh,
          serialization,
          memory: memory ? {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          } : null,
        };
      },
    };
  });
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}

declare global {
  interface Window {
    __POLYGON_BENCHMARK__?: {
      readonly ready: true;
      readonly run: (options?: { readonly quick?: boolean }) => Promise<Record<string, unknown>>;
    };
  }
}
