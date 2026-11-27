import { useEffect, type ReactNode } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  BarChartOutlined,
  UnorderedListOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  RedoOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import CanvasWorkspace from '@/features/canvas/CanvasWorkspace';
import DataListWorkspace from '@/features/list/DataListWorkspace';
import LogWorkspace from '@/features/logs/LogWorkspace';
import VariableTree from '@/features/tree/VariableTree';
import InspectorPanel from '@/features/inspector/InspectorPanel';
import ProjectMenu from '@/features/project/ProjectMenu';
import BundlePanel from '@/features/bundle/BundlePanel';
import CollectionEditor from '@/features/collection/CollectionEditor';
import RelationsPanel from '@/features/relations/RelationsPanel';
import { useProjectStore } from '@/stores/projectStore';
import { deleteNode, dissolveBundle } from '@/core/model/commands';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore, type WorkspaceTab } from '@/stores/uiStore';
import styles from './WorkspaceShell.module.css';

const TABS: { key: WorkspaceTab; label: string; icon: ReactNode }[] = [
  { key: 'canvas', label: '建模画布', icon: <ApartmentOutlined /> },
  { key: 'data', label: '数据列表', icon: <UnorderedListOutlined /> },
  { key: 'relations', label: '关系结构', icon: <DeploymentUnitOutlined /> },
  { key: 'logs', label: '日志分析', icon: <BarChartOutlined /> },
  { key: 'compare', label: '对比分析', icon: <ExperimentOutlined /> },
];

export default function WorkspaceShell() {
  const project = useProjectStore((state) => state.project);
  const undoStack = useProjectStore((state) => state.undoStack);
  const redoStack = useProjectStore((state) => state.redoStack);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const selectedBundleId = useUiStore((state) => state.selectedBundleId);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const selectBundle = useUiStore((state) => state.selectBundle);
  const setBundleCollapsed = useViewStore((state) => state.setBundleCollapsed);
  const activeTab = useUiStore((state) => state.activeTab);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const focusedRelationId = useUiStore((state) => state.focusedRelationId);
  const relationFocusNonce = useUiStore((state) => state.relationFocusNonce);
  const runCommand = useProjectStore((state) => state.runCommand);
  const docRevision = useProjectStore((state) => state.docRevision);
  const errors = useRuntimeStore((state) => state.errors);
  const readOnly = useProjectStore((state) => state.readOnly);

  const nodes = Object.values(project.nodes);
  const quantityCount = nodes.filter((node) => node.kind === 'variable').length;
  const relationCount = nodes.filter(
    (node) => node.kind === 'variable' && node.variableKind === 'formula',
  ).length;
  const problemEntries = Object.entries(errors).filter(([, message]) => Boolean(message));
  const problemCount = problemEntries.length;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        (selectedNodeIds.length > 0 || selectedBundleId) &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        if (selectedBundleId) {
          runCommand('解散折叠包', (draft) => dissolveBundle(draft, selectedBundleId));
          setBundleCollapsed(selectedBundleId, false);
          selectBundle(null);
          return;
        }
        runCommand('删除节点', (draft) => {
          for (const nodeId of selectedNodeIds) deleteNode(draft, nodeId);
        });
        selectNodes([]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    undo,
    redo,
    selectedNodeIds,
    selectedBundleId,
    runCommand,
    selectNodes,
    selectBundle,
    setBundleCollapsed,
  ]);

  // Clicking a dependency arrow focuses its row; make sure the relations
  // workspace is the one on screen when that happens.
  useEffect(() => {
    if (focusedRelationId) setActiveTab('relations');
  }, [focusedRelationId, relationFocusNonce, setActiveTab]);

  const tabCount = (key: WorkspaceTab): string | null => {
    if (key === 'canvas' || key === 'data') return `${quantityCount} 个量`;
    if (key === 'relations') return `${relationCount} 条关系`;
    if (key === 'logs') return project.datasets.length > 0 ? `${project.datasets.length} 个数据集` : null;
    return null;
  };

  return (
    <div className={styles.shell}>
      <div className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>i</span>
            <div>
              <h1>iseemath</h1>
              <p>数值建模 · 真实日志分析</p>
            </div>
          </div>

          <div className={styles.topActions}>
            <span className={styles.projectName} title="当前项目">
              {project.name}
            </span>
            <ProjectMenu />
            <Tooltip title="撤销 Ctrl+Z">
              <Button
                type="text"
                size="small"
                icon={<UndoOutlined />}
                disabled={undoStack.length === 0 || readOnly}
                onClick={undo}
              />
            </Tooltip>
            <Tooltip title="重做 Ctrl+Shift+Z">
              <Button
                type="text"
                size="small"
                icon={<RedoOutlined />}
                disabled={redoStack.length === 0 || readOnly}
                onClick={redo}
              />
            </Tooltip>
            <button
              type="button"
              className={`${styles.problemPill} ${problemCount > 0 ? styles.problemPillBad : ''}`}
              title={problemCount > 0 ? '查看问题' : '模型正常'}
              onClick={() => setActiveTab('relations')}
            >
              {problemCount > 0 ? <WarningOutlined /> : <span className={styles.okDot} />}
              {problemCount > 0 ? `${problemCount} 个问题` : '模型正常'}
            </button>
          </div>
        </header>

        {readOnly && (
          <div className={styles.readOnlyBar}>
            本页为只读：另一个标签页正在编辑该项目。关闭对方标签页后本页会自动接管。
          </div>
        )}

        <nav className={styles.tabs}>
          {TABS.map((tab) => {
            const count = tabCount(tab.key);
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`${styles.tab} ${active ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                {tab.label}
                {count ? <span className={styles.tabCount}>{count}</span> : null}
                {tab.key === 'relations' && problemCount > 0 ? (
                  <span className={`${styles.tabCount} ${styles.tabCountBad}`}>{problemCount}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <main className={styles.main}>
          {activeTab === 'canvas' && (
            <div className={styles.stack}>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>建模画布</h2>
                    <p className={styles.subtle}>
                      自由拖拽、分组和折叠。卡片只显示数值量，蓝色箭头由「关系结构」里的公式自动生成。
                    </p>
                  </div>
                  <div className={styles.panelActions}>
                    <span className={styles.badge}>{quantityCount} 个量</span>
                    <span className={styles.badge}>{relationCount} 条关系</span>
                    <Button size="small" onClick={() => setActiveTab('relations')}>
                      写关系
                    </Button>
                  </div>
                </div>
                <div className={styles.canvasStage}>
                  <CanvasWorkspace />
                </div>
              </section>

              <div className={styles.gridTwo}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>变量</h2>
                      <p className={styles.subtle}>拖到另一个节点上可改归属；点击在画布中选中。</p>
                    </div>
                  </div>
                  <div className={styles.panelBody}>
                    <VariableTree />
                  </div>
                </section>

                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>折叠包</h2>
                      <p className={styles.subtle}>纯显示层：多个包可以独立展开或收起，不影响计算。</p>
                    </div>
                  </div>
                  <div className={styles.panelBody}>
                    <BundlePanel />
                  </div>
                </section>
              </div>

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>属性</h2>
                    <p className={styles.subtle}>选中节点或折叠包后在这里改名、改归属、看公式。</p>
                  </div>
                </div>
                <div className={`${styles.panelBody} ${styles.inspectorBody}`}>
                  <InspectorPanel />
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>使用顺序</h2>
                    <p className={styles.subtle}>工具的主流程只有一条：先放量，再写关系，然后回画布看箭头与结果。</p>
                  </div>
                </div>
                <ol className={styles.steps}>
                  <li>
                    在画布点「变量」新建数值量。所有量使用同一张卡片，默认是值为 0 的自由输入。
                  </li>
                  <li>
                    到「关系结构」给变量写公式。前置量可以在同一行里用 <code>let a = …;</code>{' '}
                    局部定义，名字只在这一条关系内有效。
                  </li>
                  <li>回到画布。公式引用会自动生成蓝色依赖箭头；点箭头会跳回对应的关系行。</li>
                  <li>
                    多选变量后点「打包」，把乘区等一组量折叠成一张卡片；折叠包只改变显示，不参与计算。
                  </li>
                </ol>
              </section>
            </div>
          )}

          {activeTab === 'data' && (
            <div className={styles.stack}>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>数据列表与局域关系</h2>
                    <p className={styles.subtle}>
                      左侧点击一个量，右侧显示它的上游推导来源和下游可推导量。
                    </p>
                  </div>
                </div>
                <div className={styles.panelBody}>
                  <DataListWorkspace />
                </div>
              </section>
            </div>
          )}

          {activeTab === 'relations' && (
            <div className={styles.stack}>
              <section className={`${styles.panel} ${styles.panelTall}`}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>关系结构</h2>
                    <p className={styles.subtle}>
                      每条关系就是一行公式。公式里引用到的量会自动在画布上连出箭头；局部量只在这一行内有效。
                    </p>
                  </div>
                  <div className={styles.panelActions}>
                    <span className={styles.badge}>{relationCount} 条关系</span>
                    <span className={styles.badge}>
                      {quantityCount - relationCount} 个自由输入
                    </span>
                  </div>
                </div>
                <div className={styles.fillBody}>
                  <RelationsPanel />
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>问题</h2>
                    <p className={styles.subtle}>
                      解析失败、未知变量、除零与循环引用都会在这里列出；点击一行可在画布中定位。
                    </p>
                  </div>
                  <span className={styles.badge}>{problemCount} 个</span>
                </div>
                {problemCount === 0 ? (
                  <div className={styles.emptyNote}>没有发现公式或结构问题。</div>
                ) : (
                  <ul className={styles.problemList}>
                    {problemEntries.map(([nodeId, message]) => {
                      const node = project.nodes[nodeId];
                      return (
                        <li key={nodeId}>
                          <button
                            type="button"
                            onClick={() => {
                              selectNodes([nodeId]);
                              setActiveTab('canvas');
                            }}
                          >
                            <span className={styles.problemName}>{node?.label ?? nodeId}</span>
                            <span className={styles.problemMessage}>{message}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}

          {activeTab === 'logs' && (
            <section className={`${styles.panel} ${styles.panelTall}`}>
              <div className={styles.panelHead}>
                <div>
                  <h2>日志分析</h2>
                  <p className={styles.subtle}>
                    导入 CSV / JSONL，筛选、分组、聚合并保存分析视图。数据只留在本机浏览器。
                  </p>
                </div>
              </div>
              <div className={styles.logsBody}>
                <LogWorkspace />
              </div>
            </section>
          )}

          {activeTab === 'compare' && (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2>对比分析</h2>
                  <p className={styles.subtle}>模型输出与真实日志的误差分析将在 M4 开放。</p>
                </div>
                <Tag bordered={false} color="processing">
                  规划中
                </Tag>
              </div>
              <div className={styles.emptyNote}>
                当前可以先完成「建模画布 → 关系结构 → 日志分析」的闭环；对比分析会在后续版本接入。
              </div>
            </section>
          )}
        </main>

        <footer className={styles.footer}>
          <span>数据保存在本机浏览器 · 自动保存 · 可导出 JSON 备份</span>
          <span>
            Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Delete 删除选中 · v{docRevision}
          </span>
        </footer>
      </div>
      <CollectionEditor />
    </div>
  );
}
