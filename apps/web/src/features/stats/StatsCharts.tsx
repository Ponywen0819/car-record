import './chartSetup';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import type { FuelType } from '@car-record/shared';
import { formatMoney, formatNumber } from '../../lib/format';
import { economyUnit } from '../dashboard/dashboardModel';
import { CATEGORY_COLORS, type StatsResult } from './statsModel';

const color = (category: string) => CATEGORY_COLORS[category] ?? '#9ca3af';

export default function StatsCharts(props: { stats: StatsResult; fuelType: FuelType }) {
  const { stats, fuelType } = props;
  const unit = economyUnit(fuelType);

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">總花費</div>
          <div className="tile-value">{formatMoney(stats.totalCost)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">每公里成本</div>
          <div className="tile-value">{stats.costPerKm !== null ? `$${formatNumber(stats.costPerKm, 2)}` : '—'}</div>
        </div>
        <div className="tile">
          <div className="tile-label">行駛里程</div>
          <div className="tile-value">{formatNumber(stats.totalDistance)} km</div>
        </div>
        <div className="tile">
          <div className="tile-label">平均油耗</div>
          <div className="tile-value">
            {stats.averageEconomy !== null ? `${formatNumber(stats.averageEconomy, 1)}` : '—'}
            <span style={{ fontSize: 13, fontWeight: 500 }}> {unit}</span>
          </div>
        </div>
      </div>

      <div className="card chart-card">
        <h3>油耗趨勢（{unit}）</h3>
        {stats.economy.length > 0 ? (
          <div className="chart-box">
            <Line
              data={{
                labels: stats.economy.map((p) => p.date.slice(5).replace('-', '/')),
                datasets: [
                  {
                    label: unit,
                    data: stats.economy.map((p) => Math.round(p.kmPerUnit * 10) / 10),
                    borderColor: '#1f6feb',
                    backgroundColor: '#1f6feb',
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                  },
                  ...(stats.averageEconomy !== null
                    ? [
                        {
                          label: '平均',
                          data: stats.economy.map(() => Math.round(stats.averageEconomy! * 10) / 10),
                          borderColor: '#8e8e93',
                          backgroundColor: '#8e8e93',
                          borderDash: [6, 4],
                          pointRadius: 0,
                          borderWidth: 1,
                        },
                      ]
                    : []),
                ],
              }}
              options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false } } }}
            />
          </div>
        ) : (
          <div className="empty">這段期間沒有兩次加滿的紀錄。</div>
        )}
      </div>

      <div className="card chart-card">
        <h3>每月花費</h3>
        <div className="chart-box">
          <Bar
            data={{
              labels: stats.monthLabels,
              datasets: stats.categories.map((c) => ({
                label: c.label,
                data: stats.monthlyCosts.map((m) => m.byCategory[c.category] ?? 0),
                backgroundColor: color(c.category),
                stack: 'cost',
                borderRadius: 3,
              })),
            }}
            options={{
              plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
              scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
            }}
          />
        </div>
      </div>

      <div className="card chart-card">
        <h3>花費分布</h3>
        {stats.categories.length > 0 ? (
          <div className="chart-box small">
            <Doughnut
              data={{
                labels: stats.categories.map((c) => c.label),
                datasets: [
                  {
                    data: stats.categories.map((c) => c.total),
                    backgroundColor: stats.categories.map((c) => color(c.category)),
                    borderWidth: 0,
                  },
                ],
              }}
              options={{
                interaction: { mode: 'nearest', intersect: true },
                plugins: {
                  legend: { position: 'right', labels: { boxWidth: 10 } },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const v = Number(ctx.raw);
                        const pct = stats.totalCost > 0 ? Math.round((v / stats.totalCost) * 100) : 0;
                        return `${ctx.label}：${formatMoney(v)}（${pct}%）`;
                      },
                    },
                  },
                },
              }}
            />
          </div>
        ) : (
          <div className="empty">這段期間沒有花費紀錄。</div>
        )}
      </div>

      <div className="card chart-card">
        <h3>每月行駛距離（km）</h3>
        <div className="chart-box small">
          <Bar
            data={{
              labels: stats.monthLabels,
              datasets: [
                {
                  label: 'km',
                  data: stats.distance.map((d) => Math.round(d.km)),
                  backgroundColor: '#34c759',
                  borderRadius: 3,
                },
              ],
            }}
            options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }}
          />
        </div>
      </div>
    </>
  );
}
