import { createTwoFilesPatch } from 'diff';

export function generateDiff(displayPath: string, originalContent: string, newContent: string): string {
  return createTwoFilesPatch(`a/${displayPath}`, `b/${displayPath}`, originalContent, newContent, '', '', { context: 3 });
}
