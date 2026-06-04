import { useQuery } from '@tanstack/react-query';
import { Shield, FileText, ClipboardCheck, AlertTriangle, Activity, CheckCircle2, Clock } from 'lucide-react';
import api from '../services/api';
import useAuthStore from '../store/authStore';

function StatCard({ icon: Icon, label, value, color = 'blue', sub }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-xl ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-800">{value ?? '—'}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, healthId } = useAuthStore();

  const { data: consents } = useQuery({
    queryKey: ['active-consents'],
    queryFn: () => api.get('/consent/my/active').then(r => r.data.consents),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const { data: requests } = useQuery({
    queryKey: ['consent-requests'],
    queryFn: () => api.get('/consent/my/requests').then(r => r.data.requests),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const { data: records } = useQuery({
    queryKey: ['my-records'],
    queryFn: () => api.get('/records/my').then(r => r.data.records),
  });

  const pending = requests?.filter(r => r.status === 'PENDING') || [];
  const recentRecords = records?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Welcome back, {user?.fullName?.split(' ')[0]}</h1>
          <p className="text-slate-500 text-sm mt-1">Here's your health data overview</p>
        </div>
        <div className="bg-blue-600 text-white rounded-xl px-4 py-2 text-right hidden sm:block">
          <p className="text-xs text-blue-200">Health ID</p>
          <p className="font-mono font-bold text-sm">{healthId}</p>
        </div>
      </div>

      {/* Pending consent alert */}
      {pending.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-yellow-800">{pending.length} pending consent request{pending.length > 1 ? 's' : ''}</p>
            <p className="text-sm text-yellow-700">Healthcare providers are waiting for your approval to access records.</p>
          </div>
          <a href="/consent" className="ml-auto btn-primary text-sm py-1.5 whitespace-nowrap">Review</a>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ClipboardCheck} label="Active Consents" value={consents?.length ?? 0} color="green" sub="Vendors with approved access" />
        <StatCard icon={Clock} label="Pending Requests" value={pending.length} color="orange" sub="Awaiting your decision" />
        <StatCard icon={FileText} label="Health Records" value={records?.length ?? 0} color="blue" sub="Total stored records" />
        <StatCard icon={Shield} label="Security Status" value="Protected" color="green" sub="All systems normal" />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Active consents */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" /> Active Consents
            </h2>
            <a href="/consent" className="text-sm text-blue-600 hover:underline">Manage</a>
          </div>
          {consents?.length === 0 && <p className="text-slate-400 text-sm">No active consents.</p>}
          <div className="space-y-3">
            {consents?.slice(0, 4).map((c) => (
              <div key={c.token_ref} className="flex items-start justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-slate-700">{c.vendor_name}</p>
                  <p className="text-xs text-slate-400">{c.purpose} • {c.allowed_record_types.join(', ')}</p>
                </div>
                <div className="text-right">
                  <span className="badge-success">Active</span>
                  <p className="text-xs text-slate-400 mt-1">
                    Until {new Date(c.valid_until).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent records */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" /> Recent Records
            </h2>
            <a href="/records" className="text-sm text-blue-600 hover:underline">View All</a>
          </div>
          {recentRecords.length === 0 && <p className="text-slate-400 text-sm">No health records yet.</p>}
          <div className="space-y-3">
            {recentRecords.map((r) => (
              <div key={r.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{r.title}</p>
                  <p className="text-xs text-slate-400">{r.record_type} • {r.vendor_name} • {new Date(r.record_date).toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
