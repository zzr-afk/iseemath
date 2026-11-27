import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Tag, Tooltip, message, type MenuProps } from 'antd';
import { FolderOpenOutlined, SaveOutlined } from '@ant-design/icons';
import {
  createNewProject,
  exportCurrentDraft,
  exportCurrentProject,
  importProjectFromText,
  listProjects,
  openProject,
  reloadCurrentFromStorage,
} from '@/platform/storage/autosave';
import { usePersistenceStore } from '@/stores/persistenceStore';

const STATUS_TEXT: Record<string, { text: string; color?: string }> = {
  loading: { text: '加载中', color: 'default' },
  saved: { text: '已保存', color: 'success' },
  saving: { text: '保存中', color: 'processing' },
  readonly: { text: '只读', color: 'warning' },
  conflict: { text: '保存冲突', color: 'error' },
  error: { text: '保存失败', color: 'error' },
  unavailable: { text: '未持久化', color: 'default' },
};

export default function ProjectMenu() {
  const status = usePersistenceStore((state) => state.status);
  const statusMessage = usePersistenceStore((state) => state.message);
  const draftAvailable = usePersistenceStore((state) => state.draftAvailable);
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, [status]);

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      await importProjectFromText(text);
      message.success('项目已导入为新的本地项目');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  const items: MenuProps['items'] = [
    {
      key: 'new',
      label: '新建项目',
      onClick: () => {
        void createNewProject()
          .then(() => message.success('已新建项目'))
          .catch((error) => message.error(error instanceof Error ? error.message : String(error)));
      },
    },
    {
      key: 'open',
      label: '打开项目',
      children:
        projects.length === 0
          ? [{ key: 'none', label: '（暂无本地项目）', disabled: true }]
          : projects.slice(0, 12).map((project) => ({
              key: project.id,
              label: project.name,
              onClick: () => {
                void openProject(project.id)
                  .then(() => message.success(`已打开「${project.name}」`))
                  .catch((error) =>
                    message.error(error instanceof Error ? error.message : String(error)),
                  );
              },
            })),
    },
    { type: 'divider' },
    {
      key: 'import',
      label: '导入项目 JSON…',
      onClick: () => fileInput.current?.click(),
    },
    {
      key: 'export',
      label: '导出项目 JSON',
      onClick: () => {
        void exportCurrentProject()
          .then(() => message.success('已导出'))
          .catch((error) => message.error(error instanceof Error ? error.message : String(error)));
      },
    },
    ...(draftAvailable || status === 'conflict'
      ? [
          { type: 'divider' as const },
          {
            key: 'draft-export',
            label: '导出本地草稿',
            onClick: () => exportCurrentDraft(),
          },
          {
            key: 'draft-discard',
            label: '放弃本地改动并重新加载',
            danger: true,
            onClick: () => {
              void reloadCurrentFromStorage().catch((error) =>
                message.error(error instanceof Error ? error.message : String(error)),
              );
            },
          },
        ]
      : []),
  ];

  const statusInfo = STATUS_TEXT[status] ?? STATUS_TEXT.loading!;

  return (
    <>
      <Dropdown menu={{ items }} trigger={['click']}>
        <Button size="small" type="text" icon={<FolderOpenOutlined />}>
          项目
        </Button>
      </Dropdown>
      <Tooltip title={statusMessage ?? statusInfo.text}>
        <Tag bordered={false} color={statusInfo.color} style={{ marginInlineEnd: 0 }}>
          {status === 'saved' ? <SaveOutlined style={{ marginRight: 4 }} /> : null}
          {statusInfo.text}
        </Tag>
      </Tooltip>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </>
  );
}
