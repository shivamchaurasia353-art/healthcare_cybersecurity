import { create } from 'zustand';
import api from '../services/api';

const useAuthStore = create((set, get) => ({
  user: null,
  healthId: null,
  isAuthenticated: false,
  isLoading: false,
  initialized: false,

  initialize: () => {
    const token = localStorage.getItem('accessToken');
    const healthId = localStorage.getItem('healthId');
    const fullName = localStorage.getItem('fullName');
    if (token && healthId) {
      set({ isAuthenticated: true, healthId, user: { fullName, healthId }, initialized: true });
    } else {
      set({ initialized: true });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    const { data } = await api.post('/auth/login', { email, password });
    if (data.requiresMfa) {
      set({ isLoading: false });
      return { requiresMfa: true, preAuthToken: data.preAuthToken };
    }
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('healthId', data.healthId);
    localStorage.setItem('fullName', data.fullName);
    set({ isAuthenticated: true, healthId: data.healthId, user: { fullName: data.fullName, healthId: data.healthId }, isLoading: false });
    return { requiresMfa: false };
  },

  verifyMfa: async (preAuthToken, totpCode) => {
    const { data } = await api.post('/auth/mfa/verify', { preAuthToken, totpCode });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('healthId', data.healthId);
    localStorage.setItem('fullName', data.fullName);
    set({ isAuthenticated: true, healthId: data.healthId, user: { fullName: data.fullName, healthId: data.healthId } });
  },

  logout: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try { await api.post('/auth/logout', { refreshToken }); } catch {}
    localStorage.clear();
    set({ user: null, healthId: null, isAuthenticated: false });
  },
}));

export default useAuthStore;
