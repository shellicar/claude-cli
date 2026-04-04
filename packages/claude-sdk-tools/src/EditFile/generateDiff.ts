import { createTwoFilesPatch } from 'diff';

export function generateDiff(filePath: string, originalContent: string, newContent: string): string {
  return createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, originalContent, newContent, '', '', { context: 3 });
}
