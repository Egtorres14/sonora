/**
 * Huella del modelo comunitario: lo que cambia de verdad entre dos entrenamientos.
 *
 * CI reentrena en cada push que toca el aprendizaje o el DSP y commitea el modelo que descarga la
 * aplicación. Comparar el archivo entero hacía que cada ejecución generase un commit, porque
 * `trainedAt` cambia siempre, y ese commit hacía rechazar el siguiente push. Aquí solo cuenta lo que
 * observa la aplicación o el profesor: compatibilidad, con qué se entrenó y cómo valida.
 */
import type { LocalModel, ValidationMetrics } from '../../services/learning/types';

const sorted = (values: string[]) => [...values].sort();
/** Campo a campo, para que la huella no dependa del orden en que el código crea las claves. */
const metrics = (v: ValidationMetrics) => [
  v.confusion.truePositive, v.confusion.trueNegative, v.confusion.falsePositive, v.confusion.falseNegative,
  v.precision, v.recall, v.balancedAccuracy, v.evaluatedSamples, v.evaluatedGroups, v.folds,
];

export const modelFingerprint = (model: LocalModel): string => JSON.stringify({
  version: model.version,
  // La aplicación rechaza un modelo con otra versión de descriptores: cambiarla obliga a publicar.
  featureVersion: model.featureVersion,
  samples: sorted(model.trainingSampleIds),
  groups: sorted(model.trainingGroupIds),
  // Sin el bosque serializado: dos bosques que validan igual son el mismo modelo para quien lo usa.
  effects: Object.keys(model.effects).sort().map(effect => {
    const trained = model.effects[effect as keyof LocalModel['effects']]!;
    return { effect, validation: metrics(trained.validation), samples: sorted(trained.sampleIds), groups: sorted(trained.groupIds) };
  }),
});

export const modelsDiffer = (previous: LocalModel, next: LocalModel) => modelFingerprint(previous) !== modelFingerprint(next);
