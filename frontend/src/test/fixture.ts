// The backend's real response for the synthetic fixture calendar (tests/fixtures/google_export_sample.ics),
// analysed 1-8 Sep 2025 with config.example.yaml. Regenerate it if the API shape changes.
import raw from "./fixture-response.json";
import type { Analysis, PeriodPreset, SettingsResponse } from "../lib/types";

export const fixtureAnalysis = raw.analysis as unknown as Analysis;
export const fixtureSettings = (raw.config as unknown as SettingsResponse).settings;
export const fixtureConfig = raw.config as unknown as SettingsResponse;
export const fixturePeriods = raw.periods as { presets: PeriodPreset[]; default: string };
export const FIXTURE_TODAY = "2025-09-08";

export const fixtureCtx = () => ({
  analysis: structuredClone(fixtureAnalysis), settings: structuredClone(fixtureSettings), today: FIXTURE_TODAY,
});
