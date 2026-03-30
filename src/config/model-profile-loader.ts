import { readFile } from 'node:fs/promises';
import type { ModelProfile } from '../models/config.ts';

/** Default ModelProfile used when a requested model ID is not found. Routes all non-English prompts through English. */
export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  modelId: '__default__',
  supportedLanguages: ['en'],
  languagePerformance: [{ languageTag: 'en', performanceRating: 1.0 }],
  defaultOptimalLanguage: 'en',
  endpoint: '',
};

export class ModelProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelProfileValidationError';
  }
}

/**
 * Validates a single ModelProfile object. Throws ModelProfileValidationError if invalid.
 */
export function validateModelProfile(profile: unknown): ModelProfile {
  if (profile === null || typeof profile !== 'object') {
    throw new ModelProfileValidationError('ModelProfile must be a non-null object');
  }

  const p = profile as Record<string, unknown>;

  if (typeof p.modelId !== 'string' || p.modelId.trim() === '') {
    throw new ModelProfileValidationError('ModelProfile.modelId must be a non-empty string');
  }

  if (!Array.isArray(p.supportedLanguages) || p.supportedLanguages.length === 0) {
    throw new ModelProfileValidationError(
      `ModelProfile "${p.modelId}": supportedLanguages must be a non-empty array`
    );
  }
  for (const lang of p.supportedLanguages) {
    if (typeof lang !== 'string' || lang.trim() === '') {
      throw new ModelProfileValidationError(
        `ModelProfile "${p.modelId}": each supportedLanguage must be a non-empty string`
      );
    }
  }

  if (!Array.isArray(p.languagePerformance) || p.languagePerformance.length === 0) {
    throw new ModelProfileValidationError(
      `ModelProfile "${p.modelId}": languagePerformance must be a non-empty array`
    );
  }
  for (const lp of p.languagePerformance) {
    if (lp === null || typeof lp !== 'object') {
      throw new ModelProfileValidationError(
        `ModelProfile "${p.modelId}": each languagePerformance entry must be an object`
      );
    }
    const entry = lp as Record<string, unknown>;
    if (typeof entry.languageTag !== 'string' || entry.languageTag.trim() === '') {
      throw new ModelProfileValidationError(
        `ModelProfile "${p.modelId}": languagePerformance.languageTag must be a non-empty string`
      );
    }
    if (typeof entry.performanceRating !== 'number' || entry.performanceRating < 0 || entry.performanceRating > 1) {
      throw new ModelProfileValidationError(
        `ModelProfile "${p.modelId}": languagePerformance.performanceRating must be a number in [0.0, 1.0]`
      );
    }
  }

  if (typeof p.defaultOptimalLanguage !== 'string' || p.defaultOptimalLanguage.trim() === '') {
    throw new ModelProfileValidationError(
      `ModelProfile "${p.modelId}": defaultOptimalLanguage must be a non-empty string`
    );
  }

  if (typeof p.endpoint !== 'string' || p.endpoint.trim() === '') {
    throw new ModelProfileValidationError(
      `ModelProfile "${p.modelId}": endpoint must be a non-empty string`
    );
  }

  return p as unknown as ModelProfile;
}

/**
 * Loads and validates ModelProfile(s) from a JSON file.
 * The file may contain a single ModelProfile object or an array of ModelProfile objects.
 */
export async function loadModelProfiles(filePath: string): Promise<ModelProfile[]> {
  const content = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(content);

  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => validateModelProfile(item));
}

/**
 * Registry that holds loaded ModelProfiles and provides lookup with default fallback.
 */
export class ModelProfileRegistry {
  private profiles = new Map<string, ModelProfile>();

  constructor(profiles: ModelProfile[] = []) {
    for (const p of profiles) {
      this.profiles.set(p.modelId, p);
    }
  }

  /** Get a profile by model ID. Returns the default profile if not found. */
  get(modelId: string): ModelProfile {
    if (this.profiles.has(modelId)) {
      return this.profiles.get(modelId)!;
    }
    // Build a default profile that inherits provider/region/endpoint from the first registered profile
    const first = this.profiles.values().next().value as ModelProfile | undefined;
    return {
      ...DEFAULT_MODEL_PROFILE,
      endpoint: first?.endpoint ?? '',
      provider: first?.provider,
      awsRegion: first?.awsRegion,
    };
  }

  /** Check if a specific model ID has a loaded profile. */
  has(modelId: string): boolean {
    return this.profiles.has(modelId);
  }

  /** Load profiles from a JSON file and add them to the registry. */
  async loadFromFile(filePath: string): Promise<void> {
    const loaded = await loadModelProfiles(filePath);
    for (const p of loaded) {
      this.profiles.set(p.modelId, p);
    }
  }

  /** Get all loaded profiles. */
  all(): ModelProfile[] {
    return Array.from(this.profiles.values());
  }
}
