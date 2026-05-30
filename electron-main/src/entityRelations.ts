// Typed entity relations — parse/serialize, reciprocal registry, Archive agent proposer.
// No Electron dependency; pure TS so it is fully testable in Node.

import crypto from 'crypto';
import type { DbSuggestion } from './db.js';
import type { ArchiveIndex } from './archiveAgent.js';

// ─── Types ───

export interface EntityRelation {
  type: string;
  target: string; // entity id
}

// ─── Reciprocal registry ───

const RECIPROCAL: Record<string, string> = {
  'married to': 'married to',
  'parent of': 'child of',
  'child of': 'parent of',
  'sibling of': 'sibling of',
  'rules over': 'ruled by',
  'ruled by': 'rules over',
  'ally of': 'ally of',
  'enemy of': 'enemy of',
  'rival of': 'rival of',
  'mentor of': 'student of',
  'student of': 'mentor of',
  'creator of': 'created by',
  'created by': 'creator of',
  'serves': 'served by',
  'served by': 'serves',
};

export function getReciprocal(relType: string): string {
  return RECIPROCAL[relType.toLowerCase()] ?? relType;
}

// ─── Frontmatter serialization ───

export function serializeRelations(relations: EntityRelation[]): string {
  if (!relations.length) return '';
  const lines = ['relations:'];
  for (const r of relations) {
    lines.push(`  - type: ${r.type}`);
    lines.push(`    target: ${r.target}`);
  }
  return lines.join('\n') + '\n';
}

export function parseRelationsBlock(frontmatterText: string): EntityRelation[] {
  const blockMatch = frontmatterText.match(/^relations:\n((?:[ \t]+-[ \t].*\n(?:[ \t]+.*\n?)*)*)/m);
  if (!blockMatch) return [];

  const relations: EntityRelation[] = [];
  const block = blockMatch[1];

  const itemRegex = /[ \t]+-[ \t]+(.*?)(?=\n[ \t]+-[ \t]|$)/gs;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(block)) !== null) {
    const itemText = m[0];
    const typeMatch = itemText.match(/type:\s*(.+)/);
    const targetMatch = itemText.match(/target:\s*(.+)/);
    if (typeMatch && targetMatch) {
      relations.push({
        type: typeMatch[1].trim(),
        target: targetMatch[1].trim(),
      });
    }
  }
  return relations;
}

export function stripRelationsBlock(frontmatterText: string): string {
  return frontmatterText.replace(/^relations:\n((?:[ \t]+-[ \t].*\n(?:[ \t]+.*\n?)*)*)/m, '');
}

// ─── Relation detection patterns ───

interface RelationPattern {
  regex: RegExp;
  relType: string;
  sourceGroup: number;
  targetGroup: number;
}

const RELATION_PATTERNS: RelationPattern[] = [
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+are\s+siblings?\b/gi,
    relType: 'sibling of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+is\s+married\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'married to',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+are\s+married\b/gi,
    relType: 'married to',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+is\s+(?:the|a)\s+parent\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'parent of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+is\s+(?:the|a)\s+child\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'child of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+is\s+(?:the|a)\s+(?:son|daughter)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'child of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+rules\s+(?:over\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'rules over',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:is\s+(?:a\s+)?mentor\s+(?:to|of)|mentors)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'mentor of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+are\s+(?:allies|allied)\b/gi,
    relType: 'ally of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+and\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+are\s+(?:enemies|rivals)\b/gi,
    relType: 'enemy of',
    sourceGroup: 1,
    targetGroup: 2,
  },
  {
    regex: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:created|forged|made)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    relType: 'creator of',
    sourceGroup: 1,
    targetGroup: 2,
  },
];

interface EntityLookup {
  id: string;
  name: string;
  path: string;
  allTerms: string[];
}

function buildLookup(index: ArchiveIndex): EntityLookup[] {
  return index.entities.map((e) => ({
    id: e.id,
    name: e.name,
    path: `entities/${e.type}s/${e.id}.md`,
    allTerms: [e.name, ...e.aliases],
  }));
}

function findEntity(name: string, lookup: EntityLookup[]): EntityLookup | null {
  const lower = name.toLowerCase();
  return lookup.find((e) => e.allTerms.some((t) => t.toLowerCase() === lower)) ?? null;
}

function dedupeKey(sourceId: string, targetId: string, relType: string): string {
  const [a, b] = [sourceId, targetId].sort();
  return `${a}|${b}|${relType}`;
}

export function detectRelationSuggestions(
  transcriptText: string,
  index: ArchiveIndex,
): DbSuggestion[] {
  const lookup = buildLookup(index);
  const seen = new Set<string>();
  const suggestions: DbSuggestion[] = [];
  const now = new Date().toISOString();

  for (const pattern of RELATION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(transcriptText)) !== null) {
      const sourceName = m[pattern.sourceGroup].trim();
      const targetName = m[pattern.targetGroup].trim();
      if (sourceName.toLowerCase() === targetName.toLowerCase()) continue;

      const sourceEntity = findEntity(sourceName, lookup);
      const targetEntity = findEntity(targetName, lookup);
      if (!sourceEntity || !targetEntity) continue;

      const key = dedupeKey(sourceEntity.id, targetEntity.id, pattern.relType);
      if (seen.has(key)) continue;
      seen.add(key);

      suggestions.push({
        id: crypto.randomUUID(),
        source_agent: 'archive',
        confidence: 0.80,
        rationale: `Transcript implies "${sourceEntity.name}" and "${targetEntity.name}" have a "${pattern.relType}" relationship`,
        target_kind: 'vault',
        target_path: sourceEntity.path,
        target_anchor: null,
        payload_json: JSON.stringify({
          kind: 'typed-relation',
          relationType: pattern.relType,
          sourceEntityId: sourceEntity.id,
          sourceEntityPath: sourceEntity.path,
          targetEntityId: targetEntity.id,
          targetEntityPath: targetEntity.path,
          targetEntityName: targetEntity.name,
          sourceEntityName: sourceEntity.name,
        }),
        status: 'proposed',
        created_at: now,
        applied_at: null,
        applied_run_id: null,
        budget_exceeded: 0,
      });
    }
  }

  return suggestions;
}
