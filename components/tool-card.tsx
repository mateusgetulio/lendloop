import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Badge } from "./common";
import { label } from "@/lib/catalog";
export type Tool = FunctionReturnType<typeof api.tools.list>["page"][number];
export function ToolCard({
  tool,
  children,
}: {
  tool: Tool;
  children?: React.ReactNode;
}) {
  return (
    <li className="card">
      <p className="eyebrow">{label(tool.category)}</p>
      <h2 className="card-title">
        <Link className="card-link" href={`/tools/${tool._id}`}>
          {tool.name}
        </Link>
      </h2>
      <Badge>{tool.availability}</Badge>
      <p className="meta">Condition: {label(tool.condition)}</p>
      <p className="owner">
        {tool.ownerName}
        {tool.trustedLender && (
          <span className="badge info">Trusted Lender</span>
        )}
      </p>
      {children}
    </li>
  );
}
