import {describe,it,expect} from 'vitest';
import {teamDefinition} from './teamDefinition.js';
it('shares a reviewable snapshot without top-level account identity or credential-shaped fields',()=>{
 const json=teamDefinition({kind:'workflow',item:{name:'Workflow',owner:'private-owner',nodes:[{id:'node',parameters:{apiKey:'secret',authorization:'Bearer secret',prompt:'Review this'}}],edges:[]}});
 expect(json).toContain('Review this');expect(json).not.toContain('private-owner');expect(json).not.toContain('secret');
});
it('does not mutate the personal definition',()=>{
 const item={name:'Agent',systemPrompt:'Keep this',apiKey:'secret'};teamDefinition({kind:'agent',item});expect(item.apiKey).toBe('secret');
});
