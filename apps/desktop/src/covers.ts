import type { LibraryGame, PlatformId } from './types';

const PLATFORM_THUMBNAIL_PATH: Partial<Record<PlatformId, string>> = {
  NES: 'Nintendo - Nintendo Entertainment System',
  SNES: 'Nintendo - Super Nintendo Entertainment System',
  GB: 'Nintendo - Game Boy',
  GBC: 'Nintendo - Game Boy Color',
  GBA: 'Nintendo - Game Boy Advance',
  MEGADRIVE: 'Sega - Mega Drive - Genesis',
  N64: 'Nintendo - Nintendo 64',
  DS: 'Nintendo - Nintendo DS',
  GCN: 'Nintendo - GameCube',
  '3DS': 'Nintendo - Nintendo 3DS'
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const normalizeCandidate = (value: string): string =>
  value
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*]/g, ' ')
    .replace(/^\d+\s*-\s*/g, ' ')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

const moveTrailingArticle = (value: string): string =>
  value.replace(/^(.*),\s*(The|A|An)$/i, (_, title: string, article: string) => `${article} ${title}`.trim());

const pushCandidate = (target: Set<string>, value: string) => {
  const normalized = value.trim();
  if (normalized) {
    target.add(normalized);
  }
};

const createTitleCandidates = (game: LibraryGame): string[] => {
  const romBaseName = game.romFileName.replace(/\.[^.]+$/, '');
  const seeds = [game.title, romBaseName];
  const candidates = new Set<string>();

  for (const seed of seeds) {
    const normalized = normalizeCandidate(seed);
    const movedArticle = moveTrailingArticle(normalized);
    const noSubtitle = normalized.split(' - ')[0]?.trim() ?? '';

    pushCandidate(candidates, seed);
    pushCandidate(candidates, normalized);
    pushCandidate(candidates, movedArticle);
    pushCandidate(candidates, normalized.replace(/:\s*/g, ' - '));
    pushCandidate(candidates, normalized.replace(/\s+-\s+/g, ': '));
    pushCandidate(candidates, normalized.replace(/[!']/g, ''));
    pushCandidate(candidates, movedArticle.replace(/[!']/g, ''));
    pushCandidate(candidates, noSubtitle);
  }

  return Array.from(candidates);
};

const buildCandidateUrls = (game: LibraryGame): string[] => {
  const systemPath = PLATFORM_THUMBNAIL_PATH[game.platform];
  if (!systemPath) {
    return [];
  }

  return createTitleCandidates(game).map((candidate) => {
    const encodedSystem = encodeURIComponent(systemPath).replace(/%20/g, '%20');
    const encodedTitle = encodeURIComponent(candidate);
    return `https://thumbnails.libretro.com/${encodedSystem}/Named_Boxarts/${encodedTitle}.png`;
  });
};

export const fetchAutoCoverDataUrl = async (game: LibraryGame): Promise<string | null> => {
  const urls = buildCandidateUrls(game);

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        continue;
      }

      return blobToDataUrl(await response.blob());
    } catch {
      // ignored
    }
  }

  return null;
};
