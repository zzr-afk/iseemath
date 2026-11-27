import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Button } from 'antd';
import { useViewStore } from '@/stores/viewStore';
import styles from './nodeStyles.module.css';

export interface BundleNodeData extends Record<string, unknown> {
  bundleId: string;
  name: string;
  memberCount: number;
  hiddenMemberCount: number;
  summaryText: string;
  summaryMode: string;
  errorCount: number;
  color?: string;
  selected?: boolean;
}

const MODE_LABEL: Record<string, string> = {
  none: '仅计数',
  member: '成员值',
  sum: '求和',
  product: '乘积',
  avg: '平均',
  min: '最小值',
  max: '最大值',
};

function BundleNodeView({ data }: NodeProps) {
  const bundle = data as BundleNodeData;
  const setBundleCollapsed = useViewStore((state) => state.setBundleCollapsed);
  return (
    <div
      className={`${styles.bundleNode} ${bundle.selected ? styles.selected : ''}`}
      style={bundle.color ? { borderColor: bundle.color } : undefined}
    >
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
        style={{ top: '72%' }}
        className={`${styles.handle} ${styles.handleInfluence}`}
      />

      <div className={styles.header}>
        <span className={`${styles.dot} ${styles.bundleDot}`} />
        <span className={styles.title} title={bundle.name}>
          {bundle.name}
        </span>
        <span className={styles.symbol}>折叠包</span>
      </div>

      <div className={styles.value} style={bundle.errorCount > 0 ? { color: 'var(--danger)' } : undefined}>
        {bundle.summaryText}
      </div>

      <div className={styles.meta}>
        <span className={styles.badge}>{MODE_LABEL[bundle.summaryMode] ?? bundle.summaryMode}</span>
        <span>{bundle.memberCount} 个成员</span>
        {bundle.hiddenMemberCount > 0 ? (
          <span title="被分组折叠的成员不随包移动">
            含 {bundle.hiddenMemberCount} 个已收起
          </span>
        ) : null}
        {bundle.errorCount > 0 ? <span style={{ color: 'var(--danger)' }}>{bundle.errorCount} 错</span> : null}
        <span style={{ marginLeft: 'auto' }}>
          <Button
            size="small"
            type="text"
            style={{ height: 18, padding: '0 4px', fontSize: 10 }}
            onClick={(event) => {
              event.stopPropagation();
              setBundleCollapsed(bundle.bundleId, false);
            }}
          >
            展开
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
        style={{ top: '72%' }}
        className={`${styles.handle} ${styles.handleInfluence}`}
      />
    </div>
  );
}

export default memo(BundleNodeView);
