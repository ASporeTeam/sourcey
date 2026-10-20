import { useContext } from "preact/hooks";
import { OptionsContext } from "../../renderer/context.js";
import type { NormalizedSchema } from "../../core/types.js";
import { schemaRange } from "../../utils/http.js";
import { formatSchemaType } from "../../core/schema.js";

interface SchemaDatatypeProps {
  schema: NormalizedSchema;
  /** Keep compound type facts together in a field header; a single badge needs no group. */
  grouped?: boolean;
}

/**
 * Renders type information as a pill badge.
 * Combines type, format, and nullable into one label.
 */
export function SchemaDatatype({ schema, grouped = false }: SchemaDatatypeProps) {
  const targets = useContext(OptionsContext).referenceTargets;
  const reference = schema.refName ?? schema.items?.refName;
  const target = reference ? targets?.schemas[reference] : undefined;
  const base = formatSchemaType(schema);
  const suffix = schema.nullable ? " | null" : "";
  // A format that only repeats the type (`format: string`) says nothing more.
  const fmt = schema.format && ![schema.type].flat().includes(schema.format) ? `<${schema.format}>` : "";
  const typeLabel = `${base}${fmt}${suffix}`;
  const enumeration = renderEnum(schema.enum) ||
    (schema.type === "array" && renderEnum(schema.items?.enum));
  const range = schemaRange(schema);

  const content = (
    <>
      {target ? <a class="json-property-type json-property-reference" href={target.href}>{typeLabel}</a> : <span class="json-property-type">{typeLabel}</span>}
      {enumeration}
      {range && (
        <span class="json-property-range">{range}</span>
      )}
      {schema.default !== undefined && (
        <span class="json-property-default-value">{String(schema.default)}</span>
      )}
    </>
  );
  return grouped && (enumeration || range || schema.default !== undefined)
    ? <span class="param-type">{content}</span>
    : content;
}

function renderEnum(values?: unknown[]) {
  if (!values?.length) return null;
  return (
    <span class="json-property-enum">
      {values.map((v, i) => (
        <span key={i} class="json-property-enum-item">
          {String(v)}
        </span>
      ))}
    </span>
  );
}

