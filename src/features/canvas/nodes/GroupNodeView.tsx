import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Button } from 'antd';
import { useViewStore } from '@/stores/viewStore';
import styles from './nodeStyles.module.css';

export interface GroupNodeData extends Record<string, unknown> {
  nodeId: string;
  label: string;
  name: string;
  childCount: number;
  collapsed: boolean;
  selected?: boolean;
}

function GroupNodeView({ data }: NodeProps) {
  const group = data as GroupNodeData;
  const toggleGroup = useViewStore((state) => state.toggleGroup);

  return (
    <div className={`${styles.groupNode} ${group.selected ? styles.selected : ''}`}>
      <Handle id="h-in" type="target" position={Position.Top} className={styles.handle} />
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
        <span className={`${styles.dot} ${styles.groupDot}`} />
        <span className={styles.title} title={group.label}>
          {group.label}
        </span>
        <span className={styles.symbol}>{group.name}</span>
      </div>
      <div className={styles.meta}>
        <span>分组 · {group.childCount} 个下级</span>
        <span style={{ marginLeft: 'auto' }}>
          <Button
            size="small"
            type="text"
            style={{ height: 18, padding: '0 4px', fontSize: 10 }}
            onClick={(event) => {
              event.stopPropagation();
              toggleGroup(group.nodeId);
            }}
          >
            {group.collapsed ? '展开' : '收起'}
          </Button>
        </span>
      </div>
      <Handle id="h-out" type="source" position={Position.Bottom} className={styles.handle} />
      <Handle
        id="dep-out"
        type="source"
        position={Position.Right}
        className={`${styles.handle} ${styles.handleDependency}`}
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

export default memo(GroupNodeView);
