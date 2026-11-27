import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter } from 'react-router-dom';
import App from './app/App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#58c4ff',
          colorBgBase: '#080c11',
          colorBgContainer: '#111a24',
          colorBgElevated: '#16222f',
          colorBorder: '#21303f',
          colorBorderSecondary: '#1e2c3a',
          borderRadius: 8,
          fontSize: 13,
        },
      }}
    >
      <HashRouter>
        <App />
      </HashRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
