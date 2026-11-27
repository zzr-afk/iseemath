import { useEffect, useState } from 'react';
import { Spin } from 'antd';
import WorkspaceShell from './WorkspaceShell';
import { initPersistence } from '@/platform/storage/autosave';
import { scanDatasetsOnStartup } from '@/features/logs/startupScan';
import { initBlobRefSync } from '@/features/logs/blobRefSync';

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void initPersistence()
      .then(() => {
        if (mounted) setReady(true);
        // Blob reconciliation + runtime seeding are background work; the
        // workspace should not wait on them.
        initBlobRefSync();
        void scanDatasetsOnStartup().catch(() => undefined);
      })
      .catch(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--bg-app)',
          color: 'var(--text-secondary)',
          gap: 12,
        }}
      >
        <Spin size="large" />
        <div style={{ fontSize: 12 }}>正在加载本地项目…</div>
      </div>
    );
  }

  return <WorkspaceShell />;
}
