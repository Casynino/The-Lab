import { Suspense, lazy, useRef } from 'react';
import { pages } from '@/lib/pages';

// The same four charts as components/charts, for the home dashboard: the page
// and its figures no longer wait for the chart library (recharts, the largest
// file in the app) — each chart takes its place as the library arrives. The
// space it will fill is held at its exact height (every chart is a full-width
// box of `height` px), so nothing moves when it draws.
function lazyChart(exportName, defaultHeight) {
  const Lazy = lazy(() => pages.load('charts').then((m) => ({ default: m[exportName] })));
  function Chart(props) {
    const Body = useRef(pages.loaded('charts', exportName) || Lazy).current;
    return (
      <Suspense fallback={<div aria-hidden="true" style={{ width: '100%', height: props.height ?? defaultHeight }} />}>
        <Body {...props} />
      </Suspense>
    );
  }
  Chart.displayName = exportName;
  return Chart;
}

// Default heights are the ones components/charts.jsx gives each chart.
export const TrendChart = lazyChart('TrendChart', 260);
export const BarChartCard = lazyChart('BarChartCard', 280);
export const DonutChart = lazyChart('DonutChart', 260);
export const MonthBars = lazyChart('MonthBars', 230);
