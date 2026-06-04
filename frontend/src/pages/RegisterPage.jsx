import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [registeredId, setRegisteredId] = useState('');
  const [form, setForm] = useState({
    fullName: '', dateOfBirth: '', gender: '', phone: '', email: '',
    password: '', confirmPassword: '', aadharLast4: '',
  });

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      return toast.error('Passwords do not match');
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        fullName: form.fullName, dateOfBirth: form.dateOfBirth,
        gender: form.gender, phone: form.phone, email: form.email,
        password: form.password, aadharLast4: form.aadharLast4,
      });
      setRegisteredId(data.healthId);
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Registration Successful!</h2>
          <p className="text-slate-500 mb-6">Your Lifetime Health ID has been created.</p>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
            <p className="text-xs text-blue-600 font-medium mb-1">YOUR ABHA HEALTH ID</p>
            <p className="font-mono text-xl font-bold text-blue-800">{registeredId}</p>
            <p className="text-xs text-slate-500 mt-2">Save this ID — it is your permanent healthcare identifier.</p>
          </div>
          <button onClick={() => navigate('/login')} className="btn-primary w-full py-3">
            Proceed to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-500 rounded-2xl mb-3">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create your Health Account</h1>
          <p className="text-blue-200 text-sm mt-1">Secure • Private • Consent-driven</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input type="text" required value={form.fullName} onChange={update('fullName')}
                  className="input-field" placeholder="As per Aadhaar card" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date of Birth</label>
                <input type="date" required value={form.dateOfBirth} onChange={update('dateOfBirth')}
                  className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Gender</label>
                <select required value={form.gender} onChange={update('gender')} className="input-field">
                  <option value="">Select</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mobile Number</label>
                <input type="tel" required value={form.phone} onChange={update('phone')}
                  className="input-field" placeholder="+91XXXXXXXXXX" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Aadhaar Last 4 Digits</label>
                <input type="text" value={form.aadharLast4} onChange={update('aadharLast4')}
                  maxLength={4} className="input-field" placeholder="XXXX" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <input type="email" required value={form.email} onChange={update('email')}
                  className="input-field" placeholder="you@example.com" autoComplete="email" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input type="password" required value={form.password} onChange={update('password')}
                  className="input-field" placeholder="Min 10 chars, mixed case + symbol" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
                <input type="password" required value={form.confirmPassword} onChange={update('confirmPassword')}
                  className="input-field" placeholder="Repeat password" autoComplete="new-password" />
              </div>
            </div>

            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
              By registering, you agree to consent-driven data sharing. Only you control who can access your health records.
            </p>

            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? 'Creating Account...' : 'Create Health Account'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
