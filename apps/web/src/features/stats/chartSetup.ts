/** Register only the Chart.js pieces the stats screen uses (tree-shaking). */
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

// Neutral grey reads fine on light and dark backgrounds.
Chart.defaults.color = '#8e8e93';
Chart.defaults.borderColor = 'rgba(142, 142, 147, 0.2)';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", sans-serif';
Chart.defaults.maintainAspectRatio = false;
// Tap or drag across a chart shows the values at that x position (SPEC §5.2).
Chart.defaults.interaction.mode = 'index';
Chart.defaults.interaction.intersect = false;

export { Chart };
