import { useEffect, useRef } from 'react';
import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { AggregateResult } from '@/core/logs/aggregate';
import type { TimeBucketUnit } from '@/core/logs/aggregate';
import styles from './ChartPanel.module.css';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export interface ChartPanelProps {
  result: AggregateResult;
  chartType: 'line' | 'bar';
  timeUnit?: TimeBucketUnit;
}

const PALETTE = ['#4f9dff', '#3ecf8e', '#e3b341', '#f0616d', '#a78bfa', '#22d3ee'];

const pad = (value: number) => String(value).padStart(2, '0');

function formatTimeLabel(value: number, unit?: TimeBucketUnit): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  if (unit === 'month') return `${year}-${month}`;
  if (unit === 'day') return `${month}-${day}`;
  return `${month}-${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatGroupKey(
  value: string | number | null,
  type: string,
  unit?: TimeBucketUnit,
): string {
  if (value === null) return '（空）';
  if (type === 'date' && typeof value === 'number') {
    return formatTimeLabel(value, unit);
  }
  return String(value);
}

function buildOption(
  result: AggregateResult,
  chartType: 'line' | 'bar',
  timeUnit?: TimeBucketUnit,
): EChartsCoreOption {
  const groupColumns = result.columns.filter((column) => !column.id.startsWith('metric:'));
  const metricColumns = result.columns.filter((column) => column.id.startsWith('metric:'));
  // Bucketed dates get evenly spaced category labels; raw dates keep a real
  // time axis so gaps between samples stay meaningful.
  const timeAxis = groupColumns.length === 1 && groupColumns[0]!.type === 'date' && !timeUnit;

  const categories = result.rows.map((row) =>
    groupColumns
      .map((column, index) => formatGroupKey(row[index] ?? null, column.type, timeUnit))
      .join(' / '),
  );

  const series = metricColumns.map((column, metricIndex) => ({
    name: column.name,
    type: chartType,
    smooth: chartType === 'line',
    symbolSize: 5,
    connectNulls: false,
    data: timeAxis
      ? result.rows.map((row) => [row[0], row[groupColumns.length + metricIndex] ?? null])
      : result.rows.map((row) => row[groupColumns.length + metricIndex] ?? null),
  }));

  if (series.length === 0) {
    series.push({
      name: '行数',
      type: chartType,
      smooth: chartType === 'line',
      symbolSize: 5,
      connectNulls: false,
      data: [],
    });
  }

  return {
    color: PALETTE,
    animation: false,
    grid: { left: 52, right: 20, top: 36, bottom: timeAxis ? 48 : 28 },
    tooltip: { trigger: 'axis' },
    legend: { top: 4, type: 'scroll', textStyle: { color: '#9aa4b2', fontSize: 11 } },
    dataZoom: timeAxis
      ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 4 }]
      : undefined,
    xAxis: timeAxis
      ? {
          type: 'time',
          axisLabel: {
            color: '#9aa4b2',
            fontSize: 11,
            hideOverlap: true,
            formatter: (value: number) => formatTimeLabel(value, timeUnit),
          },
          axisLine: { lineStyle: { color: '#2a3040' } },
        }
      : {
          type: 'category',
          data: categories,
          axisLabel: { color: '#9aa4b2', fontSize: 11, hideOverlap: true },
          axisLine: { lineStyle: { color: '#2a3040' } },
        },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#9aa4b2', fontSize: 11 },
      splitLine: { lineStyle: { color: '#1c2130' } },
    },
    series,
  };
}

export default function ChartPanel({ result, chartType, timeUnit }: ChartPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const chart = echarts.init(hostRef.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(hostRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(buildOption(result, chartType, timeUnit), true);
  }, [result, chartType, timeUnit]);

  return <div ref={hostRef} className={styles.chart} />;
}
