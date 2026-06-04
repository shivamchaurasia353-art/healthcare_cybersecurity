import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import useAuthStore from '../store/authStore';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [preAuthToken, setPreAuthToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login, verifyMfa } = useAuthStore();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresMfa) {
        setPreAuthToken(result.preAuthToken);
        toast('MFA verification required', { icon: '🔐' });
      } else {
        toast.success('Welcome back!');
        navigate('/');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await verifyMfa(preAuthToken, totpCode);
      toast.success('Authenticated successfully!');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-blue-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-500 rounded-2xl mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">HealthSecure</h1>
          <p className="text-blue-200 text-sm mt-1">Secure Healthcare Data Exchange</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {!preAuthToken ? (
            <>
              <h2 className="text-xl font-bold text-slate-800 mb-6">Sign in to your account</h2>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-field" placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'} required value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-field pr-10" placeholder="••••••••••"
                      autoComplete="current-password"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-2">
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Two-Factor Verification</h2>
              <p className="text-slate-500 text-sm mb-6">Enter the 6-digit code from your authenticator app.</p>
              <form onSubmit={handleMfa} className="space-y-4">
                <input
                  type="text" required value={totpCode} maxLength={6}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  className="input-field text-center text-2xl tracking-widest font-mono"
                  placeholder="000000" autoComplete="one-time-code" inputMode="numeric"
                />
                <button type="submit" disabled={loading || totpCode.length !== 6} className="btn-primary w-full py-3">
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
                <button type="button" onClick={() => setPreAuthToken(null)}
                  className="btn-outline w-full py-2 text-sm">
                  Back to Login
                </button>
              </form>
            </>
          )}

          <p className="text-center text-sm text-slate-500 mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-blue-600 hover:underline font-medium">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
