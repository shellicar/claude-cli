import type { Anthropic } from '@anthropic-ai/sdk';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { Conversation } from '@shellicar/claude-sdk';
import { describe, expect, it } from 'vitest';
import { SkillGateProvider } from '../src/setup/SkillGateProvider.js';

function makeLoader(requiredSkills: Record<string, string[]>): ConfigLoader<any> {
  return new ConfigLoader({ config: { requiredSkills }, sources: [], warnings: [] });
}

type SkillCallOutcome = 'found' | 'not-found' | 'error';

function pushSkillCall(conversation: Conversation, id: string, skill: string, outcome: SkillCallOutcome): void {
  conversation.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } as Anthropic.Beta.Messages.BetaMessageParam);
  const text = outcome === 'found' ? JSON.stringify({ found: true, skill, body: 'instructions' }) : JSON.stringify({ found: false, skill, available: [] });
  conversation.push({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, is_error: outcome === 'error', content: [{ type: 'text', text }] }],
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
    pushSkillCall(conversation, 'tool_1', 'pr', 'found');
    provider.conversation = conversation;
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: true });
  });

  it('does not count a Skill call that came back as an error', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr'] });
    const conversation = new Conversation();
    pushSkillCall(conversation, 'tool_1', 'pr', 'error');
    provider.conversation = conversation;
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: false, missing: ['pr'] });
  });

  it('does not count a Skill call that resolved but reported found: false', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr'] });
    const conversation = new Conversation();
    pushSkillCall(conversation, 'tool_1', 'pr', 'not-found');
    provider.conversation = conversation;
    const actual = provider.check('GitHub_PullRequest_Create');
    expect(actual).toEqual({ allowed: false, missing: ['pr'] });
  });

  it('never blocks the Skill tool itself, even if misconfigured to require a skill', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ Skill: ['pr'] });
    provider.conversation = new Conversation();
    const actual = provider.check('Skill');
    expect(actual).toEqual({ allowed: true });
  });

  it('requires every listed skill, not just one', () => {
    const provider = new SkillGateProvider();
    provider.configLoader = makeLoader({ GitHub_PullRequest_Create: ['pr', 'commit'] });
    const conversation = new Conversation();
    pushSkillCall(conversation, 'tool_1', 'pr', 'found');
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
