import type { Anthropic } from '@anthropic-ai/sdk';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { Conversation } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { SkillGateProvider } from '../src/setup/SkillGateProvider.js';

function makeLoader(requiredSkills: Record<string, string[]>): ConfigLoader<any> {
  return new ConfigLoader({ config: { requiredSkills }, sources: [], warnings: [] });
}

function pushSkillCall(conversation: Conversation, id: string, skill: string, isError: boolean): void {
  conversation.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } as Anthropic.Beta.Messages.BetaMessageParam);
  conversation.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text: '{}' }] }],
  } as Anthropic.Beta.Messages.BetaMessageParam);
}

describe('SkillGateProvider', () => {
  it('allows a tool absent from the requiredSkills map', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({});
    provider.conversation = new Conversation();
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: true });
  });

  it('blocks a required tool when its skill has never been loaded', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr'] });
    provider.conversation = new Conversation();
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: false, missing: ['pr'] });
  });

  it('allows a required tool once its skill has loaded successfully', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr'] });
    const conversation = new Conversation();
    pushSkillCall(conversation, 'tool_1', 'pr', false);
    provider.conversation = conversation;
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: true });
  });

  it('does not count a Skill call that came back as an error', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr'] });
    const conversation = new Conversation();
    pushSkillCall(conversation, 'tool_1', 'pr', true);
    provider.conversation = conversation;
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: false, missing: ['pr'] });
  });

  it('requires every listed skill, not just one', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr', 'commit'] });
    const conversation = new Conversation();
    pushSkillCall(conversation, 'tool_1', 'pr', false);
    provider.conversation = conversation;
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: false, missing: ['commit'] });
  });

  it('reads the config loader live, reflecting an applied requiredSkills change', () => {
    const loader = makeLoader({});
    const provider = new SkillGateProvider();
    provider.configLoader = loader;
    provider.conversation = new Conversation();
    loader.apply({ config: { requiredSkills: { GitHub_PullRequest_Create: ['pr'] } }, sources: [], warnings: [] });
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: false, missing: ['pr'] });
  });
});
