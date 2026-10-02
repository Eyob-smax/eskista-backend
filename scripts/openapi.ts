/**
 * Exports the OpenAPI documents and audits the admin one.
 *
 *   pnpm openapi            writes docs/openapi/{admin,full}.json and prints the audit
 *   pnpm openapi --strict   same, but exits 1 if the admin document has any gap
 *
 * Boots the Nest app without listening (no port, no queue workers), with the same prefix
 * and versioning as main.ts, so the paths match what is served. Needs the usual .env
 * (database and Redis URLs are read, not connected to, at this stage).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { buildDocuments } from '../src/config/swagger';

type Json = Record<string, unknown>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const FILE_TYPES = ['application/pdf', 'text/csv'];

/** Every gap that stops an operation from being fully documented. */
export function auditOperation(
  doc: OpenAPIObject,
  path: string,
  method: string,
  op: Json,
  options: { requireForbidden?: boolean } = { requireForbidden: true },
): string[] {
  const issues: string[] = [];
  const isAuth = path.startsWith('/api/auth/');

  if (!op.summary) issues.push('no summary');
  const description = typeof op.description === 'string' ? op.description : '';
  if (description.trim().length < 40) issues.push('description missing or under 40 chars');
  if (!isAuth && !description.includes('**Behind it**')) issues.push('no "Behind it" section');

  const responses = (op.responses ?? {}) as Record<string, Json>;
  const success = Object.entries(responses).find(([code]) => code.startsWith('2'));
  if (!success) {
    issues.push('no 2xx response');
  } else {
    const isNoContent = success[0] === '204';
    const content = (success[1].content ?? {}) as Record<string, Json>;
    const isFile = Object.keys(content).some((t) => FILE_TYPES.includes(t));
    const json = content['application/json'];
    if (!isFile && Object.keys(content).length > 0 && !json?.schema) issues.push('2xx has no schema');
    if (!isFile && !isNoContent && Object.keys(content).length === 0 && method !== 'delete') {
      issues.push('2xx has no body schema');
    }
  }
  if (!isAuth && !responses['401']) issues.push('no 401');
  if (options.requireForbidden && !isAuth && !responses['403']) issues.push('no 403');

  for (const p of (op.parameters ?? []) as Json[]) {
    const schema = (p.schema ?? {}) as Json;
    const hasExample = p.example !== undefined || schema.example !== undefined;
    const explained =
      p.description || schema.enum || hasExample || schema.default !== undefined;
    if (!explained) issues.push(`param "${String(p.name)}" (${String(p.in)}) undescribed`);
    if (p.in === 'path' && !hasExample && !schema.format && !schema.enum) {
      issues.push(`path param "${String(p.name)}" has no example or format`);
    }
  }

  const body = (op.requestBody as Json | undefined)?.content as Record<string, Json> | undefined;
  if (body) {
    for (const media of Object.values(body)) {
      for (const field of missingExamples(doc, media.schema as Json | undefined, new Set())) {
        issues.push(`body field "${field}" has no example`);
      }
    }
  }
  return issues;
}

/** Request fields with neither an example, an enum nor a default — a client has to guess. */
function missingExamples(doc: OpenAPIObject, schema: Json | undefined, seen: Set<string>): string[] {
  if (!schema) return [];
  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  if (ref) {
    const name = ref.replace('#/components/schemas/', '');
    if (seen.has(name)) return [];
    seen.add(name);
    return missingExamples(doc, doc.components?.schemas?.[name] as Json | undefined, seen);
  }
  const out: string[] = [];
  for (const sub of (schema.allOf ?? []) as Json[]) out.push(...missingExamples(doc, sub, seen));
  const props = (schema.properties ?? {}) as Record<string, Json>;
  for (const [name, prop] of Object.entries(props)) {
    if (prop.$ref || prop.type === 'object') continue; // nested models are audited on their own
    if (prop.format === 'binary' || (prop.items as Json | undefined)?.format === 'binary') continue;
    const ok = prop.example !== undefined || prop.enum || prop.default !== undefined ||
      (prop.items as Json | undefined)?.enum;
    if (!ok) out.push(name);
  }
  return out;
}

/** Response models whose plain fields carry no example. */
export function auditResponseSchemas(doc: OpenAPIObject): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, raw] of Object.entries(doc.components?.schemas ?? {})) {
    if (!name.endsWith('Response')) continue;
    const props = ((raw as Json).properties ?? {}) as Record<string, Json>;
    const missing = Object.entries(props)
      .filter(([, p]) => !p.$ref && !p.allOf && p.type !== 'object' && p.type !== 'array')
      .filter(([, p]) => p.example === undefined && !p.enum && p.format !== 'uuid')
      .map(([field]) => field);
    if (missing.length > 0) out[name] = missing;
  }
  return out;
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const strict = process.argv.includes('--strict');

  const app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  const { full, admin, vendor, talent, customer } = buildDocuments(app, '0.1.0');

  const dir = join('docs', 'openapi');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'admin.json'), JSON.stringify(admin, null, 2));
  writeFileSync(join(dir, 'vendor.json'), JSON.stringify(vendor, null, 2));
  writeFileSync(join(dir, 'talent.json'), JSON.stringify(talent, null, 2));
  writeFileSync(join(dir, 'customer.json'), JSON.stringify(customer, null, 2));
  writeFileSync(join(dir, 'full.json'), JSON.stringify(full, null, 2));

  let operations = 0;
  let withIssues = 0;
  const byTag = new Map<string, string[]>();
  for (const [path, item] of Object.entries(admin.paths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, Json | undefined>)[method];
      if (!op) continue;
      operations += 1;
      const issues = auditOperation(admin, path, method, op);
      if (issues.length === 0) continue;
      withIssues += 1;
      const tag = ((op.tags as string[] | undefined) ?? ['untagged'])[0];
      byTag.set(tag, [...(byTag.get(tag) ?? []), `  ${method.toUpperCase()} ${path}\n    - ${issues.join('\n    - ')}`]);
    }
  }
  const schemas = auditResponseSchemas(admin);

  console.log(`Admin document: ${operations} operations, ${withIssues} with gaps.\n`);
  for (const [tag, lines] of byTag) console.log(`[${tag}]\n${lines.join('\n')}\n`);
  const schemaGaps = Object.entries(schemas);
  console.log(`Response models with fields lacking examples: ${schemaGaps.length}`);
  for (const [name, fields] of schemaGaps) console.log(`  ${name}: ${fields.join(', ')}`);

  let vendorOps = 0;
  let vendorGaps = 0;
  const vendorByTag = new Map<string, string[]>();
  for (const [path, item] of Object.entries(vendor.paths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, Json | undefined>)[method];
      if (!op) continue;
      vendorOps += 1;
      const issues = auditOperation(vendor, path, method, op, { requireForbidden: false });
      if (issues.length === 0) continue;
      vendorGaps += 1;
      const tag = ((op.tags as string[] | undefined) ?? ['untagged'])[0];
      vendorByTag.set(tag, [...(vendorByTag.get(tag) ?? []), `  ${method.toUpperCase()} ${path}\n    - ${issues.join('\n    - ')}`]);
    }
  }
  const vendorResponseGaps = auditResponseSchemas(vendor);

  console.log(`\nVendor document: ${vendorOps} operations, ${vendorGaps} with gaps.\n`);
  for (const [tag, lines] of vendorByTag) console.log(`[${tag}]\n${lines.join('\n')}\n`);
  const vendorSchemaGapEntries = Object.entries(vendorResponseGaps);
  console.log(`Vendor response models with fields lacking examples: ${vendorSchemaGapEntries.length}`);
  for (const [name, fields] of vendorSchemaGapEntries) console.log(`  ${name}: ${fields.join(', ')}`);

  let talentOps = 0;
  let talentGaps = 0;
  const talentByTag = new Map<string, string[]>();
  for (const [path, item] of Object.entries(talent.paths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, Json | undefined>)[method];
      if (!op) continue;
      talentOps += 1;
      const issues = auditOperation(talent, path, method, op, { requireForbidden: false });
      if (issues.length === 0) continue;
      talentGaps += 1;
      const tag = ((op.tags as string[] | undefined) ?? ['untagged'])[0];
      talentByTag.set(tag, [...(talentByTag.get(tag) ?? []), `  ${method.toUpperCase()} ${path}\n    - ${issues.join('\n    - ')}`]);
    }
  }
  const talentResponseGaps = auditResponseSchemas(talent);

  console.log(`\nTalent document: ${talentOps} operations, ${talentGaps} with gaps.\n`);
  for (const [tag, lines] of talentByTag) console.log(`[${tag}]\n${lines.join('\n')}\n`);
  const talentSchemaGapEntries = Object.entries(talentResponseGaps);
  console.log(`Talent response models with fields lacking examples: ${talentSchemaGapEntries.length}`);
  for (const [name, fields] of talentSchemaGapEntries) console.log(`  ${name}: ${fields.join(', ')}`);

  let customerOps = 0;
  let customerGaps = 0;
  const customerByTag = new Map<string, string[]>();
  for (const [path, item] of Object.entries(customer.paths)) {
    for (const method of METHODS) {
      const op = (item as Record<string, Json | undefined>)[method];
      if (!op) continue;
      customerOps += 1;
      const issues = auditOperation(customer, path, method, op, { requireForbidden: false });
      if (issues.length === 0) continue;
      customerGaps += 1;
      const tag = ((op.tags as string[] | undefined) ?? ['untagged'])[0];
      customerByTag.set(tag, [...(customerByTag.get(tag) ?? []), `  ${method.toUpperCase()} ${path}\n    - ${issues.join('\n    - ')}`]);
    }
  }
  const customerResponseGaps = auditResponseSchemas(customer);

  console.log(`\nCustomer document: ${customerOps} operations, ${customerGaps} with gaps.\n`);
  for (const [tag, lines] of customerByTag) console.log(`[${tag}]\n${lines.join('\n')}\n`);
  const customerSchemaGapEntries = Object.entries(customerResponseGaps);
  console.log(`Customer response models with fields lacking examples: ${customerSchemaGapEntries.length}`);
  for (const [name, fields] of customerSchemaGapEntries) console.log(`  ${name}: ${fields.join(', ')}`);

  console.log(
    `\nWrote ${join(dir, 'admin.json')}, ${join(dir, 'vendor.json')}, ${join(dir, 'talent.json')}, ${join(dir, 'customer.json')}, and ${join(dir, 'full.json')}.`,
  );

  await app.close();
  if (
    strict &&
    (withIssues > 0 ||
      schemaGaps.length > 0 ||
      vendorGaps > 0 ||
      vendorSchemaGapEntries.length > 0 ||
      talentGaps > 0 ||
      talentSchemaGapEntries.length > 0 ||
      customerGaps > 0 ||
      customerSchemaGapEntries.length > 0)
  ) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
