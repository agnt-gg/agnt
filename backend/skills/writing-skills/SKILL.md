---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Writing Skills

## Overview

Writing skills IS Test-Driven Development applied to process documentation.

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

Core principle: If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

REQUIRED BACKGROUND: You MUST understand superpowers:test-driven-development before using this skill.

## What is a Skill?

A skill is a reference guide for proven techniques, patterns, or tools. Skills help future Claude instances find and apply effective approaches.

- **Skills are**: Reusable techniques, patterns, tools, reference guides
- **Skills are NOT**: Narratives about how you solved a problem once

## TDD Mapping for Skills

| TDD Concept | Skill Creation |
|-------------|---------------|
| Test case | Pressure scenario with subagent |
| Production code | Skill document (SKILL.md) |
| Test fails (RED) | Agent violates rule without skill (baseline) |
| Test passes (GREEN) | Agent complies with skill present |
| Refactor | Close loopholes while maintaining compliance |

## When to Create a Skill

Create when:
- Technique wasn't intuitively obvious to you
- You'd reference this again across projects
- Pattern applies broadly (not project-specific)

Don't create for:
- One-off solutions
- Standard practices well-documented elsewhere
- Project-specific conventions (put in CLAUDE.md)

## SKILL.md Structure

Frontmatter (YAML):
- `name`: Use letters, numbers, and hyphens only
- `description`: Third-person, describes ONLY when to use (NOT what it does). Start with "Use when..."

## Claude Search Optimization (CSO)

Critical: Description = When to Use, NOT What the Skill Does.

Testing revealed that when a description summarizes the skill's workflow, Claude may follow the description instead of reading the full skill content.

## The Iron Law (Same as TDD)

Write skill before testing? Delete it. Start over.
Edit skill without testing? Same violation.

No exceptions.

## RED-GREEN-REFACTOR for Skills

1. **RED**: Run pressure scenario WITHOUT the skill. Document exact behavior.
2. **GREEN**: Write skill that addresses those specific rationalizations. Re-test WITH skill.
3. **REFACTOR**: Agent found new rationalization? Add explicit counter. Re-test until bulletproof.

## The Bottom Line

Creating skills IS TDD for process documentation.
Same Iron Law: No skill without failing test first.
Same cycle: RED (baseline) → GREEN (write skill) → REFACTOR (close loopholes).
