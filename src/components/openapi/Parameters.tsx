import type { NormalizedParameter } from "../../core/types.js";
import { FieldRow } from "../schema/FieldRow.js";
import { Markdown } from "../ui/Markdown.js";
import { MediaTypeDetails, contentMediaTypes, firstContentSchema } from "./MediaTypeDetails.js";
import { Fragment } from "preact";
import { parameterFieldAnchor } from "../../core/reference-identity.js";
import { AnchorAliases } from "../ui/AnchorAliases.js";

interface ParametersProps {
  parameters: NormalizedParameter[];
  anchorRoot?: string;
}

export function Parameters({ parameters, anchorRoot }: ParametersProps) {
  if (!parameters.length) return null;

  return (
    <div class="params-list">
      {parameters.map((param) => {
        const mediaTypes = contentMediaTypes(param.content);
        const id = anchorRoot && parameterFieldAnchor(anchorRoot, param);
        return (
          <Fragment key={`${param.in}-${param.name}`}>
          {id && <AnchorAliases target={id} />}
          <FieldRow
            id={id}
            name={param.name}
            schema={param.schema ?? firstContentSchema(param.content)}
            type={mediaTypes.length > 0 && (
              <span class="param-type">
                <code class="text-xs font-medium text-[rgb(var(--color-gray-700))] dark:text-[rgb(var(--color-gray-300))]">
                  {mediaTypes.join(", ")}
                </code>
              </span>
            )}
            required={param.required}
            deprecated={param.deprecated}
            location={param.in !== "argument" ? param.in : undefined}
            description={(param.description || mediaTypes.length > 0) && (
              <>
                {param.description && <Markdown content={param.description} class="prose-sm" />}
                {param.content && Object.entries(param.content).map(([mediaType, content]) => (
                  <MediaTypeDetails key={mediaType} mediaTypes={[mediaType]} content={content} showLabel={true} />
                ))}
              </>
            )}
          />
          </Fragment>
        );
      })}
    </div>
  );
}
