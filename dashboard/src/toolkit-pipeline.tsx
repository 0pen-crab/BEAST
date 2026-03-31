import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  type Node,
  type Edge,
  Position,
  Handle,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type StepStatus = 'completed' | 'running' | 'pending';

const DOT: Record<StepStatus, string> = {
  completed: 'beast-step-dot-done',
  running: 'beast-step-dot-active',
  pending: 'beast-step-dot-pending',
};

const LABEL: Record<StepStatus, string> = {
  completed: 'beast-step-label-done',
  running: 'beast-step-label-active',
  pending: 'beast-step-label-pending',
};

function StepNode({ data }: { data: Record<string, unknown> }) {
  const status = data.status as StepStatus;
  const label = data.label as string;
  const sublabel = data.sublabel as string | undefined;
  const handleBase = { background: 'transparent', border: 'none', width: 1, height: 1 };

  return (
    <div style={{ position: 'relative', width: 12, height: 12 }}>
      <Handle type="target" position={Position.Left} style={{ ...handleBase, left: -6 }} />
      <span className={`beast-step-dot ${DOT[status]}`} />
      <span
        className={`beast-step-label ${LABEL[status]}`}
        style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 4 }}
      >
        {label}
      </span>
      {sublabel && (
        <span
          className="beast-step-sublabel"
          style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 }}
        >
          {sublabel}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ ...handleBase, right: -6 }} />
    </div>
  );
}

const nodeTypes = { step: StepNode };
const EDGE_DONE = '#dc2626';
const EDGE_PENDING = '#4a4542';
const sq = { borderRadius: 0 };

// Node positions designed for zoom=1 rendering.
// Graph spans ~780px wide, ~90px tall.
const NODES: Node[] = [
  { id: 'clone', type: 'step', position: { x: 0, y: 42 }, data: { label: 'Clone', status: 'completed', sublabel: '3s' } },
  { id: 'analysis', type: 'step', position: { x: 160, y: 42 }, data: { label: 'Analysis', status: 'completed', sublabel: '1m 42s' } },
  { id: 'sectools', type: 'step', position: { x: 370, y: 0 }, data: { label: 'Sec Tools', status: 'completed', sublabel: '2m 39s' } },
  { id: 'airesearch', type: 'step', position: { x: 370, y: 84 }, data: { label: 'AI Research', status: 'completed', sublabel: '2m 15s' } },
  { id: 'import', type: 'step', position: { x: 580, y: 42 }, data: { label: 'Import', status: 'completed', sublabel: '2s' } },
  { id: 'triagereport', type: 'step', position: { x: 750, y: 42 }, data: { label: 'Triage & Report', status: 'completed', sublabel: '45s' } },
];

const EDGES: Edge[] = [
  { id: 'e1', source: 'clone', target: 'analysis', type: 'smoothstep', pathOptions: sq, style: { stroke: EDGE_DONE, strokeWidth: 2 } },
  { id: 'e2', source: 'analysis', target: 'sectools', type: 'smoothstep', pathOptions: sq, style: { stroke: EDGE_DONE, strokeWidth: 2 } },
  { id: 'e3', source: 'analysis', target: 'airesearch', type: 'smoothstep', pathOptions: sq, style: { stroke: EDGE_DONE, strokeWidth: 2 } },
  { id: 'e4', source: 'sectools', target: 'import', type: 'smoothstep', pathOptions: sq, style: { stroke: EDGE_DONE, strokeWidth: 2 } },
  { id: 'e5', source: 'airesearch', target: 'import', type: 'smoothstep', pathOptions: sq, style: { stroke: EDGE_DONE, strokeWidth: 2 } },
  { id: 'e6', source: 'import', target: 'triagereport', type: 'smoothstep', pathOptions: sq, style: { stroke: EDGE_DONE, strokeWidth: 2 } },
];

function Pipeline() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={NODES}
        edges={EDGES}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  );
}

const el = document.getElementById('beast-pipeline-mount');
if (el) {
  createRoot(el).render(
    <ReactFlowProvider>
      <Pipeline />
    </ReactFlowProvider>,
  );
}
