import "server-only";
import {
  getSeries,
  getSonarrStatus,
  getSeriesById,
  getEpisodes,
  getEpisodeFiles,
  getSeriesHistory,
} from "../clients/sonarr";
import { getConnection, getTorrents } from "../clients/qbittorrent";
import { getSonarrConfig } from "../config/sonarr";
import { errorMessage } from "../server/http";
import { sonarrInstances, type SonarrInstance } from "../types/sonarr";
import { matchSeries } from "./sonarr-matching";

async function attempt<T>(load: () => Promise<T>) {
  try {
    return { value: await load(), error: null };
  } catch (error) {
    return { value: null, error: errorMessage(error) };
  }
}
export async function getShowsOverview() {
  const [instances, qbit] = await Promise.all([
    Promise.all(
      sonarrInstances.map(async (instance) => {
        const [series, status] = await Promise.all([
          attempt(() => getSeries(instance)),
          attempt(() => getSonarrStatus(instance)),
        ]);
        return {
          instance,
          series: series.value ?? [],
          version: status.value?.version,
          error: series.error ?? status.error,
        };
      }),
    ),
    attempt(getConnection),
  ]);
  return { instances, qbit };
}
export async function getShowPreview(instance: SonarrInstance, id: number) {
  const [series, episodes, files, history, torrents] = await Promise.all([
    attempt(() => getSeriesById(instance, id)),
    attempt(() => getEpisodes(instance, id)),
    attempt(() => getEpisodeFiles(instance, id)),
    attempt(() => getSeriesHistory(instance, id)),
    attempt(getTorrents),
  ]);
  const errors = [
    ...new Set(
      [
        series.error,
        episodes.error,
        files.error,
        history.error,
        torrents.error,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  let category: string | null = null;
  try {
    category = getSonarrConfig(instance).category;
  } catch {
    /* reported by the API reads */
  }
  return {
    series: series.value,
    evaluatedAt: Date.now(),
    files: (files.value ?? []).filter((file) => file.seriesId === id),
    errors,
    category,
    matching: matchSeries(
      instance,
      id,
      episodes.value ?? [],
      history.value ?? [],
      torrents.value ?? [],
      category,
      errors.length > 0,
    ),
  };
}
