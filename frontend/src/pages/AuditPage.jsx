import { useQuery } from '@tanstack/react-query';
import { Shield, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import api from '../services/api';

const OUTCOME_ICON = {
  SUCCESS: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  FAILURE: <XCircle className="w-4 h-4 text-red-500" />,
  BLOCKED: <AlertTriangle className="w-4 h-4 text-orange-500" />,
};

const SEVERITY_BADGE = {
  INFO: 'badge-info',
  WARNING: 'badge-warning',
  CRITICAL: 'badge-danger',
};

export default function AuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-audit'],
    queryFn: () => api.get('/audit/my?limit=50').then(r => r.data.logs),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Shield className="w-6 h-6 text-blue-600" /> Audit Trail
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          An immutable, tamper-evident log of all actions on your account and health data.
        </p>
      </div>

      {isLoading && <p className="text-slate-400">Loading audit trail...</p>}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Event</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Category</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Outcome</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 hidden md:table-cell">IP</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.map((log) => (
              <tr key={log.event_id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {OUTCOME_ICON[log.outcome]}
                    <div>
                      <p className="font-medium text-slate-700">{log.event_type.replace(/_/g, ' ')}</p>
                      <span className={SEVERITY_BADGE[log.severity] || 'badge-info'}>{log.severity}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{log.event_category}</td>
                <td className="px-4 py-3">
                  <span className={log.outcome === 'SUCCESS' ? 'badge-success' : log.outcome === 'BLOCKED' ? 'badge-warning' : 'badge-danger'}>
                    {log.outcome}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 font-mono text-xs hidden md:table-cell">{log.ip_address || '—'}</td>
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && (
          <p className="text-center py-8 text-slate-400">No audit events found.</p>
        )}
      </div>
    </div>
  );
}
