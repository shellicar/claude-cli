export interface SystemPromptProvider {
  readonly name: string;
  getSections(): Promise<Array<string | undefined>>;
}

export class SystemPromptBuilder {
  private readonly providers: SystemPromptProvider[] = [];

  public add(provider: SystemPromptProvider): void {
    this.providers.push(provider);
  }

  public async build(): Promise<string | undefined> {
    if (this.providers.length === 0) {
      return undefined;
    }

    const results = await Promise.all(this.providers.map((p) => p.getSections()));
    const parts = results.flat().filter((s): s is string => s !== undefined);
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }
}
