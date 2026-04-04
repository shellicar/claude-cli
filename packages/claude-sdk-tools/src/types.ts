/** Options for path expansion (~ and $VAR). */
export interface NormaliseOptions {
  /** Override the home directory used for ~ expansion. Defaults to os.homedir(). */
  home?: string;
}
