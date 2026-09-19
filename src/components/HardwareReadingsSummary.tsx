import type { TelemetryView } from '../types';
import { formatMetricValue, metricRows, sensorFlagShare } from '../lib/telemetry';

const SENSOR_STATUS_NOTES: Record<string, string> = {
  NOT_PRESENT: 'GPU temperature and power are read only on NVIDIA GPUs, through the installed NVIDIA driver.',
  SIGNATURE_REJECTED: 'NVIDIA’s driver library did not pass Dialed’s signature check, so GPU temperature and power were not read.',
  UNAVAILABLE: 'The NVIDIA driver library could not be opened, so GPU temperature and power were not read.',
};

function share(value: number) {
  return `${(value * 100).toFixed(0)}%`;
}

export function HardwareReadingsSummary({ view }: { view: TelemetryView }) {
  const rows = metricRows(view);
  const limitedShare = view.summary.performanceLimitedShare;
  const unverified = view.adapters.some((adapter) => adapter.identity !== 'VERIFIED');
  return <div className="text-xs text-slate-300">
    {rows.length > 0 ? <div className="overflow-x-auto"><table className="w-full min-w-[26rem] text-left">
      <thead className="text-[11px] text-slate-500"><tr><th className="py-1 pr-3 font-semibold">Reading</th><th className="py-1 pr-3 font-semibold">Average</th><th className="py-1 pr-3 font-semibold">95th pct</th><th className="py-1 pr-3 font-semibold">Peak</th><th data-technical-detail className="py-1 font-semibold">Coverage</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key} className="border-t border-slate-800">
        <td className="py-1.5 pr-3 text-slate-400">{row.label}</td>
        <td className="py-1.5 pr-3">{formatMetricValue(row.stat.mean, row.unit)}{row.capacityBytes && row.stat.mean !== null ? <span className="text-slate-500"> of {formatMetricValue(row.capacityBytes, 'bytes')}</span> : null}</td>
        <td className="py-1.5 pr-3">{formatMetricValue(row.stat.p95, row.unit)}</td>
        <td className="py-1.5 pr-3">{formatMetricValue(row.stat.max, row.unit)}</td>
        <td data-technical-detail className="py-1.5 text-slate-500">{row.stat.coveragePercent === null ? '—' : `${row.stat.coveragePercent.toFixed(0)}% · ${row.stat.stale} stale · ${row.stat.unavailable} missing`}</td>
      </tr>)}</tbody>
    </table></div> : <p className="text-slate-400">Windows did not return usable readings.</p>}
    <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-500">
      {limitedShare !== null && limitedShare > 0 ? <li className="text-amber-200">Windows reported the processor was limited below its maximum performance in {(limitedShare * 100).toFixed(0)}% of readings. Windows does not say why, so this is not proof of overheating.</li> : null}
      {view.targetChanged ? <li className="text-amber-200">The captured app closed or restarted, so its video memory stopped being counted.</li> : null}
      {view.adapters.flatMap((adapter) => {
        const notes: Array<[string, string]> = [];
        const thermal = sensorFlagShare(view, adapter.id, 'thermalSlowdown');
        const power = sensorFlagShare(view, adapter.id, 'powerLimited');
        const hardware = sensorFlagShare(view, adapter.id, 'hardwareSlowdown');
        if (thermal) notes.push([`${adapter.id}-thermal`, `NVIDIA reported thermal slowdown on ${adapter.label} in ${share(thermal)} of readings.`]);
        if (power) notes.push([`${adapter.id}-power`, `NVIDIA reported ${adapter.label} held at its power limit in ${share(power)} of readings.`]);
        if (hardware) notes.push([`${adapter.id}-hardware`, `NVIDIA reported a hardware slowdown (heat or power) on ${adapter.label} in ${share(hardware)} of readings.`]);
        return notes.map(([key, text]) => <li key={key} className="text-amber-200">{text}</li>);
      })}
      {unverified ? <li>A graphics adapter could not be matched to a single device, so it is labelled by number.</li> : null}
      {view.sensors?.status === 'OK' ? <li>GPU temperature, power and slowdown reasons come from the NVIDIA driver{view.sensors.driverVersion ? ` (version ${view.sensors.driverVersion})` : ''}.</li> : view.sensors && SENSOR_STATUS_NOTES[view.sensors.status] ? <li>{SENSOR_STATUS_NOTES[view.sensors.status]}</li> : null}
      <li>GPU 3D engine load is not total GPU load. CPU speed is the rated base speed × “CPU speed vs. rated base”, the same way Task Manager calculates it; above 100% means boosting above base. CPU temperatures are not read.</li>
    </ul>
  </div>;
}
