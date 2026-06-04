import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { User, Shield, QrCode, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

export default function ProfilePage() {
  const [mfaStep, setMfaStep] = useState(null); // null | 'setup' | 'confirm'
  const [qrCode, setQrCode] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const { data: identity, refetch } = useQuery({
    queryKey: ['my-identity'],
    queryFn: () => api.get('/identity/me').then(r => r.data.identity),
  });

  const setupMutation = useMutation({
    mutationFn: () => api.post('/auth/mfa/setup'),
    onSuccess: (res) => { setQrCode(res.data.qrCode); setMfaStep('confirm'); },
    onError: (e) => toast.error(e.response?.data?.error || 'MFA setup failed'),
  });

  const confirmMutation = useMutation({
    mutationFn: () => api.post('/auth/mfa/confirm', { totpCode }),
    onSuccess: () => { toast.success('MFA enabled!'); setMfaStep(null); refetch(); },
    onError: (e) => toast.error(e.response?.data?.error || 'Invalid code'),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Profile & Security</h1>
        <p className="text-slate-500 text-sm mt-1">Manage your identity and security settings.</p>
      </div>

      {/* Identity card */}
      <div className="card">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center">
            <User className="w-7 h-7 text-blue-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-800">{identity?.full_name}</p>
            <p className="text-slate-500 text-sm">{identity?.email}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          {[
            ['Lifetime Health ID', identity?.health_id, 'font-mono font-bold text-blue-700'],
            ['Date of Birth', identity?.date_of_birth ? new Date(identity.date_of_birth).toLocaleDateString('en-IN') : '—'],
            ['Gender', identity?.gender],
            ['Phone', identity?.phone],
            ['Member Since', identity?.created_at ? new Date(identity.created_at).toLocaleDateString() : '—'],
            ['Last Login', identity?.last_login ? new Date(identity.last_login).toLocaleString() : 'Never'],
          ].map(([label, value, cls]) => (
            <div key={label}>
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`text-slate-700 font-medium ${cls || ''}`}>{value || '—'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Security settings */}
      <div className="card">
        <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-blue-600" /> Security Settings
        </h2>

        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div>
            <p className="font-medium text-slate-700">Two-Factor Authentication (MFA)</p>
            <p className="text-sm text-slate-400">TOTP authenticator app for extra login security</p>
          </div>
          {identity?.mfa_enabled ? (
            <span className="badge-success flex items-center gap-1"><CheckCircle className="w-3 h-3" />Enabled</span>
          ) : (
            <button onClick={() => setupMutation.mutate()} className="btn-primary text-sm py-1.5 flex items-center gap-2">
              <QrCode className="w-4 h-4" /> Enable MFA
            </button>
          )}
        </div>

        {/* MFA Setup flow */}
        {mfaStep === 'confirm' && (
          <div className="mt-4 p-4 bg-blue-50 rounded-xl">
            <p className="font-medium text-slate-700 mb-3">Scan with your authenticator app:</p>
            {qrCode && <img src={qrCode} alt="MFA QR Code" className="w-40 h-40 mx-auto rounded-lg border border-blue-200 mb-4" />}
            <input
              type="text" value={totpCode} maxLength={6}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              className="input-field text-center font-mono text-lg tracking-widest mb-3"
              placeholder="Enter 6-digit code"
            />
            <div className="flex gap-2">
              <button onClick={() => confirmMutation.mutate()} disabled={totpCode.length !== 6} className="btn-primary text-sm flex-1">
                Confirm & Enable
              </button>
              <button onClick={() => setMfaStep(null)} className="btn-outline text-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
