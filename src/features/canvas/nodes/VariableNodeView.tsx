import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import styles from './nodeStyles.module.css';

export interface VariableNodeData extends Record<string, unknown> {
  label: string;
  name: string;
  unit?: string;
  valueText: string;
  error?: string;
  selected?: boolean;
  /** Free input: drawn as a dashed "source" node, like the dependency graph. */
  source?: boolean;
  /** Only non-scalar cards (data tables) carry a badge; every quantity looks the same. */
  badge?: string;
}

function VariableNodeView({ data }: NodeProps) {
  const variable = data as VariableNodeData;
  const hasError = Boolean(variable.error);

  return (
    <div
      className={`${styles.node} ${variable.source ? styles.sourceNode : ''} ${
        variable.selected ? styles.selected : ''
      } ${hasError ? styles.errorNode : ''}`}
    >
      <Handle
        id="h-in"
        type="target"
        position={Position.Top}
        className={styles.handle}
      />
      <Handle
        id="dep-in"
        type="target"
        position={Position.Left}
        className={`${styles.handle} ${styles.handleDependency}`}
      />
      <Handle
        id="influence-in"
        type="target"
        position={Position.Left}
        style={{ top: '70%' }}
        className={`${styles.handle} ${styles.handleInfluence}`}
      />

      <div className={styles.header}>
        <span className={styles.dot} />
        <span className={styles.title} title={variable.label}>
          {variable.label}
        </span>
        {variable.name !== variable.label ? (
          <span className={styles.symbol}>{variable.name}</span>
        ) : null}
      </div>

      {hasError ? (
        <div className={styles.valueError} title={variable.error}>
          {variable.error}
        </div>
      ) : (
        <div className={styles.value}>{variable.valueText}</div>
      )}

      {variable.badge || variable.unit ? (
        <div className={styles.meta}>
          {variable.badge ? <span className={styles.badge}>{variable.badge}</span> : null}
          {variable.unit ? <span>{variable.unit}</span> : null}
        </div>
      ) : null}

      <Handle
        id="dep-out"
        type="source"
        position={Position.Right}
        className={`${styles.handle} ${styles.handleDependency}`}
      />
      <Handle
        id="h-out"
        type="source"
        position={Position.Bottom}
        className={styles.handle}
      />
      <Handle
        id="influence-out"
        type="source"
        position={Position.Right}
        style={{ top: '70%' }}
        className={`${styles.handle} ${styles.handleInfluence}`}
      />
    </div>
  );
}

export default memo(VariableNodeView);
