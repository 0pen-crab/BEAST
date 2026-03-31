import { useState, useCallback } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  Position,
  Handle,
  ReactFlowProvider,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const EDGE_DONE = '#dc2626';
const EDGE_PENDING = '#a39e98';

function edgeStyle(done: boolean): Record<string, unknown> {
  return done
    ? { stroke: EDGE_DONE, strokeWidth: 1 }
    : { stroke: EDGE_PENDING, strokeWidth: 1 };
}

function StepNode({ data }: { data: Record<string, unknown> }) {
  const label = data.label as string;
  const done = data.done as boolean;
  const gap = 6;
  const handleBase = { background: 'transparent', border: 'none', width: 1, height: 1 };

  return (
    <div style={{ position: 'relative', width: 12, height: 12 }}>
      <Handle type="target" position={Position.Left} style={{ ...handleBase, left: -gap }} />
      <span
        className={done ? 'beast-step-dot beast-step-dot-done' : 'beast-step-dot beast-step-dot-pending'}
      />
      <span
        className={done ? 'beast-step-label beast-step-label-done' : 'beast-step-label beast-step-label-pending'}
        style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8 }}
      >
        {label}
      </span>
      <Handle type="source" position={Position.Right} style={{ ...handleBase, right: -gap }} />
    </div>
  );
}

function JoinNode() {
  return (
    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b6560' }}>
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none', width: 1, height: 1 }} />
      <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 'none', width: 1, height: 1 }} />
    </div>
  );
}

const nodeTypes = { step: StepNode, join: JoinNode };

const INITIAL_NODES: Node[] = [
  { id: 'clone', type: 'step', position: { x: 0, y: 55 }, data: { label: 'Clone', done: true } },
  { id: 'analysis', type: 'step', position: { x: 160, y: 55 }, data: { label: 'Analysis', done: true } },
  { id: 'sectools', type: 'step', position: { x: 370, y: 18 }, data: { label: 'Security Tools', done: false } },
  { id: 'airesearch', type: 'step', position: { x: 370, y: 94 }, data: { label: 'AI Research', done: false } },
  { id: 'import', type: 'step', position: { x: 580, y: 55 }, data: { label: 'Import Findings', done: false } },
  { id: 'triagereport', type: 'step', position: { x: 780, y: 55 }, data: { label: 'Triage & Report', done: false } },
];

const sq = { borderRadius: 0 };

const EDGES: Edge[] = [
  { id: 'e1', source: 'clone', target: 'analysis', type: 'smoothstep', pathOptions: sq, style: edgeStyle(true) },
  { id: 'e2', source: 'analysis', target: 'sectools', type: 'smoothstep', pathOptions: sq, style: edgeStyle(true) },
  { id: 'e3', source: 'analysis', target: 'airesearch', type: 'smoothstep', pathOptions: sq, style: edgeStyle(true) },
  { id: 'e4', source: 'sectools', target: 'import', type: 'smoothstep', pathOptions: sq, style: edgeStyle(false) },
  { id: 'e5', source: 'airesearch', target: 'import', type: 'smoothstep', pathOptions: sq, style: edgeStyle(false) },
  { id: 'e7', source: 'import', target: 'triagereport', type: 'smoothstep', pathOptions: sq, style: edgeStyle(false) },
];

function PipelineTestInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [copied, setCopied] = useState(false);

  const copyCoords = useCallback(() => {
    const coords = nodes.map(n => `${n.id}: { x: ${Math.round(n.position.x)}, y: ${Math.round(n.position.y)} }`).join('\n');
    navigator.clipboard.writeText(coords);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [nodes]);

  return (
    <div style={{ padding: 24 }}>
      <h1 className="beast-page-title">Pipeline Layout Test</h1>
      <p className="beast-page-subtitle">Drag nodes to desired positions, then copy coordinates</p>
      <button onClick={copyCoords} className="beast-btn beast-btn-primary" style={{ margin: '16px 0' }}>
        {copied ? 'Copied!' : 'Copy Coordinates'}
      </button>
      <div className="beast-card" style={{ height: 300, width: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={EDGES}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          nodesConnectable={false}
          elementsSelectable={true}
          nodesDraggable={true}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      <pre className="beast-code-block" style={{ marginTop: 16 }}>
        {nodes.map(n => `${n.id}: { x: ${Math.round(n.position.x)}, y: ${Math.round(n.position.y)} }`).join('\n')}
      </pre>
    </div>
  );
}

export function PipelineTestPage() {
  return (
    <ReactFlowProvider>
      <PipelineTestInner />
    </ReactFlowProvider>
  );
}
