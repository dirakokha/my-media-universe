/**
 * Domain types shared by the API (Cloudflare Worker) and the React client.
 * Everything the client renders comes from these shapes.
 */

export type MediaKind = 'movie' | 'series';
export type MediaCollection = 'movie' | 'series' | 'anime';
export type WatchStatus = 'plan' | 'watching' | 'completed' | 'onhold' | 'dropped';
export type RatingMethod = 'direct' | 'criteria';
export type ListSortMode = 'manual' | 'rating' | 'date' | 'title';

export interface CriterionDef {
  key: string;
  label: string;
  short: string;
  order: number;
}

export interface MediaItem {
  id: string;
  userId: string;
  source: 'tmdb' | 'manual';
  tmdbId: number | null;
  kind: MediaKind;
  isAnime: boolean;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  overviewEn: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  customPosterData: string | null;
  releaseDate: string | null;
  year: number | null;
  genres: GenreRef[];
  runtimeMinutes: number | null;
  country: string | null;
  language: string | null;
  director: string | null;
  cast: CastRef[];
  status: WatchStatus;
  ratingMethod: RatingMethod;
  ratingDirect: number | null;
  criteria: Record<string, number>;
  ratingFinal: number | null;
  finalSeriesRating: number | null;
  notes: string | null;
  quotes: Quote[];
  isSpoiler: boolean;
  tags: string[];
  watchDate: string | null;
  favorite: boolean;
  addedAt: number;
  updatedAt: number;
  watchCount?: number;
}

export interface GenreRef {
  id: number | null;
  name: string;
}

export interface CastRef {
  id: number | null;
  name: string;
  character?: string | null;
  profilePath?: string | null;
  order?: number;
}

export interface Quote {
  id: string;
  text: string;
}

export interface Episode {
  id: string;
  mediaItemId: string;
  tmdbEpisodeId: number | null;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  originalName: string | null;
  overview: string | null;
  stillPath: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
  watched: boolean;
  ratingMethod: RatingMethod;
  ratingDirect: number | null;
  criteria: Record<string, number>;
  ratingFinal: number | null;
  notes: string | null;
  quotes: Quote[];
  tags: string[];
  isSpoiler: boolean;
  watchDate: string | null;
  updatedAt: number;
}

export interface Season {
  id: string;
  mediaItemId: string;
  tmdbSeasonId: number | null;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  airDate: string | null;
  episodeCount: number;
  /** filled by the API */
  episodes?: Episode[];
  /** filled by the API: average of rated episodes, or null */
  score?: number | null;
  ratedCount?: number;
}

export interface MediaDetail extends MediaItem {
  seasons: Season[];
  /** average of all rated episodes across seasons */
  computedScore: number | null;
  ratedEpisodeCount: number;
  totalEpisodeCount: number;
  watchEvents: WatchEvent[];
  categories: { id: string; name: string; color: string | null }[];
  lists: { id: string; name: string }[];
}

export interface WatchEvent {
  id: string;
  mediaItemId: string;
  episodeId: string | null;
  watchedAt: string;
  rating: number | null;
  ratingMethod: RatingMethod | null;
  criteria: Record<string, number>;
  notes: string | null;
  quotes: Quote[];
  /** The note/quote is hidden in the UI until the reader reveals it. */
  isSpoiler: boolean;
  createdAt: number;
  episodeLabel?: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  itemCount: number;
  createdAt: number;
}

export interface MediaList {
  id: string;
  name: string;
  description: string | null;
  sortMode: ListSortMode;
  isWatchlist: boolean;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  role: 'admin' | 'member';
  preferences: UserPreferences;
  createdAt: number;
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  language: 'fa' | 'en';
  autoBackup: boolean;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

export interface AuthState {
  user: User | null;
  loaded: boolean;
}

export interface LibraryFilters {
  kind?: MediaCollection | undefined;
  status?: WatchStatus | undefined;
  categoryId?: string | undefined;
  q?: string | undefined;
  sort?: 'recent' | 'rating' | 'title' | 'year' | undefined;
  favorite?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** Validation summary for a backup document (same shape for Drive previews and file imports). */
export interface BackupSummary {
  schemaVersion: number;
  exportedAt: string | null;
  counts: {
    mediaItems: number;
    episodes: number;
    seasons: number;
    watchEvents: number;
    categories: number;
    lists: number;
  };
  mediaTypes: { movie: number; series: number; anime: number };
}

export interface BackupFile {
  id: string;
  name: string;
  sizeBytes: number;
  schemaVersion: number;
  itemCount: number;
  kind: 'manual' | 'auto';
  createdAt: number;
}

export interface DriveStatus {
  connected: boolean;
  googleEmail: string | null;
  connectedAt: number | null;
  autoBackup: boolean;
  configured: boolean;
  folderName: string | null;
}

export interface StatsOverview {
  moviesWatched: number;
  seriesWatched: number;
  animeWatched: number;
  totalWatchTimeMinutes: number;
  averageRating: number | null;
  completedSeries: number;
  ratedEpisodes: number;
  totalItems: number;
  totalWatchEvents: number;
}

export interface StatsPayload {
  range: { from: string | null; to: string | null; label: string };
  overview: StatsOverview;
  highestRated: { id: string; title: string; rating: number; posterPath: string | null; kind: MediaKind }[];
  lowestRated: { id: string; title: string; rating: number; posterPath: string | null; kind: MediaKind }[];
  genreDistribution: { name: string; count: number }[];
  monthlyActivity: { key: string; label: string; count: number; minutes: number }[];
  yearlyActivity: { year: number; count: number; minutes: number }[];
  ratingDistribution: { bucket: string; count: number }[];
  mostActiveMonths: { key: string; label: string; count: number }[];
  directorStats: { name: string; count: number; average: number | null }[];
  actorStats: { name: string; count: number; average: number | null }[];
  statusBreakdown: { status: WatchStatus; count: number }[];
}

export interface TmdbSearchResult {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  genres: GenreRef[];
  isAnime: boolean;
  inLibrary: boolean;
  libraryId?: string | null;
  libraryStatus?: WatchStatus | null;
}

export interface TmdbMovieDetail {
  kind: 'movie';
  tmdbId: number;
  title: string;
  originalTitle: string;
  overview: string | null;
  overviewEn: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  genres: GenreRef[];
  runtimeMinutes: number | null;
  country: string | null;
  language: string | null;
  director: string | null;
  cast: CastRef[];
  isAnime: boolean;
  inLibrary: boolean;
  libraryId: string | null;
}

export interface TmdbSeriesDetail {
  kind: 'series';
  tmdbId: number;
  title: string;
  originalTitle: string;
  overview: string | null;
  overviewEn: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  genres: GenreRef[];
  runtimeMinutes: number | null;
  country: string | null;
  language: string | null;
  director: string | null;
  cast: CastRef[];
  isAnime: boolean;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  seasons: {
    seasonNumber: number;
    name: string;
    overview: string | null;
    posterPath: string | null;
    airDate: string | null;
    episodeCount: number;
  }[];
  inLibrary: boolean;
  libraryId: string | null;
}

export interface TmdbSeasonDetail {
  seasonNumber: number;
  name: string;
  overview: string | null;
  posterPath: string | null;
  airDate: string | null;
  episodes: {
    episodeNumber: number;
    name: string;
    originalName: string | null;
    overview: string | null;
    stillPath: string | null;
    airDate: string | null;
    runtimeMinutes: number | null;
    tmdbEpisodeId: number | null;
  }[];
}

export interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}
