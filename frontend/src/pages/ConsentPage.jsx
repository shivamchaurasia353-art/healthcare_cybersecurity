import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, RotateCcw, Clock, AlertTriangle, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

const STATUS_BADGE = {
  PENDING: 'badge-warning',
  APPROVED: 'badge-success',
  DENIED: 'badge-danger',
  REVOKED: 'badge-danger',
  EXPIRED: 'badge-info',
};

const URGENCY_COLOR = { ROUTINE: 'text-slate-400', URGENT: 'text-orange-500', EMERGENCY: 'text-red-600' };

export default function ConsentPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('requests');

  const { data: requests, isLoading: reqLoading } = useQuery({
    queryKey: ['consent-requests'],
    queryFn: () => api.get('/consent/my/requests').then(r => r.data.requests),
    refetchInterval: 5000,        // poll every 5s for new requests
    refetchIntervalInBackground: false,
  });

  const { data: active, isLoading: activeLoading } = useQuery({
    queryKey: ['active-consents'],
    queryFn: () => api.get('/consent/my/active').then(r => r.data.consents),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const approveMutation = useMutation({
    mutationFn: (id) => api.post(`/consent/requests/${id}/approve`),
    onSuccess: () => { toast.success('Consent approved'); qc.invalidateQueries(['consent-requests', 'active-consents']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Approval failed'),
  });

  const denyMutation = useMutation({
    mutationFn: (id) => api.post(`/consent/requests/${id}/deny`),
    onSuccess: () => { toast.success('Request denied'); qc.invalidateQueries(['consent-requests']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Deny failed'),
  });

  const revokeMutation = useMutation({
    mutationFn: (ref) => api.post(`/consent/tokens/${ref}/revoke`, { reason: 'Revoked by patient' }),
    onSuccess: () => { toast.success('Consent revoked immediately'); qc.invalidateQueries(['active-consents', 'consent-requests']); },
    onError: (e) => toast.error(e.response?.data?.error || 'Revocation failed'),
  });

  const pending = requests?.filter(r => r.status === 'PENDING') || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Consent Management</h1>
        <p className="text-slate-500 text-sm mt-1">Control which providers can access your health records and revoke at any time.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {[['requests', `Requests${pending.length ? ` (${pending.length})` : ''}`], ['active', 'Active Consents']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {reqLoading && <p className="text-slate-400">Loading...</p>}
          {requests?.length === 0 && <p className="text-slate-400">No consent requests.</p>}
          {requests?.map((req) => (
            <div key={req.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Shield className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800">{req.vendor_name}</p>
                    <p className="text-xs text-slate-400">{req.vendor_type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={URGENCY_COLOR[req.urgency] + ' text-xs font-medium'}>{req.urgency}</span>
                  <span className={STATUS_BADGE[req.status]}>{req.status}</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Purpose</p>
                  <p className="font-medium text-slate-700">{req.purpose}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Requested Records</p>
                  <div className="flex flex-wrap gap-1">
                    {req.requested_data_types?.map(t => <span key={t} className="badge-info">{t}</span>)}
                  </div>
                </div>
                {req.requester_note && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400 mb-0.5">Note from Provider</p>
                    <p className="text-slate-600 text-xs italic">"{req.requester_note}"</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Requested</p>
                  <p className="text-slate-600">{new Date(req.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Expires</p>
                  <p className={`${new Date(req.expires_at) < new Date() ? 'text-red-500' : 'text-slate-600'}`}>
                    {new Date(req.expires_at).toLocaleString()}
                  </p>
                </div>
              </div>

              {req.status === 'PENDING' && new Date(req.expires_at) > new Date() && (
                <div className="flex gap-3 mt-4 pt-4 border-t border-slate-100">
                  <button onClick={() => approveMutation.mutate(req.id)} className="btn-primary flex items-center gap-2 text-sm">
                    <CheckCircle className="w-4 h-4" /> Approve
                  </button>
                  <button onClick={() => denyMutation.mutate(req.id)} className="btn-danger flex items-center gap-2 text-sm">
                    <XCircle className="w-4 h-4" /> Deny
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active Consents Tab */}
      {activeTab === 'active' && (
        <div className="space-y-4">
          {activeLoading && <p className="text-slate-400">Loading...</p>}
          {active?.length === 0 && <p className="text-slate-400">No active consents. Approve a request to grant access.</p>}
          {active?.map((c) => (
            <div key={c.token_ref} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800">{c.vendor_name}</p>
                  <p className="text-xs text-slate-400">{c.vendor_type}</p>
                </div>
                <span className="badge-success">Active</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Purpose</p>
                  <p className="font-medium text-slate-700">{c.purpose}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Allowed Data Types</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {c.allowed_record_types?.map(t => <span key={t} className="badge-info">{t}</span>)}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Valid Until</p>
                  <p className="text-slate-700">{new Date(c.valid_until).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Access Count</p>
                  <p className="text-slate-700">{c.access_count} times</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100">
                <button onClick={() => { if (window.confirm('Revoke this consent? The provider will lose access immediately.')) revokeMutation.mutate(c.token_ref); }}
                  className="btn-danger flex items-center gap-2 text-sm">
                  <RotateCcw className="w-4 h-4" /> Revoke Access
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
