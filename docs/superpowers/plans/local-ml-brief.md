# Task: local supervised learning engine

Implement only `services/learning/*` and `tests/learning.test.ts`; no package/config/UI edits. Root installs ml-random-forest. No subagents. No Git exists. Report in `docs/superpowers/plans/local-ml-report.md`.

The app evaluates student audio locally. ML is optional experimental advice, never automated grading. Build a real per-effect RandomForestClassifier baseline (ml-random-forest), using existing AudioFeatures summaries and 48-band LTAS. Accept the exact contract below (define it in services/learning/types.ts, root imports it):

```ts
type EffectId = 'pitch_shift' | 'time_stretch' | 'reversa' | 'filtros' | 'loops';
type Label = 'unknown' | 'present' | 'absent';
interface TrainingSample { id: string; sourceGroup: string; origin: 'real' | 'synthetic'; features: AudioFeatures; labels: Record<EffectId, Label> }
```

Exports from `services/learning/model.ts`: `trainLocalModel(samples: TrainingSample[]): LocalModel`; `predictLocalModel(model: LocalModel, features: AudioFeatures): Prediction[]`; `trainingReadiness(samples: TrainingSample[]): Readiness[]`. Define exported LocalModel/Prediction/Readiness in types.ts; send root contracts promptly. LocalModel must serialize and contain version, feature version, trainedAt, training sample IDs/group IDs, per-effect classifier JSON, held-out confusion counts, precision/recall/balanced accuracy and sample/group counts. Predictions include effect, predicted boolean/null, voteShare (un-calibrated), explanation and validation metrics. Do not import UI/storage.

Use deterministic group-disjoint evaluation (3 folds, stratify groups when possible; require all training partitions include both classes). Minimum per effect: >=12 labeled real samples, >=3 distinct source groups containing positives and >=3 containing negatives; >=6 distinct groups total. Require explicit nonblank sourceGroup and reject duplicate sample IDs from training, malformed features and inconsistent feature versions. Unknown labels excluded per effect. Synthetic excluded completely. If an effect lacks data, readiness explains counts and model may train other eligible effects. If none eligible throw helpful Spanish error. Never count duplicate variants as independent groups. Use a single fixed descriptor mapping with finite sanitization, no file names/rates/length used as spurious shortcuts; physically meaningful normalized spectrum and temporal/spectral summaries. Report limitations of whole-file descriptors.

Worker: `services/learning/training.worker.ts` input `{ samples: TrainingSample[] }`, output `{ ok:true, model:LocalModel }` or `{ ok:false,error:string }`. Small browser API `services/learning/client.ts`: `trainInWorker(samples:TrainingSample[],signal?:AbortSignal):Promise<LocalModel>`. Cancel terminates worker. Do not block UI on training. Model persistence handled by root. Predictions abstain for votes between 0.35 and 0.65 and when group validation balanced accuracy <0.65; call scores votes, not confidence.

Tests first: observe failing tests, implement, run with local vitest. Test no synthetic/no unknown leakage, no shared groups in folds (export split helper), duplicate IDs rejected, insufficient class diversity, serialization+prediction roundtrip, genuinely held-out evaluation on controlled separable fixture (manual distinct features) and finite input handling. Do not assert training accuracy or test mock predictions. Test script root will add. Use relevant skill instructions but do not create more agents. Report commands/results/limits concisely.
