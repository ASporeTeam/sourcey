import type { NormalizedSchema } from "../../core/types.js";
import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";
import { formatSchemaType, type SchemaUsage } from "../../core/schema.js";
import { Markdown } from "../ui/Markdown.js";
import { SchemaDatatype } from "./SchemaDatatype.js";
import { SchemaExamples } from "./SchemaExamples.js";
import { DisclosureIcon } from "../ui/DisclosureIcon.js";
import { FieldRow } from "./FieldRow.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";
import { Select } from "../ui/Select.js";
import { referenceFieldPath, hasObjectFields, hasReferenceFields, innerSchema, objectFields, REFERENCE_SCHEMA_MAX_DEPTH } from "../../core/reference-identity.js";

interface SchemaViewProps {
  schema: NormalizedSchema;
  requiredFields?: string[];
  depth?: number;
  maxDepth?: number;
  showDescription?: boolean;
  anchorRoot?: string;
  /** The way the schema travels; fields that never travel that way are left out. */
  usage?: SchemaUsage;
}

/**
 * Recursive schema renderer — stacked property layout.
 * Each property: name + type on one line, description below, children indented.
 */
export function SchemaView({
  schema,
  requiredFields,
  depth = 0,
  maxDepth = REFERENCE_SCHEMA_MAX_DEPTH,
  showDescription = true,
  anchorRoot,
  usage,
}: SchemaViewProps) {
  const { messages } = useContext(OptionsContext);
  if (depth >= maxDepth) {
    return <div class="schema-max-depth">Max depth reached</div>;
  }

  // Handle allOf composition
  if (schema.allOf?.length) {
    const { fields, parts } = compositionFields(schema, anchorRoot, requiredFields, usage, depth, maxDepth);
    return (
      <div class="schema-composition">
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        {fields.length > 0 && <FieldList fields={fields} maxDepth={maxDepth} usage={usage} />}
        {parts.map((part, index) => (
          <SchemaView key={index} schema={part.schema} requiredFields={part.required} depth={part.depth} maxDepth={maxDepth} anchorRoot={part.anchorRoot} usage={usage} />
        ))}
        <SchemaExamples schema={schema} />
      </div>
    );
  }

  // Handle anyOf/oneOf
  if (schema.oneOf?.length || schema.anyOf?.length) {
    const variants = schema.oneOf ?? schema.anyOf ?? [];
    const label = schema.oneOf ? messages.oneOf : messages.anyOf;
    const discriminator = schema.discriminator?.propertyName ?? Object.keys(variants[0].properties ?? {}).find(name => {
      const values = variants.map(variant => discriminantLabel(variant.properties?.[name]));
      return values.every(value => value !== undefined) && new Set(values).size === variants.length;
    });
    return (
      <div class="schema-variants" data-schema-variants>
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        <div class="schema-variant-label" data-schema-fallback>{label}</div>
        {hasObjectFields(schema) && <SchemaView schema={{ ...schema, oneOf: undefined, anyOf: undefined, description: undefined, example: undefined, examples: undefined }} depth={depth + 1} maxDepth={maxDepth} anchorRoot={anchorRoot} usage={usage} />}
        <label class="schema-variant-control not-prose" hidden>
          <span class="schema-variant-label">{label}</span>
          <Select data-schema-picker>
            {variants.map((sub, i) => <option value={String(i)}>{variantLabel(sub, i, discriminator, messages.option)}</option>)}
          </Select>
        </label>
        {variants.map((sub, i) => (
          <div key={i} class="schema-variant-option" data-schema-variant={String(i)}>
            <SchemaView schema={sub} depth={depth + 1} maxDepth={maxDepth} anchorRoot={anchorRoot && referenceFieldPath(anchorRoot, schema.oneOf ? "oneOf" : "anyOf", String(i))} usage={usage} />
          </div>
        ))}
        <SchemaExamples schema={schema} />
      </div>
    );
  }

  // Named properties and typed map values use the same field presentation.
  if (hasObjectFields(schema)) {
    const fields = fieldRows(schema, anchorRoot, requiredFields, usage, depth);
    return (
      <>
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        {fields.length > 0 && <FieldList fields={fields} maxDepth={maxDepth} usage={usage} />}
        <SchemaExamples schema={schema} />
      </>
    );
  }

  // Array
  if (schema.type === "array" && schema.items) {
    return (
      <>
        {showDescription && schema.description && (
          <div class="schema-description">
            <Markdown content={schema.description} />
          </div>
        )}
        <div class="schema-array-info">
          <SchemaDatatype schema={schema} />
        </div>
        {hasReferenceFields(schema.items, usage) && (
          <details class="schema-expandable">
            <summary class="schema-expandable-toggle">
              <DisclosureIcon />
              Show child attributes
            </summary>
            <div class="schema-expandable-content">
              <SchemaView
                schema={schema.items}
                depth={depth + 1}
                maxDepth={maxDepth}
                anchorRoot={anchorRoot && referenceFieldPath(anchorRoot, "items")}
                usage={usage}
              />
            </div>
          </details>
        )}
        <SchemaExamples schema={schema} />
      </>
    );
  }

  // Simple type
  return (
    <>
      {showDescription && schema.description && (
        <div class="schema-description">
          <Markdown content={schema.description} />
        </div>
      )}
      <SchemaDatatype schema={schema} />
      <SchemaExamples schema={schema} />
    </>
  );
}

/** A field list row, anchored where its declaration sits. */
interface FieldEntry {
  name: string;
  schema: NormalizedSchema;
  required: boolean;
  depth: number;
  id?: string;
}

/** A composition part shown as a view of its own. */
interface CompositionPart {
  schema: NormalizedSchema;
  anchorRoot?: string;
  required: string[];
  depth: number;
}

/** An object's rows. A field is required by the object or by a composition it is part of. */
function fieldRows(schema: NormalizedSchema, anchorRoot: string | undefined, inherited: string[] | undefined, usage: SchemaUsage | undefined, depth: number): FieldEntry[] {
  const required = new Set([...inherited ?? [], ...schema.required ?? []]);
  return objectFields(schema, usage, required).map(({ name, schema, required, path }) => ({ name, schema, required, depth, id: anchorRoot && referenceFieldPath(anchorRoot, ...path) }));
}

/**
 * An allOf reads as one object: its own fields and those of each part that is
 * only fields, nested compositions included, form one list, each row keeping
 * its part's anchor. A part with more to show (a description, examples or
 * alternatives) stays a view of its own after the list.
 */
function compositionFields(
  schema: NormalizedSchema,
  anchorRoot: string | undefined,
  inherited: string[] | undefined,
  usage: SchemaUsage | undefined,
  depth: number,
  maxDepth: number,
): { fields: FieldEntry[]; parts: CompositionPart[] } {
  const required = [...inherited ?? [], ...schema.required ?? []];
  const fields = depth + 1 < maxDepth ? fieldRows(schema, anchorRoot, required, usage, depth + 1) : [];
  const parts: CompositionPart[] = [];
  schema.allOf!.forEach((part, index) => {
    const root = anchorRoot && referenceFieldPath(anchorRoot, "allOf", String(index));
    if (depth + 1 >= maxDepth || !onlyFields(part)) parts.push({ schema: part, anchorRoot: root, required, depth: depth + 1 });
    else if (part.allOf?.length) {
      const nested = compositionFields(part, root, required, usage, depth + 1, maxDepth);
      fields.push(...nested.fields);
      parts.push(...nested.parts);
    } else fields.push(...fieldRows(part, root, required, usage, depth + 1));
  });
  return { fields, parts };
}

/** A part that adds fields and nothing else to read. */
function onlyFields(schema: NormalizedSchema): boolean {
  return (hasObjectFields(schema) || !!schema.allOf?.length)
    && !schema.oneOf?.length && !schema.anyOf?.length
    && !schema.description && schema.example === undefined && !schema.examples?.length;
}

function FieldList({ fields, maxDepth, usage }: { fields: FieldEntry[]; maxDepth: number; usage?: SchemaUsage }) {
  return (
    <div class="params-list">
      {fields.map((field, index) => <PropertyRow key={field.id ?? index} {...field} maxDepth={maxDepth} usage={usage} />)}
    </div>
  );
}

function variantLabel(schema: NormalizedSchema, index: number, discriminator: string | undefined, option: string): string {
  if (schema.title || schema.refName || schema.name) return schema.title ?? schema.refName ?? schema.name!;
  const tag = discriminator ? discriminantLabel(schema.properties?.[discriminator]) : undefined;
  if (tag !== undefined) return tag;
  return `${option} ${index + 1} · ${formatSchemaType(schema)}`;
}

function discriminantLabel(schema: NormalizedSchema | undefined): string | undefined {
  const value = schema?.const !== undefined ? schema.const : schema?.enum?.length === 1 ? schema.enum[0] : undefined;
  return value === null || ["string", "number", "boolean"].includes(typeof value) ? String(value) : undefined;
}

function PropertyRow({ id, name, schema, required, depth, maxDepth, usage }: FieldEntry & { maxDepth: number; usage?: SchemaUsage }) {
  const inner = innerSchema(schema);
  const hasInner = hasReferenceFields(inner, usage);

  return (
    <>
    {id && <AnchorAliases target={id} />}
    <FieldRow
      id={id}
      name={name}
      schema={schema}
      required={required}
      readOnly={schema.readOnly}
      writeOnly={schema.writeOnly}
      deprecated={schema.deprecated}
      description={schema.description && <Markdown content={schema.description} class="prose-sm" />}
      examples={!hasInner && <SchemaExamples schema={schema} />}
      nested={hasInner ? [{
        content: (
          <SchemaView
            schema={inner}
            depth={depth + 1}
            maxDepth={maxDepth}
            showDescription={inner !== schema}
            anchorRoot={id && (inner === schema ? id : referenceFieldPath(id, "items"))}
            usage={usage}
          />
        ),
      }] : undefined}
    />
    </>
  );
}
