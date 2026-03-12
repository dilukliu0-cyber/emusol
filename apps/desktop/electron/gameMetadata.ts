export type CoverSource = 'none' | 'auto' | 'manual';
export type MetadataSource = 'import' | 'manual' | 'mixed';

export interface GameMetadata {
  description: string;
  genres: string[];
  releaseYear?: number;
  developer?: string;
  publisher?: string;
  region?: string;
  languages: string[];
  notes?: string;
  coverSource: CoverSource;
  metadataSource: MetadataSource;
  updatedAt?: string;
}

const REGION_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\busa\b|\bus\b|\bntsc-u\b/i, label: 'USA' },
  { pattern: /\beurope\b|\beu\b|\bpal\b/i, label: 'Europe' },
  { pattern: /\bjapan\b|\bjp\b|\bntsc-j\b/i, label: 'Japan' },
  { pattern: /\bworld\b/i, label: 'World' },
  { pattern: /\bfrance\b/i, label: 'France' },
  { pattern: /\bgermany\b/i, label: 'Germany' },
  { pattern: /\bspain\b/i, label: 'Spain' },
  { pattern: /\bitaly\b/i, label: 'Italy' },
  { pattern: /\bbrazil\b/i, label: 'Brazil' },
  { pattern: /\baustralia\b/i, label: 'Australia' },
  { pattern: /\bkorea\b/i, label: 'Korea' },
  { pattern: /\brussia\b|\bru\b/i, label: 'Russia' }
];

const LANGUAGE_LABELS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\benglish\b|\ben\b/i, label: 'English' },
  { pattern: /\bfrench\b|\bfr\b/i, label: 'French' },
  { pattern: /\bgerman\b|\bde\b/i, label: 'German' },
  { pattern: /\bspanish\b|\bes\b/i, label: 'Spanish' },
  { pattern: /\bitalian\b|\bit\b/i, label: 'Italian' },
  { pattern: /\bportuguese\b|\bpt\b/i, label: 'Portuguese' },
  { pattern: /\brussian\b|\bru\b/i, label: 'Russian' },
  { pattern: /\bjapanese\b|\bja\b/i, label: 'Japanese' },
  { pattern: /\bkorean\b|\bko\b/i, label: 'Korean' },
  { pattern: /\bchinese\b|\bzh\b/i, label: 'Chinese' }
];

const normalizeCsvList = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const extractGroups = (fileName: string): string[] =>
  Array.from(fileName.matchAll(/(\([^()]*\)|\[[^[\]]*])/g)).map((match) => match[1]?.slice(1, -1).trim() || '');

const inferReleaseYear = (fileName: string): number | undefined => {
  const match = fileName.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
};

const inferRegion = (groups: string[]): string | undefined => {
  for (const group of groups) {
    for (const entry of REGION_LABELS) {
      if (entry.pattern.test(group)) {
        return entry.label;
      }
    }
  }

  return undefined;
};

const inferLanguages = (groups: string[]): string[] => {
  const languages: string[] = [];

  for (const group of groups) {
    for (const entry of LANGUAGE_LABELS) {
      if (entry.pattern.test(group)) {
        languages.push(entry.label);
      }
    }
  }

  return Array.from(new Set(languages));
};

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const next = value.trim();
  return next || undefined;
};

const normalizeYear = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return rounded >= 1970 && rounded <= 2100 ? rounded : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim());
    return Number.isFinite(numeric) ? normalizeYear(numeric) : undefined;
  }

  return undefined;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      )
    );
  }

  if (typeof value === 'string') {
    return normalizeCsvList(value);
  }

  return [];
};

export const createImportedMetadata = (romFileName: string, coverSource: CoverSource = 'none'): GameMetadata => {
  const baseName = romFileName.replace(/\.[^.]+$/, '');
  const groups = extractGroups(baseName);

  return {
    description: '',
    genres: [],
    releaseYear: inferReleaseYear(baseName),
    developer: undefined,
    publisher: undefined,
    region: inferRegion(groups),
    languages: inferLanguages(groups),
    notes: undefined,
    coverSource,
    metadataSource: 'import',
    updatedAt: new Date().toISOString()
  };
};

export const mergeGameMetadata = (
  candidate: Partial<GameMetadata> | null | undefined,
  romFileName: string,
  coverDataUrl?: string
): GameMetadata => {
  const base = createImportedMetadata(romFileName, coverDataUrl ? 'manual' : 'none');

  return {
    description: typeof candidate?.description === 'string' ? candidate.description : base.description,
    genres: normalizeStringArray(candidate?.genres).length ? normalizeStringArray(candidate?.genres) : base.genres,
    releaseYear: normalizeYear(candidate?.releaseYear) ?? base.releaseYear,
    developer: normalizeText(candidate?.developer),
    publisher: normalizeText(candidate?.publisher),
    region: normalizeText(candidate?.region) ?? base.region,
    languages: normalizeStringArray(candidate?.languages).length ? normalizeStringArray(candidate?.languages) : base.languages,
    notes: normalizeText(candidate?.notes),
    coverSource:
      candidate?.coverSource === 'auto' || candidate?.coverSource === 'manual' || candidate?.coverSource === 'none'
        ? candidate.coverSource
        : base.coverSource,
    metadataSource:
      candidate?.metadataSource === 'manual' || candidate?.metadataSource === 'mixed' || candidate?.metadataSource === 'import'
        ? candidate.metadataSource
        : base.metadataSource,
    updatedAt: normalizeText(candidate?.updatedAt) ?? base.updatedAt
  };
};

export const applyMetadataPatch = (current: GameMetadata, patch: Partial<GameMetadata>): GameMetadata => {
  const next = mergeGameMetadata(
    {
      ...current,
      ...patch,
      genres: patch.genres ?? current.genres,
      languages: patch.languages ?? current.languages,
      updatedAt: new Date().toISOString()
    },
    'placeholder.rom'
  );

  if (
    patch.description !== undefined ||
    patch.genres !== undefined ||
    patch.releaseYear !== undefined ||
    patch.developer !== undefined ||
    patch.publisher !== undefined ||
    patch.region !== undefined ||
    patch.languages !== undefined ||
    patch.notes !== undefined
  ) {
    next.metadataSource = current.metadataSource === 'import' ? 'mixed' : 'manual';
  }

  return next;
};

export const buildGameSubtitle = (
  platformLabel: string,
  supportTier: 'v1' | 'future',
  metadata: GameMetadata
): string => {
  const parts = [platformLabel];

  if (metadata.releaseYear) {
    parts.push(String(metadata.releaseYear));
  }

  if (metadata.region) {
    parts.push(metadata.region);
  }

  if (parts.length === 1) {
    parts.push(supportTier === 'v1' ? 'Встроенный запуск' : 'Платформа позже');
  }

  return parts.join(' • ');
};

export const buildGameTags = (
  platformLabel: string,
  supportTier: 'v1' | 'future',
  metadata: GameMetadata
): string[] =>
  Array.from(
    new Set(
      [
        platformLabel,
        supportTier === 'v1' ? 'Встроенное ядро' : 'Roadmap',
        metadata.region,
        metadata.releaseYear ? String(metadata.releaseYear) : undefined,
        ...metadata.languages,
        ...metadata.genres
      ].filter(Boolean) as string[]
    )
  );
