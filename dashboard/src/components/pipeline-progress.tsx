import { useMemo } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  Position,
  Handle,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StepStatus } from './sources/step-progress';

export interface PipelineStep {
  key: string;
  label: string;
  status: StepStatus;
  sublabel?: string;
}

interface PipelineProgressProps {
  steps: PipelineStep[];
  size?: 'sm' | 'lg';
  onStepClick?: (key: string) => void;
}

/* ── Status → class mappings (same as StepProgress) ── */

const DOT_CLASS: Record<StepStatus, string> = {
  completed: 'beast-step-dot-done',
  current: 'beast-step-dot-active',
  running: 'beast-step-dot-active',
  failed: 'beast-step-dot-failed',
  skipped: 'beast-step-dot-skipped',
  pending: 'beast-step-dot-pending',
};

const LABEL_CLASS: Record<StepStatus, string> = {
  completed: 'beast-step-label-done',
  current: 'beast-step-label-active',
  running: 'beast-step-label-active',
  failed: 'beast-step-label-failed',
  skipped: 'beast-step-label-skipped',
  pending: 'beast-step-label-pending',
};

const EDGE_DONE = '#dc2626';
const EDGE_PENDING = '#a39e98';

function edgeStyle(done: boolean): Record<string, unknown> {
  return done
    ? { stroke: EDGE_DONE, strokeWidth: 1 }
    : { stroke: EDGE_PENDING, strokeWidth: 1 };
}

/* ── Custom node ── */

function StepNode({ data }: { data: Record<string, unknown> }) {
  const step = data.step as PipelineStep;
  const size = (data.size as string) ?? 'sm';
  const clickable = data.clickable as boolean;
  const onClick = data.onClick as (() => void) | undefined;
  const isLg = size === 'lg';

  // Invisible handles offset from dot edge to create gap between edge and node
  const gap = isLg ? 8 : 6;
  const handleBase = { background: 'transparent', border: 'none', width: 1, height: 1 };
  const leftHandle = { ...handleBase, left: -gap };
  const rightHandle = { ...handleBase, right: -gap };

  const dotSize = isLg ? 16 : 12;

  return (
    <div
      className={clickable ? 'beast-step-clickable' : undefined}
      onClick={clickable ? onClick : undefined}
      style={{ position: 'relative', width: dotSize, height: dotSize }}
    >
      <Handle type="target" position={Position.Left} style={leftHandle} />
      <span className={`beast-step-dot ${DOT_CLASS[step.status]}${isLg ? ' beast-step-dot-lg' : ''}`} />
      {/* Label above dot — absolutely positioned, no effect on node size */}
      <span
        className={`beast-step-label ${LABEL_CLASS[step.status]}`}
        style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8 }}
      >
        {step.label}
      </span>
      {/* Sublabel below dot */}
      {step.sublabel && (
        <span
          className="beast-step-sublabel"
          style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4 }}
        >
          {step.sublabel}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={rightHandle} />
    </div>
  );
}

const nodeTypes = { step: StepNode };

function getStep(steps: PipelineStep[], key: string): PipelineStep {
  return steps.find(s => s.key === key) ?? { key, label: key, status: 'pending' };
}

/* ── Main component ── */

function PipelineInner({ steps, size = 'sm', onStepClick }: PipelineProgressProps) {
  const clone = getStep(steps, 'clone');
  const analysis = getStep(steps, 'analysis');
  const secTools = getStep(steps, 'security-tools');
  const aiResearch = getStep(steps, 'ai-research');
  const imp = getStep(steps, 'import');
  const triageReport = getStep(steps, 'triage-report');

  const canClick = (s: PipelineStep) => !!onStepClick && s.status === 'completed';
  const isLg = size === 'lg';

  // Layout: clone → analysis → fork(secTools, aiResearch) → import → triageReport
  const s = isLg ? 1.3 : 1;

  const nodes: Node[] = useMemo(() => [
    { id: 'clone', type: 'step', position: { x: -2 * s, y: 55 * s }, data: { step: clone, size, clickable: canClick(clone), onClick: () => onStepClick?.('clone') } },
    { id: 'analysis', type: 'step', position: { x: 160 * s, y: 55 * s }, data: { step: analysis, size, clickable: canClick(analysis), onClick: () => onStepClick?.('analysis') } },
    { id: 'sectools', type: 'step', position: { x: 370 * s, y: 18 * s }, data: { step: secTools, size, clickable: canClick(secTools), onClick: () => onStepClick?.('security-tools') } },
    { id: 'airesearch', type: 'step', position: { x: 370 * s, y: 94 * s }, data: { step: aiResearch, size, clickable: canClick(aiResearch), onClick: () => onStepClick?.('ai-research') } },
    { id: 'import', type: 'step', position: { x: 580 * s, y: 55 * s }, data: { step: imp, size, clickable: canClick(imp), onClick: () => onStepClick?.('import') } },
    { id: 'triagereport', type: 'step', position: { x: 780 * s, y: 55 * s }, data: { step: triageReport, size, clickable: canClick(triageReport), onClick: () => onStepClick?.('triage-report') } },
  ], [steps, size, onStepClick]);

  const cloneDone = clone.status === 'completed';
  const analysisDone = analysis.status === 'completed';
  const secToolsDone = secTools.status === 'completed';
  const aiResearchDone = aiResearch.status === 'completed';

  const sq = { borderRadius: 0 };
  const edges: Edge[] = useMemo(() => [
    { id: 'e-clone-analysis', source: 'clone', target: 'analysis', type: 'smoothstep', pathOptions: sq, style: edgeStyle(cloneDone) },
    { id: 'e-analysis-sectools', source: 'analysis', target: 'sectools', type: 'smoothstep', pathOptions: sq, style: edgeStyle(analysisDone) },
    { id: 'e-analysis-airesearch', source: 'analysis', target: 'airesearch', type: 'smoothstep', pathOptions: sq, style: edgeStyle(analysisDone) },
    { id: 'e-sectools-import', source: 'sectools', target: 'import', type: 'smoothstep', pathOptions: sq, style: edgeStyle(secToolsDone) },
    { id: 'e-airesearch-import', source: 'airesearch', target: 'import', type: 'smoothstep', pathOptions: sq, style: edgeStyle(aiResearchDone) },
    { id: 'e-import-triagereport', source: 'import', target: 'triagereport', type: 'smoothstep', pathOptions: sq, style: edgeStyle(imp.status === 'completed') },
  ], [steps]);

  const h = isLg ? 190 : 150;

  return (
    <div style={{ width: '100%', height: h }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
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

export function PipelineProgress(props: PipelineProgressProps) {
  return (
    <ReactFlowProvider>
      <PipelineInner {...props} />
    </ReactFlowProvider>
  );
}
