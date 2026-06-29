import type { AgentTreeNode } from "@/lib/analytics/agents";
import { formatCost, formatTokens } from "@/lib/format";

interface AgentTreeProps {
  tree: AgentTreeNode[];
}

/** One node row with ASCII tree connectors, rendered depth-first. */
function NodeRows({
  node,
  prefix,
  isLast,
  isRoot,
}: {
  node: AgentTreeNode;
  prefix: string;
  isLast: boolean;
  isRoot: boolean;
}) {
  const connector = isRoot ? "" : isLast ? "└── " : "├── ";
  const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");

  return (
    <>
      <div className="whitespace-pre font-mono text-sm leading-6">
        <span className="text-slate-600">{prefix + connector}</span>
        {node.type === "tool" ? (
          <span className="text-violet-300">🔧 {node.key}</span>
        ) : (
          <span className="text-slate-200">{node.key}</span>
        )}
        <span className="ml-2 text-xs text-slate-500">
          {node.type === "tool"
            ? `${formatTokens(node.calls)} invocation(s)`
            : `${formatCost(node.cost)} · ${formatTokens(node.totalTokens)} tok · ${formatTokens(node.calls)} call(s)`}
        </span>
      </div>
      {node.children.map((c, i) => (
        <NodeRows
          key={`${c.type}:${c.key}`}
          node={c}
          prefix={childPrefix}
          isLast={i === node.children.length - 1}
          isRoot={false}
        />
      ))}
    </>
  );
}

/** Execution tree (US3 §3): parent/child agents + tool leaves, from ObservationEvent edges. */
export function AgentTree({ tree }: AgentTreeProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Execution hierarchy</h3>
      {tree.length === 0 ? (
        <p className="text-sm text-slate-500">No attributed agents in range.</p>
      ) : (
        <div className="overflow-x-auto">
          {tree.map((root, i) => (
            <NodeRows key={root.key} node={root} prefix="" isLast={i === tree.length - 1} isRoot />
          ))}
        </div>
      )}
    </div>
  );
}
