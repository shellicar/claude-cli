export type HistoryReplayConfig = {
  /** Whether to replay history messages into the display on startup. */
  enabled: boolean;
  /** Whether to show thinking blocks when replaying history. */
  showThinking: boolean;
};

export type CliConfig = {
  historyReplay: HistoryReplayConfig;
};

export const config: CliConfig = {
  historyReplay: {
    enabled: true,
    showThinking: false,
  },
};
