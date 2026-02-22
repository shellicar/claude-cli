export interface SystemPromptProvider {
  readonly name: string;
  readonly enabled: boolean;
  getSections(): Promise<Array<string | undefined>>;
}

export class SystemPromptBuilder {
  private readonly providers: SystemPromptProvider[] = [];

  public add(provider: SystemPromptProvider): void {
    this.providers.push(provider);
  }

  public async build(): Promise<string | undefined> {
    const enabled = this.providers.filter((p) => p.enabled);
    if (enabled.length === 0) {
      return undefined;
    }

    const results = await Promise.all(enabled.map((p) => p.getSections()));
    const parts = results.flat().filter((s): s is string => s !== undefined);
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }
}
